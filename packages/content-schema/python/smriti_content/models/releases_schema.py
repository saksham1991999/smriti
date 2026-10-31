# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta


class ReleaseScope(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    subjects: Annotated[
        list[common_schema.Slug],
        Field(
            description="Whole subjects released: every chapter of the subject the exam map includes."
        ),
    ]
    chapters: Annotated[
        list[common_schema.DottedId],
        Field(
            description="Single chapters released, for subjects that are not released whole."
        ),
    ]


class ReleasesFile(FileMeta):
    """
    content/releases.json: the release gate. Per exam profile, the subjects and chapters released to production. A production publish builds only these and needs every media item in them approved; everything else is skipped and listed in the publish report. The content check fails when a released subject or chapter is below 100% coverage (PRD 14). Staging and local builds publish everything.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["releases@1"], Field(alias="schema")
    ]
    profiles: Annotated[
        dict[common_schema.ExamProfileId, ReleaseScope],
        Field(
            description="Exam profile id -> what is released for it. A profile that is not listed has nothing released."
        ),
    ]
