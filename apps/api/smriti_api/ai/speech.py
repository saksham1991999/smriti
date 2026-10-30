"""Deepgram (TTS and STT) and Gemini Live (realtime voice) adapters (TRD §9.4).

No keys exist in this environment, so these are exercised only through their fakes in tests.
The request shapes follow the providers' public HTTP APIs and must be confirmed in Phase 0
(TRD D3, D6) before production use. Models come from env, never from code.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx

from smriti_api.ai.interfaces import (
    AIConfigError,
    AIError,
    AudioResult,
    Transcript,
    VoiceContext,
    VoiceSession,
)

DEEPGRAM_BASE = "https://api.deepgram.com/v1"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1alpha"


class DeepgramTTSProvider:
    name = "deepgram"

    def __init__(self, http: httpx.AsyncClient, api_key: str, model: str) -> None:
        if not api_key or not model:
            raise AIConfigError("DEEPGRAM_API_KEY and DEEPGRAM_TTS_MODEL are required")
        self._http = http
        self._key = api_key
        self._model = model

    async def tts(self, text: str, *, voice: str | None, locale: str) -> AudioResult:
        model = voice or self._model
        resp = await self._http.post(
            f"{DEEPGRAM_BASE}/speak",
            params={"model": model, "encoding": "mp3"},
            headers={"Authorization": f"Token {self._key}"},
            json={"text": text},
            timeout=60,
        )
        if resp.status_code >= 400:
            raise AIError(f"deepgram speak failed with HTTP {resp.status_code}")
        return AudioResult(audio=resp.content, mime="audio/mpeg", model=model)


class DeepgramSTTProvider:
    name = "deepgram"

    def __init__(self, http: httpx.AsyncClient, api_key: str, model: str) -> None:
        if not api_key or not model:
            raise AIConfigError("DEEPGRAM_API_KEY and DEEPGRAM_STT_MODEL are required")
        self._http = http
        self._key = api_key
        self._model = model

    async def stt(self, audio: bytes, *, mime: str, locale: str) -> Transcript:
        resp = await self._http.post(
            f"{DEEPGRAM_BASE}/listen",
            params={"model": self._model, "language": locale, "smart_format": "true"},
            headers={"Authorization": f"Token {self._key}", "Content-Type": mime},
            content=audio,
            timeout=120,
        )
        if resp.status_code >= 400:
            raise AIError(f"deepgram listen failed with HTTP {resp.status_code}")
        alt = resp.json()["results"]["channels"][0]["alternatives"][0]
        return Transcript(
            text=str(alt.get("transcript", "")), model=self._model, confidence=alt.get("confidence")
        )


class GeminiLiveVoiceProvider:
    """Mints a short-lived, single-use Gemini Live token locked to the tutor config, so the
    device streams audio to Gemini directly and the API key never reaches it."""

    name = "gemini_live"

    def __init__(
        self, http: httpx.AsyncClient, api_key: str, model: str, ttl_s: int = 1800
    ) -> None:
        if not api_key or not model:
            raise AIConfigError("GEMINI_API_KEY and GEMINI_LIVE_MODEL are required")
        self._http = http
        self._key = api_key
        self._model = model
        self._ttl_s = ttl_s

    async def create_session(self, context: VoiceContext) -> VoiceSession:
        now = datetime.now(UTC)
        ttl = min(context.ttl_s or self._ttl_s, self._ttl_s)
        expires = now + timedelta(seconds=ttl)
        setup: dict[str, object] = {
            "model": f"models/{self._model}",
            "generationConfig": {"responseModalities": ["AUDIO"]},
            "systemInstruction": {"parts": [{"text": context.system_instruction}]},
            # Captions on both sides (tutor-social §A9 step 4) come from Live's transcription.
            "inputAudioTranscription": {},
            "outputAudioTranscription": {},
        }
        if context.tools:
            setup["tools"] = [
                {
                    "functionDeclarations": [
                        {"name": t.name, "description": t.description, "parameters": t.parameters}
                        for t in context.tools
                    ]
                }
            ]
        body = {
            "uses": 1,
            "expireTime": expires.isoformat().replace("+00:00", "Z"),
            "newSessionExpireTime": (now + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
            # The token is locked to this setup, so a device can't change the instructions.
            "bidiGenerateContentSetup": setup,
        }
        resp = await self._http.post(
            f"{GEMINI_BASE}/auth_tokens",
            headers={"x-goog-api-key": self._key},
            json=body,
            timeout=15,
        )
        if resp.status_code >= 400:
            raise AIError(f"gemini auth token failed with HTTP {resp.status_code}")
        return VoiceSession(
            token=str(resp.json()["name"]),
            expires_at=expires,
            model=self._model,
            provider=self.name,
        )
