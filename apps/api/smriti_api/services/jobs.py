"""Background jobs (TRD §5 "Jobs"). The API enqueues; the worker runs the same functions.

Queues: default, ai, media, notifications, content-publish, pdf. ``JOBS_MODE=inline`` (the
local/test default) runs a job in-process right after the request, so the full flow works
without a worker; ``arq`` puts it on Redis for ``apps/worker``.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

import structlog

from smriti_api.core.db import Database
from smriti_api.services.analytics import AnalyticsSink
from smriti_api.services.auth_admin import AuthAdmin

if TYPE_CHECKING:
    from smriti_api.ai.gateway import AIGateway
    from smriti_api.integrations import Integrations
    from smriti_api.integrations.analytics_store import AnalyticsStore
    from smriti_api.integrations.realtime import RealtimePublisher

log = structlog.get_logger(__name__)

QUEUES = ("default", "ai", "media", "notifications", "content-publish", "pdf")
QUEUE_BY_JOB = {
    "merge_guest": "default",
    "purge_deleted_accounts": "default",
    "nightly_rollup": "default",
    "mocks_auto_submit": "default",
    "tutor_retention": "default",
    "content_publish": "content-publish",
    "render_pdf": "pdf",
    "media_generate": "media",
    "notify_dispatch": "notifications",
}


def arq_queue_name(queue: str) -> str:
    return f"smriti:queue:{queue}"


@dataclass
class JobDeps:
    db: Database
    auth_admin: AuthAdmin
    analytics: AnalyticsSink
    # Wave 2 (Agent A): notifications, PDF and media jobs need these; older jobs ignore them.
    integrations: Integrations | None = None
    ai: AIGateway | None = None
    realtime: RealtimePublisher | None = None
    # IRT and FSRS data jobs (G-11). ClickHouse, or Postgres locally.
    analytics_store: AnalyticsStore | None = None


JobFn = Callable[..., Awaitable[Any]]


class JobQueue(Protocol):
    async def enqueue(self, job: str, *args: Any, job_id: str | None = None) -> None: ...


class InlineJobQueue:
    def __init__(self, deps: JobDeps, registry: dict[str, JobFn]) -> None:
        self._deps = deps
        self._registry = registry
        self.tasks: set[asyncio.Task[Any]] = set()

    async def enqueue(self, job: str, *args: Any, job_id: str | None = None) -> None:
        fn = self._registry[job]

        async def run() -> None:
            try:
                await fn(self._deps, *args)
            except Exception:
                log.exception("inline_job_failed", job=job)

        task = asyncio.create_task(run())
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def drain(self) -> None:
        while self.tasks:
            await asyncio.gather(*list(self.tasks), return_exceptions=True)


class ArqJobQueue:
    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url
        self._pool: Any = None

    async def _get_pool(self) -> Any:
        if self._pool is None:
            from arq import create_pool
            from arq.connections import RedisSettings

            self._pool = await create_pool(RedisSettings.from_dsn(self._redis_url))
        return self._pool

    async def enqueue(self, job: str, *args: Any, job_id: str | None = None) -> None:
        pool = await self._get_pool()
        queue = QUEUE_BY_JOB.get(job, "default")
        await pool.enqueue_job(job, *args, _job_id=job_id, _queue_name=arq_queue_name(queue))

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.aclose()


def job_registry() -> dict[str, JobFn]:
    from smriti_api.services import accounts, exports, media, mocks, notify, tutor

    return {
        "merge_guest": accounts.merge_guest_job,
        "purge_deleted_accounts": accounts.purge_deleted_accounts_job,
        "mocks_auto_submit": mocks.auto_submit_expired_job,
        "tutor_retention": tutor.purge_old_messages_job,
        "render_pdf": exports.render_export,
        "media_generate": media.generate_job,
        "notify_dispatch": notify.dispatch_job,
    }
