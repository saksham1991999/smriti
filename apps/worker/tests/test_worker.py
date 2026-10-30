"""Worker settings, the timezone-bucket roll-up, upkeep, purge and the content publish hook."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from smriti_api.schemas.sync import SyncEventIn
from smriti_api.services.jobs import QUEUE_BY_JOB, QUEUES, JobDeps, arq_queue_name
from smriti_api.services.sync import apply_batch
from sqlalchemy import text

from smriti_worker import jobs
from smriti_worker.__main__ import main as worker_main
from smriti_worker.main import WORKERS, DefaultWorker


def test_every_queue_has_a_worker_on_the_apis_queue_name() -> None:
    assert set(WORKERS) == set(QUEUES)
    for queue, settings in WORKERS.items():
        assert settings.queue_name == arq_queue_name(queue)  # type: ignore[attr-defined]
    for job, queue in QUEUE_BY_JOB.items():
        names = {f.__name__ for f in WORKERS[queue].functions}  # type: ignore[attr-defined]
        assert job in names, f"{job} is enqueued on {queue} but no worker runs it"


def test_arq_sees_every_setting() -> None:
    from arq.worker import get_kwargs
    from smriti_api.core.config import get_settings

    for settings in WORKERS.values():
        kwargs = get_kwargs(settings)
        assert {"queue_name", "functions", "redis_settings", "on_startup", "max_tries"} <= set(
            kwargs
        )
        redis: Any = kwargs["redis_settings"]
        assert redis.port == int(get_settings().redis_url.split(":")[2].split("/")[0])


def test_crons_live_on_the_default_queue() -> None:
    names = {c.coroutine.__name__ for c in DefaultWorker.cron_jobs}  # type: ignore[attr-defined]
    assert names == {
        "nightly_rollup",
        "purge_deleted_accounts",
        "db_upkeep",
        "notify_dispatch",
        "notify_plan_web",
        "guardian_expire",
        "guardian_age_up",
        "trial_reminders",
        "media_sweep",
        "mocks_auto_submit",
        "live_mocks_tick",
        "fsrs_optimise",
        "irt_calibrate",
        "tutor_retention",
        "weak_area_alerts",
        "rhythm_estimates",
        "league_assign",
        "league_rollover",
        "duo_rollup",
        "duel_sweep",
        "squad_quests",
    }


def test_unknown_queue_is_refused() -> None:
    assert worker_main(["smriti_worker", "nope"]) == 2


def test_timezone_bucket_is_the_zones_at_local_midnight() -> None:
    now = datetime(2026, 10, 29, 18, 35, tzinfo=UTC)  # 00:05 on the 30th in India
    names = ["Asia/Kolkata", "UTC", "America/New_York", "Asia/Colombo", "Not/AZone"]
    assert jobs.timezones_at_local_hour(names, now) == ["Asia/Colombo", "Asia/Kolkata"]
    assert jobs.timezones_at_local_hour(names, now, hour=18) == ["UTC"]


async def new_user(deps: JobDeps, timezone: str) -> uuid.UUID:
    async with deps.db.admin_tx() as session:
        uid = (
            await session.execute(
                text("insert into auth.users (is_anonymous) values (true) returning id")
            )
        ).scalar_one()
        await session.execute(
            text(
                "update app.profiles set timezone = :tz, first_variant = 'jee' where user_id = :u"
            ),
            {"tz": timezone, "u": uid},
        )
    return uuid.UUID(str(uid))


def lesson(at: datetime, tz: str) -> SyncEventIn:
    return SyncEventIn(
        event_id=uuid.uuid4(),
        type="lesson_completed",
        occurred_at=at,
        tz=tz,
        payload={
            "topic_id": "t-worker",
            "mode": "deep_dive",
            "cards_seen": 4,
            "correct": 2,
            "total": 2,
            "ms_total": 60000,
        },
    )


async def plant_health(deps: JobDeps, user_id: uuid.UUID) -> tuple[str, int]:
    async with deps.db.admin_tx() as session:
        row = (
            await session.execute(
                text(
                    "select p.health, s.current_streak from game.plants p"
                    " join game.user_stats s using (user_id) where p.user_id = :u"
                ),
                {"u": user_id},
            )
        ).one()
    return str(row.health), int(row.current_streak)


async def test_rollup_closes_the_day_only_for_its_timezone_bucket(deps: JobDeps) -> None:
    # India just passed midnight (00:05 IST on the 30th); New York is mid-afternoon on the 29th.
    now = datetime(2026, 10, 29, 18, 35, tzinfo=UTC)
    india = await new_user(deps, "Asia/Kolkata")
    new_york = await new_user(deps, "America/New_York")
    three_days_ago = now - timedelta(days=3)
    for user, tz in ((india, "Asia/Kolkata"), (new_york, "America/New_York")):
        await apply_batch(
            deps.db,
            user_id=user,
            device_id=None,
            events=[lesson(three_days_ago, tz)],
            now=three_days_ago,
        )

    done = await jobs.rollup_timezones(deps, now, ["Asia/Kolkata"])
    assert done >= 1
    # In India the 28th and 29th are closed with no study: the monthly freeze covers one,
    # the other is missed.
    health, streak = await plant_health(deps, india)
    assert health == "droopy"
    assert streak == 0
    # New York was not in the bucket, so its stored state still shows the day of the lesson.
    assert await plant_health(deps, new_york) == ("thriving", 1)


async def test_rollup_skips_users_scheduled_for_deletion(deps: JobDeps) -> None:
    user = await new_user(deps, "Pacific/Chatham")
    async with deps.db.admin_tx() as session:
        await session.execute(
            text(
                "update app.profiles set deletion_scheduled_for = now() + interval '7 days' where user_id = :u"
            ),
            {"u": user},
        )
    now = datetime(2026, 10, 30, 11, 0, tzinfo=UTC)
    assert await jobs.rollup_timezones(deps, now, ["Pacific/Chatham"]) == 0


async def test_db_upkeep_runs_when_pg_cron_is_missing(ctx: dict[str, Any]) -> None:
    result = await jobs.db_upkeep(ctx)
    assert result["status"] in ("done", "skipped")
    if result["status"] == "done":
        assert result["idle_guests_removed"] >= 0


async def test_purge_and_merge_wrappers(ctx: dict[str, Any]) -> None:
    assert await jobs.purge_deleted_accounts(ctx) >= 0
    result = await jobs.merge_guest(ctx, str(uuid.uuid4()))
    assert result == {"status": "skipped"}  # unknown or already finished merges are no-ops
    assert await jobs.ping(ctx) == "pong"


async def test_content_publish_is_skipped_without_the_tool(
    ctx: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("CONTENT_PUBLISH_CMD", raising=False)
    result = await jobs.content_publish({**ctx, "content_publish_dir": tmp_path / "missing"}, "abc")
    assert result == {"status": "skipped"}


async def test_content_publish_runs_the_tool_with_the_ref(
    ctx: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("CONTENT_PUBLISH_CMD", raising=False)
    marker = tmp_path / "marker"
    (tmp_path / "publish.sh").write_text(f'printf "%s" "$CONTENT_PUBLISH_REF" > "{marker}"\n')
    result = await jobs.content_publish({**ctx, "content_publish_dir": tmp_path}, "main@abc123")
    assert result["status"] == "done"
    assert marker.read_text() == "main@abc123"

    (tmp_path / "publish.sh").write_text("exit 3\n")
    failed = await jobs.content_publish({**ctx, "content_publish_dir": tmp_path}, None)
    assert (failed["status"], failed["exit_code"]) == ("failed", 3)


def test_content_publish_command_prefers_the_env_override(
    ctx: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "package.json").write_text("{}")
    assert jobs.content_publish_command(ctx["settings"], tmp_path) == [
        "pnpm",
        "--dir",
        str(tmp_path),
        "run",
        "publish:local",
        "--",
        "--root",
        str(jobs.content_root()),
        "--report",
        str(jobs.report_dir()),
    ]
    monkeypatch.setenv("CONTENT_PUBLISH_CMD", "node tools/x.mjs --dry-run")
    assert jobs.content_publish_command(ctx["settings"], tmp_path) == [
        "node",
        "tools/x.mjs",
        "--dry-run",
    ]


async def test_a_job_the_api_enqueues_runs_on_the_worker() -> None:
    """End to end through Redis: the API's ArqJobQueue enqueues, a burst worker runs it."""
    from arq.jobs import Job
    from arq.worker import Worker, get_kwargs
    from smriti_api.core.config import get_settings
    from smriti_api.services.jobs import ArqJobQueue

    queue = ArqJobQueue(get_settings().redis_url)
    merge_id = str(uuid.uuid4())
    job_id = f"merge_guest:{merge_id}"
    try:
        await queue.enqueue("merge_guest", merge_id, job_id=job_id)
        settings: dict[str, Any] = {
            **get_kwargs(DefaultWorker),
            "cron_jobs": [],
            "burst": True,
            "poll_delay": 0.05,
        }
        worker = Worker(**settings)
        try:
            await worker.main()
        finally:
            await worker.close()
        pool = await queue._get_pool()
        result = await Job(job_id, pool, _queue_name=arq_queue_name("default")).result(timeout=5)
        assert result == {"status": "skipped"}  # no such merge: the job is a no-op
    finally:
        await queue.close()


async def test_content_publish_applies_metadata_sql(
    ctx: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("CONTENT_PUBLISH_CMD", raising=False)
    tool = tmp_path / "tool"
    tool.mkdir()
    report = tmp_path / "report"
    report.mkdir()
    # The stand-in publish writes a two-statement metadata.sql where the real one would.
    (tool / "publish.sh").write_text(
        'printf "select 1;\nselect 2;\n" > "$CONTENT_PUBLISH_REPORT_DIR/metadata.sql"\n'
    )
    run = {
        **ctx,
        "content_publish_dir": tool,
        "content_report_dir": report,
        "content_root": tmp_path / "content",
    }
    result = await jobs.content_publish(run, "main@abc")
    assert (result["status"], result["metadata"], result["card_index"]) == (
        "done",
        "applied",
        "no_lessons",
    )
    (report / "metadata.sql").write_text("select nope_not_a_column from nowhere;")
    (tool / "publish.sh").write_text("exit 0\n")
    failed = await jobs.content_publish(run, None)
    assert (failed["status"], failed["metadata"]) == ("failed", "failed")


async def test_notification_guardian_billing_and_media_jobs(ctx: dict[str, Any]) -> None:
    sent = await jobs.notify_dispatch(ctx)
    assert {"sent", "held", "suppressed", "failed", "pruned"} <= set(sent)
    assert isinstance(await jobs.notify_plan_web(ctx), int)
    assert isinstance(await jobs.guardian_expire(ctx), int)
    assert isinstance(await jobs.guardian_age_up(ctx), int)
    assert isinstance(await jobs.trial_reminders(ctx), int)
    assert await jobs.render_pdf(ctx, str(uuid.uuid4())) == {"status": "skipped"}
    assert (await jobs.media_generate(ctx, str(uuid.uuid4())))["status"] == "skipped"
