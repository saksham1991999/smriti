"""Live mocks (Phase 3, practice §6.11): registration, the room, the leaderboard and the
Server-Sent Events fallback for the realtime channel. The clock offset uses GET /v1/time."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from smriti_api.core.auth import AuthContext
from smriti_api.core.deps import CurrentUser, Services, signed_in
from smriti_api.integrations.realtime import RedisRealtime
from smriti_api.schemas import live as lv
from smriti_api.services import live_mocks

router = APIRouter(prefix="/v1", tags=["live"])
# Live mocks are Pro, so a guest is sent to sign in on the way to the trial (auth §4).
SignedIn = Annotated[AuthContext, signed_in("start_trial")]


@router.get(
    "/live/mocks/{mock_id}",
    response_model=lv.LiveRoom,
    summary="The live mock room (MOCK-03): status, server time and your deadline if you start now",
)
async def room(mock_id: str, services: Services, auth: CurrentUser) -> lv.LiveRoom:
    return await live_mocks.room(services.db, auth, mock_id)


@router.post(
    "/live/mocks/{mock_id}/registration",
    response_model=lv.Registration,
    summary="Register for a live mock (Pro); the reminder comes when the room opens",
)
async def register(mock_id: str, services: Services, auth: SignedIn) -> lv.Registration:
    return await live_mocks.register(services.db, auth, mock_id)


@router.delete(
    "/live/mocks/{mock_id}/registration",
    response_model=lv.Registration,
    summary="Cancel a live mock registration and its reminder",
)
async def unregister(mock_id: str, services: Services, auth: SignedIn) -> lv.Registration:
    return await live_mocks.unregister(services.db, auth, mock_id)


@router.get(
    "/live/mocks/{mock_id}/leaderboard",
    response_model=lv.LiveLeaderboard,
    summary="Frozen ranks after results (MOCK-24, R31)",
)
async def leaderboard(
    mock_id: str,
    services: Services,
    auth: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> lv.LiveLeaderboard:
    return await live_mocks.leaderboard(services.db, auth, mock_id, limit)


@router.get(
    "/live/mocks/{mock_id}/events",
    summary="Server-Sent Events for channel mock:{id} (start, clock, closed, results)",
    response_class=StreamingResponse,
)
async def events(mock_id: str, services: Services, auth: CurrentUser) -> StreamingResponse:
    await live_mocks.room(services.db, auth, mock_id)  # 404s and the live switch first
    stream = live_mocks.event_stream(RedisRealtime(services.redis), mock_id)
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
