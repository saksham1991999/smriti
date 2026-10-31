"""Voice tutor, read-aloud, dictation and Feynman (G-2, G-3; tutor-social §A6, §A8, §A9)."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query, Request
from fastapi.responses import JSONResponse

from smriti_api.core.deps import AppServices, Client, CurrentUser, IdempotencyKey, Services
from smriti_api.core.errors import ApiError
from smriti_api.integrations.storage import ObjectStorage
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import voice as v
from smriti_api.services import feynman, speech, tutor_images, voice

router = APIRouter(prefix="/v1", tags=["voice"])

SessionId = Annotated[uuid.UUID, Path()]


def _storage(services: AppServices) -> ObjectStorage:
    if services.integrations is None:
        raise ApiError(503, "storage_unavailable", "Storage isn't configured")
    return services.integrations.storage


@router.get("/voice/quota", response_model=v.VoiceQuota, summary="Voice time left today (AI-13)")
async def voice_quota(services: Services, auth: CurrentUser) -> v.VoiceQuota:
    return await voice.get_quota(services.db, auth)


@router.post(
    "/voice/sessions",
    response_model=v.VoiceSessionOut,
    summary="Start (or reconnect) a voice tutor session: a single-use Gemini Live token",
    responses={503: {"description": "voice_unavailable (not configured, off, or no limit set)"}},
)
async def create_voice_session(
    body: v.VoiceSessionCreate, services: Services, auth: CurrentUser
) -> v.VoiceSessionOut:
    return await voice.create_session(services.db, services.ai, auth, body)


@router.get("/voice/sessions", response_model=list[v.VoiceSummary], summary="Voice history (AI-09)")
async def list_voice_sessions(
    services: Services,
    auth: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[v.VoiceSummary]:
    return await voice.list_sessions(services.db, auth, limit)


@router.post(
    "/voice/sessions/{session_id}/tools",
    response_model=v.ToolCallOut,
    summary="Run a tool the voice tutor called; send the result back to Gemini Live",
)
async def voice_tool(
    session_id: SessionId,
    body: v.ToolCallIn,
    services: Services,
    auth: CurrentUser,
    client: Client,
) -> v.ToolCallOut:
    return await voice.relay_tool(
        services.db,
        auth,
        session_id,
        body,
        client.device_id,
        ai=services.ai,
        images=tutor_images.env(services),
    )


@router.post(
    "/voice/sessions/{session_id}/end",
    response_model=v.VoiceSummary,
    summary="End the session and upload its transcript (AI-15)",
)
async def end_voice_session(
    session_id: SessionId, body: v.VoiceSessionEnd, services: Services, auth: CurrentUser
) -> v.VoiceSummary:
    return await voice.end_session(services.db, _storage(services), auth, session_id, body)


@router.get(
    "/voice/sessions/{session_id}/transcript",
    response_model=v.VoiceTranscript,
    summary="The stored transcript (AI-15 View transcript)",
)
async def voice_transcript(
    session_id: SessionId, services: Services, auth: CurrentUser
) -> v.VoiceTranscript:
    return await voice.transcript(services.db, _storage(services), auth, session_id)


@router.post(
    "/speech/read-aloud",
    response_model=v.ReadAloudOut,
    summary="Read a tutor answer aloud (Deepgram TTS, cached); free within a daily cap",
)
async def read_aloud(body: v.ReadAloudIn, services: Services, auth: CurrentUser) -> v.ReadAloudOut:
    storage = _storage(services)
    assert services.integrations is not None
    return await speech.read_aloud(
        services.db,
        services.ai,
        storage,
        auth,
        body,
        services.integrations.settings.signed_url_ttl_s,
    )


@router.post(
    "/speech/dictation",
    response_model=v.DictationOut,
    summary="Speech to text for voice answers and spoken explanations (audio is not stored)",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"audio/*": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def dictation(
    request: Request,
    services: Services,
    auth: CurrentUser,
    locale: Annotated[Literal["en", "hi"], Query()] = "en",
) -> v.DictationOut:
    length = int(request.headers.get("content-length") or 0)
    if length > speech.MAX_AUDIO_BYTES:
        raise ApiError(413, "audio_too_large", "The recording is too long")
    data = await request.body()
    return await speech.dictate(
        services.db,
        services.ai,
        auth,
        data,
        request.headers.get("content-type", ""),
        locale,
    )


@router.post(
    "/feynman/attempts",
    response_model=v.FeynmanOut,
    summary="Explain a concept back; graded against its key points (AI-10, AI-11)",
)
async def feynman_attempt(
    body: v.FeynmanIn, services: Services, auth: CurrentUser, key: IdempotencyKey
) -> JSONResponse:
    # Counts against the tutor quota, so a retry with the same key replays the first grade.
    return await idempotent(
        services,
        scope="feynman",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=lambda: feynman.submit(services.db, services.ai, auth, body),
    )


@router.get(
    "/feynman/concepts/{concept_id}",
    response_model=list[v.FeynmanOut],
    summary="Earlier explanations of a concept, newest first",
)
async def feynman_history(
    concept_id: Annotated[str, Path(max_length=200)],
    services: Services,
    auth: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=20)] = 5,
) -> list[v.FeynmanOut]:
    return await feynman.history(services.db, auth, concept_id, limit)
