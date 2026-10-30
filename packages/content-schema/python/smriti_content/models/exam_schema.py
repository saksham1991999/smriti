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
        "correction_window",
        "admit_card",
        "city_intimation",
        "re_exam",
    ]
    date: common_schema.IsoDate
    source_url: AnyUrl
    end_date: Annotated[
        common_schema.IsoDate | None,
        Field(description="Last day, for a window (application, correction, exam)."),
    ] = None
    session: Annotated[
        common_schema.Slug | None,
        Field(
            description="The session this date belongs to, when the cycle has several."
        ),
    ] = None


type ExamLanguage = Annotated[str, Field(pattern="^[a-z]{2,3}$")]


class Time(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    start: Annotated[str, Field(pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$")]
    end: Annotated[str, Field(pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$")]
    duration_min: Annotated[
        int | None,
        Field(
            description="The paper length these times are for, when they differ by paper.",
            ge=1,
        ),
    ] = None


class Shift(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    tz: Annotated[str, Field(min_length=1)]
    papers: Annotated[
        list[common_schema.Slug] | None,
        Field(description="Paper codes held in this shift; absent for all."),
    ] = None
    times: Annotated[list[Time], Field(min_length=1)]
    source_ref: Annotated[str | None, Field(min_length=1)] = None


class DateWindow(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    from_: Annotated[common_schema.IsoDate, Field(alias="from")]
    to: common_schema.IsoDate


class Session(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: common_schema.Slug
    label: common_schema.I18nText
    application_window: DateWindow | None = None
    late_fee_window: DateWindow | None = None
    correction_window: DateWindow | None = None
    city_intimation: common_schema.IsoDate | None = None
    admit_card: common_schema.IsoDate | None = None
    exam_dates: list[common_schema.IsoDate] | None = None
    source_ref: Annotated[str, Field(min_length=1)]


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
    paper_names: Annotated[
        dict[common_schema.Slug, common_schema.I18nText] | None,
        Field(description="Official paper names by paper code."),
    ] = None
    exam_languages: Annotated[
        list[ExamLanguage] | None,
        Field(
            description="Languages the exam is offered in (ISO 639 codes), which can be more than the app's locales."
        ),
    ] = None
    sessions: Annotated[
        list[Session] | None, Field(description="Sessions of the cycle, as notified.")
    ] = None
    shifts: Annotated[
        list[Shift] | None,
        Field(
            description="Shift times as notified. null: not stated (they often appear only on the admit card)."
        ),
    ] = None


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
