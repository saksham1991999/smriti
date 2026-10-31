"""Deepgram adapters (R62): TTS on ``POST /v2/speak`` (Flux voices) with the model from
``DEEPGRAM_TTS_MODEL`` only; STT stays on ``/v1/listen``. Checked against the speak endpoint's
response shape: raw audio bytes with an audio content type, no JSON envelope."""

from __future__ import annotations

import json

import httpx
import pytest

from smriti_api.ai.interfaces import AIConfigError, AIError
from smriti_api.ai.speech import DeepgramSTTProvider, DeepgramTTSProvider

AUDIO = b"ID3\x04\x00\x00\x00\x00\x00\x00recorded-mp3-frames"
CONFIGURED = "configured-tts-model"  # stands in for whatever DEEPGRAM_TTS_MODEL holds


async def test_tts_posts_to_v2_speak_with_the_configured_model() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200, content=AUDIO, headers={"content-type": "audio/mpeg", "dg-request-id": "r1"}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        tts = DeepgramTTSProvider(http, "test-key", CONFIGURED)
        out = await tts.tts("नमस्ते", voice="something-else", locale="hi")
    req = seen[0]
    assert (req.method, req.url.host, req.url.path) == ("POST", "api.deepgram.com", "/v2/speak")
    assert req.url.params["model"] == CONFIGURED  # never the caller's voice
    assert req.headers["authorization"] == "Token test-key"
    assert json.loads(req.content) == {"text": "नमस्ते"}
    assert (out.audio, out.mime, out.model) == (AUDIO, "audio/mpeg", CONFIGURED)


async def test_tts_errors_and_config() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("model") == "empty":
            return httpx.Response(200, content=b"", headers={"content-type": "audio/mpeg"})
        return httpx.Response(400, json={"err_code": "INVALID_QUERY_PARAMETER"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(AIError, match="HTTP 400"):
            await DeepgramTTSProvider(http, "k", CONFIGURED).tts("hi", voice=None, locale="en")
        with pytest.raises(AIError, match="no audio"):
            await DeepgramTTSProvider(http, "k", "empty").tts("hi", voice=None, locale="en")
        with pytest.raises(AIConfigError):
            DeepgramTTSProvider(http, "k", "")


async def test_stt_stays_on_v1_listen() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        alt = {"transcript": "ok", "confidence": 0.9}
        return httpx.Response(200, json={"results": {"channels": [{"alternatives": [alt]}]}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        out = await DeepgramSTTProvider(http, "k", "configured-stt").stt(
            b"audio", mime="audio/webm", locale="hi"
        )
    assert seen[0].url.path == "/v1/listen" and out.text == "ok"
