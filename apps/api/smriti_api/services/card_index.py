"""System review cards by concept (memory-labs §5.14, R52).

Two halves:

- ``index_lessons`` fills ``content.card_index`` from the published lesson files. The content
  publish job runs it right after ``metadata.sql``, so the index always matches the bundles.
- ``queue_for_concepts`` is the server half of app-core ``queueCardsForConcepts``: it starts the
  unstarted system cards of the concepts (outside the new-card cap, up to
  ``memory.queue_from_practice_max``), pulls started cards whose recall is below the student's
  target into today, leaves due and suspended cards alone, and respects
  ``memory.daily_review_cap`` (overflow goes to the start of tomorrow).

A system card is a card of a published Deep Dive lesson whose type is in ``REVIEW_CARD_TYPES``:
the card types with something to recall. Narrative and media cards (story, animation, sim, 3D,
360, video, role play, experiment) and the explainer are teaching moments, not review cards.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from fsrs import Card, State
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.services.recompute import day_bounds, local_day
from smriti_api.services.srs import TS_FSRS_DEFAULT_RETENTION, make_scheduler

log = structlog.get_logger(__name__)

REVIEW_CARD_TYPES = frozenset(
    {
        "formula",
        "memory_hook",
        "question",
        "summary",
        "worked_example",
        "derivation",
        "common_traps",
    }
)
DEFAULT_QUEUE_MAX = 20  # memory.queue_from_practice_max (packages/config)
DEFAULT_DAILY_REVIEW_CAP = 200  # memory.daily_review_cap


@dataclass(frozen=True)
class IndexRow:
    card_id: str
    item_id: str
    topic_id: str
    mode: str
    kind: str
    concept_ids: tuple[str, ...]
    ordinal: int


def cards_from_lesson(lesson: dict[str, Any]) -> list[IndexRow]:
    """The system review cards of one lesson file (a Deep Dive)."""
    if lesson.get("mode") != "deep_dive":
        return []
    rows = []
    for i, card in enumerate(lesson.get("cards") or []):
        kind = str(card.get("type", ""))
        concepts = tuple(str(c) for c in card.get("concepts") or [])
        if kind not in REVIEW_CARD_TYPES or not concepts or not card.get("id"):
            continue
        rows.append(
            IndexRow(
                card_id=str(card["id"]),
                item_id=str(lesson["id"]),
                topic_id=str(lesson["topic"]),
                mode="deep_dive",
                kind=kind,
                concept_ids=concepts,
                ordinal=i,
            )
        )
    return rows


def read_lessons(content_root: Path) -> Iterable[dict[str, Any]]:
    for path in sorted((content_root / "lessons").rglob("*.json")):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            log.warning("card_index_unreadable_lesson", file=path.name)
            continue
        if isinstance(doc, dict) and doc.get("id") and doc.get("topic"):
            yield doc


async def index_lessons(session: AsyncSession, content_root: Path) -> dict[str, int]:
    """Upserts the system cards of every published Deep Dive under ``content_root`` and retires
    cards that left a lesson. Lessons that are not published (no ``content_items`` row) are
    skipped, so a draft never reaches a student's queue."""
    published = set(
        (
            await session.execute(
                text(
                    "select id from content.content_items where kind = 'lesson'"
                    " and status = 'published'"
                )
            )
        ).scalars()
    )
    known_concepts = set((await session.execute(text("select id from content.concepts"))).scalars())
    rows: list[IndexRow] = []
    items: set[str] = set()
    for lesson in read_lessons(content_root):
        if lesson["id"] not in published:
            continue
        items.add(str(lesson["id"]))
        for row in cards_from_lesson(lesson):
            concepts = tuple(c for c in row.concept_ids if c in known_concepts)
            if concepts:
                rows.append(
                    IndexRow(
                        row.card_id,
                        row.item_id,
                        row.topic_id,
                        row.mode,
                        row.kind,
                        concepts,
                        row.ordinal,
                    )
                )
    for row in rows:
        await session.execute(
            text(
                """
                insert into content.card_index
                  (card_id, item_id, topic_id, mode, kind, concept_ids, ordinal, status, updated_at)
                values (:card, :item, :topic, :mode, :kind, :concepts, :ordinal, 'published', now())
                on conflict (card_id) do update set
                  item_id = excluded.item_id, topic_id = excluded.topic_id, mode = excluded.mode,
                  kind = excluded.kind, concept_ids = excluded.concept_ids, ordinal = excluded.ordinal,
                  status = 'published', updated_at = now()
                """
            ),
            {
                "card": row.card_id,
                "item": row.item_id,
                "topic": row.topic_id,
                "mode": row.mode,
                "kind": row.kind,
                "concepts": list(row.concept_ids),
                "ordinal": row.ordinal,
            },
        )
    retired = 0
    if items:
        retired = (
            await session.execute(
                text(
                    "update content.card_index set status = 'retired', updated_at = now()"
                    " where item_id = any(:items) and status = 'published'"
                    " and not (card_id = any(:keep))"
                ),
                {"items": sorted(items), "keep": [r.card_id for r in rows]},
            )
        ).rowcount or 0  # type: ignore[attr-defined]
    return {"lessons": len(items), "cards": len(rows), "retired": int(retired)}


# --- queueing -----------------------------------------------------------------------------------


@dataclass
class QueueResult:
    started: list[str] = field(default_factory=list)
    pulled_forward: list[str] = field(default_factory=list)

    @property
    def changed(self) -> list[str]:
        return [*self.started, *self.pulled_forward]


def _int_flag(flags: dict[str, Any], key: str, default: int) -> int:
    value = flags.get(key)
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return default


def _retrievability(row: Any, at: datetime, retention: float) -> float:
    if row.last_review_at is None or not row.stability:
        return 0.0
    card = Card(
        state=State(int(row.state)) if int(row.state) in (1, 2, 3) else State.Learning,
        stability=float(row.stability),
        difficulty=float(row.difficulty) or 5.0,
        due=row.due_at,
        last_review=row.last_review_at,
    )
    return float(make_scheduler(retention=retention).get_card_retrievability(card, at))


async def queue_for_concepts(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    concept_ids: Sequence[str],
    card_refs: Sequence[str] = (),
    now: datetime,
    tz: ZoneInfo,
    flags: dict[str, Any],
) -> QueueResult:
    """Applies memory-labs §5.14 on the server. Idempotent: a second call with the same input
    changes nothing, because started cards are no longer unstarted and pulled cards are due."""
    result = QueueResult()
    concepts = sorted({c for c in concept_ids if c})
    explicit = sorted({r for r in card_refs if r})
    if not concepts and not explicit:
        return result
    max_new = _int_flag(flags, "memory.queue_from_practice_max", DEFAULT_QUEUE_MAX)
    cap = _int_flag(flags, "memory.daily_review_cap", DEFAULT_DAILY_REVIEW_CAP)
    today = local_day(now, tz)
    _, end_of_today = day_bounds(today, tz)
    tomorrow = end_of_today
    queued_today = int(
        (
            await session.execute(
                text(
                    "select count(*) from learn.srs_cards where user_id = :u and not suspended"
                    " and due_at < :end"
                ),
                {"u": user_id, "end": end_of_today},
            )
        ).scalar_one()
    )
    room = max(0, cap - queued_today)

    def due_at() -> datetime:
        nonlocal room
        if room > 0:
            room -= 1
            return now
        return tomorrow

    retention = float(
        (
            await session.execute(
                text("select desired_retention from learn.fsrs_params where user_id = :u"),
                {"u": user_id},
            )
        ).scalar_one_or_none()
        or TS_FSRS_DEFAULT_RETENTION
    )

    # System cards of these concepts, in lesson order, with the student's schedule if any.
    candidates: list[Any] = []
    if concepts:
        candidates = list(
            (
                await session.execute(
                    text(
                        """
                        select 'c:' || ci.card_id as ref, sc.state, sc.due_at, sc.stability,
                               sc.difficulty, sc.last_review_at, sc.suspended,
                               (sc.user_id is not null) as started
                          from content.card_index ci
                          join content.content_items i on i.id = ci.item_id and i.status = 'published'
                          left join learn.srs_cards sc
                            on sc.user_id = :u and sc.card_ref = 'c:' || ci.card_id
                         where ci.status = 'published'
                           and ci.concept_ids && cast(:concepts as text[])
                           and exists (
                             select 1 from content.content_item_concepts icc
                              where icc.item_id = ci.item_id and icc.concept_id = any(ci.concept_ids))
                         order by ci.topic_id, ci.ordinal, ci.card_id
                        """
                    ),
                    {"u": user_id, "concepts": concepts},
                )
            ).all()
        )
    to_start: list[tuple[str, datetime]] = []
    to_pull: list[tuple[str, datetime]] = []
    for row in candidates:
        if not row.started:
            if len(to_start) < max_new:
                to_start.append((row.ref, due_at()))
            continue
        if row.suspended or int(row.state) == 0 or row.due_at < end_of_today:
            continue  # suspended stays suspended; new and already-due cards stay as they are
        if _retrievability(row, now, retention) >= retention:
            continue
        to_pull.append((row.ref, due_at()))

    # Cards the client named itself (older clients send card_refs): new ones start due now,
    # started ones are pulled in unless suspended.
    seen = {ref for ref, _ in to_start} | {ref for ref, _ in to_pull}
    for ref in explicit:
        if ref not in seen:
            to_start.append((ref, now))

    existing = set(
        (
            await session.execute(
                text(
                    "select card_ref from learn.srs_cards where user_id = :u and card_ref = any(:refs)"
                ),
                {"u": user_id, "refs": [ref for ref, _ in to_start]},
            )
        ).scalars()
    )
    for ref, due in to_start:
        changed = (
            await session.execute(
                text(
                    """
                    insert into learn.srs_cards as c (user_id, card_ref, state, due_at, stability, difficulty)
                    values (:u, :ref, 0, :due, 0, 0)
                    on conflict (user_id, card_ref) do update set due_at = least(c.due_at, excluded.due_at)
                      where not c.suspended and c.due_at > excluded.due_at
                    returning card_ref
                    """
                ),
                {"u": user_id, "ref": ref, "due": due},
            )
        ).one_or_none()
        if changed is not None:
            (result.pulled_forward if ref in existing else result.started).append(ref)
    for ref, due in to_pull:
        moved = (
            await session.execute(
                text(
                    "update learn.srs_cards set due_at = :due, updated_at = now()"
                    " where user_id = :u and card_ref = :ref and not suspended and due_at > :due"
                    " returning card_ref"
                ),
                {"u": user_id, "ref": ref, "due": due},
            )
        ).scalar_one_or_none()
        if moved is not None:
            result.pulled_forward.append(ref)
    if result.started:
        await session.execute(
            text("delete from learn.srs_tombstones where user_id = :u and card_ref = any(:refs)"),
            {"u": user_id, "refs": result.started},
        )
    return result
