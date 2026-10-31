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


type Title = Annotated[
    str,
    Field(
        description="A plain string (the source language) or localised text.",
        min_length=1,
    ),
]


class Item(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    kind: (
        Literal[
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
        | None
    ) = None
    title: Annotated[
        Title | common_schema.I18nText,
        Field(description="A plain string (the source language) or localised text."),
    ]
    source_ref: Annotated[str, Field(min_length=1)]
    concepts: list[common_schema.ConceptId]
    out_of_syllabus: Annotated[
        str | None,
        Field(
            description="Why the item maps to no concept. Either concepts or this must be set."
        ),
    ] = None


type Title1 = Annotated[str, Field(min_length=1)]


class ExcludedChapter(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ref: Annotated[
        str,
        Field(
            description="The reference chapter, for example ncert:kemh1:5.",
            min_length=1,
        ),
    ]
    title: Title1 | common_schema.I18nText
    reason: Annotated[str, Field(min_length=1)]
    source_ref: Annotated[str, Field(min_length=1)]
    exam_profiles: Annotated[
        list[common_schema.ExamProfileId] | None,
        Field(description="The profiles the reason applies to."),
    ] = None


type Title2 = Annotated[
    str,
    Field(
        description="A plain string (the source language) or localised text.",
        min_length=1,
    ),
]


class Item1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    kind: (
        Literal[
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
        | None
    ) = None
    title: Annotated[
        Title2 | common_schema.I18nText,
        Field(description="A plain string (the source language) or localised text."),
    ]
    source_ref: Annotated[str, Field(min_length=1)]
    concepts: list[common_schema.ConceptId]
    out_of_syllabus: Annotated[
        str | None,
        Field(
            description="Why the item maps to no concept. Either concepts or this must be set."
        ),
    ] = None


type Title3 = Annotated[str, Field(min_length=1)]


class ExcludedChapter1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ref: Annotated[
        str,
        Field(
            description="The reference chapter, for example ncert:kemh1:5.",
            min_length=1,
        ),
    ]
    title: Title3 | common_schema.I18nText
    reason: Annotated[str, Field(min_length=1)]
    source_ref: Annotated[str, Field(min_length=1)]
    exam_profiles: Annotated[
        list[common_schema.ExamProfileId] | None,
        Field(description="The profiles the reason applies to."),
    ] = None


class Syllabus(FileMeta):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["syllabus@1"], Field(alias="schema")
    ]
    exam_profile: common_schema.ExamProfileId
    lines: Annotated[list[Line], Field(min_length=1)]


class Inventory1(FileMeta):
    """
    A chapter inventory (chapter + items) or a subject's list of reference chapters with no graph chapter (subject + excluded_chapters, at coverage/inventory/{subject}/excluded-chapters.json).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["inventory@1"], Field(alias="schema")
    ]
    chapter: common_schema.DottedId
    items: Annotated[list[Item], Field(min_length=1)]
    subject: common_schema.Slug | None = None
    excluded_chapters: Annotated[
        list[ExcludedChapter] | None,
        Field(
            description="Whole reference chapters with no graph chapter, each with the reason."
        ),
    ] = None


class Inventory2(FileMeta):
    """
    A chapter inventory (chapter + items) or a subject's list of reference chapters with no graph chapter (subject + excluded_chapters, at coverage/inventory/{subject}/excluded-chapters.json).
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["inventory@1"], Field(alias="schema")
    ]
    chapter: common_schema.DottedId | None = None
    items: Annotated[list[Item1] | None, Field(min_length=1)] = None
    subject: common_schema.Slug
    excluded_chapters: Annotated[
        list[ExcludedChapter1],
        Field(
            description="Whole reference chapters with no graph chapter, each with the reason."
        ),
    ]


type Inventory = Annotated[
    Inventory1 | Inventory2,
    Field(
        description="A chapter inventory (chapter + items) or a subject's list of reference chapters with no graph chapter (subject + excluded_chapters, at coverage/inventory/{subject}/excluded-chapters.json)."
    ),
]


type CoverageInputFile = Annotated[
    Syllabus | Inventory,
    Field(
        description="Inputs to the coverage report, written by syllabus-mapper. coverage/syllabus/{exam_profile_id}.json lists every official syllabus line with its concepts; coverage/inventory/{subject}/{chapter_slug}.json lists every item of the chapter's reference sources with its concept or exclusion reason.",
        discriminator="schema_",
        title="CoverageInputFile",
    ),
]
