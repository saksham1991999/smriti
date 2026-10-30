"""Agnes AI providers (TRD §9.3): OpenAI-compatible chat and image generation.

Base URL and key come from env (``AGNES_BASE_URL``, ``AGNES_AI_API_KEY``); the model for each
tier from ``AI_TIER_*_MODEL``. Agnes returns 429 when called too fast (TRD D6), so every call
retries with exponential backoff and honours ``Retry-After``.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Sequence
from typing import Any, Literal

import httpx
import structlog

from smriti_api.ai.interfaces import (
    AIError,
    ChatMessage,
    GeneratedImage,
    ImageResult,
    LLMChunk,
    LLMResult,
    Tier,
    ToolCall,
    ToolSpec,
)
from smriti_api.ai.tiers import ModelTiers

log = structlog.get_logger(__name__)

RETRY_STATUSES = {429, 500, 502, 503, 504}


def _message(m: ChatMessage) -> dict[str, Any]:
    out: dict[str, Any] = {"role": m.role, "content": m.content}
    if m.name:
        out["name"] = m.name
    if m.tool_call_id:
        out["tool_call_id"] = m.tool_call_id
    return out


class _AgnesClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        base_url: str,
        api_key: str,
        *,
        max_attempts: int = 4,
        base_delay_s: float = 1.0,
    ) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        # The cloud proxy injects the real key; any bearer value works there (BUILD_BRIEF "AI").
        self._headers = {
            "Authorization": f"Bearer {api_key or 'dummy'}",
            "Content-Type": "application/json",
        }
        self._max_attempts = max_attempts
        self._base_delay_s = base_delay_s

    async def post(self, path: str, body: dict[str, Any], timeout_s: float) -> dict[str, Any]:
        last: Exception | None = None
        for attempt in range(self._max_attempts):
            try:
                resp = await self._http.post(
                    f"{self._base}{path}", json=body, headers=self._headers, timeout=timeout_s
                )
            except httpx.TransportError as exc:
                last = exc
            else:
                if resp.status_code < 400:
                    data = resp.json()
                    if not isinstance(data, dict):
                        raise AIError("unexpected response shape")
                    return data
                if resp.status_code not in RETRY_STATUSES:
                    raise AIError(f"agnes {path} failed with HTTP {resp.status_code}")
                last = AIError(f"agnes {path} HTTP {resp.status_code}")
                retry_after = resp.headers.get("retry-after")
                if retry_after and retry_after.isdigit():
                    await asyncio.sleep(min(float(retry_after), 30.0))
                    continue
            await asyncio.sleep(self._base_delay_s * (2**attempt))
        raise AIError(f"agnes {path} failed after retries") from last

    async def stream(
        self, path: str, body: dict[str, Any], timeout_s: float
    ) -> AsyncIterator[dict[str, Any]]:
        async with self._http.stream(
            "POST", f"{self._base}{path}", json=body, headers=self._headers, timeout=timeout_s
        ) as resp:
            if resp.status_code >= 400:
                raise AIError(f"agnes {path} stream failed with HTTP {resp.status_code}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if isinstance(chunk, dict):
                    yield chunk


class AgnesLLMProvider:
    name = "agnes"

    def __init__(
        self,
        http: httpx.AsyncClient,
        base_url: str,
        api_key: str,
        tiers: ModelTiers,
        timeout_s: float = 60.0,
    ) -> None:
        self._client = _AgnesClient(http, base_url, api_key)
        self._tiers = tiers
        self._timeout_s = timeout_s

    def _body(
        self,
        messages: Sequence[ChatMessage],
        tier: Tier,
        tools: Sequence[ToolSpec] | None,
        max_tokens: int | None,
        temperature: float | None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": self._tiers.for_tier(tier),
            "messages": [_message(m) for m in messages],
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if temperature is not None:
            body["temperature"] = temperature
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                }
                for t in tools
            ]
        return body

    async def complete(
        self,
        messages: Sequence[ChatMessage],
        *,
        tier: Tier,
        tools: Sequence[ToolSpec] | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> LLMResult:
        body = self._body(messages, tier, tools, max_tokens, temperature)
        data = await self._client.post("/chat/completions", body, self._timeout_s)
        choices = data.get("choices") or []
        if not choices:
            raise AIError("agnes returned no choices")
        msg = choices[0].get("message") or {}
        usage = data.get("usage") or {}
        calls = [
            ToolCall(
                id=str(c.get("id", "")),
                name=str((c.get("function") or {}).get("name", "")),
                arguments=str((c.get("function") or {}).get("arguments", "")),
            )
            for c in msg.get("tool_calls") or []
        ]
        return LLMResult(
            text=str(msg.get("content") or ""),
            model=str(data.get("model") or body["model"]),
            tokens_in=int(usage.get("prompt_tokens") or 0),
            tokens_out=int(usage.get("completion_tokens") or 0),
            finish_reason=choices[0].get("finish_reason"),
            tool_calls=calls,
        )

    async def stream(
        self,
        messages: Sequence[ChatMessage],
        *,
        tier: Tier,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> AsyncIterator[LLMChunk]:
        body = self._body(messages, tier, None, max_tokens, temperature)
        body["stream"] = True
        async for chunk in self._client.stream("/chat/completions", body, self._timeout_s):
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = (choices[0].get("delta") or {}).get("content") or ""
            finish = choices[0].get("finish_reason")
            yield LLMChunk(delta=str(delta), done=finish is not None, finish_reason=finish)


class AgnesImageProvider:
    name = "agnes"

    def __init__(
        self,
        http: httpx.AsyncClient,
        base_url: str,
        api_key: str,
        tiers: ModelTiers,
        timeout_s: float = 360.0,
    ) -> None:
        self._client = _AgnesClient(http, base_url, api_key, base_delay_s=3.0)
        self._tiers = tiers
        self._timeout_s = timeout_s

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
        model = self._tiers.image_model()
        body: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "size": size,
            "ratio": ratio,
            "response_format": response_format,
        }
        if seed is not None:
            body["seed"] = seed
        if reference_images:
            body["image"] = list(reference_images)
        data = await self._client.post("/images/generations", body, self._timeout_s)
        images = [
            GeneratedImage(
                url=d.get("url"), b64_json=d.get("b64_json"), revised_prompt=d.get("revised_prompt")
            )
            for d in data.get("data") or []
            if isinstance(d, dict)
        ]
        if not images:
            raise AIError("agnes returned no images")
        return ImageResult(images=images, model=model)
