"""Shared decks (tutor-social B12): share and stop sharing (MEM-11, MEM-08), find (SOC-21),
preview a link, add a copy and vote helpful. The author is never named."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query

from smriti_api.core.deps import CurrentUser, Services
from smriti_api.schemas import social as so
from smriti_api.services import shared_decks

router = APIRouter(prefix="/v1", tags=["shared decks"])

DeckId = Annotated[uuid.UUID, Path()]
Code = Annotated[str, Path(min_length=4, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]


@router.post("/decks/{deck_id}/share", response_model=so.DeckShare, summary="Share a deck")
async def share(
    deck_id: DeckId, body: so.DeckShareIn, services: Services, auth: CurrentUser
) -> so.DeckShare:
    return await shared_decks.share(services.db, services.ai, auth, deck_id, body)


@router.delete("/decks/{deck_id}/share", response_model=so.DeckShare, summary="Stop sharing")
async def stop_share(deck_id: DeckId, services: Services, auth: CurrentUser) -> so.DeckShare:
    return await shared_decks.stop_share(services.db, auth, deck_id)


@router.get(
    "/shared-decks", response_model=list[so.SharedDeckRow], summary="Decks to find (SOC-21)"
)
async def list_shared(
    services: Services,
    auth: CurrentUser,
    scope: Annotated[Literal["friends", "exam"], Query()] = "friends",
    exam: Annotated[str | None, Query(max_length=200)] = None,
) -> list[so.SharedDeckRow]:
    return await shared_decks.list_shared(services.db, auth, scope, exam)


@router.get(
    "/shared-decks/{code}", response_model=so.SharedDeckPreview, summary="Preview a shared deck"
)
async def preview(code: Code, services: Services, auth: CurrentUser) -> so.SharedDeckPreview:
    return await shared_decks.preview(services.db, auth, code)


@router.post(
    "/shared-decks/{code}/copy", response_model=so.DeckCopy, status_code=201, summary="Add a copy"
)
async def copy(code: Code, services: Services, auth: CurrentUser) -> so.DeckCopy:
    return await shared_decks.copy(services.db, auth, code)


@router.put(
    "/shared-decks/{code}/helpful", response_model=so.SharedDeckRow, summary="Found this helpful"
)
async def helpful(
    code: Code, body: so.HelpfulIn, services: Services, auth: CurrentUser
) -> so.SharedDeckRow:
    return await shared_decks.helpful(services.db, auth, code, body.on)
