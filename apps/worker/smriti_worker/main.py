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
    [
        jobs.merge_guest,
        jobs.purge_deleted_accounts,
        jobs.nightly_rollup,
        jobs.db_upkeep,
        jobs.notify_dispatch,
        jobs.notify_plan_web,
        jobs.guardian_expire,
        jobs.guardian_age_up,
        jobs.trial_reminders,
        jobs.media_sweep,
        jobs.mocks_auto_submit,
        jobs.live_mocks_tick,
        jobs.tutor_retention,
        jobs.weak_area_alerts,
        jobs.rhythm_estimates,
        jobs.ping,
    ],
    cron_jobs=[
        # Every hour, close yesterday for the timezones whose local midnight just passed.
        cron(jobs.nightly_rollup, minute=5, run_at_startup=False, unique=True),
        cron(jobs.purge_deleted_accounts, minute=20, unique=True),
        # Partitions ahead and idle-guest cleanup when pg_cron is not installed.
        cron(jobs.db_upkeep, hour=3, minute=0, unique=True),
        # Notifications: the outbox every minute, web reminders every 15 minutes (TRD §12).
        cron(jobs.notify_dispatch, second=0, unique=True),
        cron(jobs.notify_plan_web, minute={0, 15, 30, 45}, second=5, unique=True),
        # Guardian consent: lapsed requests hourly, the turning-18 check daily (auth flow §6.10).
        cron(jobs.guardian_expire, minute=10, unique=True),
        cron(jobs.guardian_age_up, hour=1, minute=30, unique=True),
        # R33: the trial-ending reminder, hourly.
        cron(jobs.trial_reminders, minute=40, unique=True),
        # Image requests waiting for the media queue.
        cron(jobs.media_sweep, minute={2, 32}, unique=True),
        # Mocks: strict and live attempts past their deadline, every minute.
        cron(jobs.mocks_auto_submit, second=30, unique=True),
        # Live mocks (practice §6.11): start signal and clock fan-out, then frozen ranks.
        cron(jobs.live_mocks_tick, second=0, unique=True),
        # Tutor: messages past ai.tutor_retention_days, daily.
        cron(jobs.tutor_retention, hour=2, minute=15, unique=True),
        # Learning science (TRD §9.6), nightly in India: weak-area alerts are queued for the
        # next day's usual hour; the rhythm estimates feed sleep review and smart timing.
        cron(jobs.rhythm_estimates, hour=20, minute=45, unique=True),
        cron(jobs.weak_area_alerts, hour=21, minute=0, unique=True),
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
# The AI queue's jobs arrive with the tutor work (Agent B).
AiWorker = _settings("AiWorker", "ai", [jobs.ping])
MediaWorker = _settings(
    "MediaWorker", "media", [jobs.media_generate, jobs.ping], max_jobs=4, job_timeout=300
)
NotificationsWorker = _settings(
    "NotificationsWorker", "notifications", [jobs.notify_dispatch, jobs.ping], max_tries=1
)
PdfWorker = _settings("PdfWorker", "pdf", [jobs.render_pdf, jobs.ping], max_jobs=2)

WORKERS: dict[str, WorkerSettings] = {
    "default": DefaultWorker,
    "ai": AiWorker,
    "media": MediaWorker,
    "notifications": NotificationsWorker,
    "content-publish": ContentPublishWorker,
    "pdf": PdfWorker,
}
assert set(WORKERS) == set(QUEUES), "every queue in smriti_api.services.jobs needs a worker"
