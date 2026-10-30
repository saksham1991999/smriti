"""The AI gateway: tiers from env, budgets, usage records, fakes, and the Agnes request shapes.

The two ``live`` tests call the real Agnes API and run only with ``RUN_LIVE=1`` plus
``AI_TIER_CHEAP_MODEL`` and ``AI_TIER_IMAGE_MODEL`` set (model names never live in code).
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

import httpx
import pytest
import structlog.testing

from smriti_api.ai import gateway as gateway_module
from smriti_api.ai.agnes import AgnesImageProvider, AgnesLLMProvider
from smriti_api.ai.factory import build_gateway
from smriti_api.ai.fakes import (
    FakeImageProvider,
    FakeLLMProvider,
    FakeRealtimeVoiceProvider,
    FakeSTTProvider,
    FakeTTSProvider,
)
from smriti_api.ai.gateway import AIGateway, MemoryUsageRecorder, UsageTier
from smriti_api.ai.interfaces import (
    AIConfigError,
    AIError,
    BudgetExceeded,
    ChatMessage,
    VoiceContext,
)
from smriti_api.ai.tiers import ModelTiers
from smriti_api.core.config import Settings
from smriti_api.core.deps import AppServices

TIERS = ModelTiers(tutor="tier-tutor", cheap="tier-cheap", author="tier-author", image="tier-image")
HELLO = [ChatMessage(role="user", content="hello")]


class CountingBudget:
    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.used = 0

    async def check(self, user_id: uuid.UUID | None, tier: UsageTier) -> None:
        if self.used >= self.limit:
            raise BudgetExceeded(tier)
        self.used += 1


def fake_gateway(budget: CountingBudget | None = None) -> tuple[AIGateway, MemoryUsageRecorder]:
    recorder = MemoryUsageRecorder()
    gw = AIGateway(
        llm=FakeLLMProvider(),
        image=FakeImageProvider(),
        tts=FakeTTSProvider(),
        stt=FakeSTTProvider(),
        voice=FakeRealtimeVoiceProvider(),
        budget=budget,
        recorder=recorder,
    )
    return gw, recorder


def test_tiers_come_from_settings_only() -> None:
    tiers = ModelTiers.from_settings(Settings(ai_tier_cheap_model="from-env"))
    assert tiers.for_tier("cheap") == "from-env"
    with pytest.raises(AIConfigError):
        ModelTiers.from_settings(Settings(ai_tier_tutor_model="")).for_tier("tutor")
    with pytest.raises(AIConfigError):
        ModelTiers.from_settings(Settings(ai_tier_image_model="")).image_model()


async def test_gateway_records_usage_and_enforces_budget() -> None:
    user = uuid.uuid4()
    gw, recorder = fake_gateway(CountingBudget(limit=2))
    result = await gw.complete(feature="tutor", tier="tutor", messages=HELLO, user_id=user)
    assert result.text.startswith("[fake]")
    image = await gw.generate_image(feature="lesson_visual", prompt="a placeholder", user_id=user)
    assert image.images[0].url is not None and image.images[0].url.startswith("fake://")
    with pytest.raises(BudgetExceeded):
        await gw.complete(feature="tutor", tier="cheap", messages=HELLO, user_id=user)
    assert [(u.tier, u.status, u.feature) for u in recorder.records] == [
        ("tutor", "ok", "tutor"),
        ("image", "ok", "lesson_visual"),
    ]
    assert recorder.records[1].kind == "image"
    assert recorder.records[1].input_hash  # a hash, never the prompt


async def test_gateway_stream_tts_stt_and_voice() -> None:
    gw, recorder = fake_gateway()
    chunks = [c async for c in gw.stream(feature="tutor", tier="tutor", messages=HELLO)]
    assert "".join(c.delta for c in chunks) == "[fake] hello"
    assert chunks[-1].done
    audio = await gw.tts(feature="mnemonic_audio", text_in="namaste", locale="hi")
    assert audio.audio.startswith(b"FAKE-AUDIO")
    words = await gw.stt(feature="voice_answer", audio=b"...", mime="audio/webm", locale="en")
    assert words.text == "[fake transcript]"
    session = await gw.voice_session(
        feature="voice_tutor", context=VoiceContext(system_instruction="x", locale="en")
    )
    assert session.provider == "fake"
    assert {u.tier for u in recorder.records} == {"tutor", "tts", "stt", "voice"}


async def test_ai_calls_are_logged_without_text(monkeypatch: pytest.MonkeyPatch) -> None:
    capture = structlog.testing.CapturingLogger()
    monkeypatch.setattr(
        gateway_module,
        "log",
        structlog.wrap_logger(capture, processors=[], wrapper_class=structlog.BoundLogger),
    )
    gw, _ = fake_gateway()
    await gw.complete(
        feature="tutor",
        tier="tutor",
        messages=[ChatMessage(role="user", content="my secret question")],
    )
    calls = [c.kwargs for c in capture.calls if c.kwargs.get("event") == "ai_call"]
    assert len(calls) == 1
    assert "my secret question" not in json.dumps(calls, default=str)
    assert calls[0]["feature"] == "tutor"


async def test_build_gateway_uses_fakes_when_asked(services: AppServices) -> None:
    gw = build_gateway(Settings(ai_provider="fake"), services.db, services.http)
    assert gw.llm.name == gw.image.name == "fake"
    real = build_gateway(
        Settings(ai_provider="agnes", app_env="production"), services.db, services.http
    )
    assert real.llm.name == "agnes"
    with pytest.raises(AIConfigError):
        await real.tts(feature="x", text_in="x", locale="en")


def _mock(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_agnes_chat_request_shape_and_retry() -> None:
    calls: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "url": str(request.url),
                "auth": request.headers["authorization"],
                "body": json.loads(request.content),
            }
        )
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(
            200,
            json={
                "model": "tier-cheap",
                "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 1},
            },
        )

    async with _mock(handler) as http:
        llm = AgnesLLMProvider(http, "https://agnes.test/v1", "", TIERS)
        result = await llm.complete(HELLO, tier="cheap", max_tokens=5)
    assert result.text == "ok"
    assert (result.tokens_in, result.tokens_out) == (3, 1)
    assert len(calls) == 2
    assert calls[1]["url"] == "https://agnes.test/v1/chat/completions"
    assert calls[1]["auth"] == "Bearer dummy"
    assert calls[1]["body"] == {
        "model": "tier-cheap",
        "messages": [{"role": "user", "content": "hello"}],
        "max_tokens": 5,
    }


async def test_agnes_client_errors_do_not_retry() -> None:
    hits = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal hits
        hits += 1
        return httpx.Response(400, json={"error": "bad"})

    async with _mock(handler) as http:
        with pytest.raises(AIError):
            await AgnesLLMProvider(http, "https://agnes.test/v1", "k", TIERS).complete(
                HELLO, tier="tutor"
            )
    assert hits == 1


async def test_agnes_image_request_shape() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        seen["path"] = request.url.path
        return httpx.Response(200, json={"created": 1, "data": [{"url": "https://cdn.test/a.png"}]})

    async with _mock(handler) as http:
        provider = AgnesImageProvider(http, "https://agnes.test/v1", "", TIERS)
        result = await provider.generate(
            "a placeholder scene",
            size="1K",
            ratio="16:9",
            reference_images=["https://ref.test/pet.png"],
        )
    assert result.images[0].url == "https://cdn.test/a.png"
    assert seen["path"] == "/v1/images/generations"
    assert seen["model"] == "tier-image"
    assert (seen["size"], seen["ratio"]) == ("1K", "16:9")
    assert seen["image"] == ["https://ref.test/pet.png"]


def _live_settings() -> Settings:
    settings = Settings(ai_provider="agnes")
    if not (settings.ai_tier_cheap_model and settings.ai_tier_image_model):
        pytest.skip("set AI_TIER_CHEAP_MODEL and AI_TIER_IMAGE_MODEL for the live tests")
    return settings


@pytest.mark.live
async def test_live_agnes_chat() -> None:
    settings = _live_settings()
    async with httpx.AsyncClient() as http:
        llm = AgnesLLMProvider(
            http,
            settings.agnes_base_url,
            os.environ.get("AGNES_AI_API_KEY", ""),
            ModelTiers.from_settings(settings),
        )
        result = await llm.complete(
            [ChatMessage(role="user", content="Reply with the single word: ready")],
            tier="cheap",
            max_tokens=512,
        )
    assert result.text.strip()


@pytest.mark.live
async def test_live_agnes_image() -> None:
    settings = _live_settings()
    async with httpx.AsyncClient() as http:
        provider = AgnesImageProvider(
            http,
            settings.agnes_base_url,
            os.environ.get("AGNES_AI_API_KEY", ""),
            ModelTiers.from_settings(settings),
            timeout_s=360,
        )
        result = await provider.generate(
            "a plain blue circle on a white background", size="1K", ratio="1:1"
        )
    assert result.images and (result.images[0].url or result.images[0].b64_json)
