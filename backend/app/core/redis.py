"""Shared Redis client for lightweight cross-process coordination.

Celery already uses Redis as its broker + result backend, so we reuse the same
server for two small coordination needs that do not belong in Postgres:

  1. Per-mailbox sync locks (``redis_lock``) — stop two workers (or a worker and
     an interactive ``POST /sync``) from syncing the same Gmail mailbox at once,
     which would double-hit Google's per-mailbox rate limits.
  2. The JWT revocation denylist (see ``app.core.security``) — lets logout /
     session revocation invalidate a token before its 30-day expiry.

Design choice — **fail open**: every caller must tolerate Redis being
unreachable, and a Redis outage must never lock users out or wedge sync. Neither
feature is a correctness invariant (the lock is an optimization; the denylist is
defense-in-depth on top of short-lived tokens), so we favor availability. The
client is also created lazily so importing this module never opens a socket —
important for unit tests, which set ``REDIS_URL`` but run no Redis server.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from functools import lru_cache

import redis

from app.core.config import get_settings


@lru_cache
def get_redis() -> redis.Redis:
    """Return a process-wide Redis client built from ``REDIS_URL``.

    ``decode_responses=True`` so denylist reads come back as ``str`` rather than
    ``bytes``. Cached so we reuse one connection pool across requests/tasks.
    """
    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True)


@contextlib.contextmanager
def redis_lock(
    name: str,
    *,
    timeout: float = 600.0,
    blocking_timeout: float = 5.0,
) -> Iterator[bool]:
    """Best-effort distributed lock.

    Yields ``True`` when the lock was acquired (the caller owns it and should do
    the work) and ``False`` when another holder already has it (the caller should
    skip). On acquisition failure the lock is released automatically on exit.

    ``timeout`` is the auto-expiry (a crashed holder can't wedge the key forever);
    ``blocking_timeout`` is how long we wait to acquire before giving up so an
    interactive caller isn't blocked indefinitely behind a background sync.

    If Redis itself is unreachable we **fail open** and yield ``True`` so the
    coordinated work still runs (unlocked) rather than being blocked by an outage.
    """
    client = get_redis()
    lock = client.lock(name, timeout=timeout, blocking_timeout=blocking_timeout)
    try:
        acquired: bool | None = lock.acquire()
    except redis.RedisError:
        # Redis down / unreachable: fall back to running without the lock.
        acquired = None
    try:
        yield True if acquired is None else acquired
    finally:
        if acquired:
            with contextlib.suppress(redis.RedisError):
                lock.release()
