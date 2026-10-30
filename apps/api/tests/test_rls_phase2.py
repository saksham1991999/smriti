"""RLS for the Phase 2 and 3 tables (DB_SCHEMA §12). Service only: the TTS cache, App Attest keys,
integrity flags and live mock runs. Owner read, written only by the server: voice sessions,
Feynman scores and weak-area alerts. The generic isolation test in test_rls.py also covers owner
isolation for every table with a user column."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from smriti_api.core.deps import AppServices


async def _user(services: AppServices) -> uuid.UUID:
    async with services.db.admin_tx() as session:
        uid = (
            await session.execute(
                text("insert into auth.users (is_anonymous) values (true) returning id")
            )
        ).scalar_one()
    return uuid.UUID(str(uid))


def _claims(user_id: uuid.UUID) -> dict[str, Any]:
    return {
        "sub": str(user_id),
        "role": "authenticated",
        "is_anonymous": True,
        "aud": "authenticated",
    }


@pytest.mark.parametrize(
    "table",
    ["ai.tts_cache", "app.attest_keys", "ops.integrity_flags", "ops.live_mock_runs"],
)
async def test_service_only_tables(services: AppServices, table: str) -> None:
    me = await _user(services)
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(me)) as session:
            await session.execute(text(f"select count(*) from {table}"))


async def _seed(services: AppServices, user_id: uuid.UUID) -> None:
    async with services.db.system_tx() as session:
        await session.execute(
            text(
                "insert into learn.weak_area_alerts (user_id, local_day, topic_id, cards,"
                " min_retrievability, target_retention, horizon_days)"
                " values (:u, :d, 'fx.chapter-a.topic-a', 2, 0.85, 0.9, 3)"
            ),
            {"u": user_id, "d": date(2026, 10, 30)},
        )
        await session.execute(
            text(
                "insert into ops.integrity_flags (user_id, source, kind) values (:u, 'sync', 'fast_review')"
            ),
            {"u": user_id},
        )


async def test_weak_area_alerts_are_owner_read_only(services: AppServices) -> None:
    me, other = await _user(services), await _user(services)
    await _seed(services, me)
    await _seed(services, other)
    async with services.db.user_tx(_claims(me)) as session:
        owners = set(
            (await session.execute(text("select user_id from learn.weak_area_alerts"))).scalars()
        )
    assert owners == {me}
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(me)) as session:
            await session.execute(
                text(
                    "insert into learn.weak_area_alerts (user_id, local_day, topic_id, cards,"
                    " min_retrievability, target_retention, horizon_days)"
                    " values (:u, '2026-10-31', 't', 1, 0.5, 0.9, 3)"
                ),
                {"u": me},
            )


@pytest.mark.parametrize("table", ["ai.voice_sessions", "ai.feynman_scores"])
async def test_tutor_rows_are_not_writable_by_owners(services: AppServices, table: str) -> None:
    me = await _user(services)
    async with services.db.user_tx(_claims(me)) as session:
        await session.execute(text(f"select count(*) from {table}"))
    with pytest.raises(DBAPIError) as exc:
        async with services.db.user_tx(_claims(me)) as session:
            await session.execute(
                text(f"insert into {table} (user_id) values (:u)"),
                {"u": me},
            )
    message = str(exc.value.orig)
    assert "row-level security" in message or "permission denied" in message
