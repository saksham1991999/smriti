"""The AI tutor (docs/flows/tutor-social.md §A5, §A14) and SET-24 content reports (R39).

Answers stream as server-sent events. Event types: ``session`` (ask endpoints only), ``delta``,
``replace``, ``safety`` (``crisis``, ``refusal``, ``redirect``, ``pii_removed``), ``citations``,
``chips``, ``quota``, ``quota_exhausted``, ``error`` and ``done``; "Draw it" answers add
``image_ready``, ``image_pending`` or ``image_failed`` before ``citations``.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Path, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from smriti_api.core.deps import CurrentUser, IdempotencyKey, Services
from smriti_api.core.errors import ApiError
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import tutor as t
from smriti_api.schemas import tutor_images as ti
from smriti_api.services import content_reports, doubt_photo, tutor, tutor_images

router = APIRouter(prefix="/v1", tags=["tutor"])

SessionId = Annotated[uuid.UUID, Path()]
SSE_DOC: dict[int | str, dict[str, Any]] = {
    200: {
        "description": "Server-sent events (delta, replace, safety, image_ready, image_pending,"
        " image_failed, citations, chips, quota, quota_exhausted, error, done)",
        "content": {"text/event-stream": {"schema": {"type": "string"}}},
    }
}
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _sse(body: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(body, media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post(
    "/tutor/sessions",
    response_model=t.TutorSession,
    summary="Open a tutor chat; a chat on the same context from the last 30 min reopens",
)
async def open_session(
    body: t.SessionCreate, services: Services, auth: CurrentUser
) -> t.TutorSession:
    return await tutor.open_session(services.db, auth, body)


@router.get(
    "/tutor/sessions", response_model=list[t.SessionSummary], summary="Chat history (AI-09)"
)
async def list_sessions(
    services: Services,
    auth: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    before: Annotated[datetime | None, Query()] = None,
) -> list[t.SessionSummary]:
    return await tutor.list_sessions(services.db, auth, limit, before)


@router.get("/tutor/sessions/{session_id}", response_model=t.TutorSession, summary="One chat")
async def get_session(
    session_id: SessionId, services: Services, auth: CurrentUser
) -> t.TutorSession:
    return await tutor.get_session(services.db, auth, session_id)


@router.delete("/tutor/sessions/{session_id}", status_code=204, summary="Delete a chat")
async def delete_session(session_id: SessionId, services: Services, auth: CurrentUser) -> Response:
    await tutor.delete_session(services.db, auth, session_id)
    return Response(status_code=204)


@router.post(
    "/tutor/sessions/{session_id}/messages",
    response_class=StreamingResponse,
    responses=SSE_DOC,
    summary="Send a message; the answer streams back (SSE)",
)
async def send_message(
    session_id: SessionId, body: t.MessageIn, services: Services, auth: CurrentUser
) -> StreamingResponse:
    plan = await tutor.prepare(services.db, services.ai, auth, session_id, body)
    return _sse(tutor.stream(services.db, services.ai, auth, plan, tutor_images.env(services)))


async def _with_session(
    session_id: uuid.UUID, resumed: bool, body: AsyncIterator[str]
) -> AsyncIterator[str]:
    yield tutor.sse("session", {"session_id": str(session_id), "resumed": resumed})
    async for event in body:
        yield event


@router.post(
    "/tutor/ask/card",
    response_class=StreamingResponse,
    responses=SSE_DOC,
    summary="Ask about this card (LES-04, MEM-03): opens or reuses the card's chat (SSE)",
)
async def ask_card(body: t.AskCard, services: Services, auth: CurrentUser) -> StreamingResponse:
    session_id, resumed = await tutor.open_for(services.db, auth, f"card:{body.card_id}", body.exam)
    plan = await tutor.prepare(services.db, services.ai, auth, session_id, body)
    return _sse(
        _with_session(
            session_id,
            resumed,
            tutor.stream(services.db, services.ai, auth, plan, tutor_images.env(services)),
        )
    )


@router.post(
    "/tutor/ask/question",
    response_class=StreamingResponse,
    responses=SSE_DOC,
    summary="Ask about this question (LES-02, PRC-05, MOCK-22): hints first until answered (SSE)",
)
async def ask_question(
    body: t.AskQuestion, services: Services, auth: CurrentUser
) -> StreamingResponse:
    your_answer, answered = await tutor.check_your_answer(
        services.db, body.question_id, body.your_answer
    )
    ref = f"question:{body.question_id}"
    session_id, resumed = await tutor.open_for(
        services.db, auth, ref, body.exam, answered_now=answered
    )
    plan = await tutor.prepare(
        services.db,
        services.ai,
        auth,
        session_id,
        body,
        your_answer=your_answer,
        answered_now=answered,
    )
    return _sse(
        _with_session(
            session_id,
            resumed,
            tutor.stream(services.db, services.ai, auth, plan, tutor_images.env(services)),
        )
    )


@router.post(
    "/tutor/messages/{message_id}/feedback",
    response_model=t.FeedbackOut,
    summary="Thumbs up or down with reason codes (AI-05)",
)
async def message_feedback(
    message_id: Annotated[uuid.UUID, Path()],
    body: t.FeedbackIn,
    services: Services,
    auth: CurrentUser,
) -> t.FeedbackOut:
    return await tutor.feedback(services.db, auth, message_id, body)


@router.post(
    "/content/reports",
    response_model=t.ContentReportOut,
    status_code=201,
    tags=["content"],
    summary="Report a problem with content or AI output (SET-24)",
)
async def report_content(
    body: t.ContentReportIn, services: Services, auth: CurrentUser
) -> t.ContentReportOut:
    return await content_reports.create(services.db, auth, body)


@router.get(
    "/content/reports",
    response_model=list[t.ContentReportOut],
    tags=["content"],
    summary="The student's own reports and their status",
)
async def my_reports(
    services: Services, auth: CurrentUser, limit: Annotated[int, Query(ge=1, le=100)] = 20
) -> list[t.ContentReportOut]:
    return await content_reports.mine(services.db, auth, limit)


# --- photo doubt (tutor-social §A10, AI-16 to AI-19) ----------------------------------------------

PhotoId = Annotated[uuid.UUID, Path()]
_PHOTO_BODY: dict[str, Any] = {
    "requestBody": {
        "required": True,
        "description": "One compressed photo of one question (at most 4 MiB)",
        "content": {
            mime: {"schema": {"type": "string", "format": "binary"}}
            for mime in ("image/jpeg", "image/png", "image/webp")
        },
    }
}


async def _read_capped(request: Request, cap: int) -> bytes:
    """The request body, refused once it passes ``cap`` (never buffered beyond that)."""
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > cap:
            raise ApiError(413, "photo_too_large", "That photo is too large", limit=cap)
        chunks.append(chunk)
    return b"".join(chunks)


@router.post(
    "/ai/doubt-photos",
    response_model=t.DoubtPhotoOut,
    status_code=201,
    openapi_extra=_PHOTO_BODY,
    summary="AI-16 to AI-18: upload a photo of a question and read it (Pro, 13+, uploads scope)",
)
async def upload_doubt_photo(
    request: Request,
    services: Services,
    auth: CurrentUser,
    key: IdempotencyKey,
    exam: Annotated[str | None, Query(max_length=200)] = None,
) -> JSONResponse:
    if services.integrations is None:
        raise ApiError(503, "integrations_unavailable", "This service is not set up here")
    storage = services.integrations.storage
    data = await _read_capped(request, doubt_photo.MAX_PHOTO_BYTES)
    # A retried upload (same key, same bytes) returns the first read instead of a second one
    # against the quota. Only the digest is fingerprinted; the image is never stored for this.
    return await idempotent(
        services,
        scope="doubt_photo",
        subject=auth.user_id,
        key=key,
        body={"sha256": hashlib.sha256(data).hexdigest(), "exam": exam},
        status=201,
        fn=lambda: doubt_photo.upload(services.db, services.ai, storage, auth, data, exam),
    )


@router.get(
    "/ai/doubt-photos/{photo_id}",
    response_model=t.DoubtPhotoOut,
    summary="A photo doubt: what was read, and its chat once solved",
)
async def get_doubt_photo(
    photo_id: PhotoId, services: Services, auth: CurrentUser
) -> t.DoubtPhotoOut:
    return await doubt_photo.get(services.db, auth, photo_id)


@router.get(
    "/ai/doubt-photos/{photo_id}/similar",
    response_model=t.DoubtSimilarOut,
    summary="AI-19: the concepts the question matches and similar published questions",
)
async def similar_to_doubt_photo(
    photo_id: PhotoId,
    services: Services,
    auth: CurrentUser,
    count: Annotated[int, Query(ge=1, le=30)] = 10,
) -> t.DoubtSimilarOut:
    return await doubt_photo.similar(services.db, auth, photo_id, count)


@router.post(
    "/ai/doubt-photos/{photo_id}/solve",
    response_class=StreamingResponse,
    responses=SSE_DOC,
    summary="AI-19: solve the confirmed question as a tutor chat, hints first (SSE)",
)
async def solve_doubt_photo(
    photo_id: PhotoId, body: t.DoubtSolve, services: Services, auth: CurrentUser
) -> StreamingResponse:
    session_id, resumed = await doubt_photo.open_solve(services.db, auth, photo_id, body)
    plan = await tutor.prepare(services.db, services.ai, auth, session_id, body)
    return _sse(
        _with_session(
            session_id,
            resumed,
            tutor.stream(services.db, services.ai, auth, plan, tutor_images.env(services)),
        )
    )


# --- tutor pictures ("Draw it", the voice board) ------------------------------------------------

GenerationId = Annotated[uuid.UUID, Path()]


@router.get(
    "/ai/generations/{generation_id}",
    response_model=ti.GenerationOut,
    summary="A tutor picture: its status, and a short-lived signed link once ready",
)
async def get_generation(
    generation_id: GenerationId, services: Services, auth: CurrentUser
) -> ti.GenerationOut:
    return await tutor_images.get_generation(
        services.db, tutor_images.env(services), auth.user_id, auth.claims, generation_id
    )


@router.post(
    "/ai/generations/{generation_id}/retry",
    response_model=ti.GenerationOut,
    summary="[Try again] a failed tutor picture, once; never counts as a message",
)
async def retry_generation(
    generation_id: GenerationId, services: Services, auth: CurrentUser
) -> ti.GenerationOut:
    return await tutor_images.retry(
        services.db, tutor_images.env(services), auth.user_id, generation_id
    )
