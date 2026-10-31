"""Challenge duels (tutor-social B10). The server picks the questions, keeps the clock, holds the
keys and scores. Realtime goes through the duel channel: poll ``/duels/{id}/events`` or stream
``/duels/{id}/stream`` (SSE) locally; Supabase Realtime can carry the same events later."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Path, Query, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.deps import CurrentUser, IdempotencyKey, Services, require_attestation
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import social as so
from smriti_api.services import duels

router = APIRouter(prefix="/v1", tags=["duels"])

DuelId = Annotated[uuid.UUID, Path()]
POLL_SECONDS = 1.0
SSE_DOC: dict[int | str, dict[str, Any]] = {
    200: {
        "description": "Server-sent duel events (started, question, answered, reveal, left,"
        " finished, expired, rematch_requested, rematch)",
        "content": {"text/event-stream": {"schema": {"type": "string"}}},
    }
}


@router.get("/duels", response_model=list[so.DuelListItem], summary="My recent duels")
async def list_duels(services: Services, auth: CurrentUser) -> list[so.DuelListItem]:
    return await duels.list_duels(services.db, auth)


@router.post(
    "/duels", response_model=so.DuelState, status_code=201, summary="Challenge a friend, or solo"
)
async def create(body: so.DuelCreate, services: Services, auth: CurrentUser) -> so.DuelState:
    return await duels.create(services.db, auth, body)


@router.post("/duels/random", response_model=so.QueueState, summary="Find a random opponent")
async def random(body: so.RandomIn, services: Services, auth: CurrentUser) -> so.QueueState:
    return await duels.find_random(services.db, auth, body)


@router.get("/duels/random", response_model=so.QueueState, summary="Matching status")
async def random_state(services: Services, auth: CurrentUser) -> so.QueueState:
    return await duels.queue_state(services.db, auth)


@router.delete("/duels/random", status_code=204, summary="Stop looking")
async def random_leave(services: Services, auth: CurrentUser) -> Response:
    await duels.leave_queue(services.db, auth)
    return Response(status_code=204)


@router.get(
    "/duels/code/{code}", response_model=so.DuelState, summary="Open a duel link (/duel/{code} on the brand domain)"
)
async def by_code(
    code: Annotated[str, Path(min_length=4, max_length=40)], services: Services, auth: CurrentUser
) -> so.DuelState:
    return await duels.by_code(services.db, auth, code)


@router.get("/duels/{duel_id}", response_model=so.DuelState, summary="A duel, as I may see it")
async def get(duel_id: DuelId, services: Services, auth: CurrentUser) -> so.DuelState:
    return await duels.get(services.db, auth, duel_id)


@router.post("/duels/{duel_id}/accept", response_model=so.DuelState, summary="Accept a challenge")
async def accept(duel_id: DuelId, services: Services, auth: CurrentUser) -> so.DuelState:
    return await duels.accept(services.db, auth, duel_id)


@router.post("/duels/{duel_id}/decline", status_code=204, summary="Decline a challenge")
async def decline(duel_id: DuelId, services: Services, auth: CurrentUser) -> Response:
    await duels.decline(services.db, auth, duel_id)
    return Response(status_code=204)


@router.post(
    "/duels/{duel_id}/async", response_model=so.DuelState, summary="Send it as a challenge instead"
)
async def send_async(duel_id: DuelId, services: Services, auth: CurrentUser) -> so.DuelState:
    return await duels.send_async(services.db, auth, duel_id)


@router.post(
    "/duels/{duel_id}/answers",
    response_model=so.DuelAnswerOut,
    summary="Answer the open question (idempotent by question, and by Idempotency-Key)",
    # Duel submit is a sensitive endpoint (TRD §14): a device check while the flag is on.
    dependencies=[require_attestation("duel_submit")],
)
async def answer(
    duel_id: DuelId,
    body: so.DuelAnswerIn,
    services: Services,
    auth: CurrentUser,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope=f"duel_answer:{duel_id}",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=lambda: duels.answer(services.db, auth, duel_id, body),
    )


@router.post("/duels/{duel_id}/leave", response_model=so.DuelState, summary="Leave (confirmed)")
async def leave(duel_id: DuelId, services: Services, auth: CurrentUser) -> so.DuelState:
    return await duels.leave(services.db, auth, duel_id)


@router.post("/duels/{duel_id}/rematch", response_model=so.DuelState, summary="Ask for a rematch")
async def rematch(duel_id: DuelId, services: Services, auth: CurrentUser) -> so.DuelState:
    return await duels.rematch(services.db, auth, duel_id)


@router.get(
    "/duels/{duel_id}/events", response_model=so.DuelEvents, summary="Poll the duel channel"
)
async def events(
    duel_id: DuelId,
    services: Services,
    auth: CurrentUser,
    after: Annotated[int, Query(ge=0)] = 0,
) -> so.DuelEvents:
    found, _ = await duels.events(services.db, auth, duel_id, after)
    return found


async def _stream(
    db: Database, auth: AuthContext, duel_id: uuid.UUID, after: int, max_seconds: int
) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    stop = loop.time() + max_seconds
    while True:
        found, ended = await duels.events(db, auth, duel_id, after)
        for e in found.events:
            data = json.dumps(jsonable_encoder(e))
            yield f"id: {e.id}\nevent: {e.kind}\ndata: {data}\n\n"
        after = found.last_event_id
        if ended or loop.time() >= stop:
            yield "event: done\ndata: {}\n\n"
            return
        await asyncio.sleep(POLL_SECONDS)


@router.get(
    "/duels/{duel_id}/stream",
    response_class=StreamingResponse,
    responses=SSE_DOC,
    summary="Stream the duel channel (SSE); reconnect with ?after=",
)
async def stream(
    duel_id: DuelId,
    services: Services,
    auth: CurrentUser,
    after: Annotated[int, Query(ge=0)] = 0,
    max_seconds: Annotated[int, Query(ge=1, le=600)] = 300,
) -> StreamingResponse:
    await duels.events(services.db, auth, duel_id, after)  # 404 before the stream opens
    return StreamingResponse(
        _stream(services.db, auth, duel_id, after, max_seconds),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
