"""Google OAuth login + connection routes (PRD 9.1, 12.1, 12.2).

The same Google consent grants Gmail + Calendar and serves as Albert's login.
On callback Albert upserts the User, stores encrypted tokens, and returns its own
session JWT. State is signed into a short-lived JWT to bind the callback safely.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_session_token
from app.db.base import get_db
from app.db.enums import Provider, SyncStatus
from app.db.models import ConnectedAccount, User
from app.schemas.api import AuthStartResponse, SessionToken
from app.services import google_oauth
from app.services.crypto import encrypt_token

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

# The native app deep link. Used when the app doesn't supply its own redirect.
_DEFAULT_REDIRECT = "albert://auth"


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
    if redirect.startswith("exp://") and (
        ".exp.direct/" in redirect or "/--/" in redirect
    ):
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

    user = db.scalar(select(User).where(User.email == profile_email))
    if user is None:
        user = User(email=profile_email)
        db.add(user)
        db.flush()

    account = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.user_id == user.id, ConnectedAccount.provider == Provider.google
        )
    )
    ciphertext = encrypt_token(token_payload)
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
    db.commit()

    session = create_session_token(user.id)
    # Hand the session back to the app via its deep link. The app reads the token param.
    # `?`/`&` join handles both albert://auth and exp://host/--/auth (which has a path).
    sep = "&" if "?" in redirect_target else "?"
    return RedirectResponse(url=f"{redirect_target}{sep}token={session}")


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
