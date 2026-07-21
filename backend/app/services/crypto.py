"""Symmetric encryption for third-party OAuth tokens at rest (PRD 13.1, 13.2).

Tokens are encrypted before they touch Postgres. We use ``MultiFernet`` so the
encryption key can be rotated without a flag-day re-encrypt of every row:

  - ``TOKEN_ENCRYPTION_KEY`` is the *primary* key. All new ciphertext is written
    with it (MultiFernet always encrypts with the first key).
  - ``TOKEN_ENCRYPTION_KEY_PREVIOUS`` is an optional comma-separated list of older
    keys, tried in order on decrypt. This lets rows written before a rotation keep
    decrypting.

Rotation procedure: generate a new key, move the current primary into
``TOKEN_ENCRYPTION_KEY_PREVIOUS``, set the new key as ``TOKEN_ENCRYPTION_KEY``,
redeploy. Old tokens transparently re-encrypt with the new key the next time they
are rotated (e.g. on the next OAuth refresh, which re-encrypts anyway), or you can
proactively re-encrypt with ``reencrypt``."""

import json
from functools import lru_cache
from typing import Any, cast

from cryptography.fernet import Fernet, MultiFernet

from app.core.config import get_settings


@lru_cache
def _fernet() -> MultiFernet:
    """Build the MultiFernet from the primary key plus any rotation-fallback keys.

    Cached so we parse/validate keys once. The primary key is first, so it is used
    for encryption; the previous keys are decrypt-only fallbacks."""
    settings = get_settings()
    keys = [settings.token_encryption_key]
    keys.extend(k.strip() for k in settings.token_encryption_key_previous.split(",") if k.strip())
    return MultiFernet([Fernet(k.encode()) for k in keys])


def encrypt_token(token_payload: dict[str, Any]) -> str:
    """Encrypt an OAuth token dict (access_token, refresh_token, expiry, ...)."""
    return _fernet().encrypt(json.dumps(token_payload).encode()).decode()


def decrypt_token(ciphertext: str) -> dict[str, Any]:
    """Decrypt a stored token, trying the primary key then any rotation fallbacks."""
    return cast(dict[str, Any], json.loads(_fernet().decrypt(ciphertext.encode()).decode()))


def reencrypt(ciphertext: str) -> str:
    """Re-encrypt existing ciphertext under the current primary key.

    Useful for a proactive rotation sweep: decrypt with whichever key still works
    and re-encrypt with the primary, without exposing the plaintext to the caller."""
    return _fernet().rotate(ciphertext.encode()).decode()
