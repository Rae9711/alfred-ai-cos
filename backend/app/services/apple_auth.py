"""Sign in with Apple identity-token verification.

Native iOS SIWA returns a JWT (`identityToken`) signed by Apple. We verify it
against Apple's published JWKS, then treat `sub` as the stable account key.
Email is optional (Hide My Email / second sign-in may omit it).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import HTTPException
from jwt import PyJWKClient

from app.core.config import get_settings

_APPLE_ISSUER = "https://appleid.apple.com"
_APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
_APPLE_EMAIL_DOMAIN = "signin.apple.alfred"

# Module-level client caches JWKS keys across requests.
_jwks_client: PyJWKClient | None = None


def _client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(_APPLE_JWKS_URL, cache_keys=True)
    return _jwks_client


@dataclass(frozen=True)
class AppleIdentity:
    sub: str
    email: str | None
    email_verified: bool


def apple_local_email(sub: str) -> str:
    """Stable synthetic email when Apple does not share a real address."""
    # sub is opaque (usually high-entropy); keep under the 320-char email column.
    safe = "".join(c for c in sub if c.isalnum() or c in "-_")[:200]
    return f"{safe}@{_APPLE_EMAIL_DOMAIN}"


def is_apple_local_email(email: str) -> bool:
    return email.endswith(f"@{_APPLE_EMAIL_DOMAIN}")


def verify_identity_token(identity_token: str) -> AppleIdentity:
    """Verify Apple's identity JWT. Raises HTTPException on failure."""
    settings = get_settings()
    audience = (settings.apple_client_id or "").strip()
    if not audience:
        raise HTTPException(
            status_code=503,
            detail="Sign in with Apple is not configured (APPLE_CLIENT_ID)",
        )

    try:
        signing_key = _client().get_signing_key_from_jwt(identity_token)
        payload: dict[str, Any] = jwt.decode(
            identity_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=audience,
            issuer=_APPLE_ISSUER,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid Apple identity token") from exc
    except Exception as exc:  # JWKS fetch / network
        raise HTTPException(
            status_code=502, detail="Could not verify Apple identity token"
        ) from exc

    sub = payload.get("sub")
    if not sub or not isinstance(sub, str):
        raise HTTPException(status_code=401, detail="Apple token missing subject")

    raw_email = payload.get("email")
    email = raw_email.strip().lower() if isinstance(raw_email, str) and raw_email.strip() else None
    verified_claim = payload.get("email_verified")
    email_verified = verified_claim in (True, "true", "True", 1, "1")

    return AppleIdentity(sub=sub, email=email, email_verified=email_verified)
