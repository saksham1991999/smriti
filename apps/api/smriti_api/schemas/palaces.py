"""Memory palaces (memory-labs flow §5.6, MEM-12 to MEM-18; sync contract v1.5).

A palace is one document: rooms in walk order, each with its spots (loci) in walk order, and the
items the student is memorising, each on a spot or still in the tray. The same document is the
``palace_saved`` sync payload (written offline) and the body of every REST answer, so the device
and the server hold one shape. Names, labels and notes are the student's own words: they stay on
the account and are never logged or sent to analytics.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

Template = Literal["home", "school", "monument", "pano360", "custom"]
Source = Literal["list", "topic", "deck", "mnemonics"]
"""What the items came from (MEM-15): a list or date concept, a topic, a deck or my mnemonics."""

MAX_ROOMS = 20
MAX_SPOTS_PER_ROOM = 20
MAX_ITEMS = 200
DEFAULT_SPOTS = 5

Name = Annotated[str, Field(min_length=1, max_length=80)]
Label = Annotated[str, Field(min_length=1, max_length=200)]
Note = Annotated[str, Field(max_length=300)]
Slug = Annotated[str, Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=80)]
TemplateId = Annotated[str, Field(pattern=r"^pt\.[a-z0-9]+(-[a-z0-9]+)*$", max_length=120)]
ItemRef = Annotated[
    str,
    Field(
        pattern=r"^[A-Za-z0-9_.:#-]{1,240}$",
        description="What the item is: kp:<concept>#<n> (a key point), card:<id> or a card_ref "
        "(c:, d:, q:), m:<mnemonic_id> or a concept id. Never free text.",
    ),
]
Spot = Annotated[int, Field(ge=0, lt=MAX_SPOTS_PER_ROOM)]


class _Model(BaseModel):
    # The document is also a sync payload: like every payload, unknown fields from a newer app
    # are ignored rather than rejected (sync contract §2).
    model_config = ConfigDict(extra="ignore")


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PosXY(_Model):
    """A spot on a picture room, as fractions of its width and height."""

    x: Annotated[float, Field(ge=0, le=1)]
    y: Annotated[float, Field(ge=0, le=1)]


class PosYawPitch(_Model):
    """A spot in a 360° room, in degrees."""

    yaw: Annotated[float, Field(ge=-180, le=180)]
    pitch: Annotated[float, Field(ge=-90, le=90)]


Pos = PosXY | PosYawPitch


class Locus(_Model):
    locus_id: uuid.UUID
    sort: Spot
    pos: Pos


class Room(_Model):
    room_id: uuid.UUID
    name: Name
    sort: Annotated[int, Field(ge=0, lt=MAX_ROOMS)]
    template_room: Slug | None = None
    loci: Annotated[list[Locus], Field(min_length=1, max_length=MAX_SPOTS_PER_ROOM)]


class Item(_Model):
    item_id: uuid.UUID
    item_ref: ItemRef
    label: Label | None = None
    note: Note | None = None
    locus_id: uuid.UUID | None = None


class PalaceDoc(_Model):
    """One palace, whole. The ``palace_saved`` payload and the REST answer share it."""

    palace_id: uuid.UUID
    name: Name
    template: Template
    template_id: TemplateId | None = None
    source: Source | None = None
    rooms: Annotated[list[Room], Field(min_length=1, max_length=MAX_ROOMS)]
    items: Annotated[list[Item], Field(max_length=MAX_ITEMS)] = Field(default_factory=list)
    updated_at: AwareDatetime = Field(
        description="When the device last changed it. The server keeps the newest version."
    )

    @model_validator(mode="after")
    def _consistent(self) -> PalaceDoc:
        rooms = [r.room_id for r in self.rooms]
        if len(set(rooms)) != len(rooms):
            raise ValueError("room ids repeat")
        if len({r.sort for r in self.rooms}) != len(rooms):
            raise ValueError("room sort values repeat")
        loci: set[uuid.UUID] = set()
        for r in self.rooms:
            if len({lo.sort for lo in r.loci}) != len(r.loci):
                raise ValueError("spot sort values repeat in a room")
            for lo in r.loci:
                if lo.locus_id in loci:
                    raise ValueError("spot ids repeat")
                loci.add(lo.locus_id)
        items = [i.item_id for i in self.items]
        if len(set(items)) != len(items):
            raise ValueError("item ids repeat")
        placed = [i.locus_id for i in self.items if i.locus_id is not None]
        if any(lo not in loci for lo in placed):
            raise ValueError("an item sits on a spot that isn't in this palace")
        if len(set(placed)) != len(placed):
            raise ValueError("two items sit on one spot")
        return self


class PalaceItemOut(Item):
    card_ref: str = Field(description="The item's FSRS card: p:<item_id>")
    due_at: datetime | None = Field(description="Null until the item is first quizzed")


class PalaceOut(PalaceDoc):
    items: list[PalaceItemOut] = Field(default_factory=list)  # type: ignore[assignment]
    created_at: datetime
    next_walk_at: datetime | None = Field(
        description="The earliest due item (MEM-12 'next walk'); null before the first quiz"
    )


class PalaceList(BaseModel):
    palaces: list[PalaceOut] = Field(description="Newest change first")
    deleted: list[uuid.UUID] = Field(
        description="Palaces deleted on any device: drop them unless the device has unsent edits"
    )


class PalaceDeletedOut(BaseModel):
    palace_id: uuid.UUID
    state_version: int = Field(description="Pull /v1/sync/state for the removed cards' tombstones")


class PalaceDeleted(_Model):
    """The ``palace_deleted`` sync payload."""

    palace_id: uuid.UUID


# --- REST bodies ---------------------------------------------------------------------------------


class LocusIn(_Body):
    locus_id: uuid.UUID | None = None
    pos: Pos


class RoomIn(_Body):
    """A room to create or keep. Spots come from the template the client loaded (their order is
    the walk order); with none, the room gets the default zig-zag of five spots."""

    room_id: uuid.UUID | None = None
    name: Name
    template_room: Slug | None = None
    loci: Annotated[list[LocusIn], Field(max_length=MAX_SPOTS_PER_ROOM)] = Field(
        default_factory=list
    )


class PalaceCreate(_Body):
    palace_id: uuid.UUID | None = Field(default=None, description="Client UUIDv7, when it has one")
    name: Name
    template: Template
    template_id: TemplateId | None = None
    source: Source | None = None
    rooms: Annotated[list[RoomIn], Field(max_length=MAX_ROOMS)] = Field(
        default_factory=list,
        description="The template's rooms in walk order; empty makes one room named after the palace",
    )


class PalaceUpdate(_Body):
    """Rename, and add, rename, reorder or remove rooms (the list is the whole new walk). Items on
    a removed room's spots go back to the tray."""

    name: Name | None = None
    source: Source | None = None
    rooms: Annotated[list[RoomIn], Field(min_length=1, max_length=MAX_ROOMS)] | None = None


class ItemNew(_Body):
    item_id: uuid.UUID | None = None
    item_ref: ItemRef
    label: Label | None = None


class ItemsAdd(_Body):
    items: Annotated[list[ItemNew], Field(min_length=1, max_length=MAX_ITEMS)]
    auto_place: bool = Field(
        default=False, description="Put the new items on the free spots in walk order"
    )


class PlaceIn(_Body):
    room_id: uuid.UUID
    spot: Spot = Field(description="The spot's walk order in the room (its sort)")


class ItemPatch(_Body):
    label: Label | None = None
    note: Note | None = None
