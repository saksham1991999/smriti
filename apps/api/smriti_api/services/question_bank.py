"""Reads the published question bank (``content.questions`` and friends) for practice, mocks, the
daily challenge and the tutor. Bodies come from ``content.question_bodies`` (service only) and are
cut down to what a caller may see: no key or solution before the answer is in.

Nothing here writes study content: questions are selected from what ``tools/content-publish``
published, never generated.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

Difficulty = Literal["easy", "medium", "hard"]
LEVELS: tuple[Difficulty, ...] = ("easy", "medium", "hard")
LOCALES = ("en", "hi")
# Fields a student sees only after answering (content-format §8).
_HIDDEN = frozenset({"answer", "solution", "hints", "common_traps"})


@dataclass(frozen=True)
class BankQuestion:
    id: str
    type: str
    difficulty: str | None
    ideal_time_s: int | None
    source: str
    bundle_ref: str | None
    uses: tuple[str, ...]
    concepts: tuple[str, ...]
    topic_id: str
    chapter_id: str
    subject_id: str
    weights: Mapping[str, float] = field(default_factory=dict)


_POOL_SQL = """
select q.id, q.type, q.difficulty_label, q.ideal_time_s, q.source, q.bundle_ref, b.uses,
       array_agg(distinct qc.concept_id order by qc.concept_id) as concepts,
       jsonb_object_agg(qc.concept_id, qc.weight) as weights,
       min(t.id) as topic_id, min(ch.id) as chapter_id, min(ch.subject_id) as subject_id
  from content.questions q
  join content.question_bodies b on b.question_id = q.id
  join content.question_concepts qc on qc.question_id = q.id
  join content.concepts c on c.id = qc.concept_id
  join content.subtopics st on st.id = c.subtopic_id
  join content.topics t on t.id = st.topic_id
  join content.chapters ch on ch.id = t.chapter_id
 where q.status = 'published'
   and q.type <> 'paragraph'
   -- paragraph children are answered under their passage, never on their own
   and not exists (
     select 1 from content.question_bodies p
      where p.body ->> 'type' = 'paragraph'
        and p.body -> 'children' @> jsonb_build_array(jsonb_build_object('id', q.id)))
   and (cast(:exam as text) is null or exists (
     select 1 from content.exam_concepts ec
      where ec.exam_profile_id = :exam and ec.concept_id = qc.concept_id))
   and (cast(:uses as text[]) is null or b.uses && cast(:uses as text[]))
   and (cast(:exclude_uses as text[]) is null or not (b.uses && cast(:exclude_uses as text[])))
   and (cast(:concepts as text[]) is null or qc.concept_id = any(cast(:concepts as text[])))
   and (cast(:topic as text) is null or t.id = :topic)
   and (cast(:chapter as text) is null or ch.id = :chapter)
   and (cast(:subject as text) is null or ch.subject_id = :subject)
   and (cast(:ids as text[]) is null or q.id = any(cast(:ids as text[])))
   and (cast(:types as text[]) is null or q.type = any(cast(:types as text[])))
   and (cast(:source as text) is null or q.source = :source)
 group by q.id, q.type, q.difficulty_label, q.ideal_time_s, q.source, q.bundle_ref, b.uses
 order by q.id
"""


async def pool(
    session: AsyncSession,
    *,
    exam: str | None = None,
    uses: Sequence[str] | None = None,
    exclude_uses: Sequence[str] | None = None,
    concepts: Sequence[str] | None = None,
    topic: str | None = None,
    chapter: str | None = None,
    subject: str | None = None,
    ids: Sequence[str] | None = None,
    types: Sequence[str] | None = None,
    source: str | None = None,
) -> list[BankQuestion]:
    rows = (
        await session.execute(
            text(_POOL_SQL),
            {
                "exam": exam,
                "uses": list(uses) if uses is not None else None,
                "exclude_uses": list(exclude_uses) if exclude_uses is not None else None,
                "concepts": list(concepts) if concepts is not None else None,
                "topic": topic,
                "chapter": chapter,
                "subject": subject,
                "ids": list(ids) if ids is not None else None,
                "types": list(types) if types is not None else None,
                "source": source,
            },
        )
    ).all()
    return [
        BankQuestion(
            id=r.id,
            type=r.type,
            difficulty=r.difficulty_label,
            ideal_time_s=r.ideal_time_s,
            source=r.source,
            bundle_ref=r.bundle_ref,
            uses=tuple(r.uses or ()),
            concepts=tuple(r.concepts or ()),
            topic_id=r.topic_id,
            chapter_id=r.chapter_id,
            subject_id=r.subject_id,
            weights={k: float(v) for k, v in (r.weights or {}).items()},
        )
        for r in rows
    ]


async def bodies(session: AsyncSession, ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    """Full source bodies (with keys). Service-role sessions only."""
    wanted = sorted(set(ids))
    if not wanted:
        return {}
    rows = (
        await session.execute(
            text(
                "select question_id, body from content.question_bodies where question_id = any(:ids)"
            ),
            {"ids": wanted},
        )
    ).all()
    return {r.question_id: dict(r.body) for r in rows}


async def find_body(session: AsyncSession, question_id: str) -> dict[str, Any] | None:
    """A question or a paragraph child (children have rows of their own), by id."""
    return (await bodies(session, [question_id])).get(question_id)


async def concepts_of(session: AsyncSession, ids: Iterable[str]) -> dict[str, list[str]]:
    wanted = sorted(set(ids))
    if not wanted:
        return {}
    rows = (
        await session.execute(
            text(
                "select question_id, array_agg(concept_id order by concept_id) as cs"
                " from content.question_concepts where question_id = any(:ids) group by question_id"
            ),
            {"ids": wanted},
        )
    ).all()
    return {r.question_id: list(r.cs) for r in rows}


def localize(value: Any, locale: str) -> Any:
    """Turn ``{en, hi}`` texts into one locale's text (falling back to English), recursively.
    Lists of accepted blank texts per locale become that locale's list, as in bundles."""
    if isinstance(value, dict):
        keys = set(value)
        if keys and keys <= set(LOCALES) and all(isinstance(v, str | list) for v in value.values()):
            return value.get(locale, value.get("en"))
        return {k: localize(v, locale) for k, v in value.items()}
    if isinstance(value, list):
        return [localize(v, locale) for v in value]
    return value


def public_body(body: Mapping[str, Any], locale: str | None = None) -> dict[str, Any]:
    """A question as a student may see it before answering: no key, hints or solution. With no
    locale both languages stay, for the per-question EN/HI toggle (R44)."""

    def strip(node: Any) -> Any:
        if isinstance(node, dict):
            return {k: strip(v) for k, v in node.items() if k not in _HIDDEN}
        if isinstance(node, list):
            return [strip(v) for v in node]
        return node

    out: dict[str, Any] = strip(dict(body))
    for f in ("use", "exam_styles"):
        out.pop(f, None)
    result: dict[str, Any] = localize(out, locale) if locale else out
    return result


def solution_view(body: Mapping[str, Any], locale: str | None = None) -> dict[str, Any]:
    """Key, hints and solution, shown after the answer is in (PRC-05, MOCK-22)."""
    out: dict[str, Any] = {
        "question_id": body.get("id"),
        "answer": body.get("answer"),
        "solution": body.get("solution"),
        "hints": body.get("hints"),
    }
    if body.get("type") == "paragraph":
        out["children"] = [solution_view(c, locale) for c in body.get("children") or []]
    return localize(out, locale) if locale else out


def level_for_mastery(mastery: float | None) -> Difficulty:
    """practice §5.3 rule 1: low → easy, middle → medium, high → hard; no mastery → medium."""
    if mastery is None:
        return "medium"
    if mastery < 0.4:
        return "easy"
    if mastery < 0.7:
        return "medium"
    return "hard"


def nearest_levels(level: str) -> list[str]:
    """The level first, then the nearest ones (practice §5.3 rule 5)."""
    i = LEVELS.index(level) if level in LEVELS else 1
    return sorted(LEVELS, key=lambda lvl: (abs(LEVELS.index(lvl) - i), LEVELS.index(lvl)))


def stable_rank(seed: str, item: str) -> str:
    """A deterministic shuffle key: the same seed gives the same order on every server."""
    return hashlib.sha256(f"{seed}|{item}".encode()).hexdigest()
