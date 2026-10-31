"""Learning-science jobs and views (IMPLEMENTATION_PLAN G-8, TRD §9.6).

- **Predictive weak-area alerts.** For every card in review, py-fsrs predicts recall
  (retrievability) over the next ``notify.weak_area.horizon_days`` days with the student's own
  weights when they have been optimised. Cards that are still above the student's target
  retention now but will drop below it inside the horizon are grouped by topic, and the topic
  with the most such cards becomes one ``weak_area`` alert (at most ``notify.weak_area.per_week``
  a week, and only when the student keeps ``weak_area_alerts`` on). The notification rules still
  cap and time the send; minors get no predicted-state pushes (R34).
- **Sleep review (adults only, R34).** The usual bedtime is the median end of the last study
  activity per day over ``notify.sleep_review.lookback_days`` days. Confidence is the share of
  those days with activity times the share of active days that ended within an hour of the
  median. The same pass estimates the usual study hour (median first activity), which adult
  smart timing reads. Neither is computed for minors; a teen can pick a fixed
  ``bedtime_review_time``. The app asks for tonight's set (the hardest due cards) and schedules a
  local notification ``notify.sleep_review.lead_min`` minutes before bedtime.
- **Interleaved practice builder.** A mixed drill across two or more chapters (or subjects) the
  student has learned (practice §5.3), questions dealt round-robin so neighbours differ.
- **Metacognitive calibration.** Confidence (sure, 50/50, guess) against correctness, from the
  student's real answers only, shown once there are ``analytics.min_tagged_answers`` tagged
  answers.
"""

from __future__ import annotations

import statistics
import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from fsrs import Card, State
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.core.logging import hash_user_id
from smriti_api.schemas import practice as p
from smriti_api.services import notify, practice
from smriti_api.services import question_bank as bank
from smriti_api.services.recompute import zone
from smriti_api.services.srs import TS_FSRS_DEFAULT_RETENTION, make_scheduler
from smriti_api.services.usage import Flags, load_flags, load_learner

log = structlog.get_logger(__name__)

HORIZON_DAYS = 3  # TRD §9.6; packages/config notify.weak_area.horizon_days
PER_WEEK = 2  # me-money §6.3; packages/config notify.weak_area.per_week
LOOKBACK_DAYS = 14  # TRD §9.6; packages/config notify.sleep_review.lookback_days
SLEEP_CARDS = 5  # TRD §9.6; packages/config notify.sleep_review.cards
SLEEP_LEAD_MIN = 20  # PRD §5.4; packages/config notify.sleep_review.lead_min
NEAR_MEDIAN_MIN = 60
# Times before this hour count as the previous evening (a session ending at 00:40 is a late night).
DAY_ROLLOVER_HOUR = 4
MIN_GROUPS = 2  # practice §5.3; packages/config practice.mixed_min_groups


def _int(flags: Flags, key: str, default: int) -> int:
    value = flags.int_or_none(key)
    return default if value is None or value < 1 else value


# --- predicted recall ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class CardRecall:
    card_ref: str
    topic_id: str
    now: float
    at_horizon: float


@dataclass(frozen=True)
class TopicDrop:
    topic_id: str
    cards: int
    min_retrievability: float


def topic_of(card_ref: str, indexed: Mapping[str, str]) -> str | None:
    """System card ids are ``{topic_id}:{mode}:{n}``; the server card index knows the rest."""
    if card_ref in indexed:
        return indexed[card_ref]
    head = card_ref.split(":", 1)[0]
    return head if ":" in card_ref and "." in head else None


def dropping(recalls: Iterable[CardRecall], target: float) -> list[TopicDrop]:
    """Topics with cards above ``target`` now and below it at the horizon, most cards first."""
    by_topic: dict[str, list[CardRecall]] = defaultdict(list)
    for r in recalls:
        if r.now >= target > r.at_horizon:
            by_topic[r.topic_id].append(r)
    drops = [
        TopicDrop(t, len(cards), round(min(c.at_horizon for c in cards), 4))
        for t, cards in by_topic.items()
    ]
    return sorted(drops, key=lambda d: (-d.cards, d.min_retrievability, d.topic_id))


async def _params(session: AsyncSession, user_id: uuid.UUID) -> tuple[list[float] | None, float]:
    row = (
        await session.execute(
            text("select weights, desired_retention from learn.fsrs_params where user_id = :u"),
            {"u": user_id},
        )
    ).one_or_none()
    if row is None:
        return None, TS_FSRS_DEFAULT_RETENTION
    return [float(w) for w in row.weights], float(row.desired_retention)


async def predicted_drops(
    session: AsyncSession, user_id: uuid.UUID, now: datetime, horizon_days: int
) -> tuple[list[TopicDrop], float]:
    weights, target = await _params(session, user_id)
    try:
        sched = make_scheduler(weights, target)
    except ValueError:
        # Stored parameters outside FSRS's bounds: predict with the defaults instead.
        log.warning("fsrs_params_invalid", user=hash_user_id(user_id))
        sched = make_scheduler(None, target)
    rows = (
        await session.execute(
            text(
                "select card_ref, stability, difficulty, due_at, last_review_at from learn.srs_cards"
                " where user_id = :u and not suspended and state = :review and last_review_at is not null"
                " and due_at > :now and due_at <= :far"
            ),
            {
                "u": user_id,
                "review": int(State.Review),
                "now": now,
                # Cards due far later can't fall below the target this soon; this bounds the work.
                "far": now + timedelta(days=horizon_days * 4 + 30),
            },
        )
    ).all()
    if not rows:
        return [], target
    refs = [r.card_ref for r in rows]
    indexed = {
        r.card_id: r.topic_id
        for r in (
            await session.execute(
                text("select card_id, topic_id from content.card_index where card_id = any(:r)"),
                {"r": refs},
            )
        ).all()
    }
    horizon = now + timedelta(days=horizon_days)
    recalls: list[CardRecall] = []
    for r in rows:
        topic = topic_of(r.card_ref, indexed)
        if topic is None or not r.stability:
            continue
        card = Card(
            card_id=0,
            state=State.Review,
            stability=float(r.stability),
            difficulty=float(r.difficulty),
            due=r.due_at,
            last_review=r.last_review_at,
        )
        recalls.append(
            CardRecall(
                r.card_ref,
                topic,
                sched.get_card_retrievability(card, now),
                sched.get_card_retrievability(card, horizon),
            )
        )
    return dropping(recalls, target), target


async def weak_area_alerts(db: Database, now: datetime | None = None, limit: int = 5000) -> int:
    """The nightly job: one predictive alert per student at most (TRD §9.6)."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        horizon = _int(flags, "notify.weak_area.horizon_days", HORIZON_DAYS)
        per_week = _int(flags, "notify.weak_area.per_week", PER_WEEK)
        users = (
            await session.execute(
                text(
                    """
                    select distinct c.user_id, p.timezone, coalesce(n.weak_area_alerts, true) as on_,
                           n.usual_study_hour
                      from learn.srs_cards c
                      join app.profiles p on p.user_id = c.user_id
                      left join notify.prefs n on n.user_id = c.user_id
                     where not c.suspended and c.state = :review and c.due_at > :now
                       and c.due_at <= :far and p.deletion_scheduled_for is null
                     limit :n
                    """
                ),
                {
                    "review": int(State.Review),
                    "now": now,
                    "far": now + timedelta(days=horizon),
                    "n": limit,
                },
            )
        ).all()
    queued = 0
    for u in users:
        if not u.on_:
            continue
        async with db.system_tx() as session:
            day = now.astimezone(zone(u.timezone)).date()
            sent = (
                await session.execute(
                    text(
                        "select count(*) from learn.weak_area_alerts where user_id = :u"
                        " and notified and created_at > :since"
                    ),
                    {"u": u.user_id, "since": now - timedelta(days=7)},
                )
            ).scalar_one()
            drops, target = await predicted_drops(session, u.user_id, now, horizon)
            if not drops:
                continue
            top = drops[0]
            notified = int(sent) < per_week
            row = (
                await session.execute(
                    text(
                        """
                        insert into learn.weak_area_alerts
                          (user_id, local_day, topic_id, cards, min_retrievability, target_retention,
                           horizon_days, notified)
                        values (:u, :d, :t, :c, :m, :tr, :h, :n)
                        on conflict (user_id, local_day) do nothing returning id
                        """
                    ),
                    {
                        "u": u.user_id,
                        "d": day,
                        "t": top.topic_id,
                        "c": top.cards,
                        "m": max(0.0, min(1.0, top.min_retrievability)),
                        "tr": target,
                        "h": horizon,
                        "n": notified,
                    },
                )
            ).first()
            if row is None or not notified:
                continue
            # At the usual study hour when known (me-money §6.3); otherwise the engine holds it
            # through quiet hours and applies the caps.
            tz = zone(u.timezone)
            at = (
                notify.next_at(now.astimezone(tz), u.usual_study_hour).astimezone(UTC)
                if u.usual_study_hour is not None
                else None
            )
            await notify.enqueue(
                session,
                user_id=u.user_id,
                kind="weak_area",
                payload={"topic_id": top.topic_id, "n": top.cards},
                dedupe_key=f"weak_area:{u.user_id}:{day.isoformat()}",
                not_before=at,
            )
            queued += 1
    log.info("weak_area_alerts", users=len(users), queued=queued)
    return queued


class WeakAreaOut(BaseModel):
    topic_id: str
    cards: int
    min_retrievability: float


class WeakAreasOut(BaseModel):
    target_retention: float
    horizon_days: int
    topics: list[WeakAreaOut]


async def weak_areas(db: Database, auth: AuthContext) -> WeakAreasOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        horizon = _int(flags, "notify.weak_area.horizon_days", HORIZON_DAYS)
        drops, target = await predicted_drops(session, auth.user_id, now, horizon)
    return WeakAreasOut(
        target_retention=target,
        horizon_days=horizon,
        topics=[WeakAreaOut(**d.__dict__) for d in drops[:10]],
    )


# --- sleep review and usual study hour ------------------------------------------------------------


@dataclass(frozen=True)
class Estimate:
    bedtime: time | None
    confidence: float
    study_hour: time | None
    days: int


def _evening_minutes(t: time) -> int:
    """Minutes since noon-ish, with early-morning times counted after midnight."""
    m = t.hour * 60 + t.minute
    return m + 24 * 60 if t.hour < DAY_ROLLOVER_HOUR else m


def _clock(minutes: float) -> time:
    m = round(minutes) % (24 * 60)
    return time(m // 60, m % 60)


def estimate(ends: Sequence[time], starts: Sequence[time], lookback_days: int) -> Estimate:
    """Bedtime from the last activity of each day, study hour from the first (TRD §9.6)."""
    if not ends:
        return Estimate(None, 0.0, None, 0)
    evening = [_evening_minutes(t) for t in ends]
    median = statistics.median(evening)
    near = sum(1 for m in evening if abs(m - median) <= NEAR_MEDIAN_MIN)
    coverage = min(1.0, len(ends) / lookback_days)
    confidence = round(coverage * near / len(ends), 3)
    first = statistics.median([t.hour * 60 + t.minute for t in starts]) if starts else None
    return Estimate(
        _clock(median),
        confidence,
        None if first is None else time(int(first) // 60, 0),
        len(ends),
    )


async def _day_bounds(
    session: AsyncSession, user_id: uuid.UUID, tz: ZoneInfo, since: datetime
) -> tuple[list[time], list[time]]:
    rows = (
        await session.execute(
            text(
                "select occurred_at from learn.sync_events where user_id = :u and status = 'applied'"
                " and occurred_at >= :since"
            ),
            {"u": user_id, "since": since},
        )
    ).scalars()
    by_day: dict[date, list[datetime]] = defaultdict(list)
    for at in rows:
        local = at.astimezone(tz)
        # Activity after midnight but before the rollover belongs to the previous evening.
        day = (local - timedelta(hours=DAY_ROLLOVER_HOUR)).date()
        by_day[day].append(local)
    ends = [max(v).time() for v in by_day.values()]
    starts = [min(v).time() for v in by_day.values()]
    return ends, starts


async def estimate_rhythms(db: Database, now: datetime | None = None, limit: int = 5000) -> int:
    """Nightly: bedtime and usual study hour for adults only (R34)."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        lookback = _int(flags, "notify.sleep_review.lookback_days", LOOKBACK_DAYS)
        users = (
            await session.execute(
                text(
                    """
                    select distinct e.user_id, p.timezone from learn.sync_events e
                      join app.profiles p on p.user_id = e.user_id
                     where e.occurred_at >= :since and p.age_band = '18p'
                       and p.deletion_scheduled_for is null
                     limit :n
                    """
                ),
                {"since": now - timedelta(days=lookback), "n": limit},
            )
        ).all()
    done = 0
    for u in users:
        async with db.system_tx() as session:
            ends, starts = await _day_bounds(
                session, u.user_id, zone(u.timezone), now - timedelta(days=lookback)
            )
            est = estimate(ends, starts, lookback)
            await session.execute(
                text(
                    """
                    insert into notify.prefs (user_id, estimated_bedtime, bedtime_confidence, usual_study_hour)
                    values (:u, :b, :c, :h)
                    on conflict (user_id) do update set estimated_bedtime = excluded.estimated_bedtime,
                      bedtime_confidence = excluded.bedtime_confidence,
                      usual_study_hour = excluded.usual_study_hour
                    """
                ),
                {"u": u.user_id, "b": est.bedtime, "c": est.confidence, "h": est.study_hour},
            )
            done += 1
    log.info("rhythm_estimates", users=done)
    return done


class SleepCard(BaseModel):
    card_ref: str
    difficulty: float
    due_at: datetime


class SleepReviewOut(BaseModel):
    """Tonight's sleep review for the app to schedule as a local notification."""

    eligible: bool
    reason: str | None = None
    source: str | None = Field(default=None, description="estimate or fixed (a teen's own time)")
    bedtime: time | None = None
    confidence: float | None = None
    notify_at: datetime | None = None
    cards: list[SleepCard] = Field(default_factory=list)


async def sleep_review(db: Database, auth: AuthContext) -> SleepReviewOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        prefs = (
            await session.execute(
                text(
                    "select sleep_review, bedtime_review_time, estimated_bedtime, bedtime_confidence"
                    " from notify.prefs where user_id = :u"
                ),
                {"u": auth.user_id},
            )
        ).one_or_none()
        if not learner.is_pro:
            return SleepReviewOut(eligible=False, reason="pro_required")
        if prefs is None or not prefs.sleep_review:
            return SleepReviewOut(eligible=False, reason="off")
        if learner.is_minor or learner.age_band != "18p":
            # Never inferred for minors (R34): only the time the teen picked.
            if prefs.bedtime_review_time is None:
                return SleepReviewOut(eligible=False, reason="pick_a_time")
            bedtime, source, confidence = prefs.bedtime_review_time, "fixed", None
        else:
            needed = flags.float_or_none("notify.sleep_review.min_confidence")
            if needed is None:
                return SleepReviewOut(eligible=False, reason="threshold_unset")
            if prefs.estimated_bedtime is None or (prefs.bedtime_confidence or 0) < needed:
                return SleepReviewOut(
                    eligible=False, reason="not_confident", confidence=prefs.bedtime_confidence
                )
            bedtime, source, confidence = (
                prefs.estimated_bedtime,
                "estimate",
                prefs.bedtime_confidence,
            )
        lead = _int(flags, "notify.sleep_review.lead_min", SLEEP_LEAD_MIN)
        local_now = now.astimezone(learner.tz)
        tonight = datetime.combine(local_now.date(), bedtime, learner.tz)
        if bedtime.hour < DAY_ROLLOVER_HOUR:
            tonight += timedelta(days=1)
        if tonight - timedelta(minutes=lead) <= local_now:
            tonight += timedelta(days=1)
        count = _int(flags, "notify.sleep_review.cards", SLEEP_CARDS)
        rows = (
            await session.execute(
                text(
                    "select card_ref, difficulty, due_at from learn.srs_cards where user_id = :u"
                    " and not suspended and due_at <= :by order by difficulty desc, due_at limit :n"
                ),
                {"u": auth.user_id, "by": tonight.astimezone(UTC), "n": count},
            )
        ).all()
    if not rows:
        return SleepReviewOut(eligible=False, reason="no_due_cards", bedtime=bedtime, source=source)
    return SleepReviewOut(
        eligible=True,
        source=source,
        bedtime=bedtime,
        confidence=confidence,
        notify_at=(tonight - timedelta(minutes=lead)).astimezone(UTC),
        cards=[
            SleepCard(card_ref=r.card_ref, difficulty=float(r.difficulty), due_at=r.due_at)
            for r in rows
        ],
    )


# --- interleaved practice --------------------------------------------------------------------------


class InterleavedIn(BaseModel):
    session_id: uuid.UUID | None = None
    exam: str | None = Field(default=None, max_length=200)
    group_by: str = Field(default="chapter", pattern="^(subject|chapter|topic)$")
    count: int = Field(default=10, ge=2, le=100)


def interleave(groups: Mapping[str, Sequence[str]], count: int) -> list[str]:
    """Deals one question from each group in turn (A, B, C, A, B, C ...), so no two neighbours
    come from the same group while more than one group has questions left."""
    queues = {g: list(qs) for g, qs in sorted(groups.items()) if qs}
    out: list[str] = []
    while queues and len(out) < count:
        for g in list(queues):
            if len(out) >= count:
                break
            out.append(queues[g].pop(0))
            if not queues[g]:
                del queues[g]
    return out


async def _learned_topics(session: AsyncSession, user_id: uuid.UUID) -> set[str]:
    rows = (
        await session.execute(
            text(
                """
                select topic_id from learn.topic_status where user_id = :u and status = 'learned'
                union
                select st.topic_id from learn.concept_mastery m
                  join content.concepts c on c.id = m.concept_id
                  join content.subtopics st on st.id = c.subtopic_id
                 where m.user_id = :u and m.attempts > 0
                """
            ),
            {"u": user_id},
        )
    ).scalars()
    return {str(t) for t in rows}


async def build_interleaved(
    db: Database, auth: AuthContext, body: InterleavedIn
) -> p.PracticeSession:
    now = datetime.now(UTC)
    session_id = body.session_id or uuid.uuid4()
    async with db.system_tx() as session:
        flags = await load_flags(session)
        if not flags.bool("practice.mixed_enabled"):
            raise ApiError(403, "feature_disabled", "Mixed practice isn't open yet")
        existing = (
            await session.execute(
                text("select 1 from learn.practice_sessions where id = :id and user_id = :u"),
                {"id": session_id, "u": auth.user_id},
            )
        ).first()
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        exam = learner.exam_or_primary(body.exam)
        ids: list[str] = []
        if existing is None:
            topics = await _learned_topics(session, auth.user_id)
            pool = [
                q
                for q in await bank.pool(
                    session,
                    exam=exam,
                    uses=list(practice.PRACTICE_USES),
                    exclude_uses=list(practice.SERVER_ONLY_USES),
                )
                if q.topic_id in topics
            ]
            key = {"subject": "subject_id", "chapter": "chapter_id", "topic": "topic_id"}[
                body.group_by
            ]
            grouped: dict[str, list[bank.BankQuestion]] = defaultdict(list)
            for q in pool:
                grouped[str(getattr(q, key))].append(q)
            need = _int(flags, "practice.mixed_min_groups", MIN_GROUPS)
            if len(grouped) < need:
                raise ApiError(
                    409,
                    "not_enough_variety",
                    "Learn a little more first",
                    groups=len(grouped),
                    needed=need,
                    group_by=body.group_by,
                )
            history = await practice._history(session, auth.user_id, [q.id for q in pool])
            per_group = -(-body.count // len(grouped))
            dealt = {
                g: [
                    q.id
                    for q in practice.choose(
                        qs, history, level="medium", count=per_group, seed=str(session_id), now=now
                    )
                ]
                for g, qs in grouped.items()
            }
            ids = interleave(dealt, body.count)
    if not ids:
        # A repeat of the same session id returns the stored session.
        return await practice.get_session(db, auth, session_id)
    create = p.SessionCreate(
        session_id=session_id, exam=exam, question_ids=ids, source="interleaved"
    )
    return await practice.create_session(db, auth, create, now)


# --- calibration -----------------------------------------------------------------------------------


class CalibrationLevel(BaseModel):
    confidence: str
    answers: int
    correct: int
    accuracy: float | None


class CalibrationOut(BaseModel):
    """Confidence against correctness from real answers only (practice and mocks)."""

    shown: bool
    reason: str | None = None
    tagged: int
    needed: int | None
    levels: list[CalibrationLevel] = Field(default_factory=list)
    overconfident: float | None = Field(
        default=None, description="Share of 'sure' answers that were wrong"
    )
    underconfident: float | None = Field(
        default=None, description="Share of 'guess' answers that were right"
    )
    by_subject: list[dict[str, Any]] = Field(default_factory=list)


def _levels(rows: Iterable[Any]) -> list[CalibrationLevel]:
    found = {r.confidence: (int(r.n), int(r.ok)) for r in rows}
    out = []
    for level in ("sure", "fifty", "guess"):
        n, ok = found.get(level, (0, 0))
        out.append(
            CalibrationLevel(
                confidence=level, answers=n, correct=ok, accuracy=round(ok / n, 3) if n else None
            )
        )
    return out


# Mock answers come from learn.mock_answers only: since sync v1.3 the server also mirrors each
# scored mock answer into question_attempts (context 'mock'), and counting both would double them.
_CALIBRATION_SQL = """
with answers as (
  select a.confidence, a.is_correct, a.question_id
    from learn.question_attempts a
   where a.user_id = :u and a.confidence is not null and a.attempt_no = 1
     and a.context <> 'mock'
  union all
  select ma.confidence, ma.is_correct, ma.question_id
    from learn.mock_answers ma
    join learn.mock_attempts mt on mt.id = ma.attempt_id
   where mt.user_id = :u and ma.confidence is not null and ma.is_correct is not null
     and mt.status in ('submitted', 'auto_submitted')
)
"""

_CALIBRATION_TOTALS_SQL = _CALIBRATION_SQL + (  # noqa: S608 (constants only)
    "select confidence, count(*) as n, count(*) filter (where is_correct) as ok"
    " from answers group by confidence"
)
_CALIBRATION_SUBJECTS_SQL = (
    _CALIBRATION_SQL  # noqa: S608 (constants only)
    + """
                    select s.subject_id, a.confidence, count(*) as n,
                           count(*) filter (where a.is_correct) as ok
                      from answers a
                      -- One subject per question, so a question tagged with two concepts
                      -- still counts once.
                      join lateral (
                        select min(ch.subject_id) as subject_id
                          from content.question_concepts qc
                          join content.concepts c on c.id = qc.concept_id
                          join content.subtopics st on st.id = c.subtopic_id
                          join content.topics t on t.id = st.topic_id
                          join content.chapters ch on ch.id = t.chapter_id
                         where qc.question_id = a.question_id
                      ) s on s.subject_id is not null
                     group by s.subject_id, a.confidence
                    """
)


async def calibration(db: Database, auth: AuthContext) -> CalibrationOut:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        rows = (
            await session.execute(
                text(_CALIBRATION_TOTALS_SQL),
                {"u": auth.user_id},
            )
        ).all()
        levels = _levels(rows)
        tagged = sum(level.answers for level in levels)
        needed = flags.int_or_none("analytics.min_tagged_answers")
        if needed is None:
            return CalibrationOut(shown=False, reason="threshold_unset", tagged=tagged, needed=None)
        if tagged < needed:
            return CalibrationOut(
                shown=False, reason="below_threshold", tagged=tagged, needed=needed
            )
        subjects = (
            await session.execute(
                text(_CALIBRATION_SUBJECTS_SQL),
                {"u": auth.user_id},
            )
        ).all()
    by_subject: dict[str, list[Any]] = defaultdict(list)
    for r in subjects:
        by_subject[r.subject_id].append(r)
    sure = next(level for level in levels if level.confidence == "sure")
    guess = next(level for level in levels if level.confidence == "guess")
    return CalibrationOut(
        shown=True,
        tagged=tagged,
        needed=needed,
        levels=levels,
        overconfident=round(1 - sure.correct / sure.answers, 3) if sure.answers else None,
        underconfident=round(guess.correct / guess.answers, 3) if guess.answers else None,
        by_subject=[
            {"subject_id": sid, "levels": [lv.model_dump() for lv in _levels(rs)]}
            for sid, rs in sorted(by_subject.items())
        ],
    )
