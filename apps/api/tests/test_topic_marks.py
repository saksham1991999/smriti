"""Sync v1.6 topic marks against the golden vector shared with app-core
(``packages/app-core/test-vectors/topic_marks.json``): Test out marks, their undo and a chapter
reset are accepted, rejected and applied to ``learn.topic_status`` exactly as ``applyTopicMark``
does on the device, and a pull keeps ``learned_via``."""

from __future__ import annotations

import json
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.core.config import REPO_ROOT
from smriti_api.core.deps import AppServices
from tests.helpers import event, get_state, new_guest, post_events

VECTOR: dict[str, Any] = json.loads(
    (REPO_ROOT / "packages" / "app-core" / "test-vectors" / "topic_marks.json").read_text()
)


async def _rows(services: AppServices, user_id: Any) -> dict[str, dict[str, Any]]:
    async with services.db.admin_tx() as session:
        rows = (
            await session.execute(
                text(
                    "select topic_id, status, learned_via from learn.topic_status"
                    " where user_id = :u order by topic_id"
                ),
                {"u": user_id},
            )
        ).all()
    return {r.topic_id: {"status": r.status, "learned_via": r.learned_via} for r in rows}


async def test_the_vector_chapter_matches_the_fixture_course(
    services: AppServices, content: str
) -> None:
    async with services.db.admin_tx() as session:
        for chapter, topics in VECTOR["chapter_topics"].items():
            found = (
                await session.execute(
                    text("select id from content.topics where chapter_id = :c order by id"),
                    {"c": chapter},
                )
            ).scalars()
            assert list(found) == sorted(topics)


async def test_topic_marks_follow_the_shared_vector(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await new_guest(client)
    async with services.db.admin_tx() as session:
        for topic_id, row in VECTOR["initial"].items():
            await session.execute(
                text(
                    "insert into learn.topic_status (user_id, topic_id, status, learned_via)"
                    " values (:u, :t, :s, :v)"
                ),
                {"u": s.user_id, "t": topic_id, "s": row["status"], "v": row["learned_via"]},
            )
            await session.execute(
                text(
                    "insert into learn.lesson_progress (user_id, topic_id, mode, bundle_hash,"
                    " cards_seen) values (:u, :t, 'deep_dive', 'h', 3)"
                ),
                {"u": s.user_id, "t": topic_id},
            )
    for case in VECTOR["cases"]:
        result = await post_events(client, s, [event(case["type"], case["payload"])])
        codes = [r["code"] for r in result["rejected"]]
        expected = case["expected"]
        assert codes == ([] if expected["accepted"] else [expected["code"]]), case["name"]
        assert await _rows(services, s.user_id) == expected["rows"], case["name"]

    # The reset took the lesson positions too, as the device's reset does.
    async with services.db.admin_tx() as session:
        left = (
            await session.execute(
                text("select count(*) from learn.lesson_progress where user_id = :u"),
                {"u": s.user_id},
            )
        ).scalar_one()
    assert left == 0


async def test_a_pull_keeps_how_a_topic_was_learned(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await new_guest(client)
    first = VECTOR["cases"][0]
    await post_events(client, s, [event(first["type"], first["payload"])])
    state = await get_state(client, s)
    by_topic = {t["topic_id"]: t for t in state["topic_progress"]}
    passed = first["payload"]["topic_ids"]
    assert {by_topic[t]["learned_via"] for t in passed} == {"test_out"}
    assert {by_topic[t]["percent"] for t in passed} == {100}
    since = state["state_version"]
    reset = next(
        c for c in VECTOR["cases"] if c["type"] == "chapter_reset" and c["expected"]["accepted"]
    )
    await post_events(client, s, [event(reset["type"], reset["payload"])])
    later = await get_state(client, s, since=since)
    assert {t["status"] for t in later["topic_progress"]} == {"not_started"}
    assert {t["topic_id"] for t in later["topic_progress"]} == set(passed)
