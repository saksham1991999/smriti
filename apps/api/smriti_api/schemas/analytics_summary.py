"""PRC-14 analytics dashboard cards (practice flow §5.6; R58): readiness, speed, confidence and
mistake types, from the learner's own answers only. A card below its threshold flag has
``shown = false``, a ``reason``, the count it has and the count it needs, and null values: the
app shows its empty line ("Answer {n} more questions to see this"), never a placeholder chart."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Period = Literal["7d", "30d", "all"]
# not_enough_data: below the threshold. threshold_unset: the owner has not set the flag yet,
# so the card stays hidden rather than guessing a threshold.
CardReason = Literal["not_enough_data", "threshold_unset"]


class Card(BaseModel):
    shown: bool
    reason: CardReason | None = None
    have: int
    needed: int | None


class ReadinessCard(Card):
    """Ignores the period (a current state). Not a predicted score (PRD §6.3)."""

    percent: int | None = None
    practised: int
    total: int
    # True when every concept of the exam has a computed weightage; otherwise equal weights and
    # the app shows the weights note.
    weighted: bool


class SpeedCard(Card):
    """Answers to questions with an ``ideal_time_s``. Slow means over the ideal time, fast means
    under it."""

    avg_ms: int | None = None
    target_ms: int | None = None
    right_but_slow: int | None = None
    fast_and_wrong: int | None = None


class ConfidenceLevel(BaseModel):
    confidence: Literal["sure", "fifty", "guess"]
    answers: int
    correct: int
    accuracy: float | None


class ConfidenceCard(Card):
    levels: list[ConfidenceLevel] | None = None
    lucky_guesses: int | None = None


class MistakeCount(BaseModel):
    type: Literal["conceptual", "calculation", "misread", "silly", "time"]
    count: int


class MistakesCard(Card):
    """The student's own tags. Shown once anything is tagged."""

    counts: list[MistakeCount] | None = None


class AnalyticsSummaryOut(BaseModel):
    exam_profile_id: str
    period: Period
    computed_at: datetime
    readiness: ReadinessCard
    speed: SpeedCard
    confidence: ConfidenceCard
    mistakes: MistakesCard
