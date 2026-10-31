"""Fakes for every provider interface. They are clearly fake: names start with ``Fake`` and
outputs are marked (``fake://`` URLs, ``[fake]`` text), so nothing can pass for real output."""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime, timedelta
from typing import Literal

from smriti_api.ai.interfaces import (
    AudioResult,
    ChatMessage,
    GeneratedImage,
    ImageResult,
    LLMChunk,
    LLMResult,
    Tier,
    ToolSpec,
    Transcript,
    VoiceContext,
    VoiceSession,
)


class FakeLLMProvider:
    name = "fake"

    def __init__(self, replies: Sequence[str] | None = None) -> None:
        self._replies = list(replies or [])
        self.calls: list[tuple[Tier, list[ChatMessage]]] = []

    def _next(self, messages: Sequence[ChatMessage]) -> str:
        if self._replies:
            return self._replies.pop(0)
        last = next((m.content for m in reversed(messages) if m.role == "user"), "")
        return f"[fake] {last if isinstance(last, str) else 'ok'}"

    async def complete(
        self,
        messages: Sequence[ChatMessage],
        *,
        tier: Tier,
        tools: Sequence[ToolSpec] | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> LLMResult:
        self.calls.append((tier, list(messages)))
        text = self._next(messages)
        return LLMResult(
            text=text, model=f"fake-{tier}", tokens_in=len(messages), tokens_out=len(text.split())
        )

    async def stream(
        self,
        messages: Sequence[ChatMessage],
        *,
        tier: Tier,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> AsyncIterator[LLMChunk]:
        self.calls.append((tier, list(messages)))
        words = self._next(messages).split(" ")
        for i, word in enumerate(words):
            yield LLMChunk(
                delta=word + (" " if i < len(words) - 1 else ""), done=i == len(words) - 1
            )


class FakeImageProvider:
    name = "fake"

    def __init__(self) -> None:
        self.prompts: list[str] = []

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
        self.prompts.append(prompt)
        digest = hashlib.sha256(f"{prompt}|{size}|{ratio}|{seed}".encode()).hexdigest()[:16]
        return ImageResult(
            images=[GeneratedImage(url=f"fake://image/{digest}")], model="fake-image"
        )


class FakeTTSProvider:
    name = "fake"

    async def tts(self, text: str, *, voice: str | None, locale: str) -> AudioResult:
        return AudioResult(
            audio=b"FAKE-AUDIO:" + text.encode()[:32], mime="audio/mpeg", model="fake-tts"
        )


class FakeSTTProvider:
    name = "fake"

    def __init__(self, text: str = "[fake transcript]") -> None:
        self._text = text

    async def stt(self, audio: bytes, *, mime: str, locale: str) -> Transcript:
        return Transcript(text=self._text, model="fake-stt", confidence=1.0)


class FakeRealtimeVoiceProvider:
    name = "fake"

    def __init__(self) -> None:
        self.contexts: list[VoiceContext] = []

    async def create_session(self, context: VoiceContext) -> VoiceSession:
        self.contexts.append(context)
        return VoiceSession(
            token="fake-voice-token",  # noqa: S106 - a fake's marker value
            expires_at=datetime.now(UTC) + timedelta(seconds=context.ttl_s or 600),
            model="fake-voice",
            provider=self.name,
        )
