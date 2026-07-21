"""Token encryption round-trip + key rotation (MultiFernet)."""

from __future__ import annotations

from cryptography.fernet import Fernet

from app.core.config import get_settings
from app.services import crypto


def test_encrypt_decrypt_round_trip() -> None:
    payload = {"token": "abc", "refresh_token": "r", "expiry": "2030-01-01T00:00:00+00:00"}
    ciphertext = crypto.encrypt_token(payload)
    assert ciphertext != str(payload)  # actually encrypted, not just serialized
    assert crypto.decrypt_token(ciphertext) == payload


def test_previous_key_still_decrypts_after_rotation() -> None:
    """A token encrypted with the old key must still decrypt once the primary key
    has rotated, as long as the old key is listed in TOKEN_ENCRYPTION_KEY_PREVIOUS."""
    settings = get_settings()
    old_key = settings.token_encryption_key
    new_key = Fernet.generate_key().decode()
    try:
        # Encrypt under the original (soon-to-be-old) key.
        old_ciphertext = crypto.encrypt_token({"token": "old"})

        # Rotate: new primary, old key demoted to a decrypt-only fallback.
        settings.token_encryption_key = new_key
        settings.token_encryption_key_previous = old_key
        crypto._fernet.cache_clear()

        # Old ciphertext still decrypts via the fallback key...
        assert crypto.decrypt_token(old_ciphertext) == {"token": "old"}
        # ...and new writes use the new primary key.
        new_ciphertext = crypto.encrypt_token({"token": "new"})
        assert crypto.decrypt_token(new_ciphertext) == {"token": "new"}
        # reencrypt upgrades old ciphertext onto the primary key.
        upgraded = crypto.reencrypt(old_ciphertext)
        assert crypto.decrypt_token(upgraded) == {"token": "old"}
    finally:
        settings.token_encryption_key = old_key
        settings.token_encryption_key_previous = ""
        crypto._fernet.cache_clear()
