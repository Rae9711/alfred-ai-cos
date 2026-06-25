"""Google OAuth flow for Gmail + Calendar (PRD 12.1, 12.2).

Builds the consent URL, exchanges the code for tokens, and rebuilds credentials
from a stored (decrypted) token payload. Tokens are persisted encrypted by the
caller via app.services.crypto."""

from __future__ import annotations

import os
from typing import Any, cast

import httpx
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

from app.core.config import get_settings

settings = get_settings()

# Google normalizes/reorders the granted scopes (e.g. "email" -> the userinfo.email
# URN), which oauthlib's strict checker rejects as a "scope changed" error during token
# exchange. The granted scopes are a superset of what we asked for, so relax the check.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")


def _client_config() -> dict[str, Any]:
    return {
        "web": {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.google_oauth_redirect_uri],
        }
    }


def build_authorization_url(state: str) -> str:
    """Return the Google consent URL. `state` ties the callback to a pending login.

    PKCE is disabled: this is a confidential web client whose client secret already
    authenticates the token exchange. A PKCE code_verifier generated here would be lost
    between this request and the callback (separate Flow instances), so enabling it would
    break the exchange with "Missing code verifier".
    """
    flow = Flow.from_client_config(
        _client_config(), scopes=settings.google_scopes, autogenerate_code_verifier=False
    )
    flow.redirect_uri = settings.google_oauth_redirect_uri
    url, _ = flow.authorization_url(
        access_type="offline",  # request a refresh token
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    return cast(str, url)


def exchange_code(code: str) -> dict[str, Any]:
    """Exchange an authorization code for a token payload to encrypt and store.

    Includes the account email, read from the OpenID userinfo endpoint, so the
    caller can upsert the User without a second round trip.
    """
    flow = Flow.from_client_config(
        _client_config(), scopes=settings.google_scopes, autogenerate_code_verifier=False
    )
    flow.redirect_uri = settings.google_oauth_redirect_uri
    flow.fetch_token(code=code)
    creds = flow.credentials
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
        "email": _fetch_email(creds),
    }


def _fetch_email(creds: Credentials) -> str | None:
    """Read the account email from the OpenID userinfo endpoint."""
    resp = httpx.get(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={"Authorization": f"Bearer {creds.token}"},
        timeout=10,
    )
    if resp.status_code == 200:
        return cast("str | None", resp.json().get("email"))
    return None


def credentials_from_payload(payload: dict[str, Any]) -> Credentials:
    """Rebuild Google Credentials from a decrypted token payload for API calls."""
    return Credentials(  # type: ignore[no-untyped-call]
        token=payload.get("token"),
        refresh_token=payload.get("refresh_token"),
        token_uri=payload.get("token_uri"),
        client_id=payload.get("client_id"),
        client_secret=payload.get("client_secret"),
        scopes=payload.get("scopes"),
    )


def fresh_credentials(payload: dict[str, Any]) -> tuple[Credentials, dict[str, Any]]:
    """Refresh the access token once if expired; return updated payload for persistence."""
    creds = credentials_from_payload(payload)
    updated = dict(payload)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        updated["token"] = creds.token
        if creds.expiry:
            updated["expiry"] = creds.expiry.isoformat()
    return creds, updated


def revoke_token(payload: dict[str, Any]) -> bool:
    """Revoke a Google OAuth grant (PRD 12.1, 13.1). Returns True on success.

    Revokes the refresh token when present (it invalidates the whole grant), else
    the access token. Best-effort: a failed revoke must not block account deletion,
    so the caller logs and proceeds. Seed/dev tokens have nothing to revoke."""
    token = payload.get("refresh_token") or payload.get("token")
    if not token or payload.get("seed"):
        return False
    try:
        resp = httpx.post(
            "https://oauth2.googleapis.com/revoke",
            params={"token": token},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        return resp.status_code == 200
    except httpx.HTTPError:
        return False
