# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta


class Line(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ref: common_schema.SyllabusRef
    text: common_schema.I18nText
    concepts: list[common_schema.ConceptId]


class Syllabus(FileMeta):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["syllabus@1"], Field(alias="schema")
    ]
    exam_profile: common_schema.ExamProfileId
    lines: Annotated[list[Line], Field(min_length=1)]


class Item(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    kind: Literal[
        "definition",
        "law",
        "formula",
        "constant",
        "named_reaction",
        "date",
        "list",
        "diagram",
        "solved_example",
        "exercise_type",
        "fact",
    ]
    title: Annotated[str, Field(min_length=1)]
    source_ref: Annotated[str, Field(min_length=1)]
    concepts: list[common_schema.ConceptId]
    out_of_syllabus: Annotated[
        str | None,
        Field(
            description="Why the item maps to no concept. Either concepts or this must be set."
        ),
    ] = None


class Inventory(FileMeta):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["inventory@1"], Field(alias="schema")
    ]
    chapter: common_schema.DottedId
    items: Annotated[list[Item], Field(min_length=1)]


type CoverageInputFile = Annotated[
    Syllabus | Inventory,
    Field(
        description="Inputs to the coverage report, written by syllabus-mapper. coverage/syllabus/{exam_profile_id}.json lists every official syllabus line with its concepts; coverage/inventory/{subject}/{chapter_slug}.json lists every item of the chapter's reference sources with its concept or exclusion reason.",
        discriminator="schema_",
        title="CoverageInputFile",
    ),
]
