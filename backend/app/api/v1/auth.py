"""Auth routes: Google OAuth, Sign in with Apple, and session minting.

Google OAuth still creates a User + ConnectedAccount in one consent. Apple and
"continue without Gmail" mint an Albert JWT without a mailbox — Gmail can be
linked later via /auth/google/link/start.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.rate_limit import allow_request
from app.core.security import (
    create_session_token,
    decode_session_token,
    get_current_user,
    revoke_session,
)
from app.db.base import get_db
from app.db.enums import Provider, SyncStatus
from app.db.models import ConnectedAccount, User
from app.schemas.api import AppleSignInRequest, AuthStartResponse, SessionToken
from app.services import apple_auth, google_oauth
from app.services.crypto import encrypt_token

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
_bearer = HTTPBearer(auto_error=True)

# The native app deep link. Used when the app doesn't supply its own redirect.
_DEFAULT_REDIRECT = "albert://auth"
_ANON_EMAIL_DOMAIN = "local.alfred"


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _enforce_auth_rate(request: Request, bucket: str, *, limit: int, window: int) -> None:
    ip = _client_ip(request)
    if not allow_request(f"rl:auth:{bucket}:{ip}", limit=limit, window_seconds=window):
        raise HTTPException(status_code=429, detail="Too many requests — try again shortly")


def _validate_redirect(redirect: str | None) -> str:
    """Return a safe post-login deep link, or the default.

    The app passes the deep link to return to (Linking.createURL('auth')): `albert://`
    in a real build, or `exp://<host>.exp.direct/--/auth` under Expo Go. We allow only
    those two shapes so the signed-state redirect can't be turned into an open redirect
    to an arbitrary URL.
    """
    if not redirect:
        return _DEFAULT_REDIRECT
    if redirect.startswith("albert://"):
        return redirect
    # Expo Go dev links: exp://<something>.exp.direct/... (the tunnel host) or a LAN
    # exp://<ip>:<port>/... Both are first-party Expo dev clients, not arbitrary hosts.
    if redirect.startswith("exp://") and (".exp.direct/" in redirect or "/--/" in redirect):
        return redirect
    raise HTTPException(status_code=400, detail="Disallowed redirect target")


@router.get("/google/start", response_model=AuthStartResponse)
def google_start(redirect: str | None = Query(default=None)) -> AuthStartResponse:
    """Begin the Google OAuth flow. The mobile app opens authorization_url.

    State is a short-lived JWT signed with our secret, carrying the validated post-login
    redirect. Google echoes it back to the callback unchanged, where we verify signature
    + expiry. Because the app's fetch starts the flow but a separate in-app browser
    completes it, a same-browser cookie binding can't survive that handoff — so the
    integrity guarantee is the signed, expiring state itself: a forged or replayed state
    would have to be signed with our jwt_secret, which an attacker does not have. Baking
    the redirect into the signed state (rather than re-reading it from the callback's
    query) is what keeps this from being an open redirect."""
    target = _validate_redirect(redirect)
    state = jwt.encode(
        {
            "nonce": secrets.token_urlsafe(16),
            "redirect": target,
            "exp": datetime.now(UTC) + timedelta(minutes=10),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    return AuthStartResponse(
        authorization_url=google_oauth.build_authorization_url(state), state=state
    )


@router.get("/google/link/start", response_model=AuthStartResponse)
def google_link_start(
    redirect: str | None = Query(default=None),
    user: User = Depends(get_current_user),
) -> AuthStartResponse:
    """Begin OAuth to link another Gmail mailbox to the signed-in Albert user."""
    target = _validate_redirect(redirect)
    state = jwt.encode(
        {
            "nonce": secrets.token_urlsafe(16),
            "redirect": target,
            "link_user_id": user.id,
            "exp": datetime.now(UTC) + timedelta(minutes=10),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    return AuthStartResponse(
        authorization_url=google_oauth.build_authorization_url(state), state=state
    )


def _upsert_google_account(
    db: Session,
    *,
    user: User,
    profile_email: str,
    token_payload: dict,
) -> ConnectedAccount:
    ciphertext = encrypt_token(token_payload)
    account = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.user_id == user.id,
            ConnectedAccount.provider == Provider.google,
            ConnectedAccount.provider_account_email == profile_email,
        )
    )
    if account is None:
        account = ConnectedAccount(
            user_id=user.id,
            provider=Provider.google,
            provider_account_email=profile_email,
            scopes=token_payload.get("scopes", []),
            token_ciphertext=ciphertext,
            sync_status=SyncStatus.never,
        )
        db.add(account)
    else:
        account.token_ciphertext = ciphertext
        account.scopes = token_payload.get("scopes", [])
        # Fresh grant — clear a prior reconnect/error so UI + sync can recover.
        account.sync_status = SyncStatus.never
        account.sync_error = None
    return account


@router.get("/google/callback")
def google_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Google redirects here. Exchange code, upsert user, store tokens, mint session.

    The state JWT is verified for signature + expiry (jwt.decode raises on either),
    which is the CSRF guard: only we can mint a valid state, and it lasts 10 minutes.
    """
    try:
        decoded = jwt.decode(state, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state") from exc

    # Re-validate the redirect we signed in (defense in depth) before trusting it.
    redirect_target = _validate_redirect(decoded.get("redirect"))

    token_payload = google_oauth.exchange_code(code)
    profile_email = _require_email(token_payload)

    link_user_id = decoded.get("link_user_id")
    if link_user_id:
        user = db.get(User, link_user_id)
        if user is None:
            raise HTTPException(status_code=400, detail="Invalid link session")
        _upsert_google_account(
            db, user=user, profile_email=profile_email, token_payload=token_payload
        )
        db.commit()
        sep = "&" if "?" in redirect_target else "?"
        return RedirectResponse(url=f"{redirect_target}{sep}linked=1")

    user = db.scalar(select(User).where(User.email == profile_email))
    if user is None:
        user = User(email=profile_email)
        db.add(user)
        db.flush()

    _upsert_google_account(db, user=user, profile_email=profile_email, token_payload=token_payload)
    db.commit()

    session = create_session_token(user.id)
    # Hand the session back to the app via its deep link. The app reads the token param.
    # `?`/`&` join handles both albert://auth and exp://host/--/auth (which has a path).
    sep = "&" if "?" in redirect_target else "?"
    return RedirectResponse(url=f"{redirect_target}{sep}token={session}")


@router.post("/apple", response_model=SessionToken)
def apple_sign_in(
    body: AppleSignInRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> SessionToken:
    """Verify Apple's identity token and mint an Albert session (no Gmail required)."""
    _enforce_auth_rate(request, "apple", limit=20, window=60)
    identity = apple_auth.verify_identity_token(body.identity_token)

    user = db.scalar(select(User).where(User.apple_sub == identity.sub))
    email_hint = None
    if body.email and body.email.strip():
        email_hint = body.email.strip().lower()
    elif identity.email:
        email_hint = identity.email

    if user is None and email_hint:
        # First Apple grant often includes email — merge onto an existing Google user.
        user = db.scalar(select(User).where(User.email == email_hint))

    if user is None:
        # Prefer real email when Apple shares it; otherwise a stable synthetic address.
        email = email_hint or apple_auth.apple_local_email(identity.sub)
        # Collision: synthetic shouldn't collide; real email taken without apple_sub
        # was handled above. If synthetic somehow exists, attach apple_sub.
        existing = db.scalar(select(User).where(User.email == email))
        if existing is not None:
            user = existing
        else:
            user = User(
                email=email,
                name=(body.full_name.strip() if body.full_name else None) or None,
                apple_sub=identity.sub,
                preferences={"auth_provider": "apple"},
            )
            db.add(user)
            db.flush()

    if user.apple_sub is None:
        user.apple_sub = identity.sub
    prefs = dict(user.preferences or {})
    prefs.setdefault("auth_provider", "apple")
    if email_hint and apple_auth.is_apple_local_email(user.email):
        prefs["apple_email"] = email_hint
    if body.full_name and body.full_name.strip() and not user.name:
        user.name = body.full_name.strip()
    user.preferences = prefs
    db.commit()

    return SessionToken(access_token=create_session_token(user.id))


@router.post("/continue-without-gmail", response_model=SessionToken)
def continue_without_gmail(
    request: Request,
    db: Session = Depends(get_db),
) -> SessionToken:
    """Mint a session for a new user with no mailbox. Gmail can be linked in Settings.

    Prefer Sign in with Apple when available — this path exists for regions where
    Google/Apple identity is blocked or unavailable, so users can still use SMS,
    Apple Calendar, capture, and Alfred chat.
    """
    # Stricter than SIWA: this mints anonymous accounts with no identity proof.
    _enforce_auth_rate(request, "anon", limit=5, window=60)
    email = f"anon.{uuid.uuid4().hex}@{_ANON_EMAIL_DOMAIN}"
    user = User(
        email=email,
        preferences={"auth_provider": "anonymous"},
    )
    db.add(user)
    db.commit()
    return SessionToken(access_token=create_session_token(user.id))


@router.post("/logout", status_code=204)
def logout(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> None:
    """Revoke the caller's current session so its JWT stops working immediately.

    Decoding first (which also rejects already-revoked/invalid tokens) means a
    valid caller can only revoke their own token, and we get the jti + exp needed
    to add a self-expiring denylist entry."""
    payload = decode_session_token(creds.credentials)
    revoke_session(payload)


@router.post("/dev-session", response_model=SessionToken)
def dev_session(email: str, db: Session = Depends(get_db)) -> SessionToken:
    """Development-only: mint a session for a user by email without Google.
    Disabled outside development."""
    if settings.environment != "development":
        raise HTTPException(status_code=404, detail="Not found")
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email)
        db.add(user)
        db.commit()
    return SessionToken(access_token=create_session_token(user.id))


def _require_email(token_payload: dict[str, Any]) -> str:
    """Account email, read from Google's userinfo during exchange_code."""
    email = token_payload.get("email")
    if not email or not isinstance(email, str):
        raise HTTPException(status_code=502, detail="Google did not return an account email")
    return email
