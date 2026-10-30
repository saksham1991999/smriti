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
from smriti_api.core.config import REPO_ROOT, Settings, get_settings
from smriti_api.core.db import Database
from smriti_api.core.logging import configure_logging, hash_user_id
from smriti_api.services import accounts
from smriti_api.services.analytics import LogAnalyticsSink
from smriti_api.services.auth_admin import build_auth_admin
from smriti_api.services.jobs import JobDeps
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
        db=db, auth_admin=build_auth_admin(settings, db, http), analytics=LogAnalyticsSink()
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


def content_publish_command(
    settings: Settings, folder: Path = CONTENT_PUBLISH_DIR
) -> list[str] | None:
    custom = os.environ.get("CONTENT_PUBLISH_CMD")
    if custom:
        return shlex.split(custom)
    if not folder.is_dir():
        return None
    if (folder / "package.json").is_file():
        return ["pnpm", "--dir", str(folder), "run", "publish"]
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
    env = {**os.environ, "CONTENT_PUBLISH_REF": ref or ""}
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
    return {"status": "done" if code == 0 else "failed", "exit_code": code, "ms": ms}
