# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta

type ConceptKind = Literal[
    "fact",
    "definition",
    "formula",
    "derivation",
    "process",
    "skill",
    "date",
    "list",
    "diagram",
]


class Concept(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.ConceptId
    name: common_schema.I18nText
    kind: ConceptKind
    intrinsic_depth: common_schema.Depth
    summary: common_schema.I18nText
    key_points: Annotated[
        list[common_schema.I18nText],
        Field(
            description="What a complete explanation must contain; the Feynman tutor grades against them.",
            min_length=1,
        ),
    ]
    prerequisites: Annotated[
        list[common_schema.ConceptId],
        Field(
            description="Concept ids this concept builds on. Edge kind prerequisite, from this concept to each prerequisite. Must form no cycle."
        ),
    ]
    related: list[common_schema.ConceptId] | None = None
    contrasts: Annotated[
        list[common_schema.ConceptId] | None,
        Field(description="Confusable concepts (edge kind contrast)."),
    ] = None
    applies_in: Annotated[
        list[common_schema.ConceptId] | None,
        Field(description="Concepts where this one is applied (edge kind applies_in)."),
    ] = None
    aliases: Annotated[
        list[common_schema.ConceptId] | None,
        Field(
            description="Old ids kept after a concept was split or renamed. Never reused."
        ),
    ] = None
    syllabus_refs: list[common_schema.SyllabusRef]


class Subtopic(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.DottedId
    name: common_schema.I18nText
    concepts: Annotated[list[Concept], Field(min_length=1)]


class Topic(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.TopicId
    name: common_schema.I18nText
    summary: common_schema.I18nText | None = None
    subtopics: Annotated[list[Subtopic], Field(min_length=1)]


class ChapterFile(FileMeta):
    """
    content/graph/{subject_id}/{chapter_slug}.json: chapter -> topics -> subtopics -> concepts (written by syllabus-mapper). Projects to content.chapters, topics, subtopics, concepts and concept_edges.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["chapter@1"], Field(alias="schema")
    ]
    id: common_schema.DottedId
    subject: common_schema.Slug
    unit: common_schema.DottedId
    name: common_schema.I18nText
    ncert_ref: str | None = None
    topics: Annotated[list[Topic], Field(min_length=1)]
