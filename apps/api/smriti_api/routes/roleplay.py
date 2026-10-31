"""AI-21 role play (tutor-social §A11). See ``services/roleplay.py``."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path
from fastapi.responses import JSONResponse

from smriti_api.core.deps import CurrentUser, IdempotencyKey, Services
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import roleplay as r
from smriti_api.services import roleplay

router = APIRouter(prefix="/v1/roleplay", tags=["tutor"])

ChatId = Annotated[uuid.UUID, Path(description="The chat's tutor session id")]


@router.post(
    "/chats",
    response_model=r.RoleplayChat,
    summary="Start the role play for a card (or return its open chat)",
)
async def start_chat(
    body: r.RoleplayStart, services: Services, auth: CurrentUser, key: IdempotencyKey
) -> JSONResponse:
    return await idempotent(
        services,
        scope="roleplay_start",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=lambda: roleplay.start(services.db, auth, body),
    )


@router.get("/chats/{session_id}", response_model=r.RoleplayChat, summary="A role-play chat")
async def get_chat(session_id: ChatId, services: Services, auth: CurrentUser) -> r.RoleplayChat:
    return await roleplay.get(services.db, auth, session_id)


@router.post(
    "/chats/{session_id}/turns",
    response_model=r.RoleplayTurnOut,
    summary="The student's turn: a suggested reply or typed text; the character answers",
)
async def take_turn(
    session_id: ChatId, body: r.RoleplayTurnIn, services: Services, auth: CurrentUser
) -> r.RoleplayTurnOut:
    return await roleplay.turn(services.db, services.ai, auth, session_id, body)


@router.post(
    "/chats/{session_id}/wrap-up",
    response_model=r.RoleplayChat,
    summary="[Wrap up]: end the chat now and get the summary",
)
async def wrap_up(session_id: ChatId, services: Services, auth: CurrentUser) -> r.RoleplayChat:
    return await roleplay.wrap_up(services.db, auth, session_id)
