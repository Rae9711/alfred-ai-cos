"""Best-effort Redis fixed-window rate limiting.

Fails open when Redis is unreachable so an outage never blocks legitimate traffic.
Callers raise HTTP 429 when ``allow`` is False.
"""

from __future__ import annotations

import logging

import redis

from app.core.redis import get_redis

logger = logging.getLogger(__name__)


def allow_request(
    key: str,
    *,
    limit: int,
    window_seconds: int,
) -> bool:
    """Return True if the request is under the limit for ``key`` in this window."""
    if limit <= 0 or window_seconds <= 0:
        return True
    try:
        client = get_redis()
        count = client.incr(key)
        if count == 1:
            client.expire(key, window_seconds)
        return int(count) <= limit
    except redis.RedisError:
        logger.debug("rate_limit fail-open key=%s", key, exc_info=True)
        return True
