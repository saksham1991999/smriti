"""``python -m smriti_worker [queues]``: run the worker for one queue, several, or all of them.

    python -m smriti_worker                    # WORKER_QUEUE, else the default queue (crons live here)
    python -m smriti_worker pdf                # one queue
    python -m smriti_worker default,ai,media   # several queues in one process
    python -m smriti_worker all                # every queue in one process (a small deployment)

One process per queue scales each queue on its own (TRD §5 "Jobs"). ``all`` runs every queue's
arq worker on one event loop, which suits a first deployment with one worker service. Every queue
must have a consumer somewhere, or its jobs wait in Redis.
"""

from __future__ import annotations

import asyncio
import logging.config
import os
import signal
import sys
from collections.abc import Sequence

import arq.worker
from arq.logs import default_log_config
from smriti_api.core.config import get_settings
from smriti_api.core.error_reporting import configure_error_reporting

from smriti_worker.main import WORKERS, WorkerSettings

WORKER_VERSION = "0.1.0"


class UnknownQueue(ValueError):
    pass


def parse_queues(spec: str) -> list[str]:
    """``all``, one queue name, or a comma-separated list, in WORKERS order without repeats."""
    names = [s.strip() for s in spec.split(",") if s.strip()]
    if not names:
        names = ["default"]
    if names == ["all"]:
        return list(WORKERS)
    unknown = [n for n in names if n not in WORKERS]
    if unknown:
        raise UnknownQueue(", ".join(unknown))
    return [q for q in WORKERS if q in names]


async def run_many(settings: Sequence[WorkerSettings], stop: asyncio.Event | None = None) -> int:
    """Runs several arq workers on this loop until SIGTERM or SIGINT (or ``stop``), then shuts
    every one down. If one worker crashes, the rest stop too and the exit code is 1, so the
    platform restarts the whole process rather than leaving a queue without a consumer."""
    loop = asyncio.get_running_loop()
    stop = stop or asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):  # pragma: no cover - not on Linux
            pass
    # Looked up on the module, so Sentry's arq integration (which patches it) sees every job.
    workers: list[arq.worker.Worker] = [
        arq.worker.create_worker(s, handle_signals=False) for s in settings
    ]
    tasks = [asyncio.create_task(w.async_run()) for w in workers]
    waiter = asyncio.create_task(stop.wait())
    await asyncio.wait([*tasks, waiter], return_when=asyncio.FIRST_COMPLETED)
    crashed = any(t.done() and not t.cancelled() and t.exception() is not None for t in tasks)
    waiter.cancel()
    for w in workers:
        w.handle_sig(signal.SIGTERM)
    await asyncio.gather(*tasks, return_exceptions=True)
    for w in workers:
        await w.close()
    return 1 if crashed else 0


def start_error_reporting() -> bool:
    """Sentry for job errors, before any arq worker exists (off unless SENTRY_DSN is set)."""
    settings = get_settings()
    service = os.environ.get("OTEL_SERVICE_NAME") or "smriti-worker"
    return configure_error_reporting(
        dsn=settings.sentry_dsn,
        environment=settings.app_env.value,
        release=settings.sentry_release or f"smriti-worker@{WORKER_VERSION}",
        service=service,
    )


def main(argv: list[str]) -> int:
    spec = argv[1] if len(argv) > 1 else os.environ.get("WORKER_QUEUE", "default")
    try:
        queues = parse_queues(spec)
    except UnknownQueue as exc:
        print(f"unknown queue {exc}; one of: all, {', '.join(WORKERS)}", file=sys.stderr)
        return 2
    logging.config.dictConfig(default_log_config(verbose=False))
    start_error_reporting()
    if len(queues) == 1:
        arq.worker.run_worker(WORKERS[queues[0]])
        return 0
    return asyncio.run(run_many([WORKERS[q] for q in queues]))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
