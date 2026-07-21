"""Prometheus metrics + the LLM token-usage contextvar.

The FastAPI app exposes these at ``/metrics`` (wired in ``main.py``); the Celery worker
has no HTTP server of its own, so it starts a tiny ``prometheus_client`` HTTP server and
publishes a queue-backlog gauge (see ``start_worker_metrics_server``).

``last_llm_usage`` note: the Anthropic client stashes the most recent ``response.usage``
in a contextvar here. This is the single source of truth for token counts — anything that
needs the tokens a call consumed reads it back via ``last_llm_usage()`` instead of
re-deriving or re-counting, so the number always matches what we metered.
"""

from __future__ import annotations

import contextvars
from typing import Any, cast

from prometheus_client import Counter, Gauge, Histogram

# LLM call latency and token usage. Labelled by our call site (``method``) and model so we
# can see cost/latency per pipeline stage (classify vs extract vs draft vs briefing).
LLM_LATENCY = Histogram("albert_llm_seconds", "LLM call latency in seconds", ["method", "model"])
LLM_TOKENS = Counter("albert_llm_tokens_total", "LLM tokens consumed", ["model", "kind"])

# Gmail sync outcomes and Google API errors (429/5xx) seen by the retry layer.
SYNC_RESULT = Counter("albert_sync_total", "Gmail mailbox sync outcomes", ["result"])
GMAIL_ERRORS = Counter("albert_gmail_errors_total", "Retryable Google API errors", ["status"])

# Celery queue backlog (published by the worker metrics server below).
CELERY_QUEUE_DEPTH = Gauge("albert_celery_queue_depth", "Pending tasks in the celery queue")

# Most recent LLM usage object, per execution context. Any = anthropic Usage (kept loose so
# this module has no hard SDK dependency).
_last_llm_usage: contextvars.ContextVar[Any | None] = contextvars.ContextVar(
    "last_llm_usage", default=None
)


def record_llm_usage(usage: Any) -> None:
    """Stash the usage object from the latest LLM response (single source of truth)."""
    _last_llm_usage.set(usage)


def last_llm_usage() -> Any | None:
    """Return the most recent LLM ``usage`` object in this context, or None."""
    return _last_llm_usage.get()


def start_worker_metrics_server(port: int = 9100) -> None:
    """Start a Prometheus HTTP server for the Celery worker and register a backlog gauge.

    Fail-open: Redis or the socket being unavailable must never stop the worker booting.
    The gauge reads ``LLEN celery`` (the default broker list) lazily on each scrape.
    """
    from prometheus_client import start_http_server

    def _queue_depth() -> float:
        from app.core.redis import get_redis

        try:
            import redis

            try:
                # decode_responses client is sync, so llen returns an int here.
                return float(cast(int, get_redis().llen("celery")))
            except redis.RedisError:
                return 0.0
        except Exception:  # noqa: BLE001 - metrics must never break the worker
            return 0.0

    CELERY_QUEUE_DEPTH.set_function(_queue_depth)
    try:
        start_http_server(port)
    except OSError:
        # Port already bound (e.g. a second worker on the same host) — skip; the first
        # server already publishes the shared registry.
        pass
