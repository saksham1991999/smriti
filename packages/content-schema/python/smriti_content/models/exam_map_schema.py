# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta


class StatsBasis(BaseModel):
    """
    Set by pyq-ingest: the papers weightage and pyq_count were computed from.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    papers: Annotated[list[str], Field(min_length=1)]
    computed_at: common_schema.IsoDate
    method: str | None = None


class Concept(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.ConceptId
    depth: common_schema.Depth
    priority: Annotated[
        Literal["core", "high_yield", "optional"],
        Field(
            description="core by default, optional only when the syllabus marks it so, high_yield only when computed from real PYQ data."
        ),
    ]
    weightage: Annotated[
        float | None,
        Field(
            description="Share of marks over stats_basis.papers. null until pyq-ingest computes it. Never estimated.",
            ge=0.0,
            le=100.0,
        ),
    ]
    pyq_count: Annotated[int | None, Field(ge=0)]


class ExamMapFile(FileMeta):
    """
    content/exam-maps/{exam_profile_id}.json: which concepts an exam profile includes, to what depth, with priority and computed PYQ stats. Projects to content.exam_concepts.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["exam-map@1"], Field(alias="schema")
    ]
    exam_profile: common_schema.ExamProfileId
    released_subjects: Annotated[
        list[common_schema.Slug] | None,
        Field(
            description="Subjects marked for release. The content check fails when one of them is below 100% coverage, and the publisher ships only these to a non-local target."
        ),
    ] = None
    stats_basis: Annotated[
        StatsBasis | None,
        Field(
            description="Set by pyq-ingest: the papers weightage and pyq_count were computed from."
        ),
    ] = None
    concepts: Annotated[list[Concept], Field(min_length=1)]
