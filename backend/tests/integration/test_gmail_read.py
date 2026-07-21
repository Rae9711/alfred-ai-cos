"""Integration: a real Gmail read through services/gmail.py.

Scaffolding — skipped unless GMAIL_TEST_REFRESH_TOKEN + Google client creds are set
(see conftest.requires_env). Never runs in ordinary CI.
"""

from __future__ import annotations

import os

import pytest


@pytest.mark.integration
def test_gmail_history_id_read(gmail_test_token: str) -> None:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    from app.services import gmail

    creds = Credentials(
        token=None,
        refresh_token=gmail_test_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
    )
    creds.refresh(Request())

    with gmail.use_gmail_credentials(creds):
        history_id = gmail.get_history_id({})

    assert history_id
