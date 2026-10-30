"""Builds the gateway from settings. ``AI_PROVIDER=fake`` uses the fakes everywhere; otherwise
Agnes serves chat and images, and Deepgram / Gemini Live are used when their keys are set.
Without those keys, local and test fall back to the fakes; other environments fail loudly
when the capability is first used."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

import httpx

from smriti_api.ai.agnes import AgnesImageProvider, AgnesLLMProvider
from smriti_api.ai.fakes import (
    FakeImageProvider,
    FakeLLMProvider,
    FakeRealtimeVoiceProvider,
    FakeSTTProvider,
    FakeTTSProvider,
)
from smriti_api.ai.gateway import AIGateway, DailyRequestBudget, DbUsageRecorder
from smriti_api.ai.interfaces import (
    AIConfigError,
    AudioResult,
    ImageProvider,
    ImageResult,
    LLMProvider,
    RealtimeVoiceProvider,
    STTProvider,
    Transcript,
    TTSProvider,
    VoiceContext,
    VoiceSession,
)
from smriti_api.ai.speech import DeepgramSTTProvider, DeepgramTTSProvider, GeminiLiveVoiceProvider
from smriti_api.ai.tiers import ModelTiers
from smriti_api.core.config import Settings
from smriti_api.core.db import Database


class UnavailableSpeech:
    """Stands in when a speech or voice provider has no key outside local/test."""

    name = "unavailable"

    def __init__(self, what: str) -> None:
        self._what = what

    async def tts(self, text: str, *, voice: str | None, locale: str) -> AudioResult:
        raise AIConfigError(f"{self._what} is not configured")

    async def stt(self, audio: bytes, *, mime: str, locale: str) -> Transcript:
        raise AIConfigError(f"{self._what} is not configured")

    async def create_session(self, context: VoiceContext) -> VoiceSession:
        raise AIConfigError(f"{self._what} is not configured")

    async def generate(
        self,
        prompt: str,
        *,
        size: str = "1K",
        ratio: str = "1:1",
        seed: int | None = None,
        reference_images: Sequence[str] | None = None,
        response_format: Literal["url", "b64_json"] = "url",
    ) -> ImageResult:
        raise AIConfigError(f"{self._what} is not configured")


def build_gateway(
    settings: Settings,
    db: Database,
    http: httpx.AsyncClient,
    *,
    daily_limits: dict[str, int] | None = None,
) -> AIGateway:
    tiers = ModelTiers.from_settings(settings)
    llm: LLMProvider
    image: ImageProvider
    tts: TTSProvider
    stt: STTProvider
    voice: RealtimeVoiceProvider
    if settings.ai_provider == "fake":
        llm, image = FakeLLMProvider(), FakeImageProvider()
        tts, stt, voice = FakeTTSProvider(), FakeSTTProvider(), FakeRealtimeVoiceProvider()
    else:
        llm = AgnesLLMProvider(
            http,
            settings.agnes_base_url,
            settings.agnes_ai_api_key,
            tiers,
            settings.ai_request_timeout_s,
        )
        image = AgnesImageProvider(
            http,
            settings.agnes_base_url,
            settings.agnes_ai_api_key,
            tiers,
            settings.ai_image_timeout_s,
        )
        if (
            settings.deepgram_api_key
            and settings.deepgram_tts_model
            and settings.deepgram_stt_model
        ):
            tts = DeepgramTTSProvider(http, settings.deepgram_api_key, settings.deepgram_tts_model)
            stt = DeepgramSTTProvider(http, settings.deepgram_api_key, settings.deepgram_stt_model)
        elif settings.is_dev:
            tts, stt = FakeTTSProvider(), FakeSTTProvider()
        else:
            tts, stt = UnavailableSpeech("Deepgram"), UnavailableSpeech("Deepgram")
        if settings.gemini_api_key and settings.gemini_live_model:
            voice = GeminiLiveVoiceProvider(
                http, settings.gemini_api_key, settings.gemini_live_model
            )
        elif settings.is_dev:
            voice = FakeRealtimeVoiceProvider()
        else:
            voice = UnavailableSpeech("Gemini Live")
    return AIGateway(
        llm=llm,
        image=image,
        tts=tts,
        stt=stt,
        voice=voice,
        budget=DailyRequestBudget(db, daily_limits or {}),
        recorder=DbUsageRecorder(db),
    )
