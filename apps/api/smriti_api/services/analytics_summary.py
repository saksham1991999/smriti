"""PRC-14 analytics dashboard cards (practice flow §5.6; R58), computed from the learner's own
rows only: ``learn.concept_mastery`` against ``content.exam_concepts`` for readiness, and first
attempts (``learn.question_attempts`` outside mocks, plus answers of submitted mocks from
``learn.mock_answers``) for speed, confidence and mistake types, counted once each.

Every card has its threshold flag (owner values, no defaults). Below it, or with the flag unset,
the card's numbers are null and it says why, with the count it has and needs. Nothing is
estimated, smoothed or filled in.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.schemas import analytics_summary as a
from smriti_api.services.usage import Flags, load_flags, load_learner

_PERIOD_DAYS = {"7d": 7, "30d": 30}
_MISTAKES = ("conceptual", "calculation", "misread", "silly", "time")

# First attempts in the period, scoped to questions on the exam's concepts. Mock answers are
# taken from learn.mock_answers (where review tags live), so question_attempts' copies of them
# (context 'mock', sync v1.3) are left out.
_ANSWERS = """
with answers as (
  select qa.question_id, qa.is_correct, qa.time_ms, qa.confidence, qa.mistake_type
    from learn.question_attempts qa
   where qa.user_id = :u and qa.attempt_no = 1 and qa.context <> 'mock'
     and (cast(:since as timestamptz) is null or qa.answered_at >= :since)
  union all
  select ma.question_id, ma.is_correct, ma.time_spent_ms, ma.confidence, ma.mistake_type
    from learn.mock_answers ma
    join learn.mock_attempts mt on mt.id = ma.attempt_id
   where mt.user_id = :u and mt.status in ('submitted', 'auto_submitted')
     and ma.is_correct is not null
     and (cast(:since as timestamptz) is null or coalesce(mt.submitted_at, mt.started_at) >= :since)
),
scoped as (
  select x.*, q.ideal_time_s
    from answers x
    left join content.questions q on q.id = x.question_id
   where exists (
     select 1 from content.question_concepts qc
       join content.exam_concepts ec on ec.concept_id = qc.concept_id and ec.exam_profile_id = :e
      where qc.question_id = x.question_id)
)
"""

_SPEED_SQL = _ANSWERS + (
    """
select count(*) as n,
       avg(time_ms) as avg_ms,
       avg(ideal_time_s * 1000) as target_ms,
       count(*) filter (where is_correct and time_ms > ideal_time_s * 1000) as right_slow,
       count(*) filter (where not is_correct and time_ms < ideal_time_s * 1000) as fast_wrong
  from scoped where ideal_time_s is not null and time_ms > 0
"""
)
_CONFIDENCE_SQL = _ANSWERS + (
    """
select confidence, count(*) as n, count(*) filter (where is_correct) as ok
  from scoped where confidence is not null group by confidence
"""
)
_MISTAKES_SQL = _ANSWERS + (
    """
select mistake_type, count(*) as n from scoped where mistake_type is not null group by mistake_type
"""
)
_READINESS_SQL = """
select ec.concept_id, ec.weightage, coalesce(cm.mastery, 0) as mastery,
       coalesce(cm.attempts, 0) as attempts
  from content.exam_concepts ec
  left join learn.concept_mastery cm on cm.concept_id = ec.concept_id and cm.user_id = :u
 where ec.exam_profile_id = :e
"""


def _gate(flags: Flags, key: str, have: int) -> tuple[bool, a.CardReason | None, int | None]:
    needed = flags.int_or_none(key)
    if needed is None:
        return False, "threshold_unset", None
    if have < needed:
        return False, "not_enough_data", needed
    return True, None, needed


async def _readiness(session: AsyncSession, user: Any, exam: str, flags: Flags) -> a.ReadinessCard:
    rows = (await session.execute(text(_READINESS_SQL), {"u": user, "e": exam})).all()
    total = len(rows)
    practised = sum(1 for r in rows if int(r.attempts) > 0)
    weighted = total > 0 and all(r.weightage is not None and float(r.weightage) > 0 for r in rows)
    shown, reason, needed = _gate(flags, "analytics.min_concepts_for_readiness", practised)
    percent = None
    if shown and total:
        weights = [float(r.weightage) if weighted else 1.0 for r in rows]
        score = sum(w * float(r.mastery) for w, r in zip(weights, rows, strict=True)) / sum(weights)
        percent = round(100 * min(max(score, 0.0), 1.0))
    return a.ReadinessCard(
        shown=shown,
        reason=reason,
        have=practised,
        needed=needed,
        percent=percent,
        practised=practised,
        total=total,
        weighted=weighted,
    )


async def _speed(session: AsyncSession, params: dict[str, Any], flags: Flags) -> a.SpeedCard:
    r = (await session.execute(text(_SPEED_SQL), params)).one()
    have = int(r.n)
    shown, reason, needed = _gate(flags, "analytics.min_answers_total", have)
    if not shown:
        return a.SpeedCard(shown=False, reason=reason, have=have, needed=needed)
    return a.SpeedCard(
        shown=True,
        have=have,
        needed=needed,
        avg_ms=round(float(r.avg_ms)),
        target_ms=round(float(r.target_ms)),
        right_but_slow=int(r.right_slow),
        fast_and_wrong=int(r.fast_wrong),
    )


async def _confidence(
    session: AsyncSession, params: dict[str, Any], flags: Flags
) -> a.ConfidenceCard:
    found = {
        r.confidence: (int(r.n), int(r.ok))
        for r in (await session.execute(text(_CONFIDENCE_SQL), params)).all()
    }
    have = sum(n for n, _ in found.values())
    shown, reason, needed = _gate(flags, "analytics.min_tagged_answers", have)
    if not shown:
        return a.ConfidenceCard(shown=False, reason=reason, have=have, needed=needed)
    levels = []
    for level in ("sure", "fifty", "guess"):
        n, ok = found.get(level, (0, 0))
        levels.append(
            a.ConfidenceLevel(
                confidence=level,
                answers=n,
                correct=ok,
                accuracy=round(ok / n, 3) if n else None,
            )
        )
    return a.ConfidenceCard(
        shown=True,
        have=have,
        needed=needed,
        levels=levels,
        lucky_guesses=found.get("guess", (0, 0))[1],
    )


async def _mistakes(session: AsyncSession, params: dict[str, Any]) -> a.MistakesCard:
    found = {
        r.mistake_type: int(r.n) for r in (await session.execute(text(_MISTAKES_SQL), params)).all()
    }
    have = sum(found.values())
    if have == 0:
        # The flow's threshold for this card is "any tagged mistake".
        return a.MistakesCard(shown=False, reason="not_enough_data", have=0, needed=1)
    return a.MistakesCard(
        shown=True,
        have=have,
        needed=1,
        counts=[a.MistakeCount(type=m, count=found.get(m, 0)) for m in _MISTAKES],
    )


async def summary(
    db: Database, auth: AuthContext, exam: str | None, period: a.Period
) -> a.AnalyticsSummaryOut:
    now = datetime.now(UTC)
    since = now - timedelta(days=_PERIOD_DAYS[period]) if period in _PERIOD_DAYS else None
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        exam_id = exam or learner.primary_exam
        if exam_id is None:
            raise ApiError(409, "no_exam", "Pick an exam first")
        known = (
            await session.execute(
                text("select 1 from content.exam_profiles where id = :e"), {"e": exam_id}
            )
        ).first()
        if known is None:
            raise ApiError(404, "unknown_exam", "This exam isn't available")
        flags = await load_flags(session)
        params = {"u": auth.user_id, "e": exam_id, "since": since}
        readiness = await _readiness(session, auth.user_id, exam_id, flags)
        speed = await _speed(session, params, flags)
        confidence = await _confidence(session, params, flags)
        mistakes = await _mistakes(session, params)
    return a.AnalyticsSummaryOut(
        exam_profile_id=exam_id,
        period=period,
        computed_at=now,
        readiness=readiness,
        speed=speed,
        confidence=confidence,
        mistakes=mistakes,
    )
