"""Mock attempts (docs/flows/practice.md §6.2 to §6.10): the server-authoritative timer, section
locking, autosave, pause and resume, one active device, submission and the report.

Time policies (practice §6.3):

* ``strict`` and ``live``: the wall clock runs. ``server_deadline_at`` is the truth; an attempt
  past it (plus ``mock.offline_grace_s``) is auto-submitted the next time anything touches it,
  with the answers saved before the deadline.
* ``practice``: the timer stops while the student is away. Pauses move the deadline and the open
  section's end. An attempt left past its deadline with no pause recorded counts as paused from
  its last save (an interruption, MOCK-14), so it waits for the student to resume or submit.

Sections (practice §6.8): with ``section_navigation = free`` every section is open until the paper
ends. With ``locked_in_order`` and ``free_within_timer`` one section is open at a time; it closes
at its timer (the next opens at once, time doesn't wait) or by early submit when the blueprint
allows it. Answers in a closed section are frozen.

Every section closed or submitted becomes a ``mock_section_submitted`` event through the sync path,
which qualifies the streak day and pays XP once (R1).
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.schemas import mocks as m
from smriti_api.schemas.sync import MAX_EVENTS_PER_BATCH
from smriti_api.services import game_ops
from smriti_api.services import mock_paper as mp
from smriti_api.services import mock_report as mr
from smriti_api.services import question_bank as bank
from smriti_api.services.answers import AnswerFormatError, event_response, parse_answer
from smriti_api.services.server_events import ServerEvent, apply_events
from smriti_api.services.sync import MAX_AGE, MAX_FUTURE
from smriti_api.services.usage import (
    Flags,
    Learner,
    load_flags,
    load_learner,
    sectional_started_this_week,
)

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps

_COLS = (
    "id, user_id, mock_id, kind, exam_profile_id, blueprint_id, language, time_policy, paused_ms,"
    " pause_count, paused_at, active_device_id, status, section_state, started_at, submitted_at,"
    " server_deadline_at, score, max_score, attempt_no, paper, last_saved_at, created_at"
)
DB_CONFIDENCE = {"sure": "sure", "fifty_fifty": "fifty", "guess": "guess"}
WIRE_CONFIDENCE = {v: k for k, v in DB_CONFIDENCE.items()}
MAX_ANSWER_MS = 24 * 3600 * 1000


def _iso(at: datetime | None) -> str | None:
    return at.isoformat() if at else None


def _at(value: Any) -> datetime | None:
    return datetime.fromisoformat(value) if isinstance(value, str) else None


@dataclass
class _Attempt:
    """A loaded attempt with its mutable timing state."""

    row: Any
    paper: dict[str, Any]
    state: dict[str, Any]
    deadline: datetime
    paused_at: datetime | None
    paused_ms: int
    pause_count: int
    status: str

    @property
    def id(self) -> uuid.UUID:
        return uuid.UUID(str(self.row.id))

    @property
    def nav(self) -> str:
        return str(self.paper.get("navigation") or "free")

    def sections(self) -> list[dict[str, Any]]:
        return list(self.paper.get("sections") or [])

    def sec_state(self, code: str) -> dict[str, Any]:
        sections: dict[str, dict[str, Any]] = self.state.setdefault("sections", {})
        return sections.setdefault(code, {})


async def _load(
    session: AsyncSession, user_id: uuid.UUID, attempt_id: uuid.UUID, *, lock: bool = False
) -> _Attempt:
    row = (
        await session.execute(
            text(
                f"select {_COLS} from learn.mock_attempts where id = :id and user_id = :u"  # noqa: S608 - fixed column list
                + (" for update" if lock else "")
            ),
            {"id": attempt_id, "u": user_id},
        )
    ).one_or_none()
    if row is None or row.paper is None:
        raise ApiError(404, "not_found", "This attempt isn't here")
    return _Attempt(
        row=row,
        paper=dict(row.paper),
        state=json.loads(json.dumps(row.section_state or {})),
        deadline=row.server_deadline_at,
        paused_at=row.paused_at,
        paused_ms=int(row.paused_ms),
        pause_count=int(row.pause_count),
        status=row.status,
    )


def _grace(flags: Flags) -> timedelta:
    """``mock.offline_grace_s`` (owner flag). Not set: no grace beyond the deadline."""
    return timedelta(seconds=flags.int_or_none("mock.offline_grace_s") or 0)


def _initial_state(paper: Mapping[str, Any], started_at: datetime) -> dict[str, Any]:
    nav = paper.get("navigation") or "free"
    sections: dict[str, dict[str, Any]] = {}
    for i, sec in enumerate(paper.get("sections") or []):
        opened = started_at if nav == "free" or i == 0 else None
        timer = sec.get("timer_s")
        closes = (
            opened + timedelta(seconds=int(timer)) if opened and timer and nav != "free" else None
        )
        sections[sec["code"]] = {
            "opened_at": _iso(opened),
            "closes_at": _iso(closes),
            "closed_at": None,
            "closed_by": None,
        }
    first = (paper.get("sections") or [{}])[0].get("code")
    return {"current": None if nav == "free" else first, "sections": sections}


def _close(a: _Attempt, code: str, at: datetime, by: str) -> None:
    st = a.sec_state(code)
    if st.get("closed_at"):
        return
    st["closed_at"] = _iso(at)
    st["closed_by"] = by
    if a.nav == "free" or a.state.get("current") != code:
        return
    codes = [s["code"] for s in a.sections()]
    i = codes.index(code)
    if i + 1 < len(codes):
        nxt = a.sections()[i + 1]
        n = a.sec_state(nxt["code"])
        n["opened_at"] = _iso(at)
        timer = nxt.get("timer_s")
        n["closes_at"] = _iso(at + timedelta(seconds=int(timer))) if timer else None
        a.state["current"] = nxt["code"]
    else:
        a.state["current"] = None


def _clock(a: _Attempt, now: datetime) -> datetime:
    """The attempt's own time: frozen while paused (practice policy)."""
    return min(now, a.paused_at) if a.paused_at else now


def _advance(a: _Attempt, now: datetime) -> list[str]:
    """Closes sections whose timers ran out, opening the next at the same instant."""
    if a.nav == "free" or a.status != "in_progress":
        return []
    clock = _clock(a, now)
    closed = []
    while (code := a.state.get("current")) is not None:
        closes = _at(a.sec_state(code).get("closes_at"))
        if closes is None or clock < closes:
            break
        _close(a, code, closes, "timer")
        closed.append(code)
    return closed


def _interrupted(a: _Attempt, now: datetime, grace: timedelta) -> bool:
    """practice policy: past the deadline with no pause recorded means the app was away."""
    return (
        a.row.time_policy == "practice"
        and a.status == "in_progress"
        and a.paused_at is None
        and now > a.deadline + grace
    )


def _due(a: _Attempt, now: datetime, grace: timedelta) -> bool:
    if a.status != "in_progress":
        return False
    if a.nav != "free" and a.state.get("current") is None:
        return True  # every section closed by its timer
    if a.row.time_policy == "practice":
        return False
    return now > a.deadline + grace


def _section_events(
    user_id: uuid.UUID, attempt_id: uuid.UUID, codes: list[str]
) -> list[ServerEvent]:
    return [
        ServerEvent(
            game_ops.derived_event_id("mock_section", user_id, attempt_id, code),
            "mock_section_submitted",
            {"attempt_id": str(attempt_id), "section_code": code},
        )
        for code in codes
    ]


async def _already_recorded(
    session: AsyncSession, user_id: uuid.UUID, attempt_id: uuid.UUID
) -> set[str]:
    rows = (
        await session.execute(
            text(
                "select payload ->> 'section_code' from learn.sync_events where user_id = :u"
                " and type = 'mock_section_submitted' and status = 'applied'"
                " and payload ->> 'attempt_id' = :a"
            ),
            {"u": user_id, "a": str(attempt_id)},
        )
    ).scalars()
    return {str(r) for r in rows}


async def _save_state(session: AsyncSession, a: _Attempt, **extra: Any) -> None:
    sets = ", ".join(f"{k} = :{k}" for k in extra)
    await session.execute(
        text(
            "update learn.mock_attempts set section_state = cast(:st as jsonb),"  # noqa: S608 - extra keys are this module's column names
            " server_deadline_at = :dl, paused_at = :pa, paused_ms = :pm, pause_count = :pc,"
            f" status = :status{', ' + sets if sets else ''} where id = :id"
        ),
        {
            "st": json.dumps(a.state),
            "dl": a.deadline,
            "pa": a.paused_at,
            "pm": min(a.paused_ms, 2_147_483_647),
            "pc": min(a.pause_count, 32_767),
            "status": a.status,
            "id": a.id,
            **extra,
        },
    )


async def _answers(session: AsyncSession, attempt_id: uuid.UUID) -> dict[str, Any]:
    rows = (
        await session.execute(
            text(
                "select question_id, section_code, palette_status, answer, time_spent_ms, visits,"
                " first_seen_seq, answered_seq, answer_changes, confidence, client_updated_at,"
                " is_correct, marks_awarded from learn.mock_answers where attempt_id = :a"
            ),
            {"a": attempt_id},
        )
    ).all()
    return {r.question_id: r for r in rows}


async def _finalize(
    session: AsyncSession, a: _Attempt, now: datetime, status: str, flags: Flags
) -> list[str]:
    """Scores the attempt and writes the report. Returns the sections to record as submitted."""
    end = min(now, a.deadline) if status == "auto_submitted" else now
    for sec in a.sections():
        st = a.sec_state(sec["code"])
        if st.get("opened_at") and not st.get("closed_at"):
            _close(a, sec["code"], end, "submit")
    a.status = status
    if a.paused_at is not None:
        a.paused_ms += int((now - a.paused_at).total_seconds() * 1000)
        a.paused_at = None
    answers = await _answers(session, a.id)
    ids = [str(item["id"]) for _, item, _ in mp.paper_items(a.paper)]
    bodies = await bank.bodies(session, ids)
    scored = mr.score_paper(a.paper, answers, bodies)
    report = await mr.build_report(
        session,
        paper=a.paper,
        scored=scored,
        exam=a.row.exam_profile_id,
        paused_ms=a.paused_ms,
        pause_count=a.pause_count,
        time_policy=a.row.time_policy,
    )
    limit = flags.int_or_none("report.fix_next_count")
    if limit is not None:
        report["fix_next"] = report["fix_next"][:limit]
    for s in scored:
        await session.execute(
            text(
                "insert into learn.mock_answers as x (attempt_id, question_id, section_code,"
                " palette_status, time_spent_ms, client_updated_at, is_correct, marks_awarded)"
                " values (:a, :q, :sec, 'not_visited', 0, :at, :ok, :marks)"
                " on conflict (attempt_id, question_id) do update"
                " set is_correct = excluded.is_correct, marks_awarded = excluded.marks_awarded"
            ),
            {
                "a": a.id,
                "q": s.question_id,
                "sec": s.section_code,
                "at": a.row.started_at,
                "ok": s.is_correct,
                "marks": round(s.marks, 2),
            },
        )
    await session.execute(
        text(
            "insert into learn.mock_reports (attempt_id, report, report_version)"
            " values (:a, cast(:r as jsonb), :v) on conflict (attempt_id) do update"
            " set report = excluded.report, report_version = excluded.report_version,"
            " generated_at = now()"
        ),
        {"a": a.id, "r": json.dumps(report), "v": mr.REPORT_VERSION},
    )
    await _save_state(
        session,
        a,
        submitted_at=end,
        scored_at=now,
        score=report["score"],
        max_score=report["max_score"],
    )
    return [
        sec["code"] for sec in a.sections() if a.sec_state(sec["code"]).get("closed_at") is not None
    ]


@dataclass
class _Outcome:
    """What a call changed: sections to record and whether the attempt was finished."""

    sections: list[str]


async def _settle(session: AsyncSession, a: _Attempt, now: datetime, flags: Flags) -> _Outcome:
    """Brings an attempt up to date: section timers, then auto-submit when its time is over."""
    if a.status != "in_progress":
        return _Outcome([])
    closed = _advance(a, now)
    if _due(a, now, _grace(flags)):
        return _Outcome(await _finalize(session, a, now, "auto_submitted", flags))
    if closed:
        await _save_state(session, a)
    return _Outcome(closed)


async def _answer_events(
    session: AsyncSession, user_id: uuid.UUID, attempt_id: uuid.UUID
) -> list[ServerEvent]:
    """``answer_submitted`` (context ``mock``) for each scored answer of a submitted attempt that
    is not yet in ``learn.question_attempts``: mock answers update mastery once, on submit."""
    rows = (
        await session.execute(
            text(
                """
                select a.question_id, a.answer, a.is_correct, a.time_spent_ms, a.confidence
                  from learn.mock_answers a
                  join learn.mock_attempts m on m.id = a.attempt_id
                 where m.id = :a and m.user_id = :u
                   and m.status in ('submitted', 'auto_submitted')
                   and a.answer is not null and a.is_correct is not null
                   and not exists (select 1 from learn.question_attempts q
                                    where q.user_id = :u and q.session_id = :a
                                      and q.question_id = a.question_id and q.context = 'mock')
                 order by a.question_id
                """
            ),
            {"a": attempt_id, "u": user_id},
        )
    ).all()
    return [
        ServerEvent(
            game_ops.derived_event_id("mock_answer", user_id, attempt_id, r.question_id),
            "answer_submitted",
            {
                "question_id": r.question_id,
                "context": "mock",
                "attempt_id": str(attempt_id),
                "response": event_response(r.answer),
                "correct": bool(r.is_correct),
                "attempt": 1,
                "confidence": WIRE_CONFIDENCE.get(r.confidence) if r.confidence else None,
                "ms_to_answer": max(0, min(int(r.time_spent_ms or 0), MAX_ANSWER_MS)),
            },
        )
        for r in rows
    ]


async def _apply_ignoring_duplicates(
    db: Database, auth: AuthContext, events: list[ServerEvent], device_id: uuid.UUID | None
) -> None:
    for i in range(0, len(events), MAX_EVENTS_PER_BATCH):
        try:
            await apply_events(db, auth, events[i : i + MAX_EVENTS_PER_BATCH], device_id=device_id)
        except ApiError as exc:
            # The device's outbox recorded it first: it already counts once.
            if exc.code != "already_recorded":
                raise


async def _record(
    db: Database,
    auth: AuthContext,
    attempt_id: uuid.UUID,
    codes: list[str],
    device_id: uuid.UUID | None,
) -> None:
    """Records closed sections (XP, the streak day) and, once the attempt is submitted, its
    answers (mastery) through the sync path."""
    async with db.system_tx() as session:
        done = await _already_recorded(session, auth.user_id, attempt_id) if codes else set()
        answers = await _answer_events(session, auth.user_id, attempt_id)
    fresh = [c for c in dict.fromkeys(codes) if c not in done]
    if fresh:
        await _apply_ignoring_duplicates(
            db, auth, _section_events(auth.user_id, attempt_id, fresh), device_id
        )
    if answers:
        await _apply_ignoring_duplicates(db, auth, answers, device_id)


async def _settle_open(
    session: AsyncSession, user_id: uuid.UUID, now: datetime, flags: Flags
) -> list[tuple[uuid.UUID, list[str]]]:
    """Auto-submits this student's in-progress attempts whose time is over."""
    ids = (
        await session.execute(
            text(
                "select id from learn.mock_attempts where user_id = :u and status = 'in_progress'"
                " for update"
            ),
            {"u": user_id},
        )
    ).scalars()
    out = []
    for attempt_id in list(ids):
        a = await _load(session, user_id, attempt_id)
        res = await _settle(session, a, now, flags)
        out.append((a.id, res.sections))
    return out


# --- views --------------------------------------------------------------------------------------


def _section_view(a: _Attempt, answered: Mapping[str, int]) -> list[m.AttemptSection]:
    out = []
    for sec in a.sections():
        st = a.sec_state(sec["code"])
        status = (
            "closed" if st.get("closed_at") else ("open" if st.get("opened_at") else "upcoming")
        )
        if a.status != "in_progress":
            status = "closed"
        out.append(
            m.AttemptSection(
                code=sec["code"],
                title=dict(sec.get("title") or {}),
                status=status,
                opened_at=_at(st.get("opened_at")),
                closes_at=_at(st.get("closes_at")),
                closed_at=_at(st.get("closed_at")),
                closed_by=st.get("closed_by"),
                question_ids=[str(q["id"]) for q in sec["questions"]],
                attempt_any=sec.get("attempt_any"),
                over_attempt=sec.get("over_attempt"),
                answered=answered.get(sec["code"], 0),
            )
        )
    return out


def _answered_counts(answers: Mapping[str, Any]) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in answers.values():
        if r.answer is not None and r.palette_status in mr.ANSWERED:
            out[r.section_code] = out.get(r.section_code, 0) + 1
    return out


def _saved(r: Any) -> m.SavedAnswer:
    return m.SavedAnswer(
        answer=dict(r.answer) if r.answer is not None else None,
        palette_status=r.palette_status,
        time_spent_ms=r.time_spent_ms,
        visits=r.visits,
        answer_changes=r.answer_changes,
        first_seen_seq=r.first_seen_seq,
        answered_seq=r.answered_seq,
        confidence=mr.WIRE_CONFIDENCE.get(r.confidence) if r.confidence else None,
        client_updated_at=r.client_updated_at,
    )


async def _view(
    session: AsyncSession,
    a: _Attempt,
    now: datetime,
    flags: Flags,
    device_id: uuid.UUID | None,
    *,
    with_questions: bool,
) -> m.Attempt:
    answers = await _answers(session, a.id)
    grace = _grace(flags)
    interrupted = _interrupted(a, now, grace)
    clock = a.paused_at or (a.row.last_saved_at or a.row.started_at if interrupted else now)
    remaining = max(0, int((a.deadline - clock).total_seconds() * 1000))
    questions = None
    if with_questions:
        items = mp.paper_items(a.paper)
        bodies = await bank.bodies(session, [str(i["id"]) for _, i, _ in items])
        locale = a.row.language if a.paper.get("language_switch") == "fixed" else None
        questions = [
            m.AttemptQuestion(
                question_id=str(item["id"]),
                section_code=str(sec["code"]),
                position=pos,
                type=str(item["type"]),
                marking=m.MarkingOut(**item["marking"]),
                body=bank.public_body(bodies.get(str(item["id"]), {}), locale),
                saved=_saved(answers[str(item["id"])]) if str(item["id"]) in answers else None,
            )
            for sec, item, pos in items
        ]
    active = a.row.active_device_id
    return m.Attempt(
        id=a.id,
        mock_id=a.row.mock_id,
        kind=a.row.kind,
        exam_profile_id=a.row.exam_profile_id,
        blueprint_id=a.row.blueprint_id,
        title=dict(a.paper.get("title") or {}),
        status=a.status,
        attempt_no=a.row.attempt_no,
        time_policy=a.row.time_policy,
        language=a.row.language,
        language_switch=a.paper.get("language_switch", "per_question"),
        calculator=str(a.paper.get("calculator", "none")),
        interface=str(a.paper.get("interface", "generic")),
        interface_profile=a.paper.get("interface_profile"),
        section_navigation=a.nav,
        early_section_submit=a.paper.get("early_section_submit"),
        marked_answer_evaluated=bool(a.paper.get("marked_answer_evaluated", True)),
        started_at=a.row.started_at,
        server_deadline_at=a.deadline,
        server_time=now,
        remaining_ms=remaining,
        paused=a.paused_at is not None or interrupted,
        paused_ms=a.paused_ms,
        pause_count=a.pause_count,
        active_device=None
        if active is None or device_id is None
        else ("this" if active == device_id else "other"),
        submitted_at=a.row.submitted_at,
        score=float(a.row.score) if a.row.score is not None else None,
        max_score=float(a.row.max_score) if a.row.max_score is not None else None,
        sections=_section_view(a, _answered_counts(answers)),
        questions=questions,
    )


# --- catalogue ----------------------------------------------------------------------------------


async def _sectional_used(
    session: AsyncSession, learner: Learner, now: datetime, flags: Flags
) -> int:
    return await sectional_started_this_week(session, learner.user_id, now, flags)


def _access_out(a: mp.Access) -> m.MockAccess:
    return m.MockAccess(
        allowed=a.allowed,
        paywall_trigger=None if a.allowed else "mock_limit",
        paywall_source=a.paywall_source if not a.allowed else None,
        reason=a.reason,
    )


def _ref_access(ref: mp.MockRef, learner: Learner, flags: Flags, sectional: int) -> mp.Access:
    return mp.access(
        ref.kind,
        learner,
        flags,
        is_free_sample=ref.is_free,
        paper_id=ref.paper_id,
        sectional_started=sectional,
    )


def _card(
    ref: mp.MockRef, acc: mp.Access, attempts: int, in_progress: uuid.UUID | None
) -> m.MockCard:
    spec = ref.blueprint.spec
    sec = ref.blueprint.section(ref.section_code) if ref.section_code else None
    if sec is not None:
        duration_s = mp.section_duration_s(ref.blueprint, sec)
        count = int(sec["question_count"])
        marks = None
    else:
        duration_s = int(spec["duration_min"]) * 60
        count = int(spec["question_count"])
        marks = float(spec["max_marks"]) if spec.get("max_marks") is not None else None
    return m.MockCard(
        id=ref.id,
        kind=ref.kind,
        exam_profile_id=ref.exam_profile_id,
        title=ref.title,
        blueprint_id=ref.blueprint.id,
        paper_code=ref.blueprint.paper_code,
        section_code=ref.section_code,
        duration_min=duration_s // 60,
        question_count=count,
        max_marks=marks,
        is_free=ref.is_free,
        access=_access_out(acc),
        window_start=ref.window_start,
        window_end=ref.window_end,
        results_at=ref.results_at,
        attempts=attempts,
        in_progress_attempt_id=in_progress,
        ranked=ref.ranked,
    )


async def _attempt_counts(
    session: AsyncSession, user_id: uuid.UUID
) -> tuple[dict[str, int], dict[str, uuid.UUID]]:
    rows = (
        await session.execute(
            text(
                "select mock_id, count(*) filter (where status <> 'abandoned') as n,"
                " (array_agg(id) filter (where status = 'in_progress'))[1] as open_id"
                " from learn.mock_attempts where user_id = :u and mock_id is not null group by mock_id"
            ),
            {"u": user_id},
        )
    ).all()
    return {r.mock_id: int(r.n) for r in rows}, {r.mock_id: r.open_id for r in rows if r.open_id}


async def list_mocks(db: Database, auth: AuthContext, exam: str | None) -> list[m.MockCard]:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        exam_id = learner.exam_or_primary(exam)
        sectional = await _sectional_used(session, learner, now, flags)
        counts, open_ids = await _attempt_counts(session, auth.user_id)
        refs = await mp.catalogue(session, exam_id, learner.today(now))
        return [
            _card(
                ref,
                _ref_access(ref, learner, flags, sectional),
                counts.get(ref.id, 0),
                open_ids.get(ref.id),
            )
            for ref in refs
            if ref.kind != "live" or flags.bool("live.enabled")
        ]


def _summary(r: Any) -> m.AttemptSummary:
    return m.AttemptSummary(
        id=r.id,
        mock_id=r.mock_id,
        kind=r.kind,
        title=dict((r.paper or {}).get("title") or {}),
        status=r.status,
        attempt_no=r.attempt_no,
        started_at=r.started_at,
        submitted_at=r.submitted_at,
        score=float(r.score) if r.score is not None else None,
        max_score=float(r.max_score) if r.max_score is not None else None,
    )


async def get_mock(db: Database, auth: AuthContext, mock_id: str) -> m.MockDetail:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        ref = await mp.resolve(session, mock_id, learner.today(now))
        sectional = await _sectional_used(session, learner, now, flags)
        past = (
            await session.execute(
                text(
                    "select id, mock_id, kind, paper, status, attempt_no, started_at, submitted_at,"
                    " score, max_score from learn.mock_attempts where user_id = :u and mock_id = :m"
                    " order by started_at desc limit 20"
                ),
                {"u": auth.user_id, "m": ref.id},
            )
        ).all()
        acc = _ref_access(ref, learner, flags, sectional)
        open_id = next((p.id for p in past if p.status == "in_progress"), None)
        card = _card(ref, acc, sum(1 for p in past if p.status != "abandoned"), open_id)
        bp = ref.blueprint
        spec = bp.spec
        sections = [bp.section(ref.section_code)] if ref.section_code else bp.sections
        source = spec.get("source") or {}
        return m.MockDetail(
            **card.model_dump(),
            mode=spec.get("mode", "cbt"),
            languages=list(spec.get("languages") or []),
            language_switch=spec.get("language_switch", "per_question"),
            calculator=str(spec.get("calculator", "none")),
            interface=str(spec.get("interface", "generic")),
            interface_profile=spec.get("interface_profile"),
            section_navigation="free"
            if ref.section_code
            else spec.get("section_navigation", "free"),
            early_section_submit=spec.get("early_section_submit"),
            marked_answer_evaluated=bp.marked_answer_evaluated,
            sections=[
                m.MockSection(
                    code=s["code"],
                    title=dict(s.get("title") or {}),
                    subject_id=s.get("subject"),
                    question_count=int(s["question_count"]),
                    question_types=list(s.get("question_types") or []),
                    type_counts=s.get("type_counts"),
                    timer_min=s.get("timer_min"),
                    attempt_any=(s.get("attempt_rule") or {}).get("attempt_any"),
                    over_attempt=(s.get("attempt_rule") or {}).get("over_attempt"),
                    marking={k: m.MarkingOut(**v) for k, v in (s.get("marking") or {}).items()},
                )
                for s in sections
                if s is not None
            ],
            instructions=dict(spec.get("instructions") or {}),
            qualifying=spec.get("qualifying"),
            source=m.BlueprintSource(
                title=str(source.get("title", "")),
                url=str(source.get("url", bp.source_url)),
                published=source.get("published"),
            ),
            verified_at=str(spec.get("verified_at", bp.verified_at.isoformat())),
            past_attempts=[_summary(p) for p in past],
        )


async def list_attempts(
    db: Database, auth: AuthContext, limit: int, before: datetime | None
) -> list[m.AttemptSummary]:
    async with db.user_tx(auth.claims) as session:
        rows = (
            await session.execute(
                text(
                    "select id, mock_id, kind, paper, status, attempt_no, started_at, submitted_at,"
                    " score, max_score from learn.mock_attempts"
                    " where user_id = :u and status <> 'abandoned'"
                    " and (cast(:b as timestamptz) is null or started_at < :b)"
                    " order by started_at desc limit :n"
                ),
                {"u": auth.user_id, "b": before, "n": limit},
            )
        ).all()
    return [_summary(r) for r in rows]


# --- starting -----------------------------------------------------------------------------------


def _plausible_start(requested: datetime | None, now: datetime) -> datetime:
    """An offline start is accepted with the device's time when it is neither in the future nor
    older than the sync window (practice §6.2)."""
    if requested is None:
        return now
    if requested > now + MAX_FUTURE or requested < now - MAX_AGE:
        raise ApiError(422, "implausible_start", "That start time doesn't look right")
    return min(requested, now)


async def _existing(
    session: AsyncSession, user_id: uuid.UUID, attempt_id: uuid.UUID
) -> _Attempt | None:
    owner = (
        await session.execute(
            text("select user_id from learn.mock_attempts where id = :id"), {"id": attempt_id}
        )
    ).scalar_one_or_none()
    if owner is None:
        return None
    if owner != user_id:
        raise ApiError(409, "attempt_id_taken", "Use a new attempt id")
    return await _load(session, user_id, attempt_id, lock=True)


async def _guard_open(session: AsyncSession, user_id: uuid.UUID) -> None:
    open_id = (
        await session.execute(
            text(
                "select id from learn.mock_attempts where user_id = :u and status = 'in_progress'"
            ),
            {"u": user_id},
        )
    ).scalar_one_or_none()
    if open_id is not None:
        raise ApiError(
            409,
            "mock_in_progress",
            "Finish or leave the mock you started first",
            attempt_id=str(open_id),
        )


async def _insert(
    session: AsyncSession,
    *,
    attempt_id: uuid.UUID,
    user_id: uuid.UUID,
    mock_id: str | None,
    kind: str,
    exam: str,
    bp: mp.Blueprint,
    paper: dict[str, Any],
    language: str,
    time_policy: str,
    started_at: datetime,
    deadline: datetime,
    device_id: uuid.UUID | None,
    generated_spec: dict[str, Any] | None = None,
) -> None:
    attempt_no = 1
    if mock_id is not None:
        attempt_no += int(
            (
                await session.execute(
                    text(
                        "select count(*) from learn.mock_attempts where user_id = :u"
                        " and mock_id = :m and status <> 'abandoned'"
                    ),
                    {"u": user_id, "m": mock_id},
                )
            ).scalar_one()
        )
    try:
        async with session.begin_nested():
            await session.execute(
                text(
                    """
                    insert into learn.mock_attempts
                      (id, user_id, mock_id, generated_spec, blueprint_id, language, time_policy,
                       active_device_id, status, section_state, started_at, server_deadline_at,
                       kind, exam_profile_id, attempt_no, paper, last_saved_at)
                    values (:id, :u, :m, cast(:gen as jsonb), :bp, :lang, :tp, :dev, 'in_progress',
                            cast(:st as jsonb), :start, :dl, :kind, :exam, :no, cast(:paper as jsonb),
                            :start)
                    """
                ),
                {
                    "id": attempt_id,
                    "u": user_id,
                    "m": mock_id,
                    "gen": json.dumps(generated_spec) if generated_spec is not None else None,
                    "bp": bp.id,
                    "lang": language,
                    "tp": time_policy,
                    "dev": device_id,
                    "st": json.dumps(_initial_state(paper, started_at)),
                    "start": started_at,
                    "dl": deadline,
                    "kind": kind,
                    "exam": exam,
                    "no": min(attempt_no, 32_767),
                    "paper": json.dumps(paper),
                },
            )
    except IntegrityError as exc:
        raise ApiError(
            409, "mock_in_progress", "Finish or leave the mock you started first"
        ) from exc


def _check_language(bp: mp.Blueprint, language: str) -> None:
    if language not in (bp.spec.get("languages") or []):
        raise ApiError(422, "language_unavailable", "This paper isn't offered in that language")


async def start(
    db: Database,
    auth: AuthContext,
    mock_id: str,
    body: m.AttemptCreate,
    device_id: uuid.UUID | None,
) -> m.Attempt:
    now = datetime.now(UTC)
    settled: list[tuple[uuid.UUID, list[str]]] = []
    async with db.system_tx() as session:
        flags = await load_flags(session)
        existing = await _existing(session, auth.user_id, body.attempt_id)
        if existing is not None:
            if existing.row.mock_id != mock_id:
                raise ApiError(409, "attempt_id_taken", "Use a new attempt id")
            return await _view(session, existing, now, flags, device_id, with_questions=True)
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        ref = await mp.resolve(session, mock_id, learner.today(now))
        _check_language(ref.blueprint, body.language)
        started_at = _plausible_start(body.started_at, now)
        settled = await _settle_open(session, auth.user_id, now, flags)
        await _guard_open(session, auth.user_id)
        acc = _ref_access(ref, learner, flags, await _sectional_used(session, learner, now, flags))
        if not acc.allowed:
            raise _locked(acc, ref.kind)
        paper = await mp.build_paper(session, ref, auth.user_id, str(body.attempt_id))
        time_policy: str = body.time_policy
        deadline = started_at + timedelta(seconds=int(paper["duration_s"]))
        if ref.kind == "live":
            if (
                ref.window_start is None
                or ref.window_end is None
                or not (ref.window_start <= started_at < ref.window_end)
            ):
                raise ApiError(409, "window_closed", "This live mock isn't open right now")
            time_policy = "live"
            # Starting late in the window ends at the window's close (practice §6.11).
            deadline = min(deadline, ref.window_end)
        kind = "sectional" if ref.kind == "full" and ref.section_code else ref.kind
        await _insert(
            session,
            attempt_id=body.attempt_id,
            user_id=auth.user_id,
            mock_id=ref.id,
            kind=kind,
            exam=ref.exam_profile_id,
            bp=ref.blueprint,
            paper=paper,
            language=body.language,
            time_policy=time_policy,
            started_at=started_at,
            deadline=deadline,
            device_id=device_id,
        )
        a = await _load(session, auth.user_id, body.attempt_id)
        await _settle(session, a, now, flags)
        view = await _view(session, a, now, flags, device_id, with_questions=True)
    for attempt_id, codes in settled:
        await _record(db, auth, attempt_id, codes, device_id)
    return view


def _locked(acc: mp.Access, kind: str) -> ApiError:
    quota_bound = kind in ("sectional", "chapter") and acc.paywall_source == "mock_lock"
    return ApiError(
        403,
        "free_limit_reached" if quota_bound else "pro_required",
        "This week's free sectional mock is used" if quota_bound else "This mock is part of Pro",
        paywall_trigger="mock_limit",
        paywall_source=acc.paywall_source,
    )


async def generate(
    db: Database, auth: AuthContext, body: m.GenerateMock, device_id: uuid.UUID | None
) -> m.Attempt:
    now = datetime.now(UTC)
    settled: list[tuple[uuid.UUID, list[str]]] = []
    async with db.system_tx() as session:
        flags = await load_flags(session)
        existing = await _existing(session, auth.user_id, body.attempt_id)
        if existing is not None:
            return await _view(session, existing, now, flags, device_id, with_questions=True)
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        exam = learner.exam_or_primary(body.exam)
        blueprints = await mp.active_blueprints(session, exam, learner.today(now))
        bp = next((b for b in blueprints if body.paper_code in (None, b.paper_code)), None)
        if bp is None:
            raise ApiError(409, "mock_unavailable", "There's no exam pattern for this yet")
        _check_language(bp, body.language)
        if body.kind == "custom" and not body.concepts and not body.chapter_id:
            raise ApiError(422, "scope_required", "Pick the concepts or a chapter")
        settled = await _settle_open(session, auth.user_id, now, flags)
        await _guard_open(session, auth.user_id)
        acc = mp.access(
            body.kind,
            learner,
            flags,
            is_free_sample=False,
            paper_id=None,
            sectional_started=await _sectional_used(session, learner, now, flags),
        )
        if not acc.allowed:
            raise _locked(acc, body.kind)
        spec = body.model_dump(mode="json", exclude={"attempt_id", "language", "time_policy"})
        paper = await mp.generated_paper(
            session,
            bp,
            title={"en": bp.paper_code, "hi": bp.paper_code},
            concepts=body.concepts,
            chapter_id=body.chapter_id,
            count=body.question_count,
            user_id=auth.user_id,
            seed=str(body.attempt_id),
        )
        await _insert(
            session,
            attempt_id=body.attempt_id,
            user_id=auth.user_id,
            mock_id=None,
            kind=body.kind,
            exam=exam,
            bp=bp,
            paper=paper,
            language=body.language,
            time_policy=body.time_policy,
            started_at=now,
            deadline=now + timedelta(seconds=int(paper["duration_s"])),
            device_id=device_id,
            generated_spec=spec,
        )
        a = await _load(session, auth.user_id, body.attempt_id)
        view = await _view(session, a, now, flags, device_id, with_questions=True)
    for attempt_id, codes in settled:
        await _record(db, auth, attempt_id, codes, device_id)
    return view


# --- the running attempt ------------------------------------------------------------------------


async def _with_attempt(
    db: Database,
    auth: AuthContext,
    attempt_id: uuid.UUID,
    device_id: uuid.UUID | None,
    action: Any,
    *,
    with_questions: bool = False,
) -> m.Attempt:
    """Settles an attempt (timers, auto-submit), then runs ``action`` on it and records closed
    sections. Settling commits on its own, so an action refused afterwards (say, a pause on a
    paper whose time just ran out) never undoes the auto-submit."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        a = await _load(session, auth.user_id, attempt_id, lock=True)
        codes = (await _settle(session, a, now, flags)).sections
    try:
        async with db.system_tx() as session:
            a = await _load(session, auth.user_id, attempt_id, lock=True)
            if action is not None:
                codes += await action(session, a, now, flags)
            a = await _load(session, auth.user_id, attempt_id)
            view = await _view(session, a, now, flags, device_id, with_questions=with_questions)
    finally:
        await _record(db, auth, attempt_id, codes, device_id)
    return view


async def get_attempt(
    db: Database, auth: AuthContext, attempt_id: uuid.UUID, device_id: uuid.UUID | None
) -> m.Attempt:
    return await _with_attempt(db, auth, attempt_id, device_id, None, with_questions=True)


def _require_open(a: _Attempt) -> None:
    if a.status != "in_progress":
        raise ApiError(
            409, "attempt_closed", "This mock is already submitted", attempt_status=a.status
        )


def _require_device(a: _Attempt, device_id: uuid.UUID | None) -> None:
    active = a.row.active_device_id
    if active is not None and device_id is not None and active != device_id:
        raise ApiError(
            409,
            "other_device",
            "This mock is open on another device",
            detail="Take it over to continue here",
        )


async def pause(
    db: Database,
    auth: AuthContext,
    attempt_id: uuid.UUID,
    at: datetime | None,
    device_id: uuid.UUID | None,
) -> m.Attempt:
    async def run(session: AsyncSession, a: _Attempt, now: datetime, flags: Flags) -> list[str]:
        _require_open(a)
        _require_device(a, device_id)
        if a.row.time_policy != "practice":
            raise ApiError(409, "pause_not_allowed", "The timer keeps running in exam-day mode")
        if a.paused_at is None:
            # The device may report when it went away (app killed, call); never before the start
            # or the last resume, never in the future.
            floor = _at(a.state.get("resumed_at")) or a.row.started_at
            when = now if at is None else max(floor, min(at, now))
            if _interrupted(a, now, _grace(flags)):
                when = a.row.last_saved_at or a.row.started_at
            a.paused_at = when
            await _save_state(session, a)
        return []

    return await _with_attempt(db, auth, attempt_id, device_id, run)


async def resume(
    db: Database, auth: AuthContext, attempt_id: uuid.UUID, device_id: uuid.UUID | None
) -> m.Attempt:
    async def run(session: AsyncSession, a: _Attempt, now: datetime, flags: Flags) -> list[str]:
        _require_open(a)
        _require_device(a, device_id)
        paused_from = a.paused_at
        if paused_from is None and _interrupted(a, now, _grace(flags)):
            paused_from = a.row.last_saved_at or a.row.started_at
        if paused_from is None:
            return []
        delta = now - paused_from
        a.deadline += delta
        current = a.state.get("current")
        if current:
            st = a.sec_state(current)
            if st.get("closes_at"):
                closes = _at(st["closes_at"])
                st["closes_at"] = _iso(closes + delta if closes else None)
        a.paused_ms += int(delta.total_seconds() * 1000)
        a.pause_count += 1
        a.paused_at = None
        a.state["resumed_at"] = _iso(now)
        await _save_state(session, a)
        return []

    return await _with_attempt(db, auth, attempt_id, device_id, run, with_questions=True)


async def takeover(
    db: Database, auth: AuthContext, attempt_id: uuid.UUID, device_id: uuid.UUID | None
) -> m.Attempt:
    """Moves the attempt to this device; the other becomes read-only on its next sync."""
    if device_id is None:
        raise ApiError(422, "device_required", "Send X-Device-Id to continue here")

    async def run(session: AsyncSession, a: _Attempt, now: datetime, flags: Flags) -> list[str]:
        _require_open(a)
        await session.execute(
            text("update learn.mock_attempts set active_device_id = :d where id = :id"),
            {"d": device_id, "id": a.id},
        )
        return []

    return await _with_attempt(db, auth, attempt_id, device_id, run, with_questions=True)


async def submit_section(
    db: Database,
    auth: AuthContext,
    attempt_id: uuid.UUID,
    section_code: str,
    device_id: uuid.UUID | None,
) -> m.Attempt:
    """Early submit of the open section, when the blueprint allows it (or the section has no
    timer of its own, so the student isn't stuck)."""

    async def run(session: AsyncSession, a: _Attempt, now: datetime, flags: Flags) -> list[str]:
        _require_open(a)
        _require_device(a, device_id)
        if a.nav == "free":
            raise ApiError(409, "not_sectioned", "Sections stay open until you submit the paper")
        if a.state.get("current") != section_code:
            raise ApiError(409, "section_not_open", "That section isn't the open one")
        sec = next(s for s in a.sections() if s["code"] == section_code)
        if a.paper.get("early_section_submit") is not True and sec.get("timer_s"):
            raise ApiError(409, "early_submit_not_allowed", "This section ends when its timer does")
        _close(a, section_code, _clock(a, now), "student")
        if a.state.get("current") is None:
            return await _finalize(session, a, now, "submitted", flags)
        await _save_state(session, a)
        return [section_code]

    return await _with_attempt(db, auth, attempt_id, device_id, run)


async def abandon(
    db: Database, auth: AuthContext, attempt_id: uuid.UUID, device_id: uuid.UUID | None
) -> m.Attempt:
    """MOCK-15 Leave and discard. Left in the first ``mock.free_grace_min`` minutes, a free
    sectional mock is refunded once a week (``usage.sectional_started_this_week``)."""

    async def run(session: AsyncSession, a: _Attempt, now: datetime, flags: Flags) -> list[str]:
        _require_open(a)
        a.status = "abandoned"
        a.paused_at = None
        await _save_state(session, a, submitted_at=now)
        return []

    return await _with_attempt(db, auth, attempt_id, device_id, run)


async def save_answers(
    db: Database,
    auth: AuthContext,
    attempt_id: uuid.UUID,
    body: m.AnswersPut,
    device_id: uuid.UUID | None,
) -> m.SaveResult:
    """Autosave (practice §6.6): ``client_updated_at`` decides the winner per question."""
    now = datetime.now(UTC)
    saved: list[str] = []
    kept: list[str] = []
    rejected: list[m.RejectedRow] = []
    async with db.system_tx() as session:
        flags = await load_flags(session)
        grace = _grace(flags)
        a = await _load(session, auth.user_id, attempt_id, lock=True)
        _require_open(a)
        _require_device(a, device_id)
        closed = _advance(a, now)
        items = {str(item["id"]): (sec, item) for sec, item, _ in mp.paper_items(a.paper)}
        existing = await _answers(session, a.id)
        counts = _answered_counts(existing)
        for row in sorted(body.answers, key=lambda r: r.client_updated_at):
            code = _reject_code(a, row, items, now, grace)
            entry = items.get(row.question_id)
            if code is None and entry is not None:
                sec, _item = entry
                status, answered = _palette(row)
                prev = existing.get(row.question_id)
                was = (
                    prev is not None
                    and prev.answer is not None
                    and prev.palette_status in mr.ANSWERED
                )
                limit = sec.get("attempt_any")
                if (
                    answered
                    and not was
                    and limit
                    and sec.get("over_attempt") == "block"
                    and counts.get(sec["code"], 0) >= int(limit)
                ):
                    code = "over_attempt"
                else:
                    wrote = await _upsert(session, a.id, sec["code"], row, status)
                    if wrote:
                        saved.append(row.question_id)
                        counts[sec["code"]] = counts.get(sec["code"], 0) + int(answered) - int(was)
                        existing[row.question_id] = _Prev(row.answer, status)
                    else:
                        kept.append(row.question_id)
            if code is not None:
                rejected.append(m.RejectedRow(question_id=row.question_id, code=code))
        await _save_state(session, a, last_saved_at=now)
        sections = _section_view(a, counts)
        deadline, status = a.deadline, a.status
    await _record(db, auth, attempt_id, closed, device_id)
    return m.SaveResult(
        saved=saved,
        kept_newer=kept,
        rejected=rejected,
        server_time=now,
        server_deadline_at=deadline,
        status=status,
        sections=sections,
    )


@dataclass
class _Prev:
    answer: Any
    palette_status: str


def _palette(row: m.AnswerSave) -> tuple[str, bool]:
    """A palette state that matches the answer: no answer can't be "answered"."""
    status = row.palette_status
    if row.answer is None and status == "answered":
        status = "not_answered"
    elif row.answer is None and status == "answered_marked":
        status = "marked"
    return status, row.answer is not None and status in mr.ANSWERED


def _reject_code(
    a: _Attempt,
    row: m.AnswerSave,
    items: Mapping[str, tuple[Mapping[str, Any], Mapping[str, Any]]],
    now: datetime,
    grace: timedelta,
) -> str | None:
    entry = items.get(row.question_id)
    if entry is None:
        return "not_in_paper"
    at = row.client_updated_at
    if at > now + MAX_FUTURE:
        return "clock_skew"
    if at > a.deadline + grace:
        return "after_deadline"
    sec, item = entry
    st = a.sec_state(str(sec["code"]))
    opened = _at(st.get("opened_at"))
    closed = _at(st.get("closed_at"))
    if opened is None:
        return "section_locked"
    if closed is not None and at > closed + grace:
        return "section_closed"
    if row.answer is not None:
        if mp.ANSWER_KIND.get(str(item["type"])) != row.answer.kind:
            return "invalid_answer"
        try:
            parse_answer(row.answer.model_dump())
        except (AnswerFormatError, KeyError, TypeError):
            return "invalid_answer"
    return None


async def _upsert(
    session: AsyncSession, attempt_id: uuid.UUID, section_code: str, row: m.AnswerSave, status: str
) -> bool:
    result = await session.execute(
        text(
            """
            insert into learn.mock_answers as x
              (attempt_id, question_id, section_code, palette_status, answer, time_spent_ms, visits,
               first_seen_seq, answered_seq, answer_changes, confidence, client_updated_at)
            values (:a, :q, :sec, :ps, cast(:ans as jsonb), :t, :v, :fs, :as_, :ch, :conf, :at)
            on conflict (attempt_id, question_id) do update set
              palette_status = excluded.palette_status, answer = excluded.answer,
              time_spent_ms = excluded.time_spent_ms, visits = excluded.visits,
              first_seen_seq = excluded.first_seen_seq, answered_seq = excluded.answered_seq,
              answer_changes = excluded.answer_changes, confidence = excluded.confidence,
              client_updated_at = excluded.client_updated_at
             where x.client_updated_at < excluded.client_updated_at
            returning question_id
            """
        ),
        {
            "a": attempt_id,
            "q": row.question_id,
            "sec": section_code,
            "ps": status,
            "ans": json.dumps(row.answer.model_dump()) if row.answer is not None else None,
            "t": row.time_spent_ms,
            "v": row.visits,
            "fs": row.first_seen_seq,
            "as_": row.answered_seq,
            "ch": row.answer_changes,
            "conf": DB_CONFIDENCE.get(row.confidence) if row.confidence else None,
            "at": row.client_updated_at,
        },
    )
    return result.first() is not None


# --- submit and report --------------------------------------------------------------------------


async def submit(
    db: Database, auth: AuthContext, attempt_id: uuid.UUID, device_id: uuid.UUID | None
) -> m.Report:
    """MOCK-16 Submit. Submitting again returns the same report."""
    now = datetime.now(UTC)
    codes: list[str] = []
    async with db.system_tx() as session:
        flags = await load_flags(session)
        a = await _load(session, auth.user_id, attempt_id, lock=True)
        if a.status == "abandoned":
            raise ApiError(409, "attempt_closed", "This mock was left", attempt_status=a.status)
        codes = (await _settle(session, a, now, flags)).sections
        if a.status == "in_progress":
            _require_device(a, device_id)
            codes += await _finalize(session, a, now, "submitted", flags)
    await _record(db, auth, attempt_id, codes, device_id)
    return await report(db, auth, attempt_id)


async def report(db: Database, auth: AuthContext, attempt_id: uuid.UUID) -> m.Report:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        a = await _load(session, auth.user_id, attempt_id, lock=True)
        codes = (await _settle(session, a, now, flags)).sections
        if a.status in ("in_progress", "abandoned"):
            raise ApiError(
                409,
                "report_not_ready",
                "Submit the mock to see the report",
                attempt_status=a.status,
            )
        row = (
            await session.execute(
                text("select report, generated_at from learn.mock_reports where attempt_id = :a"),
                {"a": a.id},
            )
        ).one_or_none()
        if row is None:
            raise ApiError(409, "report_not_ready", "The report is being prepared")
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        window: tuple[datetime | None, datetime | None] = (None, None)
        results_at = None
        if a.row.kind == "live" and a.row.mock_id:
            live = (
                await session.execute(
                    text(
                        "select window_start, window_end, results_at from content.mocks where id = :m"
                    ),
                    {"m": a.row.mock_id},
                )
            ).one_or_none()
            if live is not None:
                window, results_at = (live.window_start, live.window_end), live.results_at
        stored = dict(row.report)
        stored["standing"] = (
            await mr.standing(
                session,
                attempt_id=a.id,
                paper_key=a.paper.get("key"),
                attempt_no=int(a.row.attempt_no),
                score=float(stored["score"]) if stored.get("score") is not None else None,
                flags=flags,
                results_at=results_at,
                window=window,
                now=now,
            )
        ).model_dump()
        shown, locked = mr.gate(stored, learner.is_pro, flags.str_list("free.mock_report_sections"))
        fields = set(m.Report.model_fields)
        out = m.Report(
            attempt_id=a.id,
            mock_id=a.row.mock_id,
            kind=a.row.kind,
            title=dict(a.paper.get("title") or {}),
            attempt_no=a.row.attempt_no,
            status=a.status,
            time_policy=a.row.time_policy,
            submitted_at=a.row.submitted_at,
            generated_at=row.generated_at,
            locked=locked,
            **{k: v for k, v in shown.items() if k in fields and k != "version"},
        )
    await _record(db, auth, attempt_id, codes, None)
    return out


async def solutions(
    db: Database, auth: AuthContext, attempt_id: uuid.UUID, locale: str | None
) -> m.Solutions:
    """MOCK-22: keys and solutions, only once the attempt is submitted (keys never ship before)."""
    async with db.system_tx() as session:
        a = await _load(session, auth.user_id, attempt_id)
        if a.status not in ("submitted", "auto_submitted"):
            raise ApiError(
                409, "report_not_ready", "Submit the mock to see solutions", attempt_status=a.status
            )
        stored = (
            await session.execute(
                text("select report from learn.mock_reports where attempt_id = :a"), {"a": a.id}
            )
        ).scalar_one_or_none() or {}
        answers = await _answers(session, a.id)
        ids = [str(i["id"]) for _, i, _ in mp.paper_items(a.paper)]
        bodies = await bank.bodies(session, ids)
        return m.Solutions(
            attempt_id=a.id,
            items=mr.solution_items(a.paper, answers, bodies, dict(stored), locale),
        )


# --- jobs -----------------------------------------------------------------------------------------


async def auto_submit_expired(db: Database, now: datetime | None = None) -> int:
    """Worker sweep: auto-submits strict and live attempts past their deadline, so the report is
    ready even if the student never comes back. Practice attempts wait for the student."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        rows = (
            await session.execute(
                text(
                    "select id, user_id from learn.mock_attempts where status = 'in_progress'"
                    " and time_policy <> 'practice' and server_deadline_at < :now limit 500"
                ),
                {"now": now},
            )
        ).all()
    done = 0
    for r in rows:
        async with db.system_tx() as session:
            flags = await load_flags(session)
            a = await _load(session, r.user_id, r.id, lock=True)
            codes = (await _settle(session, a, now, flags)).sections
            finished = a.status != "in_progress"
        if codes or finished:
            auth = AuthContext(user_id=r.user_id, is_anonymous=False, role="authenticated")
            await _record(db, auth, r.id, codes, None)
        done += int(finished)
    return done


async def auto_submit_expired_job(deps: JobDeps) -> int:
    return await auto_submit_expired(deps.db)
