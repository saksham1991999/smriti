"""Sync v1.7 Find my level marks against the golden vector shared with app-core
(``packages/app-core/test-vectors/placement_marks.json``): placement pre-marks, a redo that
replaces only unconfirmed marks, a lesson that confirms one, and Test out and chapter reset next
to them, applied to ``learn.topic_status`` exactly as ``applyTopicMark`` does on the device."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from smriti_api.core.config import REPO_ROOT
from smriti_api.core.deps import AppServices
from tests.helpers import event, get_state, new_guest, post_events

VECTOR: dict[str, Any] = json.loads(
    (REPO_ROOT / "packages" / "app-core" / "test-vectors" / "placement_marks.json").read_text()
)
EXTRA_CHAPTER = "fx.chapter-p"


@pytest.fixture
async def second_chapter(services: AppServices, content: str) -> AsyncIterator[None]:
    """The vector's second chapter of the fixture subject, for this test only."""
    topics = VECTOR["chapter_topics"][EXTRA_CHAPTER]
    name = json.dumps({"en": "Fixture chapter P", "hi": "फ़िक्स्चर अध्याय P"})
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "insert into content.chapters (id, unit_id, subject_id, name, sort)"
                " select :c, unit_id, subject_id, cast(:n as jsonb), 2 from content.chapters"
                " where id = 'fx.chapter-a' on conflict (id) do nothing"
            ),
            {"c": EXTRA_CHAPTER, "n": name},
        )
        for i, topic in enumerate(topics, start=1):
            await session.execute(
                text(
                    "insert into content.topics (id, chapter_id, name, sort)"
                    " values (:t, :c, cast(:n as jsonb), :s) on conflict (id) do nothing"
                ),
                {"t": topic, "c": EXTRA_CHAPTER, "n": name, "s": i},
            )
    try:
        yield
    finally:
        async with services.db.admin_tx() as session:
            await session.execute(
                text("delete from learn.topic_status where topic_id = any(:t)"), {"t": topics}
            )
            await session.execute(
                text("delete from content.topics where chapter_id = :c"), {"c": EXTRA_CHAPTER}
            )
            await session.execute(
                text("delete from content.chapters where id = :c"), {"c": EXTRA_CHAPTER}
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


async def test_the_vector_subject_matches_the_fixture_course(
    services: AppServices, second_chapter: None
) -> None:
    async with services.db.admin_tx() as session:
        for subject, topics in VECTOR["subject_topics"].items():
            found = (
                await session.execute(
                    text(
                        "select t.id from content.topics t join content.chapters c"
                        " on c.id = t.chapter_id where c.subject_id = :s order by t.id"
                    ),
                    {"s": subject},
                )
            ).scalars()
            assert list(found) == sorted(topics)


async def test_placement_marks_follow_the_shared_vector(
    client: httpx.AsyncClient, services: AppServices, second_chapter: None
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
    for case in VECTOR["cases"]:
        result = await post_events(client, s, [event(case["type"], case["payload"])])
        codes = [r["code"] for r in result["rejected"]]
        expected = case["expected"]
        assert codes == ([] if expected["accepted"] else [expected["code"]]), case["name"]
        assert await _rows(services, s.user_id) == expected["rows"], case["name"]

    # A pull carries how each topic was learned.
    state = await get_state(client, s)
    by_topic = {t["topic_id"]: t for t in state["topic_progress"]}
    last = VECTOR["cases"][-1]["expected"]["rows"]
    for topic_id, row in last.items():
        if row["status"] == "learned":
            assert by_topic[topic_id]["learned_via"] == row["learned_via"], topic_id
