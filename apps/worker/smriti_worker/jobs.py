"""Worker jobs (TRD §5 "Jobs"). The business logic lives in ``smriti_api.services`` so the API's
inline mode and this worker run the same code; these are thin arq wrappers plus the cron jobs.
"""

from __future__ import annotations

import asyncio
import os
import shlex
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
import structlog
from smriti_api.ai.factory import build_gateway
from smriti_api.core.config import REPO_ROOT, AppEnv, Settings, get_settings
from smriti_api.core.db import Database
from smriti_api.core.logging import configure_logging, hash_user_id
from smriti_api.core.redis import create_redis
from smriti_api.integrations import build_integrations
from smriti_api.integrations.analytics_store import build_analytics_store
from smriti_api.integrations.realtime import build_realtime
from smriti_api.integrations.settings import get_integration_settings
from smriti_api.services import (
    accounts,
    billing,
    card_index,
    data_jobs,
    doubt_photo,
    duels,
    exports,
    guardian,
    leagues,
    learning_science,
    live_mocks,
    media,
    mocks,
    notify,
    parent_mode,
    shared_decks,
    social_duos,
    social_squads,
    tutor,
    voice,
)
from smriti_api.services.analytics import LogAnalyticsSink
from smriti_api.services.auth_admin import build_auth_admin
from smriti_api.services.jobs import JobDeps
from smriti_api.services.privacy import ConsentAwareAnalytics
from smriti_api.services.state import rollup_user
from sqlalchemy import text

log = structlog.get_logger("smriti_worker")

Ctx = dict[str, Any]
CONTENT_PUBLISH_DIR = REPO_ROOT / "tools" / "content-publish"
CONTENT_PUBLISH_TIMEOUT_S = 1800


# --- lifecycle ---------------------------------------------------------------------------------


async def startup(ctx: Ctx) -> None:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_hash_salt)
    db = Database(settings.database_url, pool_size=5, system_role=settings.db_system_role)
    http = httpx.AsyncClient(timeout=30)
    ctx["settings"] = settings
    ctx["http"] = http
    ctx["deps"] = JobDeps(
        db=db,
        auth_admin=build_auth_admin(settings, db, http),
        analytics=ConsentAwareAnalytics(LogAnalyticsSink(), db),
        integrations=build_integrations(settings, http),
        ai=build_gateway(settings, db, http),
        realtime=build_realtime(
            provider=get_integration_settings().realtime_provider,
            dev=settings.is_dev,
            http=http,
            redis=ctx.get("redis") or create_redis(settings.redis_url),
            supabase_url=settings.supabase_url,
            service_key=settings.supabase_service_role_key,
        ),
        analytics_store=build_analytics_store(
            http,
            db,
            url=get_integration_settings().clickhouse_url,
            user=get_integration_settings().clickhouse_user,
            password=get_integration_settings().clickhouse_password,
            database=get_integration_settings().clickhouse_database,
        ),
    )
    log.info("worker_started", env=settings.app_env.value)


async def shutdown(ctx: Ctx) -> None:
    deps: JobDeps = ctx["deps"]
    await ctx["http"].aclose()
    await deps.db.dispose()


def _deps(ctx: Ctx) -> JobDeps:
    deps: JobDeps = ctx["deps"]
    return deps


# --- queued jobs --------------------------------------------------------------------------------


async def merge_guest(ctx: Ctx, merge_id: str) -> dict[str, Any]:
    return await accounts.merge_guest_job(_deps(ctx), merge_id)


async def purge_deleted_accounts(ctx: Ctx) -> int:
    count = await accounts.purge_deleted_accounts(_deps(ctx))
    if count:
        log.info("accounts_purged", count=count)
    return count


async def mocks_auto_submit(ctx: Ctx) -> int:
    """Strict and live mock attempts past their deadline, submitted so the report is ready."""
    count = await mocks.auto_submit_expired_job(_deps(ctx))
    if count:
        log.info("mocks_auto_submitted", count=count)
    return count


async def fsrs_optimise(ctx: Ctx) -> dict[str, Any]:
    """Per-user FSRS parameters from each student's own reviews (G-11)."""
    report = await data_jobs.fsrs_optimise_job(_deps(ctx))
    log.info("fsrs_optimise", **report)
    return report


async def irt_calibrate(ctx: Ctx) -> dict[str, Any]:
    """IRT item parameters from first-attempt responses (G-11; no calibrator chosen yet)."""
    report = await data_jobs.irt_calibrate_job(_deps(ctx))
    log.info("irt_calibrate", **report)
    return report


async def live_mocks_tick(ctx: Ctx) -> dict[str, int]:
    """Live mocks: the start signal and clock on mock:{id}, and ranks frozen after results."""
    counts = await live_mocks.tick_job(_deps(ctx))
    if any(counts.values()):
        log.info("live_mocks_tick", **counts)
    return counts


async def tutor_retention(ctx: Ctx) -> int:
    """Tutor messages and voice transcripts older than ``ai.tutor_retention_days``."""
    count = await tutor.purge_old_messages_job(_deps(ctx))
    # Voice sessions and their stored transcripts share the tutor's retention.
    count += await voice.purge_job(_deps(ctx))
    # Photo doubt: the photos and their recognised text, too (tutor-social §A10 step 8).
    count += await doubt_photo.purge_job(_deps(ctx))
    if count:
        log.info("tutor_messages_purged", count=count)
    return count


async def weak_area_alerts(ctx: Ctx) -> int:
    """Predictive weak-area alerts from FSRS retrievability (TRD §9.6)."""
    return await learning_science.weak_area_alerts(_deps(ctx).db)


async def rhythm_estimates(ctx: Ctx) -> int:
    """Adults' usual bedtime and study hour, for sleep review and smart timing (TRD §9.6)."""
    return await learning_science.estimate_rhythms(_deps(ctx).db)


async def league_assign(ctx: Ctx) -> int:
    """Hourly: places this week's active learners into league groups."""
    return await leagues.assign_job(_deps(ctx))


async def league_rollover(ctx: Ctx) -> int:
    """Sunday after ``league.close_time`` IST: promotions, demotions and results. Safe to re-run."""
    return await leagues.rollover_job(_deps(ctx))


async def duo_rollup(ctx: Ctx) -> int:
    """Nightly: settles Duo streak days."""
    return await social_duos.rollup_job(_deps(ctx))


async def duel_sweep(ctx: Ctx) -> int:
    """Every minute: expires stale duels and queue entries."""
    return await duels.sweep_job(_deps(ctx))


async def squad_quests(ctx: Ctx) -> int:
    """Hourly: settles this week's squad quests."""
    return await social_squads.quests_job(_deps(ctx))


async def deck_moderation(ctx: Ctx) -> int:
    """Every 10 minutes: retries minors' shared decks still waiting for a clear model answer."""
    return await shared_decks.moderation_job(_deps(ctx))


async def parent_digest(ctx: Ctx) -> int:
    """Sunday: the SET-15 weekly push to guardians, held until 19:00 in each guardian's zone."""
    return await parent_mode.digest_job(_deps(ctx))


async def ping(ctx: Ctx) -> str:
    """Health job for queues whose real jobs land in later phases (ai, media, notifications, pdf)."""
    return "pong"


# --- nightly roll-up ---------------------------------------------------------------------------


def _zone(name: str) -> ZoneInfo | None:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def timezones_at_local_hour(names: list[str], now: datetime, hour: int = 0) -> list[str]:
    """The timezone bucket whose local clock is in ``hour`` right now (midnight by default)."""
    out = []
    for name in names:
        tz = _zone(name)
        if tz is not None and now.astimezone(tz).hour == hour:
            out.append(name)
    return sorted(out)


async def rollup_timezones(deps: JobDeps, now: datetime, timezones: list[str] | None = None) -> int:
    """Close yesterday for every student whose local day just ended. Each user gets their own
    transaction, so one bad row never blocks the rest."""
    async with deps.db.system_tx() as session:
        if timezones is None:
            names = list(
                (
                    await session.execute(text("select distinct timezone from app.profiles"))
                ).scalars()
            )
            timezones = timezones_at_local_hour(names, now)
        if not timezones:
            return 0
        users = list(
            (
                await session.execute(
                    text(
                        "select user_id from app.profiles where timezone = any(:tz)"
                        " and deletion_scheduled_for is null order by user_id"
                    ),
                    {"tz": timezones},
                )
            ).scalars()
        )
    done = 0
    for user_id in users:
        try:
            async with deps.db.system_tx() as session:
                await rollup_user(session, user_id, now)
            done += 1
        except Exception:
            log.exception("rollup_failed", user=hash_user_id(user_id))
    return done


async def nightly_rollup(ctx: Ctx) -> int:
    started = time.perf_counter()
    count = await rollup_timezones(_deps(ctx), datetime.now(UTC))
    log.info("nightly_rollup", users=count, ms=int((time.perf_counter() - started) * 1000))
    return count


# --- database upkeep (pg_cron stand-in) ----------------------------------------------------------


async def db_upkeep(ctx: Ctx) -> dict[str, Any]:
    """Partitions ahead and idle-guest cleanup. Supabase runs these with pg_cron; when the
    extension is missing (local Postgres) the worker runs them instead."""
    deps = _deps(ctx)
    async with deps.db.system_tx() as session:
        has_cron = (
            await session.execute(
                text("select exists (select 1 from pg_extension where extname = 'pg_cron')")
            )
        ).scalar_one()
    if has_cron:
        return {"status": "skipped", "reason": "pg_cron"}
    async with deps.db.admin_tx() as session:
        await session.execute(text("select ops.ensure_partitions_ahead()"))
        removed = (await session.execute(text("select ops.cleanup_idle_guests()"))).scalar_one()
    return {"status": "done", "idle_guests_removed": int(removed or 0)}


# --- content publish hook ----------------------------------------------------------------------


def content_root() -> Path:
    return Path(os.environ.get("CONTENT_ROOT") or REPO_ROOT / "content")


def report_dir() -> Path:
    return Path(os.environ.get("CONTENT_PUBLISH_REPORT_DIR") or CONTENT_PUBLISH_DIR / "out")


async def apply_metadata_sql(db: Database, path: Path) -> int:
    """Runs the publish's ``metadata.sql`` (content.* rows) in one transaction. asyncpg runs a
    multi-statement script only through its own ``execute`` without arguments."""
    sql = await asyncio.to_thread(path.read_text, encoding="utf-8")
    async with db.engine.begin() as conn:
        raw = await conn.get_raw_connection()
        driver: Any = raw.driver_connection
        await driver.execute(sql)
    return len(sql)


def publish_environment(settings: Settings) -> str:
    """The publisher's ``--env`` for this deploy, always passed explicitly (it has no default).
    Production refuses media that is not approved; staging and local ship it as unavailable with
    a warning per item. Anything unknown is treated as production (strict)."""
    env = settings.app_env
    if env in (AppEnv.local, AppEnv.test):
        return "local"
    if env in (AppEnv.staging, AppEnv.preview):
        return "staging"
    return "production"


def content_publish_command(
    settings: Settings, folder: Path = CONTENT_PUBLISH_DIR
) -> list[str] | None:
    custom = os.environ.get("CONTENT_PUBLISH_CMD")
    if custom:
        return shlex.split(custom)
    if not folder.is_dir():
        return None
    if (folder / "package.json").is_file():
        return [
            "pnpm",
            "--dir",
            str(folder),
            "run",
            "publish:run",
            "--",
            "--env",
            publish_environment(settings),
            "--target",
            "local",
            "--root",
            str(content_root()),
            "--report",
            str(report_dir()),
        ]
    for script in ("publish.sh", "run.sh"):
        if (folder / script).is_file():
            return ["bash", str(folder / script)]
    return None


async def content_publish(ctx: Ctx, ref: str | None = None) -> dict[str, Any]:
    """Runs ``tools/content-publish`` (owned by the content pipeline) when it exists (TRD §7.2).
    Its output is not logged: only the exit code and duration."""
    settings: Settings = ctx["settings"]
    cmd = content_publish_command(settings, ctx.get("content_publish_dir", CONTENT_PUBLISH_DIR))
    if cmd is None:
        log.info("content_publish_skipped", reason="tools/content-publish not present")
        return {"status": "skipped"}
    env = {
        **os.environ,
        "CONTENT_PUBLISH_REF": ref or "",
        "CONTENT_PUBLISH_REPORT_DIR": str(ctx.get("content_report_dir") or report_dir()),
    }
    started = time.perf_counter()
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(REPO_ROOT),
        env=env,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        code = await asyncio.wait_for(proc.wait(), timeout=CONTENT_PUBLISH_TIMEOUT_S)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        log.error("content_publish_timeout")
        return {"status": "timeout"}
    ms = int((time.perf_counter() - started) * 1000)
    log.info("content_publish", exit_code=code, ms=ms)
    out: dict[str, Any] = {"status": "done" if code == 0 else "failed", "exit_code": code, "ms": ms}
    if code != 0:
        return out
    metadata = Path(ctx.get("content_report_dir") or report_dir()) / "metadata.sql"
    if not metadata.is_file():
        out["metadata"] = "missing"
        return out
    deps = _deps(ctx)
    try:
        await apply_metadata_sql(deps.db, metadata)
    except Exception:
        log.exception("content_metadata_failed")
        out.update(status="failed", metadata="failed")
        return out
    root = Path(ctx.get("content_root") or content_root())
    # Never index from an empty or wrong root: the pass retires every card it does not see.
    if not any((root / "lessons").rglob("*.json")):
        out.update(metadata="applied", card_index="no_lessons")
        return out
    async with deps.db.system_tx() as session:
        counts = await card_index.index_lessons(session, root)
    out.update(metadata="applied", card_index=counts)
    return out


# --- notifications, guardians, billing reminders (notifications queue and crons) ---------------


async def notify_dispatch(ctx: Ctx) -> dict[str, int]:
    """Decides and sends every due outbox item (every minute)."""
    return await notify.dispatch_job(_deps(ctx))


async def notify_plan_web(ctx: Ctx) -> int:
    """Daily reminder and streak saver for web devices (every 15 minutes)."""
    return await notify.plan_web_habit(_deps(ctx).db)


async def guardian_expire(ctx: Ctx) -> int:
    return await guardian.expire_requests(_deps(ctx).db)


async def guardian_age_up(ctx: Ctx) -> int:
    count = await guardian.age_up(_deps(ctx).db)
    if count:
        log.info("guardian_aged_up", count=count)
    return count


async def trial_reminders(ctx: Ctx) -> int:
    return await billing.trial_reminders(_deps(ctx).db)


# --- PDF and media -------------------------------------------------------------------------------


async def render_pdf(ctx: Ctx, export_id: str) -> dict[str, Any]:
    return await exports.render_export(_deps(ctx), export_id)


async def media_generate(ctx: Ctx, request_id: str) -> dict[str, str | None]:
    return await media.generate_job(_deps(ctx), request_id)


async def media_sweep(ctx: Ctx) -> int:
    """Queued image requests the content pipeline recorded: one job each on the media queue."""
    from smriti_api.services.jobs import ArqJobQueue

    ids = await media.pending(_deps(ctx).db)
    if not ids:
        return 0
    queue = ArqJobQueue(ctx["settings"].redis_url)
    try:
        for rid in ids:
            await queue.enqueue("media_generate", str(rid), job_id=f"media_generate:{rid}")
    finally:
        await queue.close()
    return len(ids)
