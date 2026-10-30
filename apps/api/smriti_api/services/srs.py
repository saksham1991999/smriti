"""FSRS scheduling on the server with py-fsrs (TRD §10, memory-labs flow §5).

The server is the source of truth for every schedule: it replays a card's whole review history
in time order through the scheduler, so a late review from an offline phone, or the union of
two review histories after a guest merge, always gives one deterministic schedule. The
client's own ``fsrs_state`` is never trusted.

Parameters match ts-fsrs defaults so the on-device prediction and the server agree:
FSRS-6 default weights (py-fsrs ``DEFAULT_PARAMETERS`` equals ts-fsrs ``default_w``), desired
retention 0.9, maximum interval 36500 days, learning steps 1 min and 10 min, relearning step
10 min, and no fuzz (ts-fsrs ``enable_fuzz`` defaults to false).
"""

from __future__ import annotations

import copy
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fsrs import Card, Rating, Scheduler, State
from fsrs.scheduler import DEFAULT_PARAMETERS

TS_FSRS_DEFAULT_RETENTION = 0.9
TS_FSRS_MAX_INTERVAL = 36500
TS_FSRS_LEARNING_STEPS = (timedelta(minutes=1), timedelta(minutes=10))
TS_FSRS_RELEARNING_STEPS = (timedelta(minutes=10),)


def make_scheduler(
    weights: Sequence[float] | None = None, retention: float | None = None
) -> Scheduler:
    return Scheduler(
        parameters=tuple(weights) if weights else DEFAULT_PARAMETERS,
        desired_retention=retention or TS_FSRS_DEFAULT_RETENTION,
        learning_steps=TS_FSRS_LEARNING_STEPS,
        relearning_steps=TS_FSRS_RELEARNING_STEPS,
        maximum_interval=TS_FSRS_MAX_INTERVAL,
        enable_fuzzing=False,
    )


@dataclass(frozen=True)
class ReviewInput:
    review_id: str
    rating: int
    reviewed_at: datetime
    duration_ms: int | None = None


@dataclass(frozen=True)
class ReviewOutcome:
    review_id: str
    state_before: int
    elapsed_days: float
    scheduled_days: float
    stability_after: float
    difficulty_after: float


@dataclass(frozen=True)
class CardSchedule:
    state: int
    due_at: datetime
    stability: float
    difficulty: float
    reps: int
    lapses: int
    last_review_at: datetime


def _ts_hard_minutes(steps: tuple[timedelta, ...]) -> int:
    """ts-fsrs ``BasicLearningStepsStrategy`` Hard step, in whole minutes."""
    first = steps[0].total_seconds() / 60
    if len(steps) == 1:
        return round(first * 1.5)
    return round((first + steps[1].total_seconds() / 60) / 2)


def review_like_ts_fsrs(
    sched: Scheduler, card: Card, rating: Rating, at: datetime, duration_ms: int | None = None
) -> Card:
    """One review with py-fsrs's memory model and ts-fsrs 5.4.2's interval rules, so the
    server's schedule matches the client's preview (packages/app-core test vectors):

    * Hard in a (re)learning step waits round((step1 + step2) / 2) minutes, or 1.5 x the only
      step, at every step (py-fsrs uses the exact average at step 1 and the next step after).
    * On a review card the four answers stay ordered: hard <= good, good >= hard + 1 day and
      easy >= good + 1 day (py-fsrs schedules each answer on its own).
    """
    before = card.state
    result, _log = sched.review_card(
        copy.deepcopy(card), rating, review_datetime=at, review_duration=duration_ms
    )
    if before in (State.Learning, State.Relearning) and rating == Rating.Hard:
        if result.state == before:
            steps = sched.learning_steps if before == State.Learning else sched.relearning_steps
            if steps:
                result.due = at + timedelta(minutes=_ts_hard_minutes(tuple(steps)))
        return result
    if before != State.Review or rating == Rating.Again:
        return result

    def days(r: Rating) -> int:
        other, _ = sched.review_card(copy.deepcopy(card), r, review_datetime=at)
        return round((other.due - at).total_seconds() / 86400)

    hard, good = days(Rating.Hard), days(Rating.Good)
    hard = min(hard, good)
    good = max(good, hard + 1)
    chosen = {Rating.Hard: hard, Rating.Good: good}.get(rating)
    if rating == Rating.Easy:
        chosen = max(days(Rating.Easy), good + 1)
    if chosen is not None:
        result.due = at + timedelta(days=chosen)
    return result


def _utc(dt: datetime) -> datetime:
    return dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=UTC)


def replay(
    reviews: Sequence[ReviewInput], scheduler: Scheduler | None = None
) -> tuple[CardSchedule, list[ReviewOutcome]]:
    """Replay a card's reviews (any order in; sorted by time and id) and return the final schedule."""
    if not reviews:
        raise ValueError("replay needs at least one review")
    sched = scheduler or make_scheduler()
    ordered = sorted(reviews, key=lambda r: (_utc(r.reviewed_at), r.review_id))
    first = _utc(ordered[0].reviewed_at)
    card = Card(card_id=0, state=State.Learning, due=first)
    reps = 0
    lapses = 0
    previous: datetime | None = None
    state_before = 0  # 0 = new, as in ts-fsrs and learn.srs_cards
    outcomes: list[ReviewOutcome] = []
    for review in ordered:
        at = _utc(review.reviewed_at)
        rating = Rating(min(4, max(1, review.rating)))
        if card.state == State.Review and rating == Rating.Again:
            lapses += 1
        card = review_like_ts_fsrs(sched, card, rating, at, review.duration_ms)
        reps += 1
        elapsed = (at - previous).total_seconds() / 86400 if previous else 0.0
        outcomes.append(
            ReviewOutcome(
                review_id=review.review_id,
                state_before=state_before,
                elapsed_days=round(elapsed, 6),
                scheduled_days=round((card.due - at).total_seconds() / 86400, 6),
                stability_after=float(card.stability or 0.0),
                difficulty_after=float(card.difficulty or 0.0),
            )
        )
        previous = at
        state_before = int(card.state)
    assert previous is not None
    return (
        CardSchedule(
            state=int(card.state),
            due_at=card.due,
            stability=float(card.stability or 0.0),
            difficulty=float(card.difficulty or 0.0),
            reps=reps,
            lapses=lapses,
            last_review_at=previous,
        ),
        outcomes,
    )
