"""Structured JSON logging via structlog.

One ``configure_logging()`` call (from ``main.py`` and the Celery worker) routes both
structlog and the stdlib ``logging`` module to JSON-on-stdout. Two things matter here:

  * every line is redacted through the shared ``structlog_redact_processor`` /
    ``RedactionFilter`` so email bodies and tokens never reach the log sink;
  * ``merge_contextvars`` pulls in request/task context (correlation id, user id) that
    the request middleware and Celery tasks bind, so a single request or sync can be
    traced across log lines.
"""

from __future__ import annotations

import logging

import structlog

from app.core.config import get_settings
from app.core.redaction import RedactionFilter, structlog_redact_processor

_configured = False


def configure_logging() -> None:
    """Idempotently configure structlog + stdlib logging to emit redacted JSON to stdout."""
    global _configured
    if _configured:
        return

    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog_redact_processor,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Route stdlib logging (FastAPI, uvicorn, our getLogger call sites) through the same
    # JSON renderer, and attach the redaction filter at the root so every record is scrubbed.
    handler = logging.StreamHandler()
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            processor=structlog.processors.JSONRenderer(),
            foreign_pre_chain=[
                structlog.contextvars.merge_contextvars,
                structlog.processors.add_log_level,
                structlog.processors.TimeStamper(fmt="iso"),
                structlog_redact_processor,
            ],
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # Defense in depth: even records that skip the structlog formatter (e.g. added by a
    # third party before configuration) still pass through value-level redaction.
    if not any(isinstance(f, RedactionFilter) for f in root.filters):
        root.addFilter(RedactionFilter())

    _configured = True
