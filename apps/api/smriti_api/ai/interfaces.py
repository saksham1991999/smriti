"""Provider interfaces for the AI gateway (TRD §9.1). Features call ``AIGateway``, never these
directly, and never a provider SDK (AGENTS.md rule 4)."""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, Protocol

Tier = Literal["tutor", "cheap", "author"]
Role = Literal["system", "user", "assistant", "tool"]


class AIError(Exception):
    """A provider failed after retries."""


class AIConfigError(AIError):
    """A tier or provider is not configured (for example AI_TIER_TUTOR_MODEL is empty)."""


class BudgetExceeded(AIError):
    def __init__(self, tier: str) -> None:
        super().__init__(f"daily AI budget reached for tier {tier}")
        self.tier = tier


@dataclass(frozen=True)
class ChatMessage:
    role: Role
    content: str | list[dict[str, Any]]
    name: str | None = None
    tool_call_id: str | None = None


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: str


@dataclass(frozen=True)
class LLMResult:
    text: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0
    finish_reason: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)


@dataclass(frozen=True)
class LLMChunk:
    delta: str
    done: bool = False
    finish_reason: str | None = None


@dataclass(frozen=True)
class GeneratedImage:
    url: str | None = None
    b64_json: str | None = None
    revised_prompt: str | None = None


@dataclass(frozen=True)
class ImageResult:
    images: list[GeneratedImage]
    model: str


@dataclass(frozen=True)
class AudioResult:
    audio: bytes
    mime: str
    model: str


@dataclass(frozen=True)
class Transcript:
    text: str
    model: str
    confidence: float | None = None


@dataclass(frozen=True)
class VoiceContext:
    system_instruction: str
    locale: str
    tools: Sequence[ToolSpec] = ()
    # How long the minted token may be used; the provider's default when None.
    ttl_s: int | None = None


@dataclass(frozen=True)
class VoiceSession:
    token: str
    expires_at: datetime
    model: str
    provider: str


class LLMProvider(Protocol):
    name: str

    async def complete(
        self,
        messages: Sequence[ChatMessage],
        *,
        tier: Tier,
        tools: Sequence[ToolSpec] | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> LLMResult: ...

    def stream(
        self,
        messages: Sequence[ChatMessage],
        *,
        tier: Tier,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> AsyncIterator[LLMChunk]: ...


class ImageProvider(Protocol):
    name: str

    async def generate(
        self,
        prompt: str,
        *,
        size: str = "1K",
        ratio: str = "1:1",
        seed: int | None = None,
        reference_images: Sequence[str] | None = None,
        response_format: Literal["url", "b64_json"] = "url",
    ) -> ImageResult: ...


class TTSProvider(Protocol):
    name: str

    async def tts(self, text: str, *, voice: str | None, locale: str) -> AudioResult: ...


class STTProvider(Protocol):
    name: str

    async def stt(self, audio: bytes, *, mime: str, locale: str) -> Transcript: ...


class RealtimeVoiceProvider(Protocol):
    name: str

    async def create_session(self, context: VoiceContext) -> VoiceSession: ...
