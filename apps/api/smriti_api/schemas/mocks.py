"""Mock catalogue, attempts and reports (docs/flows/practice.md §6, §8, §12.2)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

from smriti_api.schemas.practice import AnswerIn, ConfidenceIn, Id

MockKind = Literal["full", "sectional", "chapter", "pyq_paper", "live", "custom"]
TimePolicy = Literal["practice", "strict", "live"]
PaletteStatus = Literal["not_visited", "not_answered", "answered", "marked", "answered_marked"]
AttemptStatus = Literal["in_progress", "submitted", "auto_submitted", "abandoned"]
Locale = Literal["en", "hi"]
I18n = dict[str, str]


class MarkingOut(BaseModel):
    """A blueprint marking rule for one question type (skills/exam-blueprint)."""

    correct: float
    wrong: float
    unattempted: float
    partial: dict[str, Any] | None = None
    tolerance: Any = None


class MockAccess(BaseModel):
    """app-core ``mockAccess``. A locked mock names the paywall source; the client opens PAY-01 only
    on a tap (practice §4.1)."""

    allowed: bool
    paywall_trigger: Literal["mock_limit"] | None = None
    paywall_source: Literal["mock_lock", "pyq_paper", "live_mock", "custom_mock"] | None = None
    reason: str | None = None


class MockSection(BaseModel):
    code: str
    title: I18n
    subject_id: str | None
    question_count: int
    question_types: list[str]
    type_counts: dict[str, int] | None = None
    timer_min: int | None
    attempt_any: int | None
    over_attempt: Literal["block", "evaluate_first_n"] | None
    marking: dict[str, MarkingOut]


class MockCard(BaseModel):
    id: str
    kind: MockKind
    exam_profile_id: str
    title: I18n
    blueprint_id: uuid.UUID
    paper_code: str
    section_code: str | None = None
    duration_min: int
    question_count: int
    max_marks: float | None
    is_free: bool
    access: MockAccess
    window_start: datetime | None = None
    window_end: datetime | None = None
    results_at: datetime | None = None
    attempts: int = 0
    in_progress_attempt_id: uuid.UUID | None = None
    # Published and PYQ-paper mocks are the same paper for everyone, so percentile and rank can
    # appear (R26). Papers built for one student never rank.
    ranked: bool


class BlueprintSource(BaseModel):
    title: str
    url: str
    published: str | None = None


class AttemptSummary(BaseModel):
    id: uuid.UUID
    mock_id: str | None
    kind: MockKind
    title: I18n
    status: AttemptStatus
    attempt_no: int
    started_at: datetime
    submitted_at: datetime | None
    score: float | None
    max_score: float | None


class MockDetail(MockCard):
    """MOCK-02: everything the blueprint says, never a fallback value (practice §9.1)."""

    mode: Literal["cbt", "pen_paper"]
    languages: list[str]
    language_switch: Literal["per_question", "fixed"]
    calculator: str
    interface: str
    interface_profile: dict[str, Any] | None
    section_navigation: Literal["free", "locked_in_order", "free_within_timer"]
    early_section_submit: bool | None
    marked_answer_evaluated: bool
    sections: list[MockSection]
    instructions: I18n
    qualifying: dict[str, Any] | None
    source: BlueprintSource
    verified_at: str
    past_attempts: list[AttemptSummary]


class AttemptCreate(BaseModel):
    """Created when [I am ready to begin] is tapped (practice §6.4 step 5), with the client's
    UUIDv7 so a retry or an offline replay is the same attempt."""

    attempt_id: uuid.UUID
    language: Locale
    time_policy: Literal["practice", "strict"] = "practice"
    # Offline starts are accepted later with the device's start time, checked for plausibility.
    started_at: datetime | None = None


class GenerateMock(BaseModel):
    """MOCK-26 custom weak-area mock (Pro) or a timed chapter mock (counts as sectional, Q15)."""

    attempt_id: uuid.UUID
    kind: Literal["custom", "chapter"] = "custom"
    exam: Id | None = None
    paper_code: Id | None = None
    chapter_id: Id | None = None
    concepts: list[Id] | None = Field(default=None, max_length=50)
    question_count: int = Field(ge=1, le=200)
    language: Locale
    time_policy: Literal["practice", "strict"] = "practice"

    @model_validator(mode="after")
    def _scope(self) -> GenerateMock:
        if self.kind == "chapter" and not self.chapter_id:
            raise ValueError("a chapter mock needs chapter_id")
        return self


class SavedAnswer(BaseModel):
    answer: dict[str, Any] | None
    palette_status: PaletteStatus
    time_spent_ms: int
    visits: int
    answer_changes: int
    first_seen_seq: int | None
    answered_seq: int | None
    confidence: ConfidenceIn | None
    client_updated_at: datetime


class AttemptQuestion(BaseModel):
    question_id: str
    section_code: str
    position: int
    type: str
    marking: MarkingOut
    # Stem, options and media, in both languages when the blueprint allows a per-question switch
    # (R44). Never the key or the solution.
    body: dict[str, Any]
    saved: SavedAnswer | None = None


class AttemptSection(BaseModel):
    code: str
    title: I18n
    status: Literal["open", "upcoming", "closed"]
    opened_at: datetime | None
    closes_at: datetime | None
    closed_at: datetime | None
    closed_by: Literal["timer", "student", "submit"] | None
    question_ids: list[str]
    attempt_any: int | None
    over_attempt: Literal["block", "evaluate_first_n"] | None
    answered: int


class Attempt(BaseModel):
    id: uuid.UUID
    mock_id: str | None
    kind: MockKind
    exam_profile_id: str | None
    blueprint_id: uuid.UUID
    title: I18n
    status: AttemptStatus
    attempt_no: int
    time_policy: TimePolicy
    language: Locale
    language_switch: Literal["per_question", "fixed"]
    calculator: str
    interface: str
    interface_profile: dict[str, Any] | None
    section_navigation: Literal["free", "locked_in_order", "free_within_timer"]
    early_section_submit: bool | None
    marked_answer_evaluated: bool
    started_at: datetime
    server_deadline_at: datetime
    server_time: datetime
    remaining_ms: int
    paused: bool
    paused_ms: int
    pause_count: int
    # "this": the caller's device holds the attempt; "other": another device does (MOCK takeover).
    active_device: Literal["this", "other"] | None
    submitted_at: datetime | None
    score: float | None
    max_score: float | None
    sections: list[AttemptSection]
    questions: list[AttemptQuestion] | None = None


class AnswerSave(BaseModel):
    question_id: Id
    answer: AnswerIn | None = None
    palette_status: PaletteStatus
    time_spent_ms: int = Field(ge=0, le=86_400_000)
    visits: int = Field(default=0, ge=0, le=32_000)
    answer_changes: int = Field(default=0, ge=0, le=32_000)
    first_seen_seq: int | None = Field(default=None, ge=0, le=32_000)
    answered_seq: int | None = Field(default=None, ge=0, le=32_000)
    confidence: ConfidenceIn | None = None
    client_updated_at: datetime


class AnswersPut(BaseModel):
    answers: list[AnswerSave] = Field(min_length=1, max_length=300)


class RejectedRow(BaseModel):
    question_id: str
    code: Literal[
        "not_in_paper",
        "after_deadline",
        "section_closed",
        "section_locked",
        "over_attempt",
        "invalid_answer",
        "clock_skew",
    ]


class SaveResult(BaseModel):
    saved: list[str]
    # The server already holds a newer save for these (``client_updated_at`` wins).
    kept_newer: list[str]
    rejected: list[RejectedRow]
    server_time: datetime
    server_deadline_at: datetime
    status: AttemptStatus
    sections: list[AttemptSection]


# --- report -------------------------------------------------------------------------------------


class Tally(BaseModel):
    marks: float
    max_marks: float
    correct: int
    partial: int
    wrong: int
    skipped: int
    accuracy: int | None  # whole percent of attempted (practice §9.3); null when none attempted
    time_ms: int


class SectionRow(Tally):
    code: str
    title: I18n


class SubjectRow(Tally):
    subject_id: str


class TopicRow(Tally):
    topic_id: str


class ConceptRow(BaseModel):
    concept_id: str
    attempted: int
    correct: int
    accuracy: int | None
    marks_lost: float


class QuestionRow(BaseModel):
    question_id: str
    section_code: str
    position: int
    status: Literal["correct", "partial", "wrong", "skipped", "not_counted", "not_scored"]
    marks: float
    time_spent_ms: int
    confidence: ConfidenceIn | None
    answered_seq: int | None
    ideal_time_s: int | None
    slow: bool | None


class TimeBuckets(BaseModel):
    right_but_slow: int
    fast_and_wrong: int
    lucky_guesses: int
    skipped_time_ms: int
    # Where the target time came from: the cohort median once enough students answered, or the
    # authors' ``ideal_time_s`` (practice §6.10). Only the authors' value exists for now.
    ideal_time_source: Literal["authors", "cohort"]


class ConfidenceRow(BaseModel):
    confidence: Literal["sure", "fifty_fifty", "guess", "none"]
    correct: int
    wrong: int


class FixNext(BaseModel):
    concept_id: str
    marks_lost: float
    weightage: float | None
    drill: dict[str, Any]


class Standing(BaseModel):
    """R26: percentile and rank only from real first attempts, above the owner's threshold."""

    shown: bool
    percentile: float | None = None
    rank: int | None = None
    of: int | None = None
    counted: int | None = None
    needed: int | None = None
    reason: (
        Literal[
            "personal_paper",
            "not_first_attempt",
            "threshold_unset",
            "below_threshold",
            "results_pending",
        ]
        | None
    ) = None


class Report(BaseModel):
    attempt_id: uuid.UUID
    mock_id: str | None
    kind: MockKind
    title: I18n
    attempt_no: int
    status: AttemptStatus
    time_policy: TimePolicy
    submitted_at: datetime | None
    generated_at: datetime
    # Sections a free student sees as inline locked rows (``free.mock_report_sections``).
    locked: list[str]
    score: float | None = None
    max_score: float | None = None
    standing: Standing | None = None
    accuracy: int | None = None
    time_lost_wrong_ms: int | None = None
    summary: dict[str, Any] | None = None
    sections: list[SectionRow] | None = None
    subjects: list[SubjectRow] | None = None
    topics: list[TopicRow] | None = None
    concepts: list[ConceptRow] | None = None
    questions: list[QuestionRow] | None = None
    time_buckets: TimeBuckets | None = None
    confidence: list[ConfidenceRow] | None = None
    fix_next: list[FixNext] | None = None
    qualifying: dict[str, Any] | None = None


class SolutionItem(BaseModel):
    question_id: str
    section_code: str
    position: int
    status: Literal["correct", "partial", "wrong", "skipped", "not_counted", "not_scored"]
    marks: float
    your_answer: dict[str, Any] | None
    question: dict[str, Any]
    solution: dict[str, Any]


class Solutions(BaseModel):
    attempt_id: uuid.UUID
    items: list[SolutionItem]


SectionCode = Annotated[str, Field(min_length=1, max_length=64)]
