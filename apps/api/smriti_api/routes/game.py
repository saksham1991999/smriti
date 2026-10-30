"""Gamification (TRD §5.1): pet, plant, streak freeze and rest day, shop, gems, quests, badges."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Path, Query
from fastapi.responses import JSONResponse

from smriti_api.core.deps import Client, CurrentUser, IdempotencyKey, Services
from smriti_api.core.pagination import Page
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import api as a
from smriti_api.schemas.sync import PlantState, StreakState
from smriti_api.services import game

router = APIRouter(prefix="/v1", tags=["gamification"])


@router.get("/pet", response_model=a.PetResponse, summary="The buddy, its room and today's care")
async def get_pet(services: Services, auth: CurrentUser) -> a.PetResponse:
    return await game.get_pet(services.db, auth)


@router.post("/pet/care", response_model=a.PetResponse, summary="Pet, play with or feed the buddy")
async def pet_care(
    body: a.PetCareRequest,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> a.PetResponse:
    await game.apply_one(
        services.db,
        auth,
        event_type="pet_care",
        payload=body.model_dump(exclude_none=True),
        event_id=game.event_id_for(auth.user_id, "pet_care", key),
        device_id=client.device_id,
        app_variant=client.app_variant,
    )
    return await game.get_pet(services.db, auth)


@router.get("/plant", response_model=PlantState, summary="The plant's stage, health and growth")
async def get_plant(services: Services, auth: CurrentUser) -> PlantState:
    return await game.get_plant(services.db, auth)


@router.post(
    "/streak/freeze", response_model=StreakState, summary="Equip a streak freeze from the reserve"
)
async def equip_freeze(
    body: a.StreakFreezeRequest,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> StreakState:
    await game.apply_one(
        services.db,
        auth,
        event_type="freeze_equipped",
        payload=body.model_dump(),
        event_id=game.event_id_for(auth.user_id, "freeze", key),
        device_id=client.device_id,
        app_variant=client.app_variant,
    )
    return await game.get_streak(services.db, auth)


@router.post(
    "/streak/rest-day", response_model=StreakState, summary="Plan a rest day (today or ahead)"
)
async def set_rest_day(
    body: a.RestDayRequest, services: Services, auth: CurrentUser
) -> StreakState:
    await game.change_rest_day(services.db, auth, body.day, on=True)
    return await game.get_streak(services.db, auth)


@router.delete(
    "/streak/rest-day/{day}", response_model=StreakState, summary="Cancel a planned rest day"
)
async def clear_rest_day(
    day: Annotated[date, Path()], services: Services, auth: CurrentUser
) -> StreakState:
    await game.change_rest_day(services.db, auth, day, on=False)
    return await game.get_streak(services.db, auth)


@router.get(
    "/shop", response_model=a.ShopResponse, summary="Gem shop items and what the caller owns"
)
async def shop(services: Services, auth: CurrentUser) -> a.ShopResponse:
    return await game.get_shop(services.db, auth)


@router.post(
    "/shop/purchase",
    response_model=a.PurchaseResponse,
    summary="Spend gems on a shop item (requires Idempotency-Key)",
)
async def purchase(
    body: a.PurchaseRequest, services: Services, auth: CurrentUser, key: IdempotencyKey
) -> JSONResponse:
    async def run() -> a.PurchaseResponse:
        return await game.purchase(services.db, auth, body.item_id)

    return await idempotent(
        services, scope="shop", subject=auth.user_id, key=key, body=body, fn=run, required=True
    )


@router.get(
    "/gems/ledger", response_model=Page[a.GemLedgerEntry], summary="Gem history, newest first"
)
async def gem_ledger(
    services: Services,
    auth: CurrentUser,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
) -> Page[a.GemLedgerEntry]:
    return await game.gem_ledger(services.db, auth, cursor, limit)


@router.get("/quests", response_model=list[a.QuestOut], summary="Active quests with progress")
async def quests(services: Services, auth: CurrentUser) -> list[a.QuestOut]:
    return await game.list_quests(services.db, auth)


@router.post(
    "/quests/{quest_id}/claim",
    response_model=a.QuestClaimResponse,
    summary="Claim a finished quest",
)
async def claim_quest(
    quest_id: Annotated[str, Path(min_length=1, max_length=64)],
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> a.QuestClaimResponse:
    version = await game.apply_one(
        services.db,
        auth,
        event_type="quest_claimed",
        payload={"quest_id": quest_id},
        event_id=game.event_id_for(auth.user_id, f"quest:{quest_id}", key),
        device_id=client.device_id,
        app_variant=client.app_variant,
    )
    gems, xp = await game.last_claim_paid(services.db, auth, quest_id)
    return a.QuestClaimResponse(quest_id=quest_id, gems=gems, xp=xp, state_version=version)


@router.get(
    "/badges", response_model=list[a.BadgeOut], summary="All badges, with the caller's earned dates"
)
async def badges(services: Services, auth: CurrentUser) -> list[a.BadgeOut]:
    return await game.list_badges(services.db, auth)
