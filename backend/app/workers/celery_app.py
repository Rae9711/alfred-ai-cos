"""Celery app. Broker + result backend are Redis. Run a worker with:
    uv run celery -A app.workers.celery_app worker --loglevel=info
And the beat scheduler (periodic sync, daily briefing) with:
    uv run celery -A app.workers.celery_app beat --loglevel=info
"""

from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_process_init

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.metrics import start_worker_metrics_server
from app.core.observability import init_sentry

# Configure Sentry + structured logging in the worker process too (mirrors main.py).
init_sentry()
configure_logging()

settings = get_settings()


@worker_process_init.connect  # type: ignore[untyped-decorator]
def _start_worker_metrics(**_kwargs: object) -> None:
    """Expose the worker's Prometheus metrics (queue backlog + shared counters) on :9100.

    Started per worker process rather than at import time so ``celery beat`` and CLI
    imports don't bind the port; the first worker wins, later ones skip on EADDRINUSE."""
    start_worker_metrics_server(9100)


celery_app = Celery(
    "albert",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        # Hourly tick: generate the morning briefing for every user whose local time
        # has entered their morning window (07:00-09:59) and who has no briefing yet
        # for their local today. Per-user idempotency makes the overlap safe.
        "due-briefings": {
            "task": "albert.dispatch_due_briefings",
            "schedule": crontab(minute=0),
        },
        # Scan for at-risk loops and dispatch notifications every 30 minutes. The
        # per-user quiet-hours + threshold logic decides what actually sends.
        "notification-scan": {
            "task": "albert.scan_notifications",
            "schedule": crontab(minute="*/30"),
        },
        # Poll Gmail for every connected mailbox and push when new Primary mail arrives.
        "poll-mailboxes": {
            "task": "albert.poll_all_mailboxes",
            "schedule": settings.mail_poll_interval_seconds,
        },
        # Refresh learned email writing style from Sent mail (weekly).
        "refresh-writing-styles": {
            "task": "albert.refresh_writing_styles",
            "schedule": crontab(hour=3, minute=30, day_of_week="sun"),
        },
    },
)
