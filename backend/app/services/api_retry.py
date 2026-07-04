"""Shared retry policy for external API reads (Gmail, Calendar).

Scoped to idempotent read calls only — list/get requests, never send/create/
delete. Retrying a write blindly risks a duplicate side effect (e.g. sending
an email twice); that's a correctness problem, not a reliability one, so
writes are out of scope here on purpose (see /plan-eng-review D4/D5/D8,
2026-07-02).

Retries on HTTP 429 (rate limit) and 5xx (transient server error) with
exponential backoff. Retry sits at the individual-call level, not around the
whole sync function, so a caller holding a DB session isn't blocked for the
full backoff window and a transient failure that recovers on retry never
reaches the sync's outer exception handler (see D8's cross-model tension).
"""

from __future__ import annotations

from typing import Any, Protocol

from googleapiclient.errors import HttpError
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential


class _Executable(Protocol):
    def execute(self) -> Any: ...


def _is_retryable(exc: BaseException) -> bool:
    if not isinstance(exc, HttpError):
        return False
    status = getattr(exc.resp, "status", None)
    return status == 429 or (status is not None and 500 <= status < 600)


_retry_policy = retry(
    retry=retry_if_exception(_is_retryable),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)


@_retry_policy
def execute_with_retry(request: _Executable) -> Any:
    """Call request.execute() with retry on 429/5xx. Use for read calls only."""
    return request.execute()
