"""The AI gateway (TRD §9.1): the only way features reach a model.

Every call goes through a budget check (per user, per day, per tier) and a usage recorder
(tokens, units, latency, status), and is logged and traced. Prompts and answers are never
logged: only the feature, tier, provider, model and numbers.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, Protocol

import structlog
from sqlalchemy import text

from smriti_api.ai.interfaces import (
    AIError,
    AudioResult,
    BudgetExceeded,
    ChatMessage,
    ImageProvider,
    ImageResult,
    LLMChunk,
    LLMProvider,
    LLMResult,
    RealtimeVoiceProvider,
    STTProvider,
    Tier,
    ToolSpec,
    Transcript,
    TTSProvider,
    VoiceContext,
    VoiceSession,
)
from smriti_api.core.db import Database
from smriti_api.core.logging import hash_user_id
from smriti_api.core.telemetry import tracer

log = structlog.get_logger("ai")

UsageTier = Literal["tutor", "cheap", "author", "image", "tts", "stt", "voice"]


@dataclass(frozen=True)
class Usage:
    user_id: uuid.UUID | None
    tier: UsageTier
    feature: str
    provider: str
    model: str
    status: Literal["ok", "error", "blocked"]
    latency_ms: int
    tokens_in: int = 0
    tokens_out: int = 0
    units: int = 0
    kind: str | None = None  # ai.generations kind for non-chat jobs
    input_hash: str | None = None


class BudgetPolicy(Protocol):
    async def check(self, user_id: uuid.UUID | None, tier: UsageTier) -> None: ...


class UsageRecorder(Protocol):
    async def record(self, usage: Usage) -> None: ...


class NoBudget:
    async def check(self, user_id: uuid.UUID | None, tier: UsageTier) -> None:
        return None


@dataclass
class DailyRequestBudget:
    """Daily request caps per tier from ``ai.usage_daily`` (limits from config). Jobs without a
    user (content generation) are not capped here."""

    db: Database
    limits: dict[str, int]

    async def check(self, user_id: uuid.UUID | None, tier: UsageTier) -> None:
        limit = self.limits.get(tier)
        if user_id is None or not limit:
            return
        async with self.db.system_tx() as session:
            used = (
                await session.execute(
                    text(
                        "select requests from ai.usage_daily where user_id = :u and day = :d and tier = :t"
                    ),
                    {"u": user_id, "d": datetime.now(UTC).date(), "t": tier},
                )
            ).scalar_one_or_none()
        if used is not None and int(used) >= limit:
            raise BudgetExceeded(tier)


@dataclass
class DbUsageRecorder:
    db: Database

    async def record(self, usage: Usage) -> None:
        async with self.db.system_tx() as session:
            if usage.user_id is not None:
                await session.execute(
                    text(
                        """
                        insert into ai.usage_daily as u (user_id, day, tier, requests, tokens_in, tokens_out, units)
                        values (:u, :d, :t, 1, :ti, :to, :un)
                        on conflict (user_id, day, tier) do update set
                          requests = u.requests + 1, tokens_in = u.tokens_in + :ti,
                          tokens_out = u.tokens_out + :to, units = u.units + :un
                        """
                    ),
                    {
                        "u": usage.user_id,
                        "d": datetime.now(UTC).date(),
                        "t": usage.tier,
                        "ti": usage.tokens_in,
                        "to": usage.tokens_out,
                        "un": usage.units,
                    },
                )
            if usage.kind is not None:
                await session.execute(
                    text(
                        "insert into ai.generations (user_id, kind, provider, model, input_hash, latency_ms, status)"
                        " values (:u, :k, :p, :m, :h, :l, :s)"
                    ),
                    {
                        "u": usage.user_id,
                        "k": usage.kind,
                        "p": usage.provider,
                        "m": usage.model,
                        "h": usage.input_hash or "",
                        "l": usage.latency_ms,
                        "s": usage.status,
                    },
                )


@dataclass
class MemoryUsageRecorder:
    records: list[Usage] = field(default_factory=list)

    async def record(self, usage: Usage) -> None:
        self.records.append(usage)


def _hash(*parts: object) -> str:
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()


class AIGateway:
    def __init__(
        self,
        *,
        llm: LLMProvider,
        image: ImageProvider,
        tts: TTSProvider,
        stt: STTProvider,
        voice: RealtimeVoiceProvider,
        budget: BudgetPolicy | None = None,
        recorder: UsageRecorder | None = None,
    ) -> None:
        self.llm = llm
        self.image = image
        self.tts_provider = tts
        self.stt_provider = stt
        self.voice = voice
        self.budget = budget or NoBudget()
        self.recorder = recorder or MemoryUsageRecorder()

    async def _done(self, usage: Usage) -> None:
        log.info(
            "ai_call",
            feature=usage.feature,
            tier=usage.tier,
            provider=usage.provider,
            model=usage.model,
            status=usage.status,
            latency_ms=usage.latency_ms,
            tokens_in=usage.tokens_in,
            tokens_out=usage.tokens_out,
            units=usage.units,
            user=hash_user_id(usage.user_id) if usage.user_id else None,
        )
        await self.recorder.record(usage)

    async def complete(
        self,
        *,
        feature: str,
        tier: Tier,
        messages: Sequence[ChatMessage],
        user_id: uuid.UUID | None = None,
        tools: Sequence[ToolSpec] | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> LLMResult:
        await self.budget.check(user_id, tier)
        start = time.perf_counter()
        with tracer.start_as_current_span(
            "ai.complete", attributes={"ai.feature": feature, "ai.tier": tier}
        ):
            try:
                result = await self.llm.complete(
                    messages, tier=tier, tools=tools, max_tokens=max_tokens, temperature=temperature
                )
            except AIError:
                await self._done(
                    Usage(user_id, tier, feature, self.llm.name, "", "error", _ms(start))
                )
                raise
        await self._done(
            Usage(
                user_id,
                tier,
                feature,
                self.llm.name,
                result.model,
                "ok",
                _ms(start),
                tokens_in=result.tokens_in,
                tokens_out=result.tokens_out,
            )
        )
        return result

    async def stream(
        self,
        *,
        feature: str,
        tier: Tier,
        messages: Sequence[ChatMessage],
        user_id: uuid.UUID | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[LLMChunk]:
        await self.budget.check(user_id, tier)
        start = time.perf_counter()
        out = 0
        status: Literal["ok", "error"] = "ok"
        try:
            async for chunk in self.llm.stream(messages, tier=tier, max_tokens=max_tokens):
                out += len(chunk.delta.split())
                yield chunk
        except AIError:
            status = "error"
            raise
        finally:
            await self._done(
                Usage(user_id, tier, feature, self.llm.name, "", status, _ms(start), tokens_out=out)
            )

    async def generate_image(
        self,
        *,
        feature: str,
        prompt: str,
        user_id: uuid.UUID | None = None,
        size: str = "1K",
        ratio: str = "1:1",
        seed: int | None = None,
        reference_images: Sequence[str] | None = None,
    ) -> ImageResult:
        await self.budget.check(user_id, "image")
        start = time.perf_counter()
        input_hash = _hash(prompt, size, ratio, seed)
        with tracer.start_as_current_span("ai.image", attributes={"ai.feature": feature}):
            try:
                result = await self.image.generate(
                    prompt, size=size, ratio=ratio, seed=seed, reference_images=reference_images
                )
            except AIError:
                await self._done(
                    Usage(
                        user_id,
                        "image",
                        feature,
                        self.image.name,
                        "",
                        "error",
                        _ms(start),
                        kind="image",
                        input_hash=input_hash,
                    )
                )
                raise
        await self._done(
            Usage(
                user_id,
                "image",
                feature,
                self.image.name,
                result.model,
                "ok",
                _ms(start),
                units=len(result.images),
                kind="image",
                input_hash=input_hash,
            )
        )
        return result

    async def tts(
        self,
        *,
        feature: str,
        text_in: str,
        locale: str,
        voice: str | None = None,
        user_id: uuid.UUID | None = None,
    ) -> AudioResult:
        await self.budget.check(user_id, "tts")
        start = time.perf_counter()
        result = await self.tts_provider.tts(text_in, voice=voice, locale=locale)
        await self._done(
            Usage(
                user_id,
                "tts",
                feature,
                self.tts_provider.name,
                result.model,
                "ok",
                _ms(start),
                units=len(text_in),
                kind="tts",
                input_hash=_hash(text_in, voice, locale),
            )
        )
        return result

    async def stt(
        self,
        *,
        feature: str,
        audio: bytes,
        mime: str,
        locale: str,
        user_id: uuid.UUID | None = None,
    ) -> Transcript:
        await self.budget.check(user_id, "stt")
        start = time.perf_counter()
        result = await self.stt_provider.stt(audio, mime=mime, locale=locale)
        await self._done(
            Usage(
                user_id,
                "stt",
                feature,
                self.stt_provider.name,
                result.model,
                "ok",
                _ms(start),
                kind="stt",
                input_hash=_hash(len(audio), mime, locale),
            )
        )
        return result

    async def voice_session(
        self, *, feature: str, context: VoiceContext, user_id: uuid.UUID | None = None
    ) -> VoiceSession:
        await self.budget.check(user_id, "voice")
        start = time.perf_counter()
        session = await self.voice.create_session(context)
        await self._done(
            Usage(user_id, "voice", feature, self.voice.name, session.model, "ok", _ms(start))
        )
        return session


def _ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)
