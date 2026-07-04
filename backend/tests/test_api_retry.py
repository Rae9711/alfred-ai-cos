"""Retry policy for external API reads (Gmail/Calendar)."""

from __future__ import annotations

from unittest.mock import Mock

import pytest
from googleapiclient.errors import HttpError

from app.services.api_retry import execute_with_retry


def _http_error(status: int) -> HttpError:
    resp = Mock(status=status)
    return HttpError(resp, b"error")


def test_execute_with_retry_succeeds_first_try() -> None:
    request = Mock()
    request.execute.return_value = {"ok": True}
    assert execute_with_retry(request) == {"ok": True}
    assert request.execute.call_count == 1


def test_execute_with_retry_recovers_from_429() -> None:
    request = Mock()
    request.execute.side_effect = [_http_error(429), {"ok": True}]
    assert execute_with_retry(request) == {"ok": True}
    assert request.execute.call_count == 2


def test_execute_with_retry_recovers_from_503() -> None:
    request = Mock()
    request.execute.side_effect = [_http_error(503), {"ok": True}]
    assert execute_with_retry(request) == {"ok": True}
    assert request.execute.call_count == 2


def test_execute_with_retry_does_not_retry_404() -> None:
    """A 404 (e.g. expired history cursor) is a permanent failure, not transient —
    must fail on the first attempt so callers' existing except-404 handling still
    fires immediately rather than waiting through a pointless backoff."""
    request = Mock()
    request.execute.side_effect = _http_error(404)
    with pytest.raises(HttpError):
        execute_with_retry(request)
    assert request.execute.call_count == 1


def test_execute_with_retry_gives_up_after_max_attempts() -> None:
    request = Mock()
    request.execute.side_effect = _http_error(429)
    with pytest.raises(HttpError):
        execute_with_retry(request)
    assert request.execute.call_count == 4
