"""Reads and writes memory palaces (sync contract v1.5, memory-labs flow §5.6).

The ``palace_saved`` and ``palace_deleted`` sync handlers and the ``/v1/palaces`` routes all write
through ``save`` and ``delete`` here, inside the caller's service-role transaction, so the device
and the server keep one shape and one set of rules:

* A palace is saved whole. The newest ``updated_at`` (the device's clock at the edit) wins; an
  older snapshot from a slower device is accepted and ignored.
* A deleted palace stays deleted: its rooms, spots and items go, and only an empty row is kept
  so an older snapshot can't bring it back.
* Each item is an FSRS card ``p:<item_id>``. Removing an item deletes its card and tombstones it.
* Building a new palace needs Pro (PRD §11.1); edits to a palace that already exists are always
  kept, so nothing written offline is lost when a plan lapses.

Every query names the user explicitly: these run as service_role.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.schemas import palaces as ps
from smriti_api.services.errors import DomainError

CARD_PREFIX = "p:"


def card_ref(item_id: uuid.UUID) -> str:
    return f"{CARD_PREFIX}{item_id}"


def item_id_of(ref: str) -> uuid.UUID | None:
    """The item behind a ``p:`` card ref, or None when the ref isn't one."""
    if not ref.startswith(CARD_PREFIX):
        return None
    try:
        return uuid.UUID(ref[len(CARD_PREFIX) :])
    except ValueError:
        return None


async def _drop_cards(
    session: AsyncSession, user_id: uuid.UUID, item_ids: list[uuid.UUID]
) -> list[str]:
    refs = [card_ref(i) for i in item_ids]
    if refs:
        await session.execute(
            text("delete from learn.srs_cards where user_id = :u and card_ref = any(:refs)"),
            {"u": user_id, "refs": refs},
        )
    return refs


async def _foreign_ids(session: AsyncSession, palace_id: uuid.UUID, doc: ps.PalaceDoc) -> bool:
    """True when a room, spot or item id in the document already belongs to another palace."""
    rooms = [r.room_id for r in doc.rooms]
    loci = [lo.locus_id for r in doc.rooms for lo in r.loci]
    items = [i.item_id for i in doc.items]
    row = (
        await session.execute(
            text(
                """
                select exists (select 1 from learn.palace_rooms where id = any(:rooms) and palace_id <> :p)
                    or exists (select 1 from learn.palace_loci l join learn.palace_rooms r on r.id = l.room_id
                                where l.id = any(:loci) and r.palace_id <> :p)
                    or exists (select 1 from learn.palace_items where id = any(:items) and palace_id <> :p)
                """
            ),
            {"rooms": rooms, "loci": loci, "items": items, "p": palace_id},
        )
    ).scalar_one()
    return bool(row)


async def save(
    session: AsyncSession, user_id: uuid.UUID, doc: ps.PalaceDoc, *, is_pro: bool
) -> tuple[bool, list[str]]:
    """Stores the snapshot unless a newer one (or a delete) is already here.

    Returns (written, card refs removed). Raises ``DomainError`` with ``pro_required`` for a new
    palace without Pro, and ``palace_not_found`` when the id is someone else's palace."""
    row = (
        await session.execute(
            text(
                "select user_id, client_updated_at, deleted_at from learn.palaces where id = :p for update"
            ),
            {"p": doc.palace_id},
        )
    ).one_or_none()
    if row is not None and row.user_id != user_id:
        raise DomainError("palace_not_found", "No such palace", 404)
    if row is not None and (row.deleted_at is not None or doc.updated_at <= row.client_updated_at):
        return False, []
    if row is None and not is_pro:
        raise DomainError("pro_required", "Building a memory palace is part of Pro", 403)
    if await _foreign_ids(session, doc.palace_id, doc):
        raise DomainError("invalid_payload", "An id in this palace belongs to another palace", 422)

    params = {
        "p": doc.palace_id,
        "u": user_id,
        "name": doc.name,
        "tpl": doc.template,
        "tid": doc.template_id,
        "src": doc.source,
        "at": doc.updated_at,
    }
    if row is None:
        await session.execute(
            text(
                """
                insert into learn.palaces (id, user_id, name, template, template_id, source, client_updated_at)
                values (:p, :u, :name, :tpl, :tid, :src, :at)
                """
            ),
            params,
        )
    else:
        await session.execute(
            text(
                """
                update learn.palaces set name = :name, template = :tpl, template_id = :tid, source = :src,
                       client_updated_at = :at
                 where id = :p and user_id = :u
                """
            ),
            params,
        )

    # Rooms and spots are rewritten whole (their ids are kept); items let go of their spots first
    # so moves and swaps never trip the one-item-per-spot index half way.
    await session.execute(
        text(
            "update learn.palace_items set locus_id = null where palace_id = :p and locus_id is not null"
        ),
        {"p": doc.palace_id},
    )
    await session.execute(
        text("delete from learn.palace_rooms where palace_id = :p"), {"p": doc.palace_id}
    )
    for room in doc.rooms:
        await session.execute(
            text(
                "insert into learn.palace_rooms (id, palace_id, name, sort, template_room)"
                " values (:id, :p, :name, :sort, :tr)"
            ),
            {
                "id": room.room_id,
                "p": doc.palace_id,
                "name": room.name,
                "sort": room.sort,
                "tr": room.template_room,
            },
        )
        for locus in room.loci:
            await session.execute(
                text(
                    "insert into learn.palace_loci (id, room_id, sort, pos)"
                    " values (:id, :room, :sort, cast(:pos as jsonb))"
                ),
                {
                    "id": locus.locus_id,
                    "room": room.room_id,
                    "sort": locus.sort,
                    "pos": json.dumps(locus.pos.model_dump()),
                },
            )

    keep = [i.item_id for i in doc.items]
    removed = (
        (
            await session.execute(
                text(
                    "delete from learn.palace_items where palace_id = :p and id <> all(:keep) returning id"
                ),
                {"p": doc.palace_id, "keep": keep},
            )
        )
        .scalars()
        .all()
    )
    for sort, item in enumerate(doc.items):
        await session.execute(
            text(
                """
                insert into learn.palace_items as i (id, palace_id, item_ref, label, note, locus_id, sort)
                values (:id, :p, :ref, :label, :note, :locus, :sort)
                on conflict (id) do update set item_ref = excluded.item_ref, label = excluded.label,
                       note = excluded.note, locus_id = excluded.locus_id, sort = excluded.sort
                 where i.palace_id = excluded.palace_id
                """
            ),
            {
                "id": item.item_id,
                "p": doc.palace_id,
                "ref": item.item_ref,
                "label": item.label,
                "note": item.note,
                "locus": item.locus_id,
                "sort": sort,
            },
        )
    return True, await _drop_cards(session, user_id, list(removed))


async def delete(session: AsyncSession, user_id: uuid.UUID, palace_id: uuid.UUID) -> list[str]:
    """Deletes a palace's rooms, spots, items and their cards, and keeps an empty row as the
    tombstone (no name: the student's words go with it). A palace that isn't theirs, or was never
    synced, is a no-op. Returns the card refs removed."""
    owner = (
        await session.execute(
            text("select user_id from learn.palaces where id = :p for update"), {"p": palace_id}
        )
    ).scalar_one_or_none()
    if owner != user_id:
        return []
    items = (
        (
            await session.execute(
                text("delete from learn.palace_items where palace_id = :p returning id"),
                {"p": palace_id},
            )
        )
        .scalars()
        .all()
    )
    await session.execute(
        text("delete from learn.palace_rooms where palace_id = :p"), {"p": palace_id}
    )
    await session.execute(
        text(
            "update learn.palaces set name = '', template_id = null, source = null,"
            " deleted_at = coalesce(deleted_at, now()) where id = :p and user_id = :u"
        ),
        {"p": palace_id, "u": user_id},
    )
    return await _drop_cards(session, user_id, list(items))


async def item_exists(session: AsyncSession, user_id: uuid.UUID, item_id: uuid.UUID) -> bool:
    row = (
        await session.execute(
            text(
                """
                select 1 from learn.palace_items i join learn.palaces p on p.id = i.palace_id
                 where i.id = :i and p.user_id = :u and p.deleted_at is null
                """
            ),
            {"i": item_id, "u": user_id},
        )
    ).one_or_none()
    return row is not None


async def load(
    session: AsyncSession, user_id: uuid.UUID, palace_id: uuid.UUID | None = None
) -> list[ps.PalaceOut]:
    """The user's live palaces (or one), each with its items' next due time, newest change first."""
    palaces = (
        await session.execute(
            text(
                """
                select id, name, template, template_id, source, client_updated_at, created_at
                  from learn.palaces
                 where user_id = :u and deleted_at is null and (cast(:p as uuid) is null or id = :p)
                 order by client_updated_at desc, id
                """
            ),
            {"u": user_id, "p": palace_id},
        )
    ).all()
    if not palaces:
        return []
    ids = [p.id for p in palaces]
    rooms = (
        await session.execute(
            text(
                "select id, palace_id, name, sort, template_room from learn.palace_rooms"
                " where palace_id = any(:ids) order by palace_id, sort"
            ),
            {"ids": ids},
        )
    ).all()
    loci = (
        await session.execute(
            text(
                """
                select l.id, l.room_id, l.sort, l.pos from learn.palace_loci l
                  join learn.palace_rooms r on r.id = l.room_id
                 where r.palace_id = any(:ids) order by l.room_id, l.sort
                """
            ),
            {"ids": ids},
        )
    ).all()
    items = (
        await session.execute(
            text(
                """
                select i.id, i.palace_id, i.item_ref, i.label, i.note, i.locus_id, c.due_at
                  from learn.palace_items i
                  left join learn.srs_cards c on c.user_id = :u and c.card_ref = 'p:' || i.id::text
                 where i.palace_id = any(:ids) order by i.palace_id, i.sort, i.id
                """
            ),
            {"ids": ids, "u": user_id},
        )
    ).all()
    loci_by_room: dict[uuid.UUID, list[ps.Locus]] = {}
    for lo in loci:
        loci_by_room.setdefault(lo.room_id, []).append(
            ps.Locus(locus_id=lo.id, sort=lo.sort, pos=lo.pos)
        )
    rooms_by_palace: dict[uuid.UUID, list[ps.Room]] = {}
    for r in rooms:
        rooms_by_palace.setdefault(r.palace_id, []).append(
            ps.Room(
                room_id=r.id,
                name=r.name,
                sort=r.sort,
                template_room=r.template_room,
                loci=loci_by_room.get(r.id, []),
            )
        )
    items_by_palace: dict[uuid.UUID, list[ps.PalaceItemOut]] = {}
    for i in items:
        items_by_palace.setdefault(i.palace_id, []).append(
            ps.PalaceItemOut(
                item_id=i.id,
                item_ref=i.item_ref,
                label=i.label,
                note=i.note,
                locus_id=i.locus_id,
                card_ref=card_ref(i.id),
                due_at=i.due_at,
            )
        )
    out: list[ps.PalaceOut] = []
    for p in palaces:
        palace_items = items_by_palace.get(p.id, [])
        dues = [i.due_at for i in palace_items if i.due_at is not None]
        out.append(
            ps.PalaceOut(
                palace_id=p.id,
                name=p.name,
                template=p.template,
                template_id=p.template_id,
                source=p.source,
                rooms=rooms_by_palace.get(p.id, []),
                items=palace_items,
                updated_at=p.client_updated_at,
                created_at=p.created_at,
                next_walk_at=min(dues) if dues else None,
            )
        )
    return out


async def deleted_ids(session: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        (
            await session.execute(
                text(
                    "select id from learn.palaces where user_id = :u and deleted_at is not null"
                    " order by deleted_at desc limit 500"
                ),
                {"u": user_id},
            )
        )
        .scalars()
        .all()
    )


async def latest_update(
    session: AsyncSession, user_id: uuid.UUID, palace_id: uuid.UUID
) -> datetime | None:
    return (
        await session.execute(
            text(
                "select client_updated_at from learn.palaces where id = :p and user_id = :u and deleted_at is null"
            ),
            {"p": palace_id, "u": user_id},
        )
    ).scalar_one_or_none()
