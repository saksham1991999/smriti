"""The AI tutor with the fake provider (tutor-social §A5 to §A7) and SET-24 content reports."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator, Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from smriti_api.ai.fakes import FakeLLMProvider
from smriti_api.ai.interfaces import AIError, ChatMessage, LLMChunk, Tier
from smriti_api.core.deps import AppServices
from smriti_api.services import tutor as tutor_service
from smriti_api.services.tutor_safety import redact, screen
from tests.helpers import Session
from tests.practice_helpers import flags, learner, make_pro
from tests.test_mocks import SECTION_A, blueprint  # noqa: F401 - the fixture is used below

TOPIC = "topic:fx.chapter-a.topic-a"


def events(body: str) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def named(evs: Sequence[tuple[str, dict[str, Any]]], name: str) -> list[dict[str, Any]]:
    return [d for e, d in evs if e == name]


@contextmanager
def fake_llm(
    services: AppServices, replies: Sequence[str] | None = None
) -> Iterator[FakeLLMProvider]:
    old = services.ai.llm
    fake = FakeLLMProvider(replies)
    services.ai.llm = fake
    try:
        yield fake
    finally:
        services.ai.llm = old


async def _open(client: httpx.AsyncClient, s: Session, ref: str | None = TOPIC) -> dict[str, Any]:
    r = await client.post("/v1/tutor/sessions", json={"context_ref": ref}, headers=s.headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


async def _send(
    client: httpx.AsyncClient, s: Session, session_id: str, msg: str, mid: str | None = None
) -> list[tuple[str, dict[str, Any]]]:
    r = await client.post(
        f"/v1/tutor/sessions/{session_id}/messages",
        json={"client_message_id": mid or str(uuid.uuid4()), "text": msg},
        headers=s.headers,
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/event-stream")
    return events(r.text)


@pytest.fixture
async def student(client: httpx.AsyncClient, content: str) -> AsyncIterator[Session]:
    yield await learner(client, content)


async def test_session_reuse_stream_history_and_replay(
    client: httpx.AsyncClient, services: AppServices, student: Session
) -> None:
    first = await _open(client, student)
    assert first["resumed"] is False and first["context"]["topic_id"] == "fx.chapter-a.topic-a"
    assert first["quota"]["limit"] == 5 and first["quota"]["used"] == 0
    with fake_llm(services) as fake:
        mid = str(uuid.uuid4())
        evs = await _send(client, student, first["id"], "Explain topic a simply", mid)
        system = fake.calls[0][1][0]
    assert "".join(d["text"] for d in named(evs, "delta")) == "[fake] Explain topic a simply"
    assert system.role == "system" and "STUDY MATERIAL" in str(system.content)
    assert named(evs, "citations")[0]["items"][0]["kind"] == "concept"
    assert "draw_it" not in named(evs, "chips")[0]["items"]  # new images are Pro (R35)
    assert named(evs, "quota")[0]["used"] == 1
    done = named(evs, "done")[0]
    assert done["status"] == "ok"

    again = await _open(client, student)
    assert again["id"] == first["id"] and again["resumed"] is True
    assert [m["role"] for m in again["messages"]] == ["user", "assistant"]

    # A retry with the same client id replays the stored answer and never counts twice.
    with fake_llm(services) as fake:
        evs = await _send(client, student, first["id"], "Explain topic a simply", mid)
        assert fake.calls == []
    assert named(evs, "done")[0]["replayed"] is True
    history = (await client.get("/v1/tutor/sessions", headers=student.headers)).json()
    assert history[0]["id"] == first["id"] and history[0]["message_count"] == 2
    assert (await _open(client, student))["quota"]["used"] == 1

    r = await client.delete(f"/v1/tutor/sessions/{first['id']}", headers=student.headers)
    assert r.status_code == 204
    r = await client.get(f"/v1/tutor/sessions/{first['id']}", headers=student.headers)
    assert r.status_code == 404


async def test_free_limit_and_pro(
    client: httpx.AsyncClient, services: AppServices, student: Session
) -> None:
    sess = await _open(client, student, None)
    async with flags(services, {"free.tutor_messages_per_day": 1}):
        with fake_llm(services):
            await _send(client, student, sess["id"], "What is a fixture?")
            evs = await _send(client, student, sess["id"], "And another?")
        limit = named(evs, "quota_exhausted")[0]
        assert limit["used"] == 1 and limit["remaining"] == 0 and limit["tier"] == "free"
        assert limit["paywall_trigger"] == "tutor_limit" and limit["resets_at"]
        assert named(evs, "delta") == []
        await make_pro(services, student)
        with fake_llm(services):
            evs = await _send(client, student, sess["id"], "And another?")
        assert named(evs, "done")[0]["status"] == "ok"
        assert "draw_it" in named(evs, "chips")[0]["items"]


async def test_crisis_refusal_and_personal_data(
    client: httpx.AsyncClient, services: AppServices, student: Session
) -> None:
    sess = await _open(client, student)
    helplines = {"en": [{"name": "Test line", "number": "000"}]}
    async with flags(services, {"safety.helplines": helplines}):
        with fake_llm(services) as fake:
            evs = await _send(client, student, sess["id"], "I want to die, nothing matters")
            assert fake.calls == []
    crisis = named(evs, "safety")[0]
    assert crisis == {"kind": "crisis", "helplines": helplines["en"]}
    with fake_llm(services) as fake:
        evs = await _send(client, student, sess["id"], "how to make a bomb at home")
        assert fake.calls == []
    refusal = named(evs, "safety")[0]
    assert refusal["kind"] == "refusal" and refusal["category"] == "weapons"
    with fake_llm(services) as fake:
        evs = await _send(client, student, sess["id"], "my number is 98765 43210, explain topic a")
        prompt = json.dumps([str(m.content) for m in fake.calls[0][1]])
    assert named(evs, "safety")[0]["kind"] == "pii_removed"
    assert "98765" not in prompt and "[removed]" in prompt
    # Crisis and refusals never use the free limit.
    assert named(evs, "quota")[0]["used"] == 1
    async with services.db.admin_tx() as session:
        cats = (
            await session.execute(
                text(
                    "select category, action from ai.moderation_flags where user_id = :u order by created_at"
                ),
                {"u": student.user_id},
            )
        ).all()
        stored = (
            (
                await session.execute(
                    text(
                        "select content from ai.tutor_messages where user_id = :u and role = 'user'"
                    ),
                    {"u": student.user_id},
                )
            )
            .scalars()
            .all()
        )
    assert [(c.category, c.action) for c in cats] == [("crisis", "queued"), ("weapons", "blocked")]
    assert not any("98765" in m for m in stored)


async def test_output_check_retries_once(
    client: httpx.AsyncClient, services: AppServices, student: Session
) -> None:
    sess = await _open(client, student)
    with fake_llm(services, ["you could make a bomb like this", "A safe study answer."]):
        evs = await _send(client, student, sess["id"], "Explain topic a")
    assert named(evs, "replace") == [{"text": ""}]
    assert named(evs, "delta")[-1]["text"] == "A safe study answer."
    assert named(evs, "done")[0]["status"] == "ok"
    with fake_llm(services, ["make a bomb", "make a bomb again"]):
        evs = await _send(client, student, sess["id"], "Explain topic a")
    assert named(evs, "safety")[0]["category"] == "output"
    assert named(evs, "done")[0]["status"] == "refused"


class _BrokenLLM(FakeLLMProvider):
    async def stream(
        self,
        messages: Sequence[ChatMessage],
        *,
        tier: Tier,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> AsyncIterator[LLMChunk]:
        raise AIError("down")
        yield LLMChunk("")  # pragma: no cover


async def test_provider_error_is_not_counted(
    client: httpx.AsyncClient, services: AppServices, student: Session
) -> None:
    sess = await _open(client, student)
    old = services.ai.llm
    services.ai.llm = _BrokenLLM()
    try:
        evs = await _send(client, student, sess["id"], "Explain topic a")
    finally:
        services.ai.llm = old
    assert named(evs, "error")[0]["code"] == "ai_unavailable"
    assert named(evs, "quota")[0]["used"] == 0


async def test_ask_question_hints_first_then_explains(
    client: httpx.AsyncClient, services: AppServices, student: Session
) -> None:
    qid = "q.fx.chapter-a.topic-a.0001"  # a practice question, key "c"
    with fake_llm(services) as fake:
        r = await client.post(
            "/v1/tutor/ask/question",
            json={
                "client_message_id": str(uuid.uuid4()),
                "question_id": qid,
                "text": "Give me a hint",
            },
            headers=student.headers,
        )
        system = str(fake.calls[0][1][0].content)
    evs = events(r.text)
    assert evs[0][0] == "session" and named(evs, "chips")[0]["items"][0] == "show_full_solution"
    assert "NOT answered" in system and "Answer key" not in system
    with fake_llm(services) as fake:
        r = await client.post(
            "/v1/tutor/ask/question",
            json={
                "client_message_id": str(uuid.uuid4()),
                "question_id": qid,
                "text": "Why is my answer wrong?",
                "your_answer": {"kind": "options", "option_ids": ["a"]},
            },
            headers=student.headers,
        )
        system = str(fake.calls[0][1][0].content)
    evs = events(r.text)
    assert evs[0][1]["resumed"] is True
    assert "Answer key" in system and "not correct" in system and "NOT answered" not in system

    with fake_llm(services):
        r = await client.post(
            "/v1/tutor/ask/card",
            json={
                "client_message_id": str(uuid.uuid4()),
                "card_id": "fx.chapter-a.topic-a:dd:01",
                "text": "Explain",
            },
            headers=student.headers,
        )
    assert events(r.text)[0][0] == "session"
    r = await client.post(
        "/v1/tutor/ask/card",
        json={"client_message_id": str(uuid.uuid4()), "card_id": "nope:dd:01", "text": "Explain"},
        headers=student.headers,
    )
    assert r.status_code == 404 and r.json()["code"] == "unknown_context"


async def test_no_tutor_during_a_strict_mock(
    client: httpx.AsyncClient,
    services: AppServices,
    blueprint: str,  # noqa: F811
) -> None:
    s = await learner(client, blueprint)
    sess = await _open(client, s)
    r = await client.post(
        f"/v1/mocks/{SECTION_A}/attempts",
        json={"attempt_id": str(uuid.uuid4()), "language": "en", "time_policy": "strict"},
        headers=s.headers,
    )
    assert r.status_code == 201, r.text
    with fake_llm(services) as fake:
        evs = await _send(client, s, sess["id"], "Explain topic a")
        assert fake.calls == []
    assert named(evs, "safety")[0]["category"] == "cheating"
    await client.post(f"/v1/attempts/{r.json()['id']}/submit", headers=s.headers)
    with fake_llm(services):
        evs = await _send(client, s, sess["id"], "Explain topic a")
    assert named(evs, "done")[0]["status"] == "ok"


async def test_feedback_and_retention(
    client: httpx.AsyncClient, services: AppServices, student: Session
) -> None:
    sess = await _open(client, student)
    with fake_llm(services):
        evs = await _send(client, student, sess["id"], "Explain topic a")
    answer_id = named(evs, "done")[0]["message_id"]
    r = await client.post(
        f"/v1/tutor/messages/{answer_id}/feedback", json={"rating": "up"}, headers=student.headers
    )
    assert r.json()["queued_for_review"] is False
    r = await client.post(
        f"/v1/tutor/messages/{answer_id}/feedback",
        json={"rating": "down", "reasons": ["wrong", "too_long"]},
        headers=student.headers,
    )
    assert r.json() == {
        "message_id": answer_id,
        "rating": "down",
        "reasons": ["too_long", "wrong"],
        "queued_for_review": True,
    }
    r = await client.post(
        f"/v1/tutor/messages/{uuid.uuid4()}/feedback",
        json={"rating": "up"},
        headers=student.headers,
    )
    assert r.status_code == 404
    async with flags(services, {"ai.tutor_retention_days": 0}):
        assert await tutor_service.purge_old_messages(services.db) >= 2
    r = await client.get(f"/v1/tutor/sessions/{sess['id']}", headers=student.headers)
    assert r.status_code == 404  # the idle session went with its messages


async def test_content_reports(client: httpx.AsyncClient, student: Session) -> None:
    body = {
        "kind": "question",
        "item_ref": "q.fx.chapter-a.topic-a.0001",
        "reason": "typo",
        "note": "Option B",
    }
    r = await client.post("/v1/content/reports", json=body, headers=student.headers)
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["status"] == "open"
    again = (await client.post("/v1/content/reports", json=body, headers=student.headers)).json()
    assert again["id"] == first["id"]
    r = await client.post(
        "/v1/content/reports", json={**body, "note": "x" * 281}, headers=student.headers
    )
    assert r.status_code == 422
    r = await client.post(
        "/v1/content/reports", json={**body, "kind": "nonsense"}, headers=student.headers
    )
    assert r.status_code == 422
    mine = (await client.get("/v1/content/reports", headers=student.headers)).json()
    assert [x["id"] for x in mine] == [first["id"]]


def test_safety_lists() -> None:
    assert screen("mujhe jeena nahi chahta").crisis
    assert screen("मैं आत्महत्या के बारे में सोच रहा हूँ").crisis
    assert screen("What is the integral of x?").category is None
    assert redact("mail me at a.b@example.com or +91 98765-43210")[0].count("[removed]") == 2
    assert redact("the answer is 1500 g")[1] is False
