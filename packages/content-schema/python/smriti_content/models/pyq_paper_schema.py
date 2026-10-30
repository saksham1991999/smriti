# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AnyUrl, BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta


class Blueprint(BaseModel):
    """
    The blueprint version in force on held_on.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    exam_profile: common_schema.ExamProfileId
    paper_code: common_schema.Slug
    version: Annotated[int, Field(ge=1)]


class Source(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["official"]
    url: AnyUrl
    answer_key_url: AnyUrl | None = None
    retrieved: common_schema.IsoDate


class Item(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    number: Annotated[int, Field(ge=1)]
    question: common_schema.QuestionId
    section: str | None = None
    official_answer: Annotated[
        str,
        Field(
            description="The official final key as published (option ids, a number, or a note)."
        ),
    ]
    answer_challenged: bool
    dropped: bool | None = None


class PyqPaperFile(FileMeta):
    """
    content/pyq/{exam_id}/{paper_id}.json: one previous-year paper from its official source (pyq-ingest). Projects to content.pyq_papers and content.pyq_questions. The questions themselves live in questions/ with source pyq.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["pyq-paper@1"], Field(alias="schema")
    ]
    id: common_schema.Slug
    exam: common_schema.ExamId
    year: Annotated[int, Field(ge=1950, le=2100)]
    session_label: str | None = None
    held_on: common_schema.IsoDate | None = None
    paper_code: Annotated[
        common_schema.Slug | None,
        Field(description="Matches the blueprint paper_code in force on held_on."),
    ] = None
    blueprint: Annotated[
        Blueprint | None,
        Field(description="The blueprint version in force on held_on."),
    ] = None
    source: Source
    rights_note: Annotated[str, Field(min_length=1)]
    items: Annotated[list[Item], Field(min_length=1)]
