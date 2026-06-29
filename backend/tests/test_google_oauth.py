"""Google OAuth flow tests. No network: these check URL construction and the two
fixes found during live verification (PKCE disabled, oauthlib scope relax)."""

import os
import urllib.parse as up

import app.services.google_oauth as oauth


def test_scope_relax_env_is_set_on_import() -> None:
    # oauthlib rejects Google's normalized/reordered scopes at token exchange unless
    # this is set. The module sets it at import so the exchange does not 500.
    assert os.environ.get("OAUTHLIB_RELAX_TOKEN_SCOPE") == "1"


def test_authorization_url_has_no_pkce_challenge(monkeypatch) -> None:
    # PKCE must be off: the verifier would be lost between the start and callback
    # requests (separate Flow instances), breaking the exchange. Confidential web
    # client + secret authenticates the exchange instead.
    monkeypatch.setattr(oauth.settings, "google_client_id", "test-client-id")
    monkeypatch.setattr(oauth.settings, "google_client_secret", "test-secret")
    url = oauth.build_authorization_url("test-state")
    q = up.parse_qs(up.urlparse(url).query)
    assert "code_challenge" not in q
    assert q["client_id"][0] == "test-client-id"


def test_authorization_url_scopes_are_intact(monkeypatch) -> None:
    # Guard against scope-string corruption: each requested scope must survive whole.
    monkeypatch.setattr(oauth.settings, "google_client_id", "test-client-id")
    monkeypatch.setattr(oauth.settings, "google_client_secret", "test-secret")
    url = oauth.build_authorization_url("test-state")
    scope = up.parse_qs(up.urlparse(url).query)["scope"][0]
    scopes = scope.split(" ")
    assert "https://www.googleapis.com/auth/gmail.modify" in scopes
    assert "https://www.googleapis.com/auth/gmail.compose" in scopes
    assert "https://www.googleapis.com/auth/calendar.readonly" in scopes
