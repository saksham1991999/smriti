"""Read views for Practice: weak spots (PRC-02), the hub (PRC-01) and the PYQ bank (PRC-07 to
PRC-10). Every number comes from the student's own answers or published content (practice §9.1);
thresholds are owner flags and a rule whose flag is not set is skipped, never guessed."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import not_found
from smriti_api.schemas import practice as p
from smriti_api.services import daily_challenge
from smriti_api.services.practice import _limits, list_sessions
from smriti_api.services.usage import Flags, Learner, load_flags, load_learner

WEAK_FLAGS = (
    "practice.weak_min_attempts",
    "practice.weak_accuracy_below",
    "practice.weak_sure_wrong_min",
    "practice.weak_recent_mocks",
)
PRIORITY_ORDER = {"high_yield": 0, "core": 1, "optional": 2}
FADING_DAYS = 3  # practice §5.2: recall drops below the target in the next 3 days

_CONCEPT_SQL = """
select c.id as concept_id, c.name as concept_name, t.id as topic_id, t.name as topic_name,
       ec.weightage, ec.priority
  from content.concepts c
  join content.exam_concepts ec on ec.concept_id = c.id and ec.exam_profile_id = :exam
  join content.subtopics st on st.id = c.subtopic_id
  join content.topics t on t.id = st.topic_id
 where c.id = any(:ids)
"""


async def weak_spots(
    session: AsyncSession, learner: Learner, flags: Flags, exam: str, now: datetime
) -> p.WeakSpots:
    min_attempts = flags.int_or_none("practice.weak_min_attempts")
    accuracy_below = flags.float_or_none("practice.weak_accuracy_below")
    sure_wrong_min = flags.int_or_none("practice.weak_sure_wrong_min")
    recent_mocks = flags.int_or_none("practice.weak_recent_mocks")
    unset = [k for k in WEAK_FLAGS if flags.get(k) is None]

    mastery = (
        await session.execute(
            text(
                "select m.concept_id, m.attempts, m.correct, m.mastery, m.sure_total, m.sure_correct"
                " from learn.concept_mastery m join content.exam_concepts ec"
                "   on ec.concept_id = m.concept_id and ec.exam_profile_id = :exam"
                " where m.user_id = :u"
            ),
            {"u": learner.user_id, "exam": exam},
        )
    ).all()
    stats = {r.concept_id: r for r in mastery}
    reasons: dict[
        str, list[Literal["low_accuracy", "fading", "missed_in_mock", "overconfident"]]
    ] = {}

    def add(
        concept: str, reason: Literal["low_accuracy", "fading", "missed_in_mock", "overconfident"]
    ) -> None:
        reasons.setdefault(concept, [])
        if reason not in reasons[concept]:
            reasons[concept].append(reason)

    for r in mastery:
        if (
            min_attempts is not None
            and accuracy_below is not None
            and r.attempts >= min_attempts
            and r.attempts > 0
            and r.correct / r.attempts < accuracy_below
        ):
            add(r.concept_id, "low_accuracy")
        if sure_wrong_min is not None and (r.sure_total - r.sure_correct) >= sure_wrong_min:
            add(r.concept_id, "overconfident")

    # Fading: question cards in the review queue that fall due within 3 days (FSRS due date is
    # when predicted recall reaches the target retention).
    fading = (
        await session.execute(
            text(
                "select distinct qc.concept_id from learn.srs_cards s"
                " join content.question_concepts qc on 'q:' || qc.question_id = s.card_ref"
                " where s.user_id = :u and not s.suspended and s.due_at < :until"
            ),
            {"u": learner.user_id, "until": now + timedelta(days=FADING_DAYS)},
        )
    ).scalars()
    for concept in fading:
        add(str(concept), "fading")

    if recent_mocks is not None and recent_mocks > 0:
        missed = (
            await session.execute(
                text(
                    "select distinct step ->> 'concept_id' from ("
                    "  select r.report from learn.mock_reports r join learn.mock_attempts a on a.id = r.attempt_id"
                    "   where a.user_id = :u and a.exam_profile_id = :exam order by a.started_at desc limit :n"
                    ") x, jsonb_array_elements(coalesce(x.report -> 'fix_next', '[]'::jsonb)) step"
                ),
                {"u": learner.user_id, "exam": exam, "n": recent_mocks},
            )
        ).scalars()
        for concept in missed:
            if concept:
                add(str(concept), "missed_in_mock")

    meta = {
        r.concept_id: r
        for r in (
            await session.execute(text(_CONCEPT_SQL), {"exam": exam, "ids": sorted(reasons)})
        ).all()
    }
    items: list[p.WeakSpot] = []
    for concept, why in reasons.items():
        m = meta.get(concept)
        if m is None:
            continue  # not in this exam profile
        st = stats.get(concept)
        accuracy = (st.correct / st.attempts) if st is not None and st.attempts else None
        items.append(
            p.WeakSpot(
                concept_id=concept,
                concept_name=dict(m.concept_name),
                topic_id=m.topic_id,
                topic_name=dict(m.topic_name),
                reasons=why,
                attempts=int(st.attempts) if st is not None else 0,
                accuracy=round(accuracy, 4) if accuracy is not None else None,
                mastery=float(st.mastery) if st is not None and st.mastery is not None else None,
                weightage=float(m.weightage) if m.weightage is not None else None,
                priority=m.priority,
            )
        )

    def rank(w: p.WeakSpot) -> tuple[int, float, int, float, str]:
        gap = (
            (accuracy_below - w.accuracy)
            if accuracy_below is not None and w.accuracy is not None
            else 0.0
        )
        return (
            0 if w.weightage is not None else 1,
            -(w.weightage or 0.0),
            PRIORITY_ORDER.get(w.priority, 3),
            -gap,
            w.concept_id,
        )

    items.sort(key=rank)
    needs_more: int | None = None
    if min_attempts is not None and not items:
        best = max((int(r.attempts) for r in mastery), default=0)
        needs_more = max(0, min_attempts - best) or None
    return p.WeakSpots(
        exam=exam, items=items, needs_more_answers=needs_more, unset_thresholds=unset
    )


async def get_weak_spots(db: Database, auth: AuthContext, exam: str | None) -> p.WeakSpots:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        return await weak_spots(session, learner, flags, learner.exam_or_primary(exam), now)


async def mock_in_progress(session: AsyncSession, user_id: uuid.UUID) -> p.MockInProgress | None:
    row = (
        await session.execute(
            text(
                "select id, mock_id, kind, started_at, server_deadline_at from learn.mock_attempts"
                " where user_id = :u and status = 'in_progress'"
            ),
            {"u": user_id},
        )
    ).one_or_none()
    if row is None:
        return None
    return p.MockInProgress(
        attempt_id=row.id,
        mock_id=row.mock_id,
        kind=row.kind,
        started_at=row.started_at,
        server_deadline_at=row.server_deadline_at,
    )


async def hub(db: Database, auth: AuthContext, exam: str | None) -> p.PracticeHub:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        chosen = learner.exam_or_primary(exam)
        limits = await _limits(session, learner, flags, now)
        spots = await weak_spots(session, learner, flags, chosen, now)
        card = await daily_challenge.card(session, learner, chosen, now)
        in_progress = await mock_in_progress(session, auth.user_id)
    recent = await list_sessions(db, auth, limit=5, before=None)
    return p.PracticeHub(
        exam=chosen,
        limits=limits,
        weak_spots=spots.items[:3],
        daily_challenge=card,
        recent_sessions=recent,
        mock_in_progress=in_progress,
    )


# --- PYQ ------------------------------------------------------------------------------------------


async def _exam_id(session: AsyncSession, exam_profile: str) -> str:
    exam_id = (
        await session.execute(
            text("select exam_id from content.exam_profiles where id = :p"), {"p": exam_profile}
        )
    ).scalar_one_or_none()
    if exam_id is None:
        raise not_found("exam_not_found", "No such exam profile")
    return str(exam_id)


async def _status(
    session: AsyncSession, user_id: uuid.UUID, ids: list[str]
) -> dict[str, Literal["wrong", "correct"]]:
    if not ids:
        return {}
    rows = (
        await session.execute(
            text(
                "select question_id, bool_or(is_correct) as ok from learn.question_attempts"
                " where user_id = :u and question_id = any(:ids) group by question_id"
            ),
            {"u": user_id, "ids": ids},
        )
    ).all()
    return {r.question_id: "correct" if r.ok else "wrong" for r in rows}


_PAPER_COLS = (
    "pp.id, pp.exam_id, pp.year, pp.session_label, pp.held_on, pp.paper_code, pp.source_url, pp.notes,"
    " (select count(*) from content.pyq_questions pq where pq.paper_id = pp.id) as question_count"
)


def _paper(row: Any, flags: Flags) -> p.PyqPaper:
    return p.PyqPaper(
        id=row.id,
        exam_id=row.exam_id,
        year=row.year,
        session_label=row.session_label,
        held_on=row.held_on,
        paper_code=row.paper_code,
        source_url=row.source_url,
        notes=row.notes,
        question_count=int(row.question_count),
        free_as_mock=row.id in flags.str_list("free.pyq_papers_free"),
    )


async def papers(
    db: Database, auth: AuthContext, exam: str | None, year: int | None, session_label: str | None
) -> list[p.PyqPaper]:
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        exam_id = await _exam_id(session, learner.exam_or_primary(exam))
        rows = (
            await session.execute(
                text(
                    f"select {_PAPER_COLS} from content.pyq_papers pp where pp.exam_id = :e"  # noqa: S608 - fixed columns
                    " and (cast(:y as smallint) is null or pp.year = :y)"
                    " and (cast(:s as text) is null or pp.session_label = :s)"
                    " order by pp.year desc, pp.held_on desc nulls last, pp.id"
                ),
                {"e": exam_id, "y": year, "s": session_label},
            )
        ).all()
    return [_paper(r, flags) for r in rows]


async def paper(db: Database, auth: AuthContext, paper_id: str) -> p.PyqPaperDetail:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        row = (
            await session.execute(
                text(f"select {_PAPER_COLS} from content.pyq_papers pp where pp.id = :id"),  # noqa: S608 - fixed columns
                {"id": paper_id},
            )
        ).one_or_none()
        if row is None:
            raise not_found("paper_not_found", "No such paper")
        items = (
            await session.execute(
                text(
                    "select pq.number, pq.question_id, q.type, q.difficulty_label, q.bundle_ref,"
                    " (select min(t.id) from content.question_concepts qc join content.concepts c on c.id = qc.concept_id"
                    "   join content.subtopics st on st.id = c.subtopic_id join content.topics t on t.id = st.topic_id"
                    "  where qc.question_id = q.id) as topic_id"
                    " from content.pyq_questions pq join content.questions q on q.id = pq.question_id"
                    " where pq.paper_id = :id order by pq.number"
                ),
                {"id": paper_id},
            )
        ).all()
        chapters: dict[str, str] = {
            r.id: r.chapter_id
            for r in (
                await session.execute(
                    text("select id, chapter_id from content.topics where id = any(:ids)"),
                    {"ids": [i.topic_id for i in items if i.topic_id]},
                )
            ).all()
        }
        status = await _status(session, auth.user_id, [i.question_id for i in items])
    base = _paper(row, flags)
    return p.PyqPaperDetail(
        **base.model_dump(),
        items=[
            p.PyqItem(
                number=i.number,
                question_id=i.question_id,
                type=i.type,
                difficulty=i.difficulty_label,
                topic_id=i.topic_id,
                chapter_id=chapters.get(i.topic_id) if i.topic_id else None,
                status=status.get(i.question_id, "not_tried"),
                bundle_ref=i.bundle_ref,
            )
            for i in items
        ],
    )


async def pyq_questions(
    db: Database,
    auth: AuthContext,
    *,
    exam: str | None,
    year: list[int] | None,
    session_label: str | None,
    subject: str | None,
    chapter: str | None,
    topic: str | None,
    difficulty: str | None,
    qtype: str | None,
    status: str | None,
    limit: int,
    offset: int,
) -> list[p.PyqQuestion]:
    """PRC-08 filters. Every PYQ is listed; none is locked (R25)."""
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        exam_id = await _exam_id(session, learner.exam_or_primary(exam))
        rows = (
            await session.execute(
                text(
                    """
                    select pq.question_id, pq.paper_id, pq.number, pp.year, pp.session_label,
                           q.type, q.difficulty_label, q.bundle_ref,
                           loc.topic_id, loc.chapter_id, loc.subject_id
                      from content.pyq_questions pq
                      join content.pyq_papers pp on pp.id = pq.paper_id
                      join content.questions q on q.id = pq.question_id
                      left join lateral (
                        select t.id as topic_id, ch.id as chapter_id, ch.subject_id
                          from content.question_concepts qc join content.concepts c on c.id = qc.concept_id
                          join content.subtopics st on st.id = c.subtopic_id
                          join content.topics t on t.id = st.topic_id
                          join content.chapters ch on ch.id = t.chapter_id
                         where qc.question_id = q.id order by t.id limit 1) loc on true
                     where pp.exam_id = :e
                       and (cast(:years as smallint[]) is null or pp.year = any(cast(:years as smallint[])))
                       and (cast(:s as text) is null or pp.session_label = :s)
                       and (cast(:subject as text) is null or loc.subject_id = :subject)
                       and (cast(:chapter as text) is null or loc.chapter_id = :chapter)
                       and (cast(:topic as text) is null or loc.topic_id = :topic)
                       and (cast(:d as text) is null or q.difficulty_label = :d)
                       and (cast(:t as text) is null or q.type = :t)
                     order by pp.year desc, pq.paper_id, pq.number
                    """
                ),
                {
                    "e": exam_id,
                    "years": year,
                    "s": session_label,
                    "subject": subject,
                    "chapter": chapter,
                    "topic": topic,
                    "d": difficulty,
                    "t": qtype,
                },
            )
        ).all()
        state = await _status(session, auth.user_id, [r.question_id for r in rows])
    out = [
        p.PyqQuestion(
            question_id=r.question_id,
            paper_id=r.paper_id,
            number=r.number,
            year=r.year,
            session_label=r.session_label,
            type=r.type,
            difficulty=r.difficulty_label,
            topic_id=r.topic_id,
            chapter_id=r.chapter_id,
            subject_id=r.subject_id,
            status=state.get(r.question_id, "not_tried"),
            bundle_ref=r.bundle_ref,
        )
        for r in rows
    ]
    if status:
        out = [q for q in out if q.status == status]
    return out[offset : offset + limit]
