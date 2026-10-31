"""Voice tutor (G-2), read-aloud and dictation (TRD §9.4) and the Feynman tutor (G-3)."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.ai.factory import UnavailableSpeech
from smriti_api.ai.fakes import FakeLLMProvider, FakeRealtimeVoiceProvider
from smriti_api.core.deps import AppServices
from smriti_api.services import voice
from tests.helpers import Session
from tests.money_helpers import grant_pro, set_profile, signed_in
from tests.practice_helpers import flags

CONCEPT = "fx.chapter-a.topic-a.sub-1.concept-1"
TOPIC = "fx.chapter-a.topic-a"
VOICE_ON = {
    "feature.voice_tutor": True,
    "pro.voice_daily_seconds": 600,
    "voice.session_max_seconds": 300,
    "voice.reconnect_seconds": 30,
}


async def adult(client: httpx.AsyncClient, services: AppServices, *, pro: bool = True) -> Session:
    s = await signed_in(client)
    await set_profile(services, s.user_id, age_band="18p")
    if pro:
        await grant_pro(services, s.user_id)
    return s


@contextmanager
def fake_voice(services: AppServices) -> Iterator[FakeRealtimeVoiceProvider]:
    old = services.ai.voice
    fake = FakeRealtimeVoiceProvider()
    services.ai.voice = fake
    try:
        yield fake
    finally:
        services.ai.voice = old


@contextmanager
def llm_replies(services: AppServices, *replies: str) -> Iterator[FakeLLMProvider]:
    old = services.ai.llm
    fake = FakeLLMProvider(list(replies))
    services.ai.llm = fake
    try:
        yield fake
    finally:
        services.ai.llm = old


async def start(client: httpx.AsyncClient, s: Session, **body: Any) -> httpx.Response:
    payload = {"client_session_id": str(uuid.uuid4()), **body}
    return await client.post("/v1/voice/sessions", json=payload, headers=s.headers)


# --- voice -------------------------------------------------------------------------------------------


async def test_voice_gates(client: httpx.AsyncClient, services: AppServices, content: str) -> None:
    s = await adult(client, services, pro=False)
    r = await start(client, s)
    assert r.status_code == 503 and r.json()["reason"] == "feature_off"
    async with flags(services, VOICE_ON):
        r = await start(client, s)
        assert r.status_code == 403 and r.json()["code"] == "pro_required"
        assert r.json()["paywall_source"] == "tutor_voice"
        await grant_pro(services, s.user_id)
        # No key and no fake: a clear 503, never a silent fallback.
        old = services.ai.voice
        services.ai.voice = UnavailableSpeech("Gemini Live")
        try:
            r = await start(client, s)
        finally:
            services.ai.voice = old
        assert r.status_code == 503 and r.json()["reason"] == "not_configured"

        teen = await signed_in(client)
        await set_profile(services, teen.user_id, age_band="13_17")
        await grant_pro(services, teen.user_id)
        r = await start(client, teen)
        assert r.status_code == 403 and r.json()["code"] == "guardian_consent_required"
        assert r.json()["scope"] == "voice"
        little = await signed_in(client)
        await set_profile(services, little.user_id, age_band="u10")
        await grant_pro(services, little.user_id)
        assert (await start(client, little)).json()["code"] == "voice_not_for_age"
    # The fair-use numbers run on their proposed defaults (R54) until the owner sets them.
    async with flags(services, {"feature.voice_tutor": True}):
        q = (await client.get("/v1/voice/quota", headers=s.headers)).json()
        assert q["available"] is True
        assert (q["daily_seconds"], q["session_max_seconds"]) == (900, 600)
        assert (q["reconnect_seconds"], q["background_grace_seconds"]) == (30, 20)


async def test_voice_session_tools_and_transcript(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await adult(client, services)
    client_id = str(uuid.uuid4())
    with fake_voice(services) as fake:
        async with flags(services, VOICE_ON):
            r = await start(client, s, client_session_id=client_id, context_ref=f"topic:{TOPIC}")
            assert r.status_code == 200, r.text
            sess = r.json()
            assert sess["token"] == "fake-voice-token" and sess["resumed"] is False
            assert sess["max_seconds"] == 300 and sess["warn_at_seconds"] == 180
            assert {t["name"] for t in sess["tools"]} == {
                "look_up_concept",
                "show_formula",
                "queue_cards",
                "get_mastery",
                "make_flashcard",
            }
            ctx = fake.contexts[-1]
            assert voice.VOICE_RULES in ctx.system_instruction
            assert "Fixture concept A1" in ctx.system_instruction  # grounded on the topic
            assert ctx.ttl_s == 300 + voice.TOKEN_MARGIN_S

            # Reconnect with the same client id: a fresh token for the same session.
            again = (await start(client, s, client_session_id=client_id)).json()
            assert again["id"] == sess["id"] and again["resumed"] is True

            sid = sess["id"]
            tool = f"/v1/voice/sessions/{sid}/tools"
            board = (
                await client.post(
                    tool,
                    json={"call_id": "c1", "name": "show_formula", "args": {"concept_id": CONCEPT}},
                    headers=s.headers,
                )
            ).json()
            assert board["result"]["board"]["lines"] == [
                "Fixture key point A1.1",
                "Fixture key point A1.2",
            ]
            found = (
                await client.post(
                    tool,
                    json={"call_id": "c2", "name": "look_up_concept", "args": {"query": "Fixture"}},
                    headers=s.headers,
                )
            ).json()
            assert "results" in found["result"]
            mastery = (
                await client.post(
                    tool,
                    json={
                        "call_id": "c3",
                        "name": "get_mastery",
                        "args": {"concept_ids": [CONCEPT]},
                    },
                    headers=s.headers,
                )
            ).json()
            assert mastery["result"] == {"mastery": {CONCEPT: None}}
            queued = await client.post(
                tool,
                json={"call_id": "c4", "name": "queue_cards", "args": {"concept_ids": [CONCEPT]}},
                headers=s.headers,
            )
            assert queued.status_code == 200 and "queued" in queued.json()["result"]
            card = (
                await client.post(
                    tool,
                    json={
                        "call_id": "c5",
                        "name": "make_flashcard",
                        "args": {
                            "front": "What is concept A1?",
                            "back": "Mail me at a@b.co",
                            "concept_id": CONCEPT,
                        },
                    },
                    headers=s.headers,
                )
            ).json()["result"]["flashcard"]
            assert card["deck"] == "from_tutor" and card["concept_id"] == CONCEPT
            assert "a@b.co" not in card["back"]
            missing = (
                await client.post(
                    tool,
                    json={"call_id": "c6", "name": "make_flashcard", "args": {"front": "x"}},
                    headers=s.headers,
                )
            ).json()
            assert missing["result"] == {"error": "front_and_back_required"}
            other = await signed_in(client)
            r = await client.post(
                tool, json={"call_id": "x", "name": "get_mastery"}, headers=other.headers
            )
            assert r.status_code == 404

            ended = await client.post(
                f"/v1/voice/sessions/{sid}/end",
                json={
                    "seconds": 9999,
                    "flashcards_made": 1,
                    "turns": [
                        {
                            "role": "student",
                            "text": "Call me on 98765 43210 about this",
                            "at_ms": 0,
                        },
                        {"role": "tutor", "text": "Let's look at the formula.", "at_ms": 900},
                    ],
                },
                headers=s.headers,
            )
            assert ended.status_code == 200, ended.text
            summary = ended.json()
            # Seconds are capped by the wall clock since the start, never the client's number.
            assert summary["seconds"] <= 10 and summary["has_transcript"] is True
            assert summary["safety"] is None
            assert (
                await client.post(
                    f"/v1/voice/sessions/{sid}/end", json={"seconds": 1}, headers=s.headers
                )
            ).json()["seconds"] == summary["seconds"]
            transcript = (
                await client.get(f"/v1/voice/sessions/{sid}/transcript", headers=s.headers)
            ).json()
            assert "98765" not in transcript["turns"][0]["text"]
            assert "[removed]" in transcript["turns"][0]["text"]
            r = await client.post(
                tool, json={"call_id": "late", "name": "get_mastery"}, headers=s.headers
            )
            assert r.json()["code"] == "voice_session_ended"
            listed = (await client.get("/v1/voice/sessions", headers=s.headers)).json()
            assert listed[0]["id"] == sid and listed[0]["flashcards_made"] == 1


async def test_voice_daily_cap_and_crisis(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await adult(client, services)
    with fake_voice(services):
        async with flags(services, {**VOICE_ON, "pro.voice_daily_seconds": 60}):
            sess = (await start(client, s)).json()
            assert sess["max_seconds"] == 60
            async with services.db.admin_tx() as session:
                await session.execute(
                    text(
                        "update ai.voice_sessions set started_at = started_at - interval '2 minutes'"
                        " where id = :id"
                    ),
                    {"id": sess["id"]},
                )
            ended = (
                await client.post(
                    f"/v1/voice/sessions/{sess['id']}/end",
                    json={
                        "seconds": 70,
                        "turns": [{"role": "student", "text": "I want to die", "at_ms": 0}],
                    },
                    headers=s.headers,
                )
            ).json()
            assert ended["seconds"] == 60
            assert ended["safety"]["kind"] == "crisis"
            r = await start(client, s)
            assert r.status_code == 429 and r.json()["code"] == "voice_daily_limit"
    async with services.db.admin_tx() as session:
        category = (
            await session.execute(
                text(
                    "select category from ai.moderation_flags where source_kind = 'voice_transcript'"
                    " and source_id = :s"
                ),
                {"s": sess["id"]},
            )
        ).scalar_one()
    assert category == "crisis"


async def test_transcripts_follow_tutor_retention(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    assert services.integrations is not None
    storage = services.integrations.storage
    s = await adult(client, services)
    with fake_voice(services):
        async with flags(services, VOICE_ON):
            sess = (await start(client, s)).json()
            await client.post(
                f"/v1/voice/sessions/{sess['id']}/end",
                json={"seconds": 1, "turns": [{"role": "student", "text": "hello"}]},
                headers=s.headers,
            )
    async with services.db.admin_tx() as session:
        key = (
            await session.execute(
                text("select transcript_key from ai.voice_sessions where id = :id"),
                {"id": sess["id"]},
            )
        ).scalar_one()
    assert await storage.get("uploads", key)
    removed = await voice.purge_old_transcripts(
        services.db, storage, now=datetime.now(UTC) + timedelta(days=181)
    )
    assert removed >= 1
    r = await client.get(f"/v1/voice/sessions/{sess['id']}/transcript", headers=s.headers)
    assert r.status_code == 404


# --- read-aloud and dictation ---------------------------------------------------------------------


async def test_read_aloud_cache_and_free_cap(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    free = await adult(client, services, pro=False)
    words = f"Read this aloud {uuid.uuid4().hex}"
    async with flags(services, {"free.tutor_read_aloud_per_day": 1}):
        first = await client.post(
            "/v1/speech/read-aloud", json={"text": words, "locale": "en"}, headers=free.headers
        )
        assert first.status_code == 200, first.text
        body = first.json()
        assert body["cached"] is False and body["quota"]["remaining"] == 0
        audio = await client.get(httpx.URL(body["url"]).raw_path.decode())
        assert audio.content.startswith(b"FAKE-AUDIO:")
        capped = await client.post(
            "/v1/speech/read-aloud", json={"text": words, "locale": "en"}, headers=free.headers
        )
        # At the cap: a toast with the reset time, never a paywall (R35).
        assert capped.status_code == 429 and capped.json()["code"] == "read_aloud_limit"
        assert "paywall_trigger" not in capped.json()
        pro = await adult(client, services)
        again = (
            await client.post(
                "/v1/speech/read-aloud", json={"text": words, "locale": "en"}, headers=pro.headers
            )
        ).json()
        assert again["cached"] is True and again["quota"]["unlimited"] is True


async def test_dictation_is_pro_and_checks_audio(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    free = await adult(client, services, pro=False)
    audio = {"Content-Type": "audio/webm"}
    r = await client.post("/v1/speech/dictation", content=b"abc", headers={**free.headers, **audio})
    assert r.status_code == 403 and r.json()["code"] == "pro_required"
    pro = await adult(client, services)
    r = await client.post(
        "/v1/speech/dictation?locale=hi", content=b"abc", headers={**pro.headers, **audio}
    )
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "[fake transcript]"
    r = await client.post(
        "/v1/speech/dictation",
        content=b"abc",
        headers={**pro.headers, "Content-Type": "text/plain"},
    )
    assert r.status_code == 415


# --- Feynman ------------------------------------------------------------------------------------------


def grade(covered: list[int], wrong: list[int] | None = None, clarity: int = 80) -> str:
    return json.dumps(
        {
            "covered": covered,
            "misconceptions": [
                {"key_point": i, "note": "Mixed up the two ideas."} for i in wrong or []
            ],
            "clarity": clarity,
            "follow_ups": ["What happens at the boundary?"],
        }
    )


@asynccontextmanager
async def feynman_on(services: AppServices) -> AsyncIterator[None]:
    # The fixture explanations are a few words; the proposed minimum (30) is tested separately.
    flag_values = {"feature.feynman": True, "feynman.mastery_weight": 0.2, "feynman.min_words": 1}
    async with flags(services, flag_values):
        yield


async def explain(
    client: httpx.AsyncClient, s: Session, textin: str = "My explanation", **body: Any
) -> httpx.Response:
    payload = {
        "client_attempt_id": str(uuid.uuid4()),
        "concept_id": CONCEPT,
        "explanation": textin,
        **body,
    }
    return await client.post("/v1/feynman/attempts", json=payload, headers=s.headers)


async def test_feynman_grades_against_key_points(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await adult(client, services, pro=False)
    assert (await explain(client, s)).json()["code"] == "feature_disabled"
    async with feynman_on(services):
        r = await explain(client, s)
        assert r.status_code == 403 and r.json()["paywall_source"] == "tutor_feynman"
        await grant_pro(services, s.user_id)
        with llm_replies(services, grade([0], [1]), grade([0, 1])) as llm:
            attempt_id = str(uuid.uuid4())
            r = await explain(client, s, "Here is what I understood", client_attempt_id=attempt_id)
            assert r.status_code == 200, r.text
            first = r.json()
            assert (first["completeness"], first["accuracy"], first["clarity"]) == (50, 50, 80)
            assert [k["status"] for k in first["key_points"]] == ["covered", "misconception"]
            assert first["key_points"][1]["note"] == "Mixed up the two ideas."
            assert first["follow_ups"] == ["What happens at the boundary?"]
            assert first["previous"] is None and first["attempt_no"] == 1
            # The grader saw the course's key points, not invented ones.
            prompt = str(llm.calls[-1][1][-1].content)
            assert "0. Fixture key point A1.1" in prompt and "1. Fixture key point A1.2" in prompt
            # Same client id: the stored result, no second grading call.
            calls = len(llm.calls)
            replay = (await explain(client, s, client_attempt_id=attempt_id)).json()
            assert replay["id"] == first["id"] and len(llm.calls) == calls

            follow = await explain(client, s, "At the boundary it flips", follow_up_of=first["id"])
            assert follow.status_code == 200, follow.text
            assert follow.json()["completeness"] == 100
            assert "First explanation" in str(llm.calls[-1][1][-1].content)

    async with services.db.admin_tx() as session:
        row = (
            await session.execute(
                text(
                    "select mastery, feynman_score, feynman_weight from learn.concept_mastery"
                    " where user_id = :u and concept_id = :c"
                ),
                {"u": s.user_id, "c": CONCEPT},
            )
        ).one()
        stored = (
            await session.execute(
                text("select count(*) from ai.tutor_messages where user_id = :u and counted"),
                {"u": s.user_id},
            )
        ).scalar_one()
    # The latest score (1.0) blended in at weight 0.2 over the count prior (1/3).
    assert abs(float(row.mastery) - (0.8 / 3 + 0.2)) < 1e-4
    assert stored == 2  # each graded explanation is one tutor message on the fair-use cap


async def test_feynman_safety_and_bad_grader_output(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await adult(client, services)
    async with feynman_on(services):
        r = await explain(client, s, "honestly I want to die")
        assert r.status_code == 422 and r.json()["kind"] == "crisis"
        with llm_replies(services, "not json at all"):
            r = await explain(client, s)
        assert r.status_code == 503 and r.json()["code"] == "grading_unavailable"
        async with flags(services, {"feynman.min_words": 50}):
            r = await explain(client, s, "too short")
        assert r.json()["code"] == "too_short"
    # With the proposed default, a few words are too short to grade, but a short message in
    # distress is still screened first and gets the helplines.
    async with flags(services, {"feature.feynman": True}):
        r = await explain(client, s, "too short")
        assert r.json()["code"] == "too_short" and r.json()["min_words"] == 30
        r = await explain(client, s, "honestly I want to die")
        assert r.status_code == 422 and r.json()["kind"] == "crisis"
