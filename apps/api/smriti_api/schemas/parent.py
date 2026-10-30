"""Request and response models for parent mode (me-money §4.7 SET-13 to SET-19, Phase 3).

Everything a parent sees about a child is a count, a score or a topic name from the child's
own synced data. Nothing the child typed (tutor chats, notes, cards) is ever in these models.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from smriti_api.schemas.social import Person

# SET-16: Off (null), 15, 30, 45, 60, 90 or 120 minutes a day.
DailyLimit = Literal[15, 30, 45, 60, 90, 120]
TimeRequestStatus = Literal["pending", "allowed", "declined", "expired"]


class PetOut(BaseModel):
    name: str
    species: str
    state: str


class TimeRequestOut(BaseModel):
    id: uuid.UUID
    learner_user_id: uuid.UUID
    minutes: int
    status: TimeRequestStatus
    for_date: date
    created_at: datetime
    decided_at: datetime | None = None


class LastMock(BaseModel):
    attempt_id: uuid.UUID
    mock_id: str | None
    title: dict[str, str] | None = None
    score: float | None
    max_score: float | None
    submitted_at: datetime | None


class ChildCard(BaseModel):
    """SET-14: pet, name, this week's minutes, streak, the practice line and "Needs you"."""

    user_id: uuid.UUID
    first_name: str | None
    age_band: str | None
    kind: Literal["managed", "consent"]
    pet: PetOut | None = None
    week_minutes: int
    streak: int
    practice_questions: int
    last_mock: LastMock | None = None
    is_pro: bool = False
    # "Needs you": an open time request for today, or a consent request waiting for the parent.
    needs_you: bool
    time_requests: list[TimeRequestOut] = Field(default_factory=list)
    consent_pending: bool = False


class Dashboard(BaseModel):
    learners: list[ChildCard]


class DayMinutes(BaseModel):
    day: date
    minutes: int


class SubjectWeek(BaseModel):
    subject_id: str
    name: dict[str, str]
    color_token: str
    topics: list[dict[str, str]]


class MockScore(BaseModel):
    attempt_id: uuid.UUID
    mock_id: str | None
    title: dict[str, str] | None = None
    score: float | None
    max_score: float | None
    percentile: float | None
    submitted_at: datetime | None


class ComingUp(BaseModel):
    kind: Literal["mock"]
    mock_id: str
    title: dict[str, str]
    starts_at: datetime


class WeekReport(BaseModel):
    """SET-15. Counts and topic names only (never chat text, notes or anything typed)."""

    user_id: uuid.UUID
    first_name: str | None
    week_start: date
    week_end: date
    days: list[DayMinutes]
    minutes: int
    lessons: int
    reviews: int
    practice_questions: int
    streak: int
    subjects: list[SubjectWeek]
    mocks: list[MockScore]
    coming_up: list[ComingUp]


class Controls(BaseModel):
    """SET-14 and SET-16 for one child. ``weekly_report`` is the calling guardian's own switch."""

    daily_limit_min: DailyLimit | None = None
    allowed_from: time | None = None
    allowed_to: time | None = None
    break_reminders: bool = False
    ask_before_switching: bool = False
    # Little learners (u10): the preset-question tutor button, off until the parent turns it on.
    tutor_button: bool = False
    picture_rhymes: bool = False
    # Older children: the parent can turn the AI tutor or social features off.
    tutor_enabled: bool = True
    social_enabled: bool = True
    weekly_report: bool = True

    @model_validator(mode="after")
    def _hours(self) -> Controls:
        if (self.allowed_from is None) != (self.allowed_to is None):
            raise ValueError("allowed_from and allowed_to go together")
        if self.allowed_from is not None and self.allowed_from == self.allowed_to:
            raise ValueError("allowed hours need a start and a different end")
        return self


class ControlsOut(Controls):
    learner_user_id: uuid.UUID
    updated_at: datetime | None = None


class MyLimits(BaseModel):
    """What the child's device caches to enforce SET-16 offline and to show SET-19."""

    controlled: bool
    daily_limit_min: DailyLimit | None = None
    allowed_from: time | None = None
    allowed_to: time | None = None
    break_reminders: bool = False
    ask_before_switching: bool = False
    tutor_button: bool = False
    picture_rhymes: bool = False
    tutor_enabled: bool = True
    social_enabled: bool = True
    today: date
    minutes_today: int = 0
    extra_minutes: int = 0
    # Limit plus today's approved extra minutes; null when there is no daily limit.
    limit_today: int | None = None
    remaining_minutes: int | None = None
    within_hours: bool = True
    request: TimeRequestOut | None = None


class Decision(BaseModel):
    allow: bool


class ParentFriend(BaseModel):
    """A friend as the child sees them (B13: the parent sees and can remove friends)."""

    person: Person
    since: datetime | None
