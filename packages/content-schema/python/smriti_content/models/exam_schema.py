# Generated from packages/content-schema/schemas by scripts/gen-python.sh. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AnyUrl, BaseModel, ConfigDict, Field

from . import common_schema
from .common_schema import FileMeta


class ScheduleItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal[
        "application_open",
        "application_close",
        "exam_window_start",
        "exam_window_end",
        "exam_day",
        "result",
    ]
    date: common_schema.IsoDate
    source_url: AnyUrl


class ExamProfile(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.ExamProfileId
    cycle: Annotated[str, Field(min_length=1)]
    name: common_schema.I18nText | None = None
    locales: Annotated[
        list[common_schema.Locale],
        Field(
            description="Locales every content field used by this profile must have.",
            min_length=1,
        ),
    ]
    papers: Annotated[
        list[common_schema.Slug],
        Field(
            description="Paper codes; each has a blueprint in blueprints/{profile}/{paper}.v{n}.json."
        ),
    ]
    schedule: Annotated[
        list[ScheduleItem] | None,
        Field(
            description="Official dates for the cycle, each with its notification URL. null until announced."
        ),
    ] = None
    is_active: bool | None = None


class ExamFile(FileMeta):
    """
    content/exams/{exam_id}.json: an exam and its profiles (one per cycle). Projects to content.exams and content.exam_profiles.
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schema_: Annotated[
        Literal["exam@1"], Field(alias="schema")
    ]
    id: common_schema.ExamId
    name: common_schema.I18nText
    category: Literal[
        "engineering",
        "medical",
        "civil_services",
        "ssc",
        "banking",
        "railways",
        "defence",
        "state",
        "school",
    ]
    conducting_body: str | None = None
    official_url: AnyUrl | None = None
    is_active: bool | None = None
    profiles: Annotated[list[ExamProfile], Field(min_length=1)]
