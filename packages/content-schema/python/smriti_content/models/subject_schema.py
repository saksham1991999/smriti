# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta


class Unit(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.DottedId
    name: common_schema.I18nText


class SubjectFile(FileMeta):
    """
    content/graph/{subject_id}/subject.json: the subject, its units and the ordered chapter list. Projects to content.subjects and content.units; the chapter order gives content.chapters.sort.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["subject@1"], Field(alias="schema")
    ]
    id: common_schema.Slug
    name: common_schema.I18nText
    color_family: common_schema.SubjectFamily
    sort: Annotated[int, Field(ge=0)]
    units: Annotated[list[Unit], Field(min_length=1)]
    chapters: Annotated[
        list[common_schema.DottedId],
        Field(
            description="Chapter ids in teaching order (NCERT order where it exists). Each has a graph/{subject}/{chapter_slug}.json file.",
            min_length=1,
        ),
    ]
