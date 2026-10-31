"""AI-21 role play with the fake provider: the script comes from the published card (the publish
pass), turns, goals, the turn cap, wrap-up and the summary, the free daily cap, Pro fair use,
replies only for under-13s, stepping out, the crisis card, replay safety, and isolation."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from smriti_api.core.config import REPO_ROOT
from smriti_api.core.deps import AppServices
from smriti_api.services import card_index, roleplay
from tests.helpers import Session
from tests.money_helpers import set_profile
from tests.practice_helpers import flags, learner, make_pro
from tests.test_tutor import fake_llm

CARD = "fx.chapter-a.topic-c:dd:10"
FIXTURES = REPO_ROOT / "content" / "fixtures"


def said(reply: str, goals: list[int] | None = None, step_out: bool = False) -> str:
    return json.dumps({"reply": reply, "goals_met": goals or [], "step_out": step_out})


@pytest.fixture
async def scripts(services: AppServices, content: str) -> AsyncIterator[None]:
    lessons = list(card_index.read_lessons(FIXTURES))
    async with services.db.admin_tx() as session:
        counts = await roleplay.index_scripts(session, lessons)
    assert counts["roleplay"] >= 1
    yield


async def student(
    client: httpx.AsyncClient, services: AppServices, exam: str, band: str
) -> Session:
    s = await learner(client, exam)
    await set_profile(services, s.user_id, age_band=band)
    return s


async def start(client: httpx.AsyncClient, s: Session, card: str = CARD) -> httpx.Response:
    return await client.post("/v1/roleplay/chats", json={"card_id": card}, headers=s.headers)


async def turn(
    client: httpx.AsyncClient, s: Session, chat: str, mid: str | None = None, **body: Any
) -> httpx.Response:
    return await client.post(
        f"/v1/roleplay/chats/{chat}/turns",
        json={"client_message_id": mid or str(uuid.uuid4()), **body},
        headers=s.headers,
    )


async def test_the_publish_pass_indexes_role_play_cards(
    services: AppServices, content: str, tmp_path: Path
) -> None:
    lessons = list(card_index.read_lessons(FIXTURES))
    async with services.db.admin_tx() as session:
        await roleplay.index_scripts(session, lessons)
        row = (
            await session.execute(
                text("select status, script from content.roleplay_scripts where card_id = :c"),
                {"c": CARD},
            )
        ).one()
        assert row.status == "published"
        assert set(row.script) == set(roleplay.SCRIPT_KEYS)
        # A card that leaves its lesson is retired.
        trimmed = [
            {**lesson, "cards": [c for c in lesson["cards"] if c.get("id") != CARD]}
            for lesson in lessons
        ]
        counts = await roleplay.index_scripts(session, trimmed)
        assert counts["roleplay_retired"] >= 1
        status = (
            await session.execute(
                text("select status from content.roleplay_scripts where card_id = :c"),
                {"c": CARD},
            )
        ).scalar_one()
        assert status == "retired"
        await roleplay.index_scripts(session, lessons)


async def test_a_chat_meets_goals_and_ends_with_a_summary(
    client: httpx.AsyncClient, services: AppServices, content: str, scripts: None
) -> None:
    s = await student(client, services, content, "18p")
    with fake_llm(services, [said("First answer", [0]), said("Second answer", [1])]) as fake:
        r = await start(client, s)
        assert r.status_code == 200, r.text
        chat = r.json()
        assert chat["status"] == "open" and chat["goals_total"] == 2 and chat["turns"] == 0
        assert [m["role"] for m in chat["messages"]] == ["character"]
        assert chat["messages"][0]["text"] == "Fixture line C10"
        again = (await start(client, s)).json()
        assert again["session_id"] == chat["session_id"]
        sid = chat["session_id"]

        mid = str(uuid.uuid4())
        one = await turn(client, s, sid, mid, reply_index=0)
        assert one.status_code == 200, one.text
        body = one.json()
        assert body["turns"] == 1 and body["goals_met"] == [0] and body["status"] == "open"
        assert [m["text"] for m in body["messages"]][-2:] == ["Fixture reply 1", "First answer"]
        # The persona and guardrails come from the published card, not the client.
        system = str(fake.calls[0][1][0].content)
        assert "Fixture persona prompt" in system and "Fixture guardrail" in system

        # A retry of the same turn returns the chat without calling the model again.
        calls = len(fake.calls)
        replay = await turn(client, s, sid, mid, reply_index=0)
        assert replay.json()["turns"] == 1 and len(fake.calls) == calls

        two = (await turn(client, s, sid, text="Tell me more")).json()
        assert two["status"] == "ended" and two["end_reason"] == "goals_met"
        assert two["summary"]["found_out"] == [
            {"en": "Fixture goal 1", "hi": "फ़िक्स्चर लक्ष्य 1"},
            {"en": "Fixture goal 2", "hi": "फ़िक्स्चर लक्ष्य 2"},
        ]
        assert [c["id"] for c in two["summary"]["concepts"]] == [
            "fx.chapter-a.topic-c.sub-1.concept-1"
        ]
        r = await turn(client, s, sid, text="One more")
        assert r.status_code == 409 and r.json()["code"] == "roleplay_ended"

    # Role play never uses free tutor messages.
    async with services.db.admin_tx() as session:
        counted = (
            await session.execute(
                text("select count(*) from ai.tutor_messages where user_id = :u and counted"),
                {"u": s.user_id},
            )
        ).scalar_one()
    assert counted == 0
    other = await student(client, services, content, "18p")
    r = await client.get(f"/v1/roleplay/chats/{sid}", headers=other.headers)
    assert r.status_code == 404


async def test_turn_cap_wrap_up_and_the_free_daily_cap(
    client: httpx.AsyncClient, services: AppServices, content: str, scripts: None
) -> None:
    s = await student(client, services, content, "18p")
    async with flags(services, {"roleplay.max_turns": 1, "free.roleplay_chats_per_day": 1}):
        with fake_llm(services, [said("Only answer")]):
            sid = (await start(client, s)).json()["session_id"]
            capped = (await turn(client, s, sid, reply_index=1)).json()
            assert capped["status"] == "ended" and capped["end_reason"] == "turn_cap"
            assert capped["max_turns"] == 1 and capped["summary"]["found_out"] == []
        r = await start(client, s)
        assert r.status_code == 429 and r.json()["code"] == "roleplay_daily_cap"
        assert r.json()["limit"] == 1

        pro = await student(client, services, content, "18p")
        await make_pro(services, pro)
        first = (await start(client, pro)).json()
        wrapped = await client.post(
            f"/v1/roleplay/chats/{first['session_id']}/wrap-up", headers=pro.headers
        )
        assert wrapped.json()["end_reason"] == "wrap_up"
        # Pro has no daily role-play cap; a new chat starts after the last one ended.
        second = await start(client, pro)
        assert second.status_code == 200 and second.json()["session_id"] != first["session_id"]
        with fake_llm(services, [said("Pro answer")]):
            body = (await turn(client, pro, second.json()["session_id"], reply_index=0)).json()
        assert body["quota"] is not None


async def test_under_13s_reply_with_chips_and_little_learners_get_none(
    client: httpx.AsyncClient, services: AppServices, content: str, scripts: None
) -> None:
    child = await student(client, services, content, "10_12")
    sid = (await start(client, child)).json()["session_id"]
    r = await turn(client, child, sid, text="typed")
    assert r.status_code == 422 and r.json()["code"] == "replies_only"
    r = await turn(client, child, sid, reply_index=2)
    assert r.status_code == 422 and r.json()["code"] == "unknown_reply"

    little = await student(client, services, content, "u10")
    r = await start(client, little)
    assert r.status_code == 403 and r.json()["code"] == "roleplay_not_for_age"
    r = await start(client, child, card="fx.chapter-a.topic-c:dd:99")
    assert r.status_code == 404


async def test_stepping_out_and_the_crisis_card(
    client: httpx.AsyncClient, services: AppServices, content: str, scripts: None
) -> None:
    s = await student(client, services, content, "18p")
    sid = (await start(client, s)).json()["session_id"]
    with fake_llm(services, [said("", step_out=True)]) as fake:
        out = (await turn(client, s, sid, text="Tell me something off the lesson")).json()
        assert out["step_out"] is True and out["turns"] == 0
        crisis = (await turn(client, s, sid, text="I want to kill myself")).json()
        assert crisis["safety"] == "crisis" and crisis["turns"] == 0
        assert len(fake.calls) == 1  # the crisis line never reaches the model
    # Neither line is part of the chat the student (or the model) sees.
    assert [m["role"] for m in crisis["messages"]] == ["character"]
    async with services.db.admin_tx() as session:
        flagged = (
            await session.execute(
                text("select count(*) from ai.moderation_flags where user_id = :u"),
                {"u": s.user_id},
            )
        ).scalar_one()
    assert flagged == 1


async def test_roleplay_chats_rls(services: AppServices) -> None:
    from tests.test_rls_wave2 import _claims, _user

    me, other = await _user(services), await _user(services)
    async with services.db.system_tx() as session:
        for u in (me, other):
            sid = (
                await session.execute(
                    text(
                        "insert into ai.tutor_sessions (user_id, mode, locale)"
                        " values (:u, 'roleplay', 'en') returning id"
                    ),
                    {"u": u},
                )
            ).scalar_one()
            await session.execute(
                text(
                    "insert into ai.roleplay_chats (session_id, user_id, card_id, goals_total)"
                    " values (:s, :u, 'x', 1)"
                ),
                {"s": sid, "u": u},
            )
    async with services.db.user_tx(_claims(me)) as session:
        seen = (
            (await session.execute(text("select user_id from ai.roleplay_chats"))).scalars().all()
        )
        assert set(seen) == {me}
    async with services.db.user_tx(_claims(me)) as session:
        changed = await session.execute(text("update ai.roleplay_chats set turns = 5"))
        assert (changed.rowcount or 0) == 0  # type: ignore[attr-defined]
    # The scripts (persona prompts) are service only.
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(me)) as session:
            await session.execute(text("select count(*) from content.roleplay_scripts"))


async def test_the_generic_tutor_endpoint_refuses_role_play_chats(
    client: httpx.AsyncClient, services: AppServices, content: str, scripts: None
) -> None:
    s = await student(client, services, content, "18p")
    sid = (await start(client, s)).json()["session_id"]
    r = await client.post(
        f"/v1/tutor/sessions/{sid}/messages",
        json={"client_message_id": str(uuid.uuid4()), "text": "hi"},
        headers=s.headers,
    )
    assert r.status_code == 409 and r.json()["code"] == "use_roleplay"
