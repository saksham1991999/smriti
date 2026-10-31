"""``GET /v1/config``. Public and cacheable: no user targeting here (cohorts are client-side)."""

from __future__ import annotations

import json
from typing import Annotated

import structlog
from fastapi import APIRouter, Query, Response
from redis.exceptions import RedisError

from smriti_api.core.deps import Client, Services
from smriti_api.schemas.api import ConfigResponse
from smriti_api.services.app_config import build_config

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/v1", tags=["config"])

CACHE_TTL_S = 60


@router.get(
    "/config",
    response_model=ConfigResponse,
    summary="Variant, flags, version gate, limits and prices",
)
async def get_config(
    services: Services,
    client: Client,
    response: Response,
    variant: Annotated[
        str | None, Query(max_length=32, description="Overrides X-App-Variant")
    ] = None,
) -> ConfigResponse:
    chosen = variant or client.app_variant
    key = f"cfg:v1:{chosen}:{client.platform}:{client.app_version}"
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TTL_S}"
    response.headers["Vary"] = "X-App-Variant, X-Platform, X-App-Version"
    try:
        cached = await services.redis.get(key)
    except RedisError:
        cached = None
    if cached:
        result = ConfigResponse.model_validate(json.loads(cached))
        return result
    result = await build_config(
        services.db,
        services.settings,
        variant=chosen,
        platform=client.platform,
        app_version=client.app_version,
    )
    try:
        await services.redis.set(key, result.model_dump_json(), ex=CACHE_TTL_S)
    except RedisError:
        log.warning("config_cache_unavailable")
    return result
