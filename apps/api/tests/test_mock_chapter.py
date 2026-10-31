"""LRN-06: a published chapter mock carries its chapter on MockCard (the one chapter its questions
teach); other mocks carry null."""

from __future__ import annotations

import json
import uuid

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from tests.practice_helpers import learner


async def test_a_published_chapter_mock_names_its_chapter(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    mock_id = f"chapter-test-{uuid.uuid4().hex[:8]}"
    async with services.db.admin_tx() as session:
        bp = (
            await session.execute(
                text(
                    "select id, spec, status from content.exam_blueprints where exam_profile_id = :e"
                    " order by version desc limit 1"
                ),
                {"e": content},
            )
        ).one()
        await session.execute(
            text("update content.exam_blueprints set status = 'active' where id = :b"),
            {"b": bp.id},
        )
        questions = (
            await session.execute(
                text(
                    "select distinct qc.question_id from content.question_concepts qc"
                    " join content.concepts c on c.id = qc.concept_id"
                    " join content.subtopics st on st.id = c.subtopic_id"
                    " join content.topics t on t.id = st.topic_id"
                    " where t.chapter_id = 'fx.chapter-a' order by qc.question_id limit 2"
                )
            )
        ).scalars()
        await session.execute(
            text(
                "insert into content.mocks (id, exam_profile_id, blueprint_id, kind, title, status)"
                " values (:id, :e, :bp, 'chapter', cast(:t as jsonb), 'open')"
            ),
            {"id": mock_id, "e": content, "bp": bp.id, "t": json.dumps({"en": "C", "hi": "C"})},
        )
        section = bp.spec["sections"][0]["code"]
        for i, q in enumerate(questions, start=1):
            await session.execute(
                text(
                    "insert into content.mock_items (mock_id, section_code, position, question_id)"
                    " values (:m, :s, :p, :q)"
                ),
                {"m": mock_id, "s": section, "p": i, "q": q},
            )
    try:
        s = await learner(client, content)
        r = await client.get(f"/v1/mocks?exam={content}", headers=s.headers)
        assert r.status_code == 200, r.text
        cards = {c["id"]: c for c in r.json()}
        assert cards[mock_id]["chapter_id"] == "fx.chapter-a"
        assert {c["chapter_id"] for i, c in cards.items() if i != mock_id} == {None}
        detail = await client.get(f"/v1/mocks/{mock_id}", headers=s.headers)
        assert detail.json()["chapter_id"] == "fx.chapter-a"
    finally:
        async with services.db.admin_tx() as session:
            await session.execute(
                text("delete from content.mock_items where mock_id = :m"), {"m": mock_id}
            )
            await session.execute(text("delete from content.mocks where id = :m"), {"m": mock_id})
            await session.execute(
                text("update content.exam_blueprints set status = :s where id = :b"),
                {"b": bp.id, "s": bp.status},
            )
