# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta

type ExamProfile = Annotated[str, Field(pattern="^[a-z0-9_-]+$")]


type PalaceTemplateId = Annotated[
    str,
    Field(
        description="pt. then a slug. Never changes once published: palaces keep it as template_id.",
        max_length=120,
        pattern="^pt\\.[a-z0-9]+(?:-[a-z0-9]+)*$",
    ),
]


class Pos(BaseModel):
    """
    {x, y} fractions of the picture for an image room, {yaw, pitch} degrees for a pano room.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    x: Annotated[float, Field(ge=0.0, le=1.0)]
    y: Annotated[float, Field(ge=0.0, le=1.0)]


class Pos1(BaseModel):
    """
    {x, y} fractions of the picture for an image room, {yaw, pitch} degrees for a pano room.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    yaw: Annotated[float, Field(ge=-180.0, le=180.0)]
    pitch: Annotated[float, Field(ge=-90.0, le=90.0)]


class PalaceTemplateSpot(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    order: Annotated[
        int,
        Field(description="Walk order in the room, 0-based and gapless.", ge=0, le=9),
    ]
    pos: Annotated[
        Pos | Pos1,
        Field(
            description="{x, y} fractions of the picture for an image room, {yaw, pitch} degrees for a pano room."
        ),
    ]
    label: Annotated[
        common_schema.I18nText | None,
        Field(
            description="What the spot is in the picture (the door, the clock), read by screen readers and shown in the walk. No text is ever drawn into the image."
        ),
    ] = None


class PalaceTemplateRoom1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    name: common_schema.I18nText
    image: Annotated[
        common_schema.ImageRef,
        Field(
            description="An image request with preset sunny-scene. Its alt text is the room's description for screen readers."
        ),
    ]
    pano: Annotated[
        common_schema.PanoRef | None,
        Field(description="A pano360 request (pano-360 preset), for kind pano360."),
    ] = None
    spots: Annotated[list[PalaceTemplateSpot], Field(max_length=10, min_length=5)]


class PalaceTemplateRoom2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    name: common_schema.I18nText
    image: Annotated[
        common_schema.ImageRef | None,
        Field(
            description="An image request with preset sunny-scene. Its alt text is the room's description for screen readers."
        ),
    ] = None
    pano: Annotated[
        common_schema.PanoRef,
        Field(description="A pano360 request (pano-360 preset), for kind pano360."),
    ]
    spots: Annotated[list[PalaceTemplateSpot], Field(max_length=10, min_length=5)]


type PalaceTemplateRoom = PalaceTemplateRoom1 | PalaceTemplateRoom2


class PalaceTemplateFile(FileMeta):
    """
    content/palace-templates/{slug}.json: a memory palace template (memory-labs flow §5.6, gap G3). Rooms in walk order, each an Agnes sunny-scene image (or a pano-360 scene for kind pano360) with 5 to 10 spots in walk order. The app copies the rooms and spots into a new palace (palace_saved, sync v1.5); the room id travels as template_room.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["palace_template@1"], Field(alias="schema")
    ]
    id: PalaceTemplateId
    kind: Annotated[
        Literal["home", "school", "monument", "pano360"],
        Field(
            description="The MEM-13 tile it appears under. Mix your own rooms (custom) strings rooms of these templates together, so it has no template of its own."
        ),
    ]
    name: common_schema.I18nText
    description: common_schema.I18nText | None = None
    exam_profiles: Annotated[
        list[ExamProfile] | None,
        Field(
            description="Exam profiles this template is offered in (memory-labs matrix 'Templates per exam'). Missing or empty: every profile."
        ),
    ] = None
    rooms: Annotated[list[PalaceTemplateRoom], Field(max_length=20, min_length=1)]
