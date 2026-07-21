"""Shared guards for integration tests.

These tests hit real external sandboxes (Gmail/Calendar, Stripe test mode) and need
credentials that are never present in ordinary CI. Rather than fail the suite, each
required env var is declared via ``requires_env`` and the test is skipped when it (or
any of them) is missing. This keeps ``pytest -m "not integration"`` — and even
``pytest -m integration`` without secrets — green, while the nightly secrets-guarded
job actually exercises them.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest


def requires_env(*names: str) -> None:
    """Skip the calling test unless every named env var is set and non-empty."""
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        pytest.skip(f"integration creds not set: {', '.join(missing)}")


@pytest.fixture
def gmail_test_token() -> Iterator[str]:
    """Yield a Gmail sandbox refresh token, skipping when creds are absent."""
    requires_env("GMAIL_TEST_REFRESH_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")
    yield os.environ["GMAIL_TEST_REFRESH_TOKEN"]


@pytest.fixture
def stripe_test_key() -> Iterator[str]:
    """Yield a Stripe test-mode secret key, skipping when it's absent."""
    requires_env("STRIPE_SECRET_KEY")
    key = os.environ["STRIPE_SECRET_KEY"]
    if not key.startswith("sk_test_"):
        pytest.skip("STRIPE_SECRET_KEY is not a test-mode key (sk_test_)")
    yield key
