"""Albert session tokens (PRD 12.1). Albert mints its own JWT after Google login;
the Google OAuth tokens are stored encrypted and never exposed to the client.

Sessions are long-lived (30 days) so users rarely re-auth. To make "log out" and
"revoke this session" actually work before that expiry, every token carries a
unique ``jti`` (JWT id) and we keep a Redis denylist of revoked ``jti`` values.
``get_current_user`` rejects any token whose ``jti`` is on the denylist.

The denylist is best-effort: if Redis is unreachable we fail open (accept the
token). Revocation is defense-in-depth on top of already-short-ish tokens, and a
Redis outage must not lock every user out. Denylist entries are given a TTL equal
to the token's remaining lifetime, so the key disappears exactly when the token
would have expired anyway — the set can never grow without bound."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import redis
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.redis import get_redis
from app.db.base import get_db
from app.db.models import User

settings = get_settings()
_bearer = HTTPBearer(auto_error=True)

# Redis key prefix for revoked JWT ids. Value is unused; presence == revoked.
_REVOKED_PREFIX = "revoked_jti:"


def create_session_token(user_id: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
        # Unique id so this specific session can be revoked (logout) independently.
        "jti": secrets.token_urlsafe(16),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _is_revoked(jti: str) -> bool:
    """True if this jti is on the denylist. Fails open when Redis is unreachable."""
    if not jti:
        return False
    try:
        return get_redis().exists(f"{_REVOKED_PREFIX}{jti}") == 1
    except redis.RedisError:
        return False


def revoke_session(payload: dict[str, Any]) -> None:
    """Add a token's jti to the denylist until its natural expiry.

    Takes a decoded JWT payload (needs ``jti`` and ``exp``). The denylist entry's
    TTL is the token's remaining lifetime, so it self-cleans and never outlives the
    token it revokes. No-op (best effort) if Redis is down or the token predates
    jti support."""
    jti = payload.get("jti")
    if not jti:
        return
    exp = payload.get("exp")
    now = int(datetime.now(UTC).timestamp())
    ttl = max(int(exp) - now, 1) if exp else settings.jwt_expire_minutes * 60
    try:
        get_redis().setex(f"{_REVOKED_PREFIX}{jti}", ttl, "1")
    except redis.RedisError:
        # Revocation is best-effort; a Redis blip must not turn logout into a 500.
        pass


def decode_session_token(token: str) -> dict[str, Any]:
    """Decode + verify a session JWT, raising 401 on any problem (bad sig, expired,
    or revoked). Shared by ``get_current_user`` and the logout route."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from exc
    if _is_revoked(payload.get("jti", "")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked")
    return payload


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_session_token(creds.credentials)
    user = db.get(User, payload.get("sub"))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user")
    return user
