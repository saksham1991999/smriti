"""Practice, PYQ and daily-challenge models (docs/flows/practice.md §5, §8, §12.2)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

Id = Annotated[str, Field(min_length=1, max_length=200)]
ConfidenceIn = Literal["sure", "fifty_fifty", "guess"]
MistakeType = Literal["conceptual", "calculation", "misread", "silly", "time"]
DifficultyLevel = Literal["easy", "medium", "hard"]


class QuotaOut(BaseModel):
    """A free-tier counter (app-core ``Quota``). ``remaining`` is null when unlimited."""

    unlimited: bool
    limit: int | None
    used: int
    remaining: int | None
    resets_at: datetime | None = None


class Limits(BaseModel):
    is_pro: bool
    day: date
    practice_questions: QuotaOut
    tutor_messages: QuotaOut
    sectional_mocks: QuotaOut


# --- answers on the wire ------------------------------------------------------------------------


class OptionIdsAnswer(BaseModel):
    kind: Literal["options"]
    option_ids: list[Annotated[str, Field(max_length=64)]] = Field(max_length=26)


class NumberAnswerIn(BaseModel):
    kind: Literal["number"]
    value: float | Annotated[str, Field(max_length=64)]
    unit: Annotated[str, Field(max_length=16)] | None = None


class PairIn(BaseModel):
    left: Annotated[str, Field(max_length=64)]
    right: Annotated[str, Field(max_length=64)]


class PairsAnswerIn(BaseModel):
    kind: Literal["pairs"]
    pairs: list[PairIn] = Field(max_length=26)


class MatrixRowIn(BaseModel):
    row: Annotated[str, Field(max_length=64)]
    columns: list[Annotated[str, Field(max_length=64)]] = Field(max_length=26)


class MatrixAnswerIn(BaseModel):
    kind: Literal["matrix"]
    rows: list[MatrixRowIn] = Field(max_length=26)


class BlankIn(BaseModel):
    blank: Annotated[str, Field(max_length=64)]
    choice_id: Annotated[str, Field(max_length=64)] | None = None
    # Typed text is checked and dropped: only the matched key is stored (lesson-core).
    text: Annotated[str, Field(max_length=200)] | None = None


class BlanksAnswerIn(BaseModel):
    kind: Literal["blanks"]
    blanks: list[BlankIn] = Field(max_length=20)


class OrderAnswerIn(BaseModel):
    kind: Literal["order"]
    order: list[Annotated[str, Field(max_length=64)]] = Field(max_length=30)


# Each member's ``kind`` is a literal, so the union resolves on it. It is left without an OpenAPI
# ``discriminator`` because openapi-typescript rewrites discriminated schemas in place, which
# would make the committed openapi.json differ from the models.
AnswerIn = (
    OptionIdsAnswer
    | NumberAnswerIn
    | PairsAnswerIn
    | MatrixAnswerIn
    | BlanksAnswerIn
    | OrderAnswerIn
)


class CheckOut(BaseModel):
    correct: bool
    partial: float
    # Option ids, a number or matched keys: never the text a student typed.
    response: dict[str, Any] | None


# --- drill sessions ---------------------------------------------------------------------------


class SessionCreate(BaseModel):
    """PRC-03's input contract (practice §5.3): exactly one of ``concepts``, ``topic_id``,
    ``chapter_id``, ``question_ids`` or ``paper_id``; or none for a mixed drill of the exam."""

    session_id: uuid.UUID | None = Field(
        default=None, description="Client UUIDv7; a repeat returns the same session"
    )
    exam: Id | None = None
    concepts: list[Id] | None = Field(default=None, max_length=50)
    topic_id: Id | None = None
    chapter_id: Id | None = None
    question_ids: list[Id] | None = Field(default=None, max_length=100)
    paper_id: Id | None = None
    mode: Literal["drill", "chapter_test", "weak_spots"] = "drill"
    count: Annotated[int, Field(ge=1, le=100)] = 10
    difficulty: Literal["adaptive", "easy", "medium", "hard"] = "adaptive"
    source: Annotated[str, Field(max_length=32, pattern=r"^[a-z_]+$")] | None = None

    @model_validator(mode="after")
    def _one_scope(self) -> SessionCreate:
        given = [
            x
            for x in (
                self.concepts,
                self.topic_id,
                self.chapter_id,
                self.question_ids,
                self.paper_id,
            )
            if x
        ]
        if len(given) > 1:
            raise ValueError("give one of concepts, topic_id, chapter_id, question_ids or paper_id")
        if self.mode == "chapter_test" and not self.chapter_id:
            raise ValueError("a chapter test needs chapter_id")
        return self


class SessionQuestion(BaseModel):
    question_id: str
    type: str
    difficulty: str | None
    topic_id: str
    chapter_id: str
    ideal_time_s: int | None
    bundle_ref: str | None = Field(description="Bundle that holds the question for offline use")
    concepts: list[str]


class PracticeSession(BaseModel):
    id: uuid.UUID
    kind: str
    exam: str | None
    source: str | None
    started_at: datetime
    ended_at: datetime | None
    size: int
    requested: int
    capped_by_free_limit: bool
    answered: int
    correct: int
    questions: list[SessionQuestion]
    quota: QuotaOut


class SessionSummary(BaseModel):
    id: uuid.UUID
    kind: str
    exam: str | None
    started_at: datetime
    ended_at: datetime | None
    size: int | None
    answered: int
    correct: int


class AnswerSubmit(BaseModel):
    question_id: Id
    answer: AnswerIn | None = Field(default=None, description="null: I don't know yet")
    attempt: Literal[1, 2] = 1
    confidence: ConfidenceIn | None = None
    time_ms: Annotated[int, Field(ge=0, le=3_600_000)]
    mistake_type: MistakeType | None = None
    locale: Literal["en", "hi"] | None = None


class AnswerResult(BaseModel):
    question_id: str
    attempt: int
    check: CheckOut
    counted: bool = Field(description="Whether it used a free practice question")
    solution: dict[str, Any]
    session_answered: int
    session_correct: int
    quota: QuotaOut


class SessionComplete(BaseModel):
    ended_by: Literal["finished", "closed", "time_up"] = "finished"


class DrillPreview(BaseModel):
    exam: str
    question_ids: list[str]


# --- weak spots and the hub -------------------------------------------------------------------


class WeakSpot(BaseModel):
    concept_id: str
    concept_name: dict[str, str]
    topic_id: str
    topic_name: dict[str, str]
    reasons: list[Literal["low_accuracy", "fading", "missed_in_mock", "overconfident"]]
    attempts: int
    accuracy: float | None
    mastery: float | None
    weightage: float | None
    priority: str


class WeakSpots(BaseModel):
    exam: str
    items: list[WeakSpot]
    needs_more_answers: int | None = Field(
        description="Answers still needed before weak spots can be found; null when enough"
    )
    unset_thresholds: list[str] = Field(
        description="Owner flags not set yet; their rules are skipped (practice §9.2)"
    )


class DailyChallengeCard(BaseModel):
    challenge_id: uuid.UUID | None
    day: date
    state: Literal["not_played", "started", "played", "unavailable"]


class MockInProgress(BaseModel):
    attempt_id: uuid.UUID
    mock_id: str | None
    kind: str | None
    started_at: datetime
    server_deadline_at: datetime


class PracticeHub(BaseModel):
    exam: str
    limits: Limits
    weak_spots: list[WeakSpot]
    daily_challenge: DailyChallengeCard
    recent_sessions: list[SessionSummary]
    mock_in_progress: MockInProgress | None


# --- PYQ --------------------------------------------------------------------------------------


class PyqPaper(BaseModel):
    id: str
    exam_id: str
    year: int
    session_label: str | None
    held_on: date | None
    paper_code: str | None
    source_url: str | None
    notes: str | None
    question_count: int
    free_as_mock: bool


class PyqItem(BaseModel):
    number: int
    question_id: str
    type: str
    difficulty: str | None
    topic_id: str | None
    chapter_id: str | None
    status: Literal["not_tried", "wrong", "correct"]
    bundle_ref: str | None


class PyqPaperDetail(PyqPaper):
    items: list[PyqItem]


class PyqQuestion(BaseModel):
    question_id: str
    paper_id: str
    number: int
    year: int
    session_label: str | None
    type: str
    difficulty: str | None
    topic_id: str | None
    chapter_id: str | None
    subject_id: str | None
    status: Literal["not_tried", "wrong", "correct"]
    bundle_ref: str | None


# --- daily challenge --------------------------------------------------------------------------


class DailyChallengeResult(BaseModel):
    correct: bool
    time_ms: int
    submitted_at: datetime
    rank: int | None
    players: int
    beat_pct: int | None = Field(description="Share of players beaten, when ranks are shown")
    min_players_for_rank: int | None


class DailyChallenge(BaseModel):
    id: uuid.UUID
    exam: str
    day: date
    opens_at: datetime
    closes_at: datetime
    question: dict[str, Any] | None = Field(
        description="The question without its key; shown once started"
    )
    started_at: datetime | None
    result: DailyChallengeResult | None
    solution: dict[str, Any] | None = None


class DailyChallengeAnswer(BaseModel):
    answer: AnswerIn | None = None
    confidence: ConfidenceIn | None = None
    client_time_ms: Annotated[int, Field(ge=0, le=86_400_000)]
    tz: Annotated[str, Field(max_length=64)] | None = Field(
        default=None, description="IANA zone of the device, for the streak day (R23)"
    )


class LeaderboardRow(BaseModel):
    rank: int
    name: str | None = Field(description="Adults: display name. Minors: auto nickname (R31)")
    avatar: str | None
    is_you: bool
    correct: bool
    time_ms: int


class DailyLeaderboard(BaseModel):
    challenge_id: uuid.UUID
    players: int
    ranked: bool
    min_players_for_rank: int | None
    rows: list[LeaderboardRow]
    you: LeaderboardRow | None
