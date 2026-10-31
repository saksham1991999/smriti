"""Mock scoring and the report (docs/flows/practice.md §6.10).

Scoring happens only on the server, because mock keys never ship to devices. Each question is
checked with the lesson-core rules (``services/answers``) and marked with the rule pinned on the
attempt's paper from the blueprint: negative marking, partial marking for multi-select and the
notified numerical tolerance. Attempt-any rules count the first answers the student gave.

Numbers in the report come only from this attempt's answers and the published content. Rank and
percentile are computed when the report is read, from real first attempts only, and only once the
owner's threshold is met (R26); nothing is estimated.
"""

from __future__ import annotations

import copy
import uuid
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.schemas import mocks as m
from smriti_api.services import question_bank as bank
from smriti_api.services.answers import (
    AnswerFormatError,
    CheckResult,
    check_answer,
    parse_answer,
    score_answer,
)
from smriti_api.services.mock_paper import paper_items
from smriti_api.services.usage import Flags

REPORT_VERSION = 1
ANSWERED = ("answered", "answered_marked")
WIRE_CONFIDENCE = {"sure": "sure", "fifty": "fifty_fifty", "guess": "guess"}


@dataclass
class Scored:
    question_id: str
    section_code: str
    position: int
    status: str
    marks: float
    correct_marks: float
    time_spent_ms: int
    confidence: str | None
    answered_seq: int | None
    is_correct: bool | None
    item: Mapping[str, Any]


@dataclass
class _Tally:
    marks: float = 0.0
    max_marks: float = 0.0
    correct: int = 0
    partial: int = 0
    wrong: int = 0
    skipped: int = 0
    time_ms: int = 0
    keys: dict[str, Any] = field(default_factory=dict)

    def add(self, s: Scored) -> None:
        self.marks += s.marks
        self.time_ms += s.time_spent_ms
        if s.status in ("not_scored", "not_counted"):
            return
        self.max_marks += s.correct_marks
        if s.status == "correct":
            self.correct += 1
        elif s.status == "partial":
            self.partial += 1
        elif s.status == "wrong":
            self.wrong += 1
        else:
            self.skipped += 1

    def out(self) -> dict[str, Any]:
        attempted = self.correct + self.partial + self.wrong
        return {
            "marks": round(self.marks, 2),
            "max_marks": round(self.max_marks, 2),
            "correct": self.correct,
            "partial": self.partial,
            "wrong": self.wrong,
            "skipped": self.skipped,
            "accuracy": round(100 * self.correct / attempted) if attempted else None,
            "time_ms": self.time_ms,
        }


def _with_tolerance(body: Mapping[str, Any], rule: Mapping[str, Any]) -> Mapping[str, Any]:
    """A blueprint that notifies its own numerical tolerance overrides the question's
    (``tolerance: "as_notified"`` keeps the question's)."""
    tol = rule.get("tolerance")
    if isinstance(tol, Mapping) and isinstance(body.get("answer"), Mapping):
        out = copy.deepcopy(dict(body))
        out["answer"]["tolerance"] = dict(tol)
        return out
    return body


def score_paper(
    paper: Mapping[str, Any],
    answers: Mapping[str, Any],
    bodies: Mapping[str, Mapping[str, Any]],
) -> list[Scored]:
    """Marks every question in the paper. ``answers`` maps question id to its saved row."""
    evaluate_marked = bool(paper.get("marked_answer_evaluated", True))
    out: list[Scored] = []
    counted_in: dict[str, set[str]] = {}
    for sec in paper.get("sections") or []:
        n = sec.get("attempt_any")
        given = [
            (a.answered_seq if a.answered_seq is not None else 1 << 30, pos, item["id"])
            for pos, item in enumerate(sec["questions"])
            if (a := answers.get(item["id"])) is not None and _is_answered(a, evaluate_marked)
        ]
        given.sort()
        # Attempt-any: the first answers count, in the order the student gave them.
        counted_in[sec["code"]] = {qid for *_, qid in (given[: int(n)] if n else given)}
    for sec, item, pos in paper_items(paper):
        qid = str(item["id"])
        rule = item["marking"]
        a = answers.get(qid)
        body = bodies.get(qid)
        time_ms = int(a.time_spent_ms) if a is not None else 0
        confidence = WIRE_CONFIDENCE.get(a.confidence) if a is not None and a.confidence else None
        seq = a.answered_seq if a is not None else None

        base = Scored(
            question_id=qid,
            section_code=str(sec["code"]),
            position=pos,
            status="",
            marks=0.0,
            correct_marks=float(rule["correct"]),
            time_spent_ms=time_ms,
            confidence=confidence,
            answered_seq=seq,
            is_correct=None,
            item=item,
        )

        if body is None or not isinstance(body.get("answer"), Mapping):
            out.append(replace(base, status="not_scored", marks=0.0, is_correct=None))
            continue
        answered = a is not None and _is_answered(a, evaluate_marked)
        if answered and qid not in counted_in[sec["code"]]:
            out.append(replace(base, status="not_counted", marks=0.0, is_correct=None))
            continue
        if not answered:
            marks = score_answer(body, None, rule)
            out.append(replace(base, status="skipped", marks=marks, is_correct=None))
            continue
        assert a is not None
        try:
            result: CheckResult | None = check_answer(
                _with_tolerance(body, rule), parse_answer(a.answer)
            )
        except (AnswerFormatError, KeyError, TypeError, ValueError):
            result = None
        if result is None:
            # A saved answer that can't be read for this question scores as wrong, never as right.
            marks = float(rule["wrong"])
            out.append(replace(base, status="wrong", marks=marks, is_correct=False))
            continue
        marks = score_answer(body, result, rule)
        status = "correct" if result.correct else ("partial" if marks > 0 else "wrong")
        out.append(replace(base, status=status, marks=marks, is_correct=result.correct))
    return out


def _is_answered(a: Any, evaluate_marked: bool) -> bool:
    if a.answer is None:
        return False
    if a.palette_status == "answered":
        return True
    return a.palette_status == "answered_marked" and evaluate_marked


async def _weightage(
    session: AsyncSession, exam: str | None, concepts: Sequence[str]
) -> dict[str, float]:
    if not exam or not concepts:
        return {}
    rows = (
        await session.execute(
            text(
                "select concept_id, weightage from content.exam_concepts"
                " where exam_profile_id = :e and concept_id = any(:c) and weightage is not null"
            ),
            {"e": exam, "c": list(concepts)},
        )
    ).all()
    return {r.concept_id: float(r.weightage) for r in rows}


async def build_report(
    session: AsyncSession,
    *,
    paper: Mapping[str, Any],
    scored: Sequence[Scored],
    exam: str | None,
    paused_ms: int,
    pause_count: int,
    time_policy: str,
) -> dict[str, Any]:
    total = _Tally()
    sections: dict[str, _Tally] = defaultdict(_Tally)
    subjects: dict[str, _Tally] = defaultdict(_Tally)
    topics: dict[str, _Tally] = defaultdict(_Tally)
    concept_attempted: dict[str, int] = defaultdict(int)
    concept_correct: dict[str, int] = defaultdict(int)
    concept_lost: dict[str, float] = defaultdict(float)
    buckets = {"right_but_slow": 0, "fast_and_wrong": 0, "lucky_guesses": 0, "skipped_time_ms": 0}
    confidence: dict[str, dict[str, int]] = {
        k: {"correct": 0, "wrong": 0} for k in ("sure", "fifty_fifty", "guess", "none")
    }
    time_lost_wrong = 0
    questions = []
    for s in scored:
        item = s.item
        total.add(s)
        sections[s.section_code].add(s)
        if item.get("subject_id"):
            subjects[str(item["subject_id"])].add(s)
        if item.get("topic_id"):
            topics[str(item["topic_id"])].add(s)
        ideal = item.get("ideal_time_s")
        slow = (s.time_spent_ms > int(ideal) * 1000) if ideal and s.status != "skipped" else None
        if s.status in ("correct", "partial", "wrong"):
            lost = max(0.0, s.correct_marks - s.marks)
            weights = item.get("weights") or {}
            concepts = list(item.get("concepts") or [])
            wsum = sum(float(weights.get(c) or 0) for c in concepts)
            for c in concepts:
                concept_attempted[c] += 1
                if s.status == "correct":
                    concept_correct[c] += 1
                share = float(weights.get(c) or 0) / wsum if wsum else 1 / len(concepts)
                concept_lost[c] += lost * share
            conf = s.confidence or "none"
            confidence[conf]["correct" if s.status == "correct" else "wrong"] += 1
            if s.status == "correct":
                buckets["right_but_slow"] += 1 if slow else 0
                buckets["lucky_guesses"] += 1 if s.confidence == "guess" else 0
            else:
                time_lost_wrong += s.time_spent_ms
                if s.status == "wrong" and slow is False:
                    buckets["fast_and_wrong"] += 1
        elif s.status == "skipped":
            buckets["skipped_time_ms"] += s.time_spent_ms
            for c in item.get("concepts") or []:
                concept_lost[c] += s.correct_marks / max(1, len(item.get("concepts") or []))
        questions.append(
            {
                "question_id": s.question_id,
                "section_code": s.section_code,
                "position": s.position,
                "status": s.status,
                "marks": round(s.marks, 2),
                "time_spent_ms": s.time_spent_ms,
                "confidence": s.confidence,
                "answered_seq": s.answered_seq,
                "ideal_time_s": ideal,
                "slow": slow,
            }
        )
    concepts_all = sorted(set(concept_attempted) | set(concept_lost))
    weight = await _weightage(session, exam, concepts_all)
    # Fix next: concepts ranked by marks lost times the exam's weightage (practice §6.10). Where the
    # exam map has no weightage for a concept, marks lost alone order it.
    fix = sorted(
        (c for c in concepts_all if concept_lost[c] > 0),
        key=lambda c: (-(concept_lost[c] * weight.get(c, 1.0)), c),
    )
    titles = {sec["code"]: sec.get("title") or {} for sec in paper.get("sections") or []}
    attempted = total.correct + total.partial + total.wrong
    return {
        "version": REPORT_VERSION,
        "score": round(total.marks, 2),
        "max_score": round(_max_score(paper, scored), 2),
        "accuracy": round(100 * total.correct / attempted) if attempted else None,
        "time_lost_wrong_ms": time_lost_wrong,
        "summary": {
            "attempted": attempted,
            "correct": total.correct,
            "partial": total.partial,
            "wrong": total.wrong,
            "skipped": total.skipped,
            "not_counted": sum(1 for s in scored if s.status == "not_counted"),
            "not_scored": sum(1 for s in scored if s.status == "not_scored"),
            "time_ms": total.time_ms,
            "paused_ms": paused_ms,
            "pause_count": pause_count,
            "time_policy": time_policy,
        },
        "sections": [
            {"code": code, "title": titles.get(code, {}), **t.out()} for code, t in sections.items()
        ],
        "subjects": [{"subject_id": k, **t.out()} for k, t in sorted(subjects.items())],
        "topics": [{"topic_id": k, **t.out()} for k, t in sorted(topics.items())],
        "concepts": [
            {
                "concept_id": c,
                "attempted": concept_attempted[c],
                "correct": concept_correct[c],
                "accuracy": round(100 * concept_correct[c] / concept_attempted[c])
                if concept_attempted[c]
                else None,
                "marks_lost": round(concept_lost[c], 2),
            }
            for c in concepts_all
        ],
        "questions": questions,
        "time_buckets": {**buckets, "ideal_time_source": "authors"},
        "confidence": [{"confidence": k, **v} for k, v in confidence.items()],
        "fix_next": [
            {
                "concept_id": c,
                "marks_lost": round(concept_lost[c], 2),
                "weightage": weight.get(c),
                # PRC-03 prefilled: this concept, untimed (practice §6.10).
                "drill": {"concepts": [c], "kind": "drill"},
            }
            for c in fix
        ],
        "qualifying": paper.get("qualifying"),
    }


def _max_score(paper: Mapping[str, Any], scored: Sequence[Scored]) -> float:
    """The best possible score over the questions that could be scored: each section's top
    ``attempt_any`` correct marks, or all of them."""
    scorable = {s.question_id for s in scored if s.status != "not_scored"}
    total = 0.0
    for sec in paper.get("sections") or []:
        marks = sorted(
            (float(i["marking"]["correct"]) for i in sec["questions"] if i["id"] in scorable),
            reverse=True,
        )
        n = sec.get("attempt_any")
        total += sum(marks[: int(n)] if n else marks)
    return total


# --- standing (R26) -------------------------------------------------------------------------------


async def standing(
    session: AsyncSession,
    *,
    attempt_id: uuid.UUID,
    paper_key: str | None,
    attempt_no: int,
    score: float | None,
    flags: Flags,
    results_at: datetime | None,
    window: tuple[datetime | None, datetime | None],
    now: datetime,
) -> m.Standing:
    if paper_key is None or score is None:
        return m.Standing(shown=False, reason="personal_paper")
    if attempt_no != 1:
        return m.Standing(shown=False, reason="not_first_attempt")
    needed = flags.int_or_none("mock.min_attempts_for_percentile")
    if needed is None:
        return m.Standing(shown=False, reason="threshold_unset")
    if results_at is not None and now < results_at:
        return m.Standing(shown=False, reason="results_pending", needed=needed)
    start, end = window
    row = (
        await session.execute(
            text(
                """
                select count(*) as n,
                       count(*) filter (where score > :s) as above,
                       count(*) filter (where score <= :s) as at_or_below
                  from learn.mock_attempts
                 where paper ->> 'key' = :k and attempt_no = 1 and score is not null
                   and status in ('submitted', 'auto_submitted')
                   and (cast(:ws as timestamptz) is null or started_at >= :ws)
                   and (cast(:we as timestamptz) is null or started_at < :we)
                """
            ),
            {"s": score, "k": paper_key, "ws": start, "we": end},
        )
    ).one()
    counted = int(row.n)
    if counted < needed:
        return m.Standing(shown=False, reason="below_threshold", counted=counted, needed=needed)
    return m.Standing(
        shown=True,
        # The share of first attempts that scored at or below this one.
        percentile=round(100 * int(row.at_or_below) / counted, 2),
        rank=int(row.above) + 1,
        of=counted,
        counted=counted,
        needed=needed,
    )


async def live_standing(
    session: AsyncSession, *, attempt_id: uuid.UUID, mock_id: str, attempt_no: int, flags: Flags
) -> m.Standing:
    """Live mocks (practice §6.11): rank and percentile wait for the frozen results, and only
    first attempts started inside the window have them."""
    needed = flags.int_or_none("mock.min_attempts_for_percentile")
    if attempt_no != 1:
        return m.Standing(shown=False, reason="not_first_attempt", needed=needed)
    run = (
        await session.execute(
            text(
                "select ranks_published_at, ranked, unranked_reason from ops.live_mock_runs"
                " where mock_id = :m"
            ),
            {"m": mock_id},
        )
    ).one_or_none()
    if run is None or run.ranks_published_at is None:
        return m.Standing(shown=False, reason="results_pending", needed=needed)
    if run.unranked_reason is not None:
        return m.Standing(shown=False, reason=run.unranked_reason, needed=needed)
    mine = (
        await session.execute(
            text("select rank, percentile from learn.mock_attempts where id = :a"),
            {"a": attempt_id},
        )
    ).one()
    if mine.rank is None:
        return m.Standing(shown=False, reason="outside_window", needed=needed)
    return m.Standing(
        shown=True,
        percentile=float(mine.percentile) if mine.percentile is not None else None,
        rank=int(mine.rank),
        of=int(run.ranked),
        counted=int(run.ranked),
        needed=needed,
    )


# Report blocks and the ``free.mock_report_sections`` names that unlock them (R25, R43).
SECTION_OF = {
    "score": "score",
    "max_score": "score",
    "standing": "score",
    "accuracy": "accuracy",
    "time_lost_wrong_ms": "time_lost_wrong",
    "sections": "section_bars",
    "subjects": "subject_bars",
    "summary": "attempt_summary",
    "questions": "time_analysis",
    "time_buckets": "time_analysis",
    "topics": "concept_heatmap",
    "concepts": "concept_heatmap",
    "confidence": "confidence",
    "fix_next": "fix_next",
    "qualifying": "score",
}


def gate(
    report: Mapping[str, Any], is_pro: bool, free_sections: Sequence[str]
) -> tuple[dict[str, Any], list[str]]:
    """Pro sees everything. Free sees the sections the flag lists; the rest come back as names in
    ``locked`` so the app draws inline locked rows. ``fix_next_top`` is the first Fix next row."""
    if is_pro:
        return dict(report), []
    allowed = set(free_sections)
    out: dict[str, Any] = {}
    locked: set[str] = set()
    for key, value in report.items():
        section = SECTION_OF.get(key)
        if section is None or section in allowed:
            out[key] = value
        elif key == "fix_next" and "fix_next_top" in allowed:
            out[key] = list(value or [])[:1]
            locked.add("fix_next")
        else:
            locked.add(section)
    return out, sorted(locked)


def solution_items(
    paper: Mapping[str, Any],
    answers: Mapping[str, Any],
    bodies: Mapping[str, Mapping[str, Any]],
    report: Mapping[str, Any],
    locale: str | None,
) -> list[m.SolutionItem]:
    rows = {q["question_id"]: q for q in report.get("questions") or []}
    items = []
    for sec, item, pos in paper_items(paper):
        qid = str(item["id"])
        body = bodies.get(qid)
        if body is None:
            continue
        a = answers.get(qid)
        r = rows.get(qid, {})
        items.append(
            m.SolutionItem(
                question_id=qid,
                section_code=str(sec["code"]),
                position=pos,
                status=r.get("status", "not_scored"),
                marks=float(r.get("marks", 0.0)),
                your_answer=dict(a.answer) if a is not None and a.answer is not None else None,
                question=bank.public_body(body, locale),
                solution=bank.solution_view(body, locale),
            )
        )
    return items
