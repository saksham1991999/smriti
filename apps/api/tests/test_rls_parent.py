"""RLS for parent mode (DB_SCHEMA §12): app.parental_controls and app.time_requests are read by
the child and by a guardian with a live link, nobody else; nobody writes them except the API."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from smriti_api.core.deps import AppServices


async def _user(services: AppServices) -> uuid.UUID:
    async with services.db.admin_tx() as session:
        uid = (
            await session.execute(
                text("insert into auth.users (is_anonymous) values (false) returning id")
            )
        ).scalar_one()
    return uuid.UUID(str(uid))


def _claims(user_id: uuid.UUID) -> dict[str, Any]:
    return {"sub": str(user_id), "role": "authenticated", "aud": "authenticated"}


async def _count(services: AppServices, user_id: uuid.UUID, sql: str, **params: Any) -> int:
    async with services.db.user_tx(_claims(user_id)) as session:
        return int((await session.execute(text(sql), params)).scalar_one())


async def test_child_and_linked_guardian_read_only(services: AppServices) -> None:
    child, guardian, ex_guardian, stranger = (
        await _user(services),
        await _user(services),
        await _user(services),
        await _user(services),
    )
    async with services.db.system_tx() as session:
        await session.execute(
            text(
                "insert into app.guardian_links (guardian_user_id, learner_user_id, kind)"
                " values (:g, :c, 'consent'), (:x, :c, 'consent')"
            ),
            {"g": guardian, "x": ex_guardian, "c": child},
        )
        await session.execute(
            text(
                "update app.guardian_links set revoked_at = now()"
                " where guardian_user_id = :x and learner_user_id = :c"
            ),
            {"x": ex_guardian, "c": child},
        )
        await session.execute(
            text(
                "insert into app.parental_controls (learner_user_id, set_by, daily_limit_min)"
                " values (:c, :g, 30)"
            ),
            {"c": child, "g": guardian},
        )
        await session.execute(
            text(
                "insert into app.time_requests (learner_user_id, minutes, for_date)"
                " values (:c, 15, current_date)"
            ),
            {"c": child},
        )
    for table in ("app.parental_controls", "app.time_requests"):
        sql = f"select count(*) from {table} where learner_user_id = :c"
        assert await _count(services, child, sql, c=child) == 1
        assert await _count(services, guardian, sql, c=child) == 1
        assert await _count(services, ex_guardian, sql, c=child) == 0
        assert await _count(services, stranger, sql, c=child) == 0

    # No write policy for anyone: the API writes after its link and consent checks.
    for who in (child, guardian):
        async with services.db.user_tx(_claims(who)) as session:
            changed = (
                await session.execute(
                    text(
                        "update app.parental_controls set daily_limit_min = 120"
                        " where learner_user_id = :c returning 1"
                    ),
                    {"c": child},
                )
            ).all()
        assert changed == []
        with pytest.raises(DBAPIError):
            async with services.db.user_tx(_claims(who)) as session:
                await session.execute(
                    text(
                        "insert into app.time_requests (learner_user_id, minutes, for_date)"
                        " values (:c, 15, current_date)"
                    ),
                    {"c": child},
                )
