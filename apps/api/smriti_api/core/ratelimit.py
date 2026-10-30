"""Rate limits in Redis (TRD §14): a fixed window counter per subject (user or IP).

Redis being unavailable never blocks learning: the limiter fails open and logs it.
"""

from __future__ import annotations

import time

import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

from smriti_api.core.errors import ApiError

log = structlog.get_logger(__name__)


class RateLimiter:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def hit(self, name: str, subject: str, limit: int, window_s: int) -> None:
        if limit <= 0:
            return
        window = int(time.time() // window_s)
        key = f"rl:{name}:{subject}:{window}"
        try:
            pipe = self._redis.pipeline(transaction=True)
            pipe.incr(key)
            pipe.expire(key, window_s + 1)
            count, _ = await pipe.execute()
        except RedisError:
            log.warning("rate_limit_unavailable", limiter=name)
            return
        if int(count) > limit:
            retry_after = window_s - int(time.time() % window_s)
            raise ApiError(
                429,
                "rate_limited",
                "Too many requests. Wait a moment and try again.",
                headers={"Retry-After": str(max(retry_after, 1))},
                retry_after_s=max(retry_after, 1),
            )
