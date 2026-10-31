"""RLS for memory palaces (DB_SCHEMA §12): a palace, its rooms, spots and items are the owner's
alone, and an item can only sit on a spot of its own palace."""

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


async def _palace(services: AppServices, user_id: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """A palace with one room and one spot, written as its owner. Returns (palace, spot)."""
    palace, room, spot = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    async with services.db.user_tx(_claims(user_id)) as session:
        await session.execute(
            text(
                "insert into learn.palaces (id, user_id, name, template) values (:p, :u, 'P', 'home')"
            ),
            {"p": palace, "u": user_id},
        )
        await session.execute(
            text(
                "insert into learn.palace_rooms (id, palace_id, name, sort) values (:r, :p, 'R', 0)"
            ),
            {"r": room, "p": palace},
        )
        await session.execute(
            text(
                "insert into learn.palace_loci (id, room_id, sort, pos)"
                ' values (:l, :r, 0, \'{"x": 0.5, "y": 0.5}\')'
            ),
            {"l": spot, "r": room},
        )
    return palace, spot


async def _count(services: AppServices, user_id: uuid.UUID, sql: str, **params: Any) -> int:
    async with services.db.user_tx(_claims(user_id)) as session:
        return int((await session.execute(text(sql), params)).scalar_one())


async def test_owner_only(services: AppServices) -> None:
    owner, stranger = await _user(services), await _user(services)
    palace, spot = await _palace(services, owner)
    item = uuid.uuid4()
    async with services.db.user_tx(_claims(owner)) as session:
        await session.execute(
            text(
                "insert into learn.palace_items (id, palace_id, item_ref, locus_id)"
                " values (:i, :p, 'kp:c.x#1', :l)"
            ),
            {"i": item, "p": palace, "l": spot},
        )
    for table in ("learn.palace_items", "learn.palace_loci", "learn.palace_rooms", "learn.palaces"):
        assert await _count(services, owner, f"select count(*) from {table}") >= 1, table
        assert await _count(services, stranger, f"select count(*) from {table}") == 0, table

    # The stranger can't change or delete the owner's items, nor add one to the owner's palace.
    async with services.db.user_tx(_claims(stranger)) as session:
        changed = await session.execute(
            text("update learn.palace_items set label = 'x' where id = :i returning id"),
            {"i": item},
        )
        assert changed.all() == []
        gone = await session.execute(
            text("delete from learn.palace_items where id = :i returning id"), {"i": item}
        )
        assert gone.all() == []
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(stranger)) as session:
            await session.execute(
                text(
                    "insert into learn.palace_items (id, palace_id, item_ref)"
                    " values (:i, :p, 'kp:c.x#2')"
                ),
                {"i": uuid.uuid4(), "p": palace},
            )
    async with services.db.user_tx(_claims(owner)) as session:
        changed = await session.execute(
            text("update learn.palace_items set label = 'mine' where id = :i returning id"),
            {"i": item},
        )
        assert len(changed.all()) == 1


async def test_item_sits_on_its_own_palace_only(services: AppServices) -> None:
    owner, stranger = await _user(services), await _user(services)
    _, their_spot = await _palace(services, owner)
    mine, my_spot = await _palace(services, stranger)
    # Pointing at a spot of someone else's palace (to see or block it) is refused, even by the API.
    for tx in (services.db.user_tx(_claims(stranger)), services.db.system_tx()):
        with pytest.raises(DBAPIError):
            async with tx as session:
                await session.execute(
                    text(
                        "insert into learn.palace_items (id, palace_id, item_ref, locus_id)"
                        " values (:i, :p, 'kp:c.x#1', :l)"
                    ),
                    {"i": uuid.uuid4(), "p": mine, "l": their_spot},
                )
    # One item per spot.
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(stranger)) as session:
            for n in range(2):
                await session.execute(
                    text(
                        "insert into learn.palace_items (id, palace_id, item_ref, locus_id)"
                        " values (:i, :p, :ref, :l)"
                    ),
                    {"i": uuid.uuid4(), "p": mine, "ref": f"kp:c.x#{n}", "l": my_spot},
                )
