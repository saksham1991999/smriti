"""``python -m smriti_worker.health``: the worker container's health check.

Exits 0 when every queue this process serves (``WORKER_QUEUE``, as for ``python -m smriti_worker``)
has written its arq health key in the last ``health_check_interval`` seconds, else 1. Prints the
queue names only.
"""

from __future__ import annotations

import asyncio
import os
import sys

from arq.worker import async_check_health
from smriti_api.services.jobs import arq_queue_name

from smriti_worker.__main__ import UnknownQueue, parse_queues
from smriti_worker.main import WORKERS


async def check(queues: list[str]) -> list[str]:
    """The queues whose health key is missing."""
    missing: list[str] = []
    for queue in queues:
        settings = WORKERS[queue]
        code = await async_check_health(
            settings.redis_settings,  # type: ignore[attr-defined]
            queue_name=arq_queue_name(queue),
        )
        if code != 0:
            missing.append(queue)
    return missing


def main() -> int:
    try:
        queues = parse_queues(os.environ.get("WORKER_QUEUE", "default"))
    except UnknownQueue as exc:
        print(f"unknown queue {exc}", file=sys.stderr)
        return 1
    missing = asyncio.run(check(queues))
    if missing:
        print(f"unhealthy: {', '.join(missing)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
