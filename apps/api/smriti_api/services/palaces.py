"""Memory palaces: the document operations and the ``/v1/palaces`` flows (memory-labs §5.6).

The operations are pure: each takes a palace document and returns the next one. app-core
``src/palace/ops.ts`` implements the same operations for the apps, and both are tested against
``packages/app-core/test-vectors/palace.json``. A REST mutation loads the palace, applies an
operation and saves the result as a ``palace_saved`` event through the sync batch, exactly as a
device's outbox would, so there is one write path and one set of rules (``palace_store``).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import ValidationError
from sqlalchemy import text

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.deps import ClientInfo
from smriti_api.core.errors import ApiError
from smriti_api.schemas import palaces as ps
from smriti_api.schemas import sync as s
from smriti_api.services import game, palace_store
from smriti_api.services.errors import DomainError
from smriti_api.services.recompute import DEFAULT_TZ
from smriti_api.services.sync import apply_batch

NewId = Callable[[], uuid.UUID]

# The five spots a room gets when it comes with none: a zig-zag across the picture, in walk order
# (fractions of the width and height). Kept in step with app-core DEFAULT_SPOT_POSITIONS.
DEFAULT_SPOT_POSITIONS: tuple[tuple[float, float], ...] = (
    (0.15, 0.65),
    (0.325, 0.4),
    (0.5, 0.65),
    (0.675, 0.4),
    (0.85, 0.65),
)

_REJECT_STATUS = {"pro_required": 403, "palace_not_found": 404}


# --- pure operations ------------------------------------------------------------------------------


def _rebuild(doc: ps.PalaceDoc, **changes: Any) -> ps.PalaceDoc:
    data = doc.model_dump()
    data.update(changes)
    try:
        return ps.PalaceDoc.model_validate(data)
    except ValidationError as exc:
        detail = "; ".join(str(e["msg"]) for e in exc.errors()[:3])
        raise DomainError("invalid_palace", detail, 422) from exc


def default_loci(new_id: NewId) -> list[dict[str, Any]]:
    return [
        {"locus_id": new_id(), "sort": i, "pos": {"x": x, "y": y}}
        for i, (x, y) in enumerate(DEFAULT_SPOT_POSITIONS)
    ]


def _room(
    room: ps.RoomIn, sort: int, existing: dict[str, Any] | None, new_id: NewId
) -> dict[str, Any]:
    if room.loci:
        loci = [
            {"locus_id": lo.locus_id or new_id(), "sort": i, "pos": lo.pos.model_dump()}
            for i, lo in enumerate(room.loci)
        ]
    elif existing is not None:
        loci = existing["loci"]
    else:
        loci = default_loci(new_id)
    return {
        "room_id": room.room_id or new_id(),
        "name": room.name,
        "sort": sort,
        "template_room": room.template_room,
        "loci": loci,
    }


def create_doc(body: ps.PalaceCreate, now: datetime, new_id: NewId) -> ps.PalaceDoc:
    """A new palace from the template the client loaded (its rooms and spots in walk order).
    With no rooms it gets one room named after the palace, with the default spots."""
    rooms = body.rooms or [ps.RoomIn(name=body.name)]
    data = {
        "palace_id": body.palace_id or new_id(),
        "name": body.name,
        "template": body.template,
        "template_id": body.template_id,
        "source": body.source,
        "rooms": [_room(r, i, None, new_id) for i, r in enumerate(rooms)],
        "items": [],
        "updated_at": now,
    }
    try:
        return ps.PalaceDoc.model_validate(data)
    except ValidationError as exc:
        raise DomainError("invalid_palace", str(exc.errors()[0]["msg"]), 422) from exc


def walk(doc: ps.PalaceDoc) -> list[ps.Locus]:
    """Every spot in walk order: rooms by their order, spots by theirs."""
    return [
        lo
        for r in sorted(doc.rooms, key=lambda r: r.sort)
        for lo in sorted(r.loci, key=lambda lo: lo.sort)
    ]


def set_rooms(doc: ps.PalaceDoc, rooms: list[ps.RoomIn], new_id: NewId) -> ps.PalaceDoc:
    """The new walk, whole: rooms named by id are kept (with their spots unless new spots are
    given), others are new, and rooms left out go. Items on spots that went return to the tray."""
    existing = {r["room_id"]: r for r in doc.model_dump()["rooms"]}
    for r in rooms:
        if r.room_id is not None and r.room_id not in existing:
            raise DomainError("room_not_found", "No such room in this palace", 404)
    new_rooms = [
        _room(r, i, existing.get(r.room_id) if r.room_id else None, new_id)
        for i, r in enumerate(rooms)
    ]
    spots = {lo["locus_id"] for r in new_rooms for lo in r["loci"]}
    items = [
        {**i, "locus_id": i["locus_id"] if i["locus_id"] in spots else None}
        for i in doc.model_dump()["items"]
    ]
    return _rebuild(doc, rooms=new_rooms, items=items)


def update(doc: ps.PalaceDoc, body: ps.PalaceUpdate, new_id: NewId) -> ps.PalaceDoc:
    if body.rooms is not None:
        doc = set_rooms(doc, body.rooms, new_id)
    changes: dict[str, Any] = {}
    if body.name is not None:
        changes["name"] = body.name
    if "source" in body.model_fields_set:
        changes["source"] = body.source
    return _rebuild(doc, **changes) if changes else doc


def add_items(
    doc: ps.PalaceDoc, items: list[ps.ItemNew], auto_place: bool, new_id: NewId
) -> ps.PalaceDoc:
    """Adds items to the tray, or with ``auto_place`` onto the free spots in walk order (one item
    per spot; what doesn't fit stays in the tray for the student to place or add a room for)."""
    current = doc.model_dump()["items"]
    if len(current) + len(items) > ps.MAX_ITEMS:
        raise DomainError("too_many_items", f"A palace holds at most {ps.MAX_ITEMS} items", 422)
    known = {i["item_id"] for i in current}
    if any(i.item_id in known for i in items if i.item_id is not None):
        raise DomainError("item_exists", "An item with this id is already in the palace", 409)
    taken = {i["locus_id"] for i in current if i["locus_id"] is not None}
    free = [lo.locus_id for lo in walk(doc) if lo.locus_id not in taken] if auto_place else []
    added = []
    for n, item in enumerate(items):
        added.append(
            {
                "item_id": item.item_id or new_id(),
                "item_ref": item.item_ref,
                "label": item.label,
                "note": None,
                "locus_id": free[n] if n < len(free) else None,
            }
        )
    return _rebuild(doc, items=current + added)


def _find_item(items: list[dict[str, Any]], item_id: uuid.UUID) -> dict[str, Any]:
    for i in items:
        if i["item_id"] == item_id:
            return i
    raise DomainError("item_not_found", "No such item in this palace", 404)


def place(doc: ps.PalaceDoc, item_id: uuid.UUID, room_id: uuid.UUID, spot: int) -> ps.PalaceDoc:
    """Puts an item on a spot. An item already there swaps to where this one was (or the tray)."""
    room = next((r for r in doc.rooms if r.room_id == room_id), None)
    if room is None:
        raise DomainError("room_not_found", "No such room in this palace", 404)
    locus = next((lo for lo in room.loci if lo.sort == spot), None)
    if locus is None:
        raise DomainError("spot_not_found", "No such spot in this room", 404)
    items = doc.model_dump()["items"]
    item = _find_item(items, item_id)
    before = item["locus_id"]
    for other in items:
        if other is not item and other["locus_id"] == locus.locus_id:
            other["locus_id"] = before
    item["locus_id"] = locus.locus_id
    return _rebuild(doc, items=items)


def unplace(doc: ps.PalaceDoc, item_id: uuid.UUID) -> ps.PalaceDoc:
    items = doc.model_dump()["items"]
    _find_item(items, item_id)["locus_id"] = None
    return _rebuild(doc, items=items)


def patch_item(doc: ps.PalaceDoc, item_id: uuid.UUID, patch: ps.ItemPatch) -> ps.PalaceDoc:
    """Changes an item's label or link note (MEM-16); null or an empty note clears it."""
    items = doc.model_dump()["items"]
    item = _find_item(items, item_id)
    if "label" in patch.model_fields_set:
        item["label"] = patch.label
    if "note" in patch.model_fields_set:
        item["note"] = patch.note or None
    return _rebuild(doc, items=items)


def remove_item(doc: ps.PalaceDoc, item_id: uuid.UUID) -> ps.PalaceDoc:
    items = doc.model_dump()["items"]
    _find_item(items, item_id)
    return _rebuild(doc, items=[i for i in items if i["item_id"] != item_id])


def to_doc(palace: ps.PalaceOut) -> ps.PalaceDoc:
    return ps.PalaceDoc.model_validate(palace.model_dump())


# --- flows (REST) ---------------------------------------------------------------------------------


async def _profile_tz(db: Database, user_id: uuid.UUID) -> str:
    async with db.system_tx() as session:
        tz = (
            await session.execute(
                text("select timezone from app.profiles where user_id = :u"), {"u": user_id}
            )
        ).scalar_one_or_none()
    return str(tz or DEFAULT_TZ)


async def _send(
    db: Database,
    auth: AuthContext,
    client: ClientInfo,
    *,
    event_type: str,
    payload: dict[str, Any],
    scope: str,
    key: str | None,
    now: datetime,
) -> int:
    result = await apply_batch(
        db,
        user_id=auth.user_id,
        device_id=client.device_id,
        events=[
            s.SyncEventIn(
                event_id=game.event_id_for(auth.user_id, scope, key),
                type=event_type,
                occurred_at=now,
                tz=await _profile_tz(db, auth.user_id),
                payload=payload,
            )
        ],
        app_variant=client.app_variant,
        now=now,
    )
    if result.rejected:
        r = result.rejected[0]
        raise ApiError(_REJECT_STATUS.get(r.code, 422), r.code, r.detail or "Not valid")
    return result.state_version


async def _one(db: Database, auth: AuthContext, palace_id: uuid.UUID) -> ps.PalaceOut:
    async with db.system_tx() as session:
        found = await palace_store.load(session, auth.user_id, palace_id)
    if not found:
        raise ApiError(404, "palace_not_found", "No such palace")
    return found[0]


async def list_palaces(db: Database, auth: AuthContext) -> ps.PalaceList:
    async with db.system_tx() as session:
        palaces = await palace_store.load(session, auth.user_id)
        deleted = await palace_store.deleted_ids(session, auth.user_id)
    return ps.PalaceList(palaces=palaces, deleted=deleted)


async def get_palace(db: Database, auth: AuthContext, palace_id: uuid.UUID) -> ps.PalaceOut:
    return await _one(db, auth, palace_id)


async def create(
    db: Database, auth: AuthContext, client: ClientInfo, body: ps.PalaceCreate, key: str | None
) -> ps.PalaceOut:
    now = datetime.now(UTC)
    if body.palace_id is not None:
        async with db.system_tx() as session:
            taken = (
                await session.execute(
                    text("select 1 from learn.palaces where id = :p"), {"p": body.palace_id}
                )
            ).one_or_none()
        if taken is not None:
            raise ApiError(409, "palace_exists", "A palace with this id already exists")
    doc = create_doc(body, now, uuid.uuid4)
    await _send(
        db,
        auth,
        client,
        event_type="palace_saved",
        payload=doc.model_dump(mode="json"),
        scope=f"palace_create:{doc.palace_id}",
        key=key,
        now=now,
    )
    return await _one(db, auth, doc.palace_id)


Op = Callable[[ps.PalaceDoc], ps.PalaceDoc]


async def mutate(
    db: Database,
    auth: AuthContext,
    client: ClientInfo,
    palace_id: uuid.UUID,
    *,
    scope: str,
    key: str | None,
    op: Op,
) -> ps.PalaceOut:
    """Load, apply one operation, save. The new version is stamped just after the stored one
    when the device that wrote it runs ahead of the server's clock, so it still wins."""
    current = await _one(db, auth, palace_id)
    now = datetime.now(UTC)
    try:
        doc = op(to_doc(current))
    except DomainError as exc:
        raise exc.to_api() from exc
    stamp = max(now, current.updated_at + timedelta(milliseconds=1))
    await _send(
        db,
        auth,
        client,
        event_type="palace_saved",
        payload=doc.model_copy(update={"updated_at": stamp}).model_dump(mode="json"),
        scope=f"palace_{scope}:{palace_id}",
        key=key,
        now=now,
    )
    return await _one(db, auth, palace_id)


async def delete(
    db: Database, auth: AuthContext, client: ClientInfo, palace_id: uuid.UUID, key: str | None
) -> ps.PalaceDeletedOut:
    await _one(db, auth, palace_id)
    version = await _send(
        db,
        auth,
        client,
        event_type="palace_deleted",
        payload={"palace_id": str(palace_id)},
        scope=f"palace_delete:{palace_id}",
        key=key,
        now=datetime.now(UTC),
    )
    return ps.PalaceDeletedOut(palace_id=palace_id, state_version=version)
