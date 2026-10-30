"""cards_queued with concept_ids (R52, memory-labs §5.14): the server starts the same system cards
the device does, from content.card_index, and the publish-time indexer fills that table."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services import card_index
from tests.helpers import event, get_state, new_guest, post_events

N = '{"en": "Test", "hi": "टेस्ट"}'
C1 = "cq.topic.sub.concept-1"
C2 = "cq.topic.sub.concept-2"
LESSON_ID = "cq.topic:deep_dive"


def _lesson() -> dict[str, Any]:
    def card(n: int, kind: str, concepts: list[str]) -> dict[str, Any]:
        return {"id": f"cq.topic:dd:{n:02d}", "type": kind, "concepts": concepts}

    return {
        "id": LESSON_ID,
        "topic": "cq-topic",
        "mode": "deep_dive",
        "concepts": [C1, C2],
        "cards": [
            card(1, "story", [C1]),  # narrative: not a review card
            card(2, "formula", [C1]),
            card(3, "question", [C1]),
            card(4, "summary", [C1, C2]),
            card(5, "memory_hook", [C2]),
            card(6, "animation", [C2]),
        ],
    }


@pytest.fixture
async def indexed(services: AppServices, tmp_path: Path) -> AsyncIterator[Path]:
    stmts = [
        "insert into content.subjects (id, name, color_token, sort) values ('cq-subj', cast(:n as jsonb), 'subject.physics', 98) on conflict do nothing",
        "insert into content.units (id, subject_id, name, sort) values ('cq-unit', 'cq-subj', cast(:n as jsonb), 1) on conflict do nothing",
        "insert into content.chapters (id, unit_id, subject_id, name, sort) values ('cq-ch', 'cq-unit', 'cq-subj', cast(:n as jsonb), 1) on conflict do nothing",
        "insert into content.topics (id, chapter_id, name, sort) values ('cq-topic', 'cq-ch', cast(:n as jsonb), 1) on conflict do nothing",
        "insert into content.subtopics (id, topic_id, name, sort) values ('cq-sub', 'cq-topic', cast(:n as jsonb), 1) on conflict do nothing",
        f"insert into content.concepts (id, subtopic_id, name, summary, kind, intrinsic_depth, sort) values ('{C1}', 'cq-sub', cast(:n as jsonb), cast(:n as jsonb), 'fact', 1, 1) on conflict do nothing",
        f"insert into content.concepts (id, subtopic_id, name, summary, kind, intrinsic_depth, sort) values ('{C2}', 'cq-sub', cast(:n as jsonb), cast(:n as jsonb), 'fact', 1, 2) on conflict do nothing",
        f"insert into content.content_items (id, kind, topic_id, mode, status, is_free, source_path) values ('{LESSON_ID}', 'lesson', 'cq-topic', 'deep_dive', 'published', true, 'x') on conflict do nothing",
        f"insert into content.content_item_concepts (item_id, concept_id, role) values ('{LESSON_ID}', '{C1}', 'teaches'), ('{LESSON_ID}', '{C2}', 'teaches') on conflict do nothing",
    ]
    root = tmp_path / "content"
    (root / "lessons" / "cq").mkdir(parents=True)
    (root / "lessons" / "cq" / "topic.deep_dive.json").write_text(json.dumps(_lesson()))
    async with services.db.admin_tx() as session:
        for sql in stmts:
            await session.execute(text(sql), {"n": N})
        counts = await card_index.index_lessons(session, root)
    assert counts == {"lessons": 1, "cards": 4, "retired": 0}
    yield root


def test_only_deep_dive_review_cards_are_indexed() -> None:
    rows = card_index.cards_from_lesson(_lesson())
    assert [r.kind for r in rows] == ["formula", "question", "summary", "memory_hook"]
    assert card_index.cards_from_lesson({**_lesson(), "mode": "quick_revision"}) == []


async def test_reindex_retires_cards_that_left_the_lesson(
    services: AppServices, indexed: Path
) -> None:
    lesson = _lesson()
    lesson["cards"] = lesson["cards"][:3]
    (indexed / "lessons" / "cq" / "topic.deep_dive.json").write_text(json.dumps(lesson))
    async with services.db.admin_tx() as session:
        counts = await card_index.index_lessons(session, indexed)
        retired = set(
            (
                await session.execute(
                    text("select card_id from content.card_index where status = 'retired'")
                )
            ).scalars()
        )
        # Put the full lesson back for the other tests.
        (indexed / "lessons" / "cq" / "topic.deep_dive.json").write_text(json.dumps(_lesson()))
        await card_index.index_lessons(session, indexed)
    assert counts["cards"] == 2
    assert {"cq.topic:dd:04", "cq.topic:dd:05"} <= retired


async def test_concept_ids_alone_start_the_concepts_system_cards(
    client: httpx.AsyncClient, indexed: Path
) -> None:
    s = await new_guest(client)
    # The shape app-core sends since R52: ids only, no card refs.
    queued = event("cards_queued", {"concept_ids": [C1], "source": "practice"})
    result = await post_events(client, s, [queued])
    assert len(result["accepted"]) == 1
    cards = {c["card_ref"]: c for c in (await get_state(client, s))["srs"]["cards"]}
    assert set(cards) == {"c:cq.topic:dd:02", "c:cq.topic:dd:03", "c:cq.topic:dd:04"}
    assert all(c["state"] == 0 for c in cards.values())
    now = datetime.now(UTC).isoformat()
    assert all(c["due"] <= now for c in cards.values())

    # Idempotent: the same request again changes nothing.
    await post_events(
        client, s, [event("cards_queued", {"concept_ids": [C1], "source": "practice"})]
    )
    assert len((await get_state(client, s))["srs"]["cards"]) == 3


async def test_queue_respects_the_practice_max_and_the_daily_cap(
    services: AppServices, indexed: Path
) -> None:
    async with services.db.admin_tx() as session:
        uid = (
            await session.execute(
                text("insert into auth.users (is_anonymous) values (true) returning id")
            )
        ).scalar_one()
    now = datetime(2026, 10, 30, 6, 0, tzinfo=UTC)
    tz = ZoneInfo("Asia/Kolkata")
    async with services.db.admin_tx() as session:
        r = await card_index.queue_for_concepts(
            session,
            user_id=uid,
            concept_ids=[C1, C2],
            now=now,
            tz=tz,
            flags={"memory.queue_from_practice_max": 3, "memory.daily_review_cap": 2},
        )
        due: dict[str, datetime] = {
            str(row.card_ref): row.due_at
            for row in (
                await session.execute(
                    text("select card_ref, due_at from learn.srs_cards where user_id = :u"),
                    {"u": uid},
                )
            ).all()
        }
    assert r.started == ["c:cq.topic:dd:02", "c:cq.topic:dd:03", "c:cq.topic:dd:04"]
    # Two fit today's cap; the third rolls to the start of tomorrow (local midnight).
    assert sorted(due.values())[:2] == [now, now]
    assert sorted(due.values())[2] == datetime(2026, 10, 30, 18, 30, tzinfo=UTC)


async def test_started_cards_below_target_are_pulled_into_today(
    services: AppServices, indexed: Path
) -> None:
    async with services.db.admin_tx() as session:
        uid = (
            await session.execute(
                text("insert into auth.users (is_anonymous) values (true) returning id")
            )
        ).scalar_one()
        now = datetime(2026, 10, 30, 6, 0, tzinfo=UTC)
        rows = [
            # Weak: stability 2 days, last seen 20 days ago, due in 5 days -> pulled.
            ("c:cq.topic:dd:02", 2, now + timedelta(days=5), 2.0, now - timedelta(days=20), False),
            # Strong: stability 300 days, seen yesterday -> left alone.
            (
                "c:cq.topic:dd:03",
                2,
                now + timedelta(days=200),
                300.0,
                now - timedelta(days=1),
                False,
            ),
            # Suspended -> left alone.
            ("c:cq.topic:dd:04", 2, now + timedelta(days=5), 2.0, now - timedelta(days=20), True),
        ]
        for ref, state, due, stab, last, susp in rows:
            await session.execute(
                text(
                    "insert into learn.srs_cards (user_id, card_ref, state, due_at, stability,"
                    " difficulty, reps, last_review_at, suspended)"
                    " values (:u, :r, :st, :d, :s, 5, 3, :l, :x)"
                ),
                {"u": uid, "r": ref, "st": state, "d": due, "s": stab, "l": last, "x": susp},
            )
        r = await card_index.queue_for_concepts(
            session, user_id=uid, concept_ids=[C1], now=now, tz=ZoneInfo("Asia/Kolkata"), flags={}
        )
    assert r.pulled_forward == ["c:cq.topic:dd:02"]
    assert r.started == []


async def test_reviews_queue_endpoint_needs_a_key_and_returns_the_count(
    client: httpx.AsyncClient, indexed: Path
) -> None:
    s = await new_guest(client)
    body = {"concept_ids": [C2], "source": "mock_report"}
    r = await client.post("/v1/reviews/queue", json=body, headers=s.headers)
    assert r.status_code == 400, r.text
    headers = {**s.headers, "Idempotency-Key": "queue-key-0001"}
    r = await client.post("/v1/reviews/queue", json=body, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 2
    assert r.json()["card_refs"] == ["c:cq.topic:dd:04", "c:cq.topic:dd:05"]
    # A retry with the same key gets the first answer back.
    again = await client.post("/v1/reviews/queue", json=body, headers=headers)
    assert again.json() == r.json()
