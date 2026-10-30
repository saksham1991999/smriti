# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta

type MediaKind = Literal[
    "image",
    "diagram",
    "comic",
    "pano360",
    "animation_rive",
    "animation_lottie",
    "model3d",
    "sim",
    "audio_tts",
    "audio_song",
]


type Preset = Annotated[
    Literal[
        "sunny-object",
        "sunny-scene",
        "sunny-diagram",
        "pet-cat",
        "pet-dog",
        "plant-stage",
        "storybook",
        "roleplay-portrait",
        "memory-hook",
        "pano-360",
        "badge",
        "league-tier",
        "empty-state",
    ],
    Field(description="DESIGN.md 6.2 illustration presets (image kinds only)."),
]


class MediaResult(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    sha256: Annotated[str, Field(pattern="^[0-9a-f]{64}$")]
    asset_id: str | None = None
    reused: bool
    mime: str | None = None
    bytes: Annotated[int | None, Field(ge=1)] = None
    width: Annotated[int | None, Field(ge=1)] = None
    height: Annotated[int | None, Field(ge=1)] = None
    duration_ms: Annotated[int | None, Field(ge=1)] = None
    sim_id: Annotated[
        str | None, Field(description="kind sim: the sims/{sim_id} bundle.")
    ] = None
    sim_version: str | None = None
    source_path: Annotated[
        str | None,
        Field(
            description="Fixture files only: a repo path under design/mocks/assets/ the publisher copies for local output.",
            pattern="^design/mocks/assets/[A-Za-z0-9._-]+$",
        ),
    ] = None
    licence: str | None = None
    attribution: str | None = None


class MediaRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.MediaRef
    kind: MediaKind
    preset: Preset | None = None
    subject_family: common_schema.SubjectFamily | None = None
    brief: Annotated[str, Field(min_length=1)]
    must_show: list[str] | None = None
    must_not_show: list[str] | None = None
    label_anchors: list[common_schema.LabelAnchor] | None = None
    alt: common_schema.I18nText | None = None
    decorative: bool | None = None
    transcript: common_schema.I18nText | None = None
    locale: common_schema.Locale | None = None
    used_by: Annotated[
        list[str],
        Field(description="Card, question or mnemonic ids that use this request."),
    ]
    status: Literal["requested", "generated", "approved", "rejected"]
    rejected_reason: str | None = None
    result: MediaResult | None


class MediaRequestsFile(FileMeta):
    """
    content/media/requests/{subject_id}/{chapter_slug}.json: every media item the content needs. Content files point to request ids; the media skills fulfil them (image presets go to Agnes through visual-director).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["media-requests@1"], Field(alias="schema")
    ]
    requests: Annotated[list[MediaRequest], Field(min_length=1)]
