"""continue-without-gmail creates a real session without a ConnectedAccount."""

from unittest.mock import MagicMock

from app.api.v1 import auth as auth_routes
from app.core.security import decode_session_token
from app.db.models import User


def _fake_request(ip: str = "127.0.0.1") -> MagicMock:
    req = MagicMock()
    req.headers = {}
    req.client.host = ip
    return req


def test_continue_without_gmail_mints_session(db) -> None:
    out = auth_routes.continue_without_gmail(_fake_request(), db)
    assert out.access_token
    payload = decode_session_token(out.access_token)
    user = db.get(User, payload["sub"])
    assert user is not None
    assert user.email.endswith("@local.alfred")
    assert (user.preferences or {}).get("auth_provider") == "anonymous"
