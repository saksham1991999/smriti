"""Deepgram (TTS and STT) and Gemini Live (realtime voice) adapters (TRD §9.4).

No keys exist in this environment, so these are exercised only through their fakes in tests.
The request shapes follow the providers' public HTTP APIs and must be confirmed in Phase 0
(TRD D3, D6) before production use. Models come from env, never from code.
"""

from __future__ import annotations

from collections.abc import Mapping
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

# STT stays on v1 (/v1/listen); TTS (Flux voices) is on v2 (/v2/speak), R62.
DEEPGRAM_BASE = "https://api.deepgram.com/v1"
DEEPGRAM_TTS_URL = "https://api.deepgram.com/v2/speak"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1alpha"


class DeepgramTTSProvider:
    name = "deepgram"

    def __init__(
        self,
        http: httpx.AsyncClient,
        api_key: str,
        model: str,
        models_by_locale: Mapping[str, str] | None = None,
    ) -> None:
        self._by_locale = {k: v for k, v in (models_by_locale or {}).items() if v}
        if not api_key or not (model or self._by_locale):
            raise AIConfigError(
                "DEEPGRAM_API_KEY and a voice (DEEPGRAM_TTS_MODEL_HI, DEEPGRAM_TTS_MODEL_EN or"
                " DEEPGRAM_TTS_MODEL) are required"
            )
        self._http = http
        self._key = api_key
        self._model = model

    def model_for(self, locale: str) -> str:
        """The voice for the request's language (DEEPGRAM_TTS_MODEL_<LANG>), else the fallback
        DEEPGRAM_TTS_MODEL. Config only: a caller's ``voice`` never picks a model."""
        model = self._by_locale.get(locale.split("-", 1)[0].lower()) or self._model
        if not model:
            raise AIConfigError(f"no Deepgram voice is configured for locale {locale}")
        return model

    async def tts(self, text: str, *, voice: str | None, locale: str) -> AudioResult:
        model = self.model_for(locale)
        resp = await self._http.post(
            DEEPGRAM_TTS_URL,
            params={"model": model, "encoding": "mp3"},
            headers={"Authorization": f"Token {self._key}"},
            json={"text": text},
            timeout=60,
        )
        if resp.status_code >= 400:
            raise AIError(f"deepgram speak failed with HTTP {resp.status_code}")
        if not resp.content:
            raise AIError("deepgram speak returned no audio")
        mime = resp.headers.get("content-type", "audio/mpeg").split(";", 1)[0].strip()
        return AudioResult(audio=resp.content, mime=mime or "audio/mpeg", model=model)


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
