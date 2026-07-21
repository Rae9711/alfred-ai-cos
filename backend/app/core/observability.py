"""Sentry wiring for the API and the Celery worker.

``init_sentry()`` is a no-op when ``SENTRY_DSN`` is empty (the default), so dev, tests,
and any deploy that hasn't configured Sentry never send events. When a DSN is present we
initialise with the FastAPI + Celery integrations, ``send_default_pii=False``, and the
shared ``sentry_before_send`` scrubber so error reports carry no raw email/token content.
"""

from __future__ import annotations

from typing import Any, cast

from app.core.config import get_settings
from app.core.redaction import sentry_before_send

_initialized = False


def init_sentry() -> None:
    """Initialise Sentry once, if a DSN is configured. Safe to call from both entrypoints."""
    global _initialized
    if _initialized:
        return

    settings = get_settings()
    if not settings.sentry_dsn:
        return

    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.fastapi import FastApiIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=[FastApiIntegration(), CeleryIntegration()],
        send_default_pii=False,
        # sentry_before_send is typed against plain dicts (redaction stays SDK-agnostic);
        # it is structurally compatible with Sentry's Event TypedDict at runtime.
        before_send=cast(Any, sentry_before_send),
    )
    _initialized = True
