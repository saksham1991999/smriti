# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from typing_extensions import TypeAliasType

from . import bundle_schema, common_schema


class Exam(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    name: str
    profile_name: str
    cycle: str
    category: str
    conducting_body: str | None = None


class Chapter(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    name: str
    sort: int
    unit: str
    free_deep_dive: Annotated[
        bool,
        Field(
            description="The first 2 chapters of every subject (PRD 11.1). Rotating free chapters come from the flag free.rotating_chapters, added by the API."
        ),
    ]
    topics: list[str]


class Subject(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    name: str
    color_family: str
    sort: int
    chapters: list[Chapter]


class Blueprint(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    paper_code: str
    version: int
    effective_from: str


class Free(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    deep_dive_chapters: list[str]


DepthAdditionalProperty = TypeAliasType(
    "DepthAdditionalProperty", Annotated[int, Field(ge=1, le=5)]
)


class Patch(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    from_hash: Annotated[str, Field(pattern="^[0-9a-f]{64}$")]
    path: str
    size_bytes: Annotated[int, Field(ge=1)]


class BundleEntry(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    hash: Annotated[str, Field(pattern="^[0-9a-f]{64}$")]
    path: str
    size_bytes: Annotated[int, Field(ge=1)]
    card_count: Annotated[int, Field(ge=0)]
    min_app_version: str
    is_free: bool
    patches: list[Patch]


class TopicEntry(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    chapter: str
    sort: int
    depth: Annotated[
        dict[str, DepthAdditionalProperty],
        Field(description="concept id -> the deepest level this exam needs"),
    ]
    bundles: dict[bundle_schema.BundleMode, BundleEntry]


class Manifest(BaseModel):
    """
    A published manifest: one exam profile x locale. Lists every subject, chapter and topic with its bundle hashes, sizes and the available delta patches, plus the exam's concept depths so the player can hide cards above the exam's depth. Served at manifests/{profile}.{locale}.json (short TTL) and archived as manifests/{profile}.{locale}.{sha256}.json.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[Literal["manifest@1"], Field(alias="schema")]
    exam_profile: str
    locale: common_schema.Locale
    version: Annotated[int, Field(ge=1)]
    min_app_version: str
    fixture: bool | None = None
    exam: Exam
    subjects: list[Subject]
    topics: dict[str, TopicEntry]
    blueprints: list[Blueprint]
    free: Free
