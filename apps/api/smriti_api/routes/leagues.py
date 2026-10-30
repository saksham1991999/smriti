"""Weekly leagues and leaderboards (tutor-social B6, B7). Adults and teens only; the league
screen refreshes on open and on pull, it does not stream."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Query

from smriti_api.core.deps import CurrentUser, Services
from smriti_api.schemas import social as so
from smriti_api.services import leagues

router = APIRouter(prefix="/v1", tags=["leagues"])


@router.get("/leagues/current", response_model=so.League, summary="This week's league (SOC-08)")
async def current(services: Services, auth: CurrentUser) -> so.League:
    return await leagues.current(services.db, auth)


@router.get(
    "/leagues/result", response_model=so.LeagueResult, summary="Last week's result (SOC-09)"
)
async def result(services: Services, auth: CurrentUser) -> so.LeagueResult:
    return await leagues.last_result(services.db, auth)


@router.post("/leagues/join", response_model=so.League, summary="Join leagues (teens, R30)")
async def join(services: Services, auth: CurrentUser) -> so.League:
    return await leagues.join(services.db, auth)


@router.put("/leagues/opt-out", response_model=so.League, summary="Take a break from leagues")
async def opt_out(body: so.OptOutIn, services: Services, auth: CurrentUser) -> so.League:
    return await leagues.opt_out(services.db, auth, body)


@router.get("/leaderboards", response_model=so.Leaderboard, summary="Leaderboards (SOC-10)")
async def leaderboard(
    services: Services,
    auth: CurrentUser,
    scope: Annotated[
        Literal["friends", "squad", "school", "city", "all_india"], Query()
    ] = "friends",
    period: Annotated[Literal["week", "all_time"], Query()] = "week",
    squad_id: Annotated[uuid.UUID | None, Query()] = None,
) -> so.Leaderboard:
    return await leagues.leaderboard(services.db, auth, scope, period, squad_id)
