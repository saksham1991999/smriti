"""arq worker settings, one class per queue (TRD §5 "Jobs").

Run one process per queue:

    uv run python -m smriti_worker                      # default queue (crons live here)
    uv run python -m smriti_worker content-publish      # or ai, media, notifications, pdf
    uv run arq smriti_worker.main.DefaultWorker         # the same through arq's own CLI

The queue names come from ``smriti_api.services.jobs.arq_queue_name``, which the API's
``ArqJobQueue`` uses to enqueue, so both sides always agree.
"""

from __future__ import annotations

from typing import Any

from arq import cron
from arq.connections import RedisSettings
from smriti_api.core.config import get_settings
from smriti_api.services.jobs import QUEUES, arq_queue_name

from smriti_worker import jobs

WorkerSettings = type


def _settings(name: str, queue: str, functions: list[Any], **overrides: Any) -> WorkerSettings:
    """arq reads only a settings class's own attributes (not inherited ones), so every
    class gets the full set."""
    attrs: dict[str, Any] = {
        "queue_name": arq_queue_name(queue),
        "functions": functions,
        "redis_settings": RedisSettings.from_dsn(get_settings().redis_url),
        "on_startup": jobs.startup,
        "on_shutdown": jobs.shutdown,
        "max_jobs": 10,
        "job_timeout": 600,
        "keep_result": 3600,
        # A failed merge or purge is retried; every job is safe to run twice.
        "max_tries": 3,
        **overrides,
    }
    return type(name, (), attrs)


DefaultWorker = _settings(
    "DefaultWorker",
    "default",
    [jobs.merge_guest, jobs.purge_deleted_accounts, jobs.nightly_rollup, jobs.db_upkeep, jobs.ping],
    cron_jobs=[
        # Every hour, close yesterday for the timezones whose local midnight just passed.
        cron(jobs.nightly_rollup, minute=5, run_at_startup=False, unique=True),
        cron(jobs.purge_deleted_accounts, minute=20, unique=True),
        # Partitions ahead and idle-guest cleanup when pg_cron is not installed.
        cron(jobs.db_upkeep, hour=3, minute=0, unique=True),
    ],
)
ContentPublishWorker = _settings(
    "ContentPublishWorker",
    "content-publish",
    [jobs.content_publish, jobs.ping],
    max_jobs=1,  # publishes never overlap
    job_timeout=jobs.CONTENT_PUBLISH_TIMEOUT_S + 60,
    max_tries=1,
)
# Queues whose real jobs arrive in later phases (AI, media, notifications, PDF).
AiWorker = _settings("AiWorker", "ai", [jobs.ping])
MediaWorker = _settings("MediaWorker", "media", [jobs.ping])
NotificationsWorker = _settings("NotificationsWorker", "notifications", [jobs.ping])
PdfWorker = _settings("PdfWorker", "pdf", [jobs.ping])

WORKERS: dict[str, WorkerSettings] = {
    "default": DefaultWorker,
    "ai": AiWorker,
    "media": MediaWorker,
    "notifications": NotificationsWorker,
    "content-publish": ContentPublishWorker,
    "pdf": PdfWorker,
}
assert set(WORKERS) == set(QUEUES), "every queue in smriti_api.services.jobs needs a worker"
