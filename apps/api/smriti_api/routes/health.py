"""Liveness and readiness probes (Railway health checks) and the server clock."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import text

from smriti_api.core.deps import Services
from smriti_api.core.errors import ApiError
from smriti_api.schemas.api import TimeResponse

router = APIRouter(tags=["health"])


@router.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", include_in_schema=False)
async def readyz(services: Services) -> dict[str, str]:
    try:
        async with services.db.anon_tx() as session:
            await session.execute(text("select 1"))
        await services.redis.ping()
    except Exception as exc:
        raise ApiError(503, "not_ready", "Dependencies are not reachable") from exc
    return {"status": "ready"}


@router.get("/v1/time", response_model=TimeResponse, summary="Server clock")
async def server_time() -> TimeResponse:
    """The client corrects its own clock with this before it decides which day an event is on."""
    return TimeResponse(server_time=datetime.now(UTC))
