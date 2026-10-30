"""The mock catalogue and paper builder (docs/flows/practice.md §6.1, §6.5).

A mock is one of:

* a **published mock** (``content.mocks`` + ``mock_items``): the same paper for everyone, so it
  can rank (R26);
* a **PYQ paper** (``pyq:{paper_id}``): the real paper's questions on the blueprint for its paper
  code, also the same for everyone;
* a **blueprint mock** (``bp:{exam}:{paper_code}`` for a full paper, ``…:{section}`` for one
  section): a paper picked from the question bank to the blueprint's sections, types and counts,
  for this student. It avoids questions they met in earlier mocks, so it never ranks;
* a **generated mock** (``POST /v1/mocks/generate``): MOCK-26 custom weak-area mocks and timed
  chapter mocks, on the blueprint's question types, marking and pace.

The paper is pinned on the attempt (``learn.mock_attempts.paper``) at the timer start, with the
marking of every question, so a content patch mid-mock changes nothing (practice §6.6).
Durations, marks and rules come only from the blueprint; nothing here has a fallback number
(practice §9.1). Questions are selected from what ``tools/content-publish`` published, never
written here.
"""

from __future__ import annotations

import math
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.errors import ApiError
from smriti_api.services import question_bank as bank
from smriti_api.services.usage import Flags, Learner, quota

BP_PREFIX = "bp:"
PYQ_PREFIX = "pyq:"
# Answer kinds each question type takes (lesson-core ``checkAnswer``).
ANSWER_KIND = {
    "mcq_single": "options",
    "mcq_multi": "options",
    "assertion_reason": "options",
    "statement_based": "options",
    "numerical": "number",
    "integer": "number",
    "match_list": "pairs",
    "matrix_match": "matrix",
    "fill_blank": "blanks",
    "order_steps": "order",
}


@dataclass(frozen=True)
class Blueprint:
    id: uuid.UUID
    exam_profile_id: str
    paper_code: str
    version: int
    spec: Mapping[str, Any]
    verified_at: date
    source_url: str

    @property
    def sections(self) -> list[Mapping[str, Any]]:
        return list(self.spec.get("sections") or [])

    def section(self, code: str) -> Mapping[str, Any] | None:
        return next((s for s in self.sections if s.get("code") == code), None)

    @property
    def marked_answer_evaluated(self) -> bool:
        """From the interface profile. The generic profile scores answered-and-marked questions
        and says so (practice §6.5)."""
        profile = self.spec.get("interface_profile")
        if isinstance(profile, Mapping) and isinstance(
            profile.get("marked_answer_evaluated"), bool
        ):
            return bool(profile["marked_answer_evaluated"])
        return True


@dataclass(frozen=True)
class MockRef:
    """One catalogue entry, resolved."""

    id: str
    kind: str
    exam_profile_id: str
    blueprint: Blueprint
    title: dict[str, str]
    section_code: str | None = None
    is_free: bool = False
    paper_id: str | None = None
    window_start: datetime | None = None
    window_end: datetime | None = None
    results_at: datetime | None = None
    ranked: bool = False


_BP_COLS = "id, exam_profile_id, paper_code, version, spec, verified_at, source_url"


def _blueprint(row: Any) -> Blueprint:
    return Blueprint(
        id=row.id,
        exam_profile_id=row.exam_profile_id,
        paper_code=row.paper_code,
        version=row.version,
        spec=dict(row.spec),
        verified_at=row.verified_at,
        source_url=row.source_url,
    )


async def active_blueprints(session: AsyncSession, exam: str, today: date) -> list[Blueprint]:
    """The newest reviewed blueprint per paper that is in effect today (``status = 'active'``)."""
    rows = (
        await session.execute(
            text(
                f"select distinct on (paper_code) {_BP_COLS} from content.exam_blueprints"  # noqa: S608 - fixed column list
                " where exam_profile_id = :e and status = 'active' and effective_from <= :d"
                " order by paper_code, version desc"
            ),
            {"e": exam, "d": today},
        )
    ).all()
    return [_blueprint(r) for r in rows]


async def blueprint_by_id(session: AsyncSession, blueprint_id: uuid.UUID) -> Blueprint | None:
    row = (
        await session.execute(
            text(f"select {_BP_COLS} from content.exam_blueprints where id = :id"),  # noqa: S608 - fixed column list
            {"id": blueprint_id},
        )
    ).one_or_none()
    return _blueprint(row) if row else None


async def _blueprint_for_paper(
    session: AsyncSession, exam_id: str, paper_code: str | None, held_on: date | None
) -> Blueprint | None:
    """The blueprint in effect on the day a past paper was held (practice §6.1), else the newest
    reviewed one for its paper code."""
    rows = (
        await session.execute(
            text(
                f"select b.{_BP_COLS.replace(', ', ', b.')} from content.exam_blueprints b"  # noqa: S608 - fixed column list
                " join content.exam_profiles ep on ep.id = b.exam_profile_id"
                " where ep.exam_id = :x and b.status in ('active', 'retired')"
                " and (cast(:pc as text) is null or b.paper_code = :pc)"
                " order by (cast(:held as date) is not null and b.effective_from <= :held) desc,"
                " b.effective_from desc, b.version desc"
            ),
            {"x": exam_id, "pc": paper_code, "held": held_on},
        )
    ).all()
    return _blueprint(rows[0]) if rows else None


def _bp_title(bp: Blueprint, section: Mapping[str, Any] | None) -> dict[str, str]:
    if section is not None:
        return dict(section.get("title") or {})
    # The paper's own name lives on the exam profile; the code is the stable fallback label.
    return {"en": bp.paper_code, "hi": bp.paper_code}


async def catalogue(session: AsyncSession, exam: str, today: date) -> list[MockRef]:
    """MOCK-01: published mocks, PYQ papers and blueprint mocks for one exam profile."""
    refs: list[MockRef] = []
    blueprints = await active_blueprints(session, exam, today)
    published = (
        await session.execute(
            text(
                "select m.id, m.kind, m.title, m.is_free, m.window_start, m.window_end,"
                " m.results_at, m.blueprint_id from content.mocks m"
                " where m.exam_profile_id = :e and m.status in ('scheduled', 'open')"
                " order by m.kind, m.id"
            ),
            {"e": exam},
        )
    ).all()
    for m in published:
        bp = await blueprint_by_id(session, m.blueprint_id)
        if bp is None:
            continue
        refs.append(
            MockRef(
                id=m.id,
                kind=m.kind,
                exam_profile_id=exam,
                blueprint=bp,
                title=dict(m.title),
                is_free=bool(m.is_free),
                window_start=m.window_start,
                window_end=m.window_end,
                results_at=m.results_at,
                ranked=True,
            )
        )
    for bp in blueprints:
        refs.append(
            MockRef(
                id=f"{BP_PREFIX}{exam}:{bp.paper_code}",
                kind="full",
                exam_profile_id=exam,
                blueprint=bp,
                title=_bp_title(bp, None),
            )
        )
        for sec in bp.sections:
            refs.append(
                MockRef(
                    id=f"{BP_PREFIX}{exam}:{bp.paper_code}:{sec['code']}",
                    kind="sectional",
                    exam_profile_id=exam,
                    blueprint=bp,
                    title=_bp_title(bp, sec),
                    section_code=str(sec["code"]),
                )
            )
    papers = (
        await session.execute(
            text(
                "select p.id, p.year, p.session_label, p.held_on, p.paper_code, p.blueprint_id,"
                " p.exam_id from content.pyq_papers p"
                " join content.exam_profiles ep on ep.exam_id = p.exam_id"
                " where ep.id = :e order by p.year desc, p.id"
            ),
            {"e": exam},
        )
    ).all()
    for paper in papers:
        ref = await _pyq_ref(session, exam, paper)
        if ref is not None:
            refs.append(ref)
    return refs


async def _pyq_ref(session: AsyncSession, exam: str, paper: Any) -> MockRef | None:
    bp = (
        await blueprint_by_id(session, paper.blueprint_id)
        if paper.blueprint_id
        else await _blueprint_for_paper(session, paper.exam_id, paper.paper_code, paper.held_on)
    )
    if bp is None:
        return None
    label = f"{paper.year}" + (f" · {paper.session_label}" if paper.session_label else "")
    return MockRef(
        id=f"{PYQ_PREFIX}{paper.id}",
        kind="pyq_paper",
        exam_profile_id=exam,
        blueprint=bp,
        title={"en": label, "hi": label},
        paper_id=paper.id,
        ranked=True,
    )


async def resolve(session: AsyncSession, mock_id: str, today: date) -> MockRef:
    """A catalogue entry by id, or 404."""
    if mock_id.startswith(BP_PREFIX):
        parts = mock_id[len(BP_PREFIX) :].split(":")
        if len(parts) in (2, 3):
            exam, paper_code = parts[0], parts[1]
            bp = next(
                (
                    b
                    for b in await active_blueprints(session, exam, today)
                    if b.paper_code == paper_code
                ),
                None,
            )
            if bp is not None:
                if len(parts) == 2:
                    return MockRef(mock_id, "full", exam, bp, _bp_title(bp, None))
                sec = bp.section(parts[2])
                if sec is not None:
                    return MockRef(
                        mock_id, "sectional", exam, bp, _bp_title(bp, sec), section_code=parts[2]
                    )
    elif mock_id.startswith(PYQ_PREFIX):
        paper = (
            await session.execute(
                text(
                    "select p.id, p.year, p.session_label, p.held_on, p.paper_code,"
                    " p.blueprint_id, p.exam_id, ep.id as exam_profile_id"
                    " from content.pyq_papers p join content.exam_profiles ep on ep.exam_id = p.exam_id"
                    " where p.id = :id order by ep.id limit 1"
                ),
                {"id": mock_id[len(PYQ_PREFIX) :]},
            )
        ).one_or_none()
        if paper is not None:
            ref = await _pyq_ref(session, paper.exam_profile_id, paper)
            if ref is not None:
                return ref
    else:
        m = (
            await session.execute(
                text(
                    "select id, kind, exam_profile_id, blueprint_id, title, is_free, window_start,"
                    " window_end, results_at from content.mocks"
                    " where id = :id and status in ('scheduled', 'open', 'closed')"
                ),
                {"id": mock_id},
            )
        ).one_or_none()
        if m is not None:
            bp = await blueprint_by_id(session, m.blueprint_id)
            if bp is not None:
                return MockRef(
                    id=m.id,
                    kind=m.kind,
                    exam_profile_id=m.exam_profile_id,
                    blueprint=bp,
                    title=dict(m.title),
                    is_free=bool(m.is_free),
                    window_start=m.window_start,
                    window_end=m.window_end,
                    results_at=m.results_at,
                    ranked=True,
                )
    raise ApiError(404, "not_found", "This mock isn't available", detail=mock_id[:200])


# --- access -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Access:
    allowed: bool
    paywall_source: str | None = None
    reason: str | None = None


def access(
    ref_kind: str,
    learner: Learner,
    flags: Flags,
    *,
    is_free_sample: bool,
    paper_id: str | None,
    sectional_started: int,
) -> Access:
    """app-core ``mockAccess`` (practice §4.1), with the live switch per variant."""
    if ref_kind == "live" and not flags.bool("live.enabled"):
        return Access(False, "live_mock", "live_disabled")
    if learner.is_pro:
        if ref_kind == "custom" and not flags.bool("pro.custom_mocks"):
            return Access(False, "custom_mock", "custom_disabled")
        return Access(True, reason="pro")
    if ref_kind == "full":
        return Access(True, reason="free_sample") if is_free_sample else Access(False, "mock_lock")
    if ref_kind in ("sectional", "chapter"):
        q = quota(sectional_started, flags.int_or_none("free.sectional_mocks_per_week"), False)
        return Access(True, reason="free_quota") if q.allowed else Access(False, "mock_lock")
    if ref_kind == "pyq_paper":
        if paper_id and paper_id in flags.str_list("free.pyq_papers_free"):
            return Access(True, reason="free_paper")
        return Access(False, "pyq_paper")
    if ref_kind == "live":
        return Access(False, "live_mock")
    return Access(False, "custom_mock")


# --- building a paper ---------------------------------------------------------------------------


def marking_for(section: Mapping[str, Any], qtype: str) -> dict[str, Any] | None:
    rule = (section.get("marking") or {}).get(qtype)
    return dict(rule) if isinstance(rule, Mapping) else None


def section_duration_s(bp: Blueprint, section: Mapping[str, Any]) -> int:
    """A sectional mock's time: the section's own timer, else the blueprint's pace for its
    questions, rounded up to the minute (practice §6.1)."""
    if section.get("timer_min"):
        return int(section["timer_min"]) * 60
    total = int(bp.spec["question_count"])
    return math.ceil(int(bp.spec["duration_min"]) * int(section["question_count"]) / total) * 60


def paced_duration_s(bp: Blueprint, questions: int) -> int:
    """Generated mocks: questions times (duration / total questions), rounded up to the minute."""
    total = int(bp.spec["question_count"])
    return math.ceil(questions * int(bp.spec["duration_min"]) / total) * 60


def _paper_shell(
    bp: Blueprint, *, key: str | None, title: Mapping[str, str], duration_s: int
) -> dict[str, Any]:
    spec = bp.spec
    return {
        "v": 1,
        "key": key,
        "title": dict(title),
        "blueprint_id": str(bp.id),
        "blueprint_version": bp.version,
        "paper_code": bp.paper_code,
        "duration_s": duration_s,
        "navigation": spec.get("section_navigation", "free"),
        "early_section_submit": spec.get("early_section_submit"),
        "marked_answer_evaluated": bp.marked_answer_evaluated,
        "language_switch": spec.get("language_switch", "per_question"),
        "languages": list(spec.get("languages") or []),
        "calculator": spec.get("calculator", "none"),
        "interface": spec.get("interface", "generic"),
        "interface_profile": spec.get("interface_profile"),
        "mode": spec.get("mode", "cbt"),
        "qualifying": spec.get("qualifying"),
        "sections": [],
    }


def _section_shell(section: Mapping[str, Any], timer_s: int | None) -> dict[str, Any]:
    rule = section.get("attempt_rule") or {}
    return {
        "code": section["code"],
        "title": dict(section.get("title") or {}),
        "subject": section.get("subject"),
        "timer_s": timer_s,
        "attempt_any": rule.get("attempt_any"),
        "over_attempt": rule.get("over_attempt"),
        "questions": [],
    }


def _item(q: bank.BankQuestion, rule: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": q.id,
        "type": q.type,
        "marking": dict(rule),
        "topic_id": q.topic_id,
        "subject_id": q.subject_id,
        "concepts": list(q.concepts),
        "weights": dict(q.weights),
        "ideal_time_s": q.ideal_time_s,
    }


async def seen_in_mocks(session: AsyncSession, user_id: uuid.UUID) -> set[str]:
    rows = (
        await session.execute(
            text(
                "select distinct jsonb_path_query(paper, '$.sections[*].questions[*].id') #>> '{}'"
                " as qid from learn.mock_attempts where user_id = :u and paper is not null"
            ),
            {"u": user_id},
        )
    ).scalars()
    return {str(r) for r in rows}


def _usable(q: bank.BankQuestion) -> bool:
    # Daily-challenge-only questions stay for the challenge (practice §5.5).
    return bool(set(q.uses) - {"daily"})


def _order(pool: Iterable[bank.BankQuestion], seen: set[str], seed: str) -> list[bank.BankQuestion]:
    """Mock-only questions first (their keys never ship to devices), then questions this student
    hasn't met in a mock, in a stable shuffle."""
    return sorted(
        pool,
        key=lambda q: ("mock" not in q.uses, q.id in seen, bank.stable_rank(seed, q.id)),
    )


def _not_ready(section_code: str) -> ApiError:
    return ApiError(
        409,
        "mock_unavailable",
        "This mock isn't ready yet",
        detail=f"Not enough published questions for section {section_code[:64]}",
    )


async def _fill_section(
    session: AsyncSession,
    exam: str,
    section: Mapping[str, Any],
    seen: set[str],
    used: set[str],
    seed: str,
) -> list[tuple[bank.BankQuestion, dict[str, Any]]]:
    types = [str(t) for t in section.get("question_types") or []]
    counts: dict[str, int] | None = section.get("type_counts")
    if not counts and len(types) == 1:
        counts = {types[0]: int(section["question_count"])}
    candidates = [
        q
        for q in await bank.pool(
            session, exam=exam, types=types, subject=section.get("subject") or None
        )
        if _usable(q) and q.id not in used
    ]
    chosen: list[tuple[bank.BankQuestion, dict[str, Any]]] = []
    if counts:
        for qtype, n in counts.items():
            rule = marking_for(section, qtype)
            picks = [q for q in _order(candidates, seen, seed) if q.type == qtype][: int(n)]
            if rule is None or len(picks) < int(n):
                raise _not_ready(str(section["code"]))
            chosen += [(q, rule) for q in picks]
    else:
        # Mixed types with no per-type counts: any listed type, in the stable order.
        picks = _order(candidates, seen, seed)[: int(section["question_count"])]
        if len(picks) < int(section["question_count"]):
            raise _not_ready(str(section["code"]))
        for q in picks:
            rule = marking_for(section, q.type)
            if rule is None:
                raise _not_ready(str(section["code"]))
            chosen.append((q, rule))
    used.update(q.id for q, _ in chosen)
    # Within a section, questions keep the blueprint's type order, then the stable shuffle.
    order = {t: i for i, t in enumerate(types)}
    chosen.sort(
        key=lambda item: (order.get(item[0].type, len(order)), bank.stable_rank(seed, item[0].id))
    )
    return chosen


async def build_paper(
    session: AsyncSession, ref: MockRef, user_id: uuid.UUID, seed: str
) -> dict[str, Any]:
    """Pins the paper for a new attempt."""
    bp = ref.blueprint
    if ref.id.startswith(BP_PREFIX):
        seen = await seen_in_mocks(session, user_id)
        sections = [bp.section(ref.section_code)] if ref.section_code else bp.sections
        duration = (
            section_duration_s(bp, sections[0])
            if ref.section_code and sections[0] is not None
            else int(bp.spec["duration_min"]) * 60
        )
        paper = _paper_shell(bp, key=None, title=ref.title, duration_s=duration)
        if ref.section_code:
            paper["navigation"] = "free"
        used: set[str] = set()
        for sec in sections:
            if sec is None:
                continue
            timer = None if ref.section_code else sec.get("timer_min")
            shell = _section_shell(sec, int(timer) * 60 if timer else None)
            for q, rule in await _fill_section(session, ref.exam_profile_id, sec, seen, used, seed):
                shell["questions"].append(_item(q, rule))
            paper["sections"].append(shell)
        return paper
    if ref.kind == "pyq_paper" and ref.paper_id:
        return await _pyq_paper(session, ref)
    return await _published_paper(session, ref)


async def _items_meta(session: AsyncSession, ids: Sequence[str]) -> dict[str, bank.BankQuestion]:
    return {q.id: q for q in await bank.pool(session, ids=list(ids))}


async def _published_paper(session: AsyncSession, ref: MockRef) -> dict[str, Any]:
    bp = ref.blueprint
    rows = (
        await session.execute(
            text(
                "select section_code, position, question_id, marking from content.mock_items"
                " where mock_id = :m order by section_code, position"
            ),
            {"m": ref.id},
        )
    ).all()
    meta = await _items_meta(session, [r.question_id for r in rows])
    paper = _paper_shell(
        bp, key=ref.id, title=ref.title, duration_s=int(bp.spec["duration_min"]) * 60
    )
    by_code = {s["code"]: s for s in bp.sections}
    for sec in bp.sections:
        items = [r for r in rows if r.section_code == sec["code"]]
        if not items:
            continue
        shell = _section_shell(sec, int(sec["timer_min"]) * 60 if sec.get("timer_min") else None)
        for r in items:
            q = meta.get(r.question_id)
            rule = (
                dict(r.marking)
                if r.marking
                else (marking_for(by_code[sec["code"]], q.type) if q else None)
            )
            if q is None or rule is None:
                raise _not_ready(str(sec["code"]))
            shell["questions"].append(_item(q, rule))
        paper["sections"].append(shell)
    if not paper["sections"]:
        raise _not_ready(ref.id)
    if ref.kind == "sectional" and len(paper["sections"]) == 1:
        only = bp.section(paper["sections"][0]["code"])
        if only is not None:
            paper["duration_s"] = section_duration_s(bp, only)
        paper["navigation"] = "free"
    return paper


async def _pyq_paper(session: AsyncSession, ref: MockRef) -> dict[str, Any]:
    """A past paper as a mock: its questions in order, each under the blueprint section that
    takes its type (and subject, when the section names one)."""
    bp = ref.blueprint
    ids = list(
        (
            await session.execute(
                text(
                    "select question_id from content.pyq_questions where paper_id = :p"
                    " order by number"
                ),
                {"p": ref.paper_id},
            )
        ).scalars()
    )
    meta = await _items_meta(session, ids)
    paper = _paper_shell(
        bp, key=ref.id, title=ref.title, duration_s=int(bp.spec["duration_min"]) * 60
    )
    shells: dict[str, dict[str, Any]] = {}
    for qid in ids:
        q = meta.get(qid)
        if q is None:
            continue
        sec = next(
            (
                s
                for s in bp.sections
                if q.type in (s.get("question_types") or [])
                and (not s.get("subject") or s.get("subject") == q.subject_id)
            ),
            None,
        )
        rule = marking_for(sec, q.type) if sec else None
        if sec is None or rule is None:
            continue
        shell = shells.get(sec["code"])
        if shell is None:
            shell = _section_shell(
                sec, int(sec["timer_min"]) * 60 if sec.get("timer_min") else None
            )
            shells[sec["code"]] = shell
        shell["questions"].append(_item(q, rule))
    paper["sections"] = [shells[s["code"]] for s in bp.sections if s["code"] in shells]
    if not paper["sections"]:
        raise _not_ready(ref.id)
    return paper


async def generated_paper(
    session: AsyncSession,
    bp: Blueprint,
    *,
    title: Mapping[str, str],
    concepts: Sequence[str] | None,
    chapter_id: str | None,
    count: int,
    user_id: uuid.UUID,
    seed: str,
) -> dict[str, Any]:
    """MOCK-26 and timed chapter mocks: questions in scope, on the blueprint's types and marking,
    grouped under the blueprint section that takes each type."""
    pool = [
        q
        for q in await bank.pool(
            session, exam=bp.exam_profile_id, concepts=concepts, chapter=chapter_id
        )
        if _usable(q)
    ]
    seen = await seen_in_mocks(session, user_id)
    shells: dict[str, dict[str, Any]] = {}
    taken = 0
    for q in _order(pool, seen, seed):
        if taken >= count:
            break
        sec = next(
            (
                s
                for s in bp.sections
                if marking_for(s, q.type) is not None
                and (not s.get("subject") or s.get("subject") == q.subject_id)
            ),
            None,
        )
        if sec is None:
            continue
        shell = shells.setdefault(sec["code"], _section_shell(sec, None))
        shell["attempt_any"] = None
        shell["over_attempt"] = None
        shell["questions"].append(_item(q, marking_for(sec, q.type) or {}))
        taken += 1
    if taken == 0:
        raise ApiError(
            409, "mock_unavailable", "No questions in this scope yet", detail="Empty question pool"
        )
    paper = _paper_shell(bp, key=None, title=title, duration_s=paced_duration_s(bp, taken))
    paper["navigation"] = "free"
    paper["sections"] = [shells[s["code"]] for s in bp.sections if s["code"] in shells]
    return paper


def paper_items(paper: Mapping[str, Any]) -> list[tuple[Mapping[str, Any], Mapping[str, Any], int]]:
    """(section, item, position) for every question, position counted from 1 across the paper."""
    out = []
    pos = 0
    for sec in paper.get("sections") or []:
        for item in sec.get("questions") or []:
            pos += 1
            out.append((sec, item, pos))
    return out


def max_marks(paper: Mapping[str, Any]) -> float:
    """The best possible score: each section's top ``attempt_any`` correct marks, or all."""
    total = 0.0
    for sec in paper.get("sections") or []:
        marks = sorted((float(i["marking"]["correct"]) for i in sec["questions"]), reverse=True)
        n = sec.get("attempt_any")
        total += sum(marks[: int(n)] if n else marks)
    return total
