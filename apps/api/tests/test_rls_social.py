"""RLS for the Phase 2 social tables (DB_SCHEMA §12): own rows for social.members,
social.duel_queue and game.league_players; nothing for social.handle_reservations (service
only); duel players and duel events for the two players only. Writes go through the API."""

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


async def _count(services: AppServices, user_id: uuid.UUID, sql: str, **params: Any) -> int:
    async with services.db.user_tx(_claims(user_id)) as session:
        return int((await session.execute(text(sql), params)).scalar_one())


@pytest.mark.parametrize(
    ("table", "insert"),
    [
        ("social.members", "insert into social.members (user_id) values (:u)"),
        (
            "social.duel_queue",
            "insert into social.duel_queue (user_id, exam_profile_id, age_group) values (:u, 'x', 'adult')",
        ),
        ("game.league_players", "insert into game.league_players (user_id) values (:u)"),
    ],
)
async def test_owner_rows_only(services: AppServices, table: str, insert: str) -> None:
    me, other = await _user(services), await _user(services)
    async with services.db.system_tx() as session:
        for uid in (me, other):
            await session.execute(text(insert), {"u": uid})
    assert await _count(services, me, f"select count(*) from {table}") == 1
    assert (
        await _count(services, me, f"select count(*) from {table} where user_id = :o", o=other) == 0
    )
    # No write policy: the API writes after its consent checks.
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(me)) as session:
            await session.execute(text(insert.replace(":u", ":x")), {"x": uuid.uuid4()})


async def test_handle_reservations_are_service_only(services: AppServices) -> None:
    me = await _user(services)
    handle = f"held_{uuid.uuid4().hex[:8]}"
    async with services.db.system_tx() as session:
        await session.execute(
            text(
                "insert into social.handle_reservations (handle, user_id, released_at)"
                " values (:h, :u, now())"
            ),
            {"h": handle, "u": me},
        )
    assert await _count(services, me, "select count(*) from social.handle_reservations") == 0
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(me)) as session:
            await session.execute(
                text(
                    "insert into social.handle_reservations (handle, released_at) values ('x_y_z', now())"
                )
            )


async def test_duel_rows_are_for_the_two_players(services: AppServices) -> None:
    a, b, outsider = await _user(services), await _user(services), await _user(services)
    async with services.db.system_tx() as session:
        duel = (
            await session.execute(
                text(
                    "insert into social.duels (challenger_id, opponent_id, exam_profile_id,"
                    " question_ids, status) values (:a, :b, 'x', '{}', 'live') returning id"
                ),
                {"a": a, "b": b},
            )
        ).scalar_one()
        for uid, role in ((a, "challenger"), (b, "opponent")):
            await session.execute(
                text(
                    "insert into social.duel_players (duel_id, user_id, role) values (:d, :u, :r)"
                ),
                {"d": duel, "u": uid, "r": role},
            )
        await session.execute(
            text("insert into social.duel_events (duel_id, kind) values (:d, 'started')"),
            {"d": duel},
        )
    for uid, players, events in ((a, 2, 1), (b, 2, 1), (outsider, 0, 0)):
        assert (
            await _count(
                services, uid, "select count(*) from social.duel_players where duel_id = :d", d=duel
            )
            == players
        )
        assert (
            await _count(
                services, uid, "select count(*) from social.duel_events where duel_id = :d", d=duel
            )
            == events
        )
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(a)) as session:
            await session.execute(
                text("insert into social.duel_events (duel_id, kind) values (:d, 'finished')"),
                {"d": duel},
            )
