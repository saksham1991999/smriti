"""Runs a mutation under an ``Idempotency-Key`` (AGENTS.md "API"). Without a key the mutation
just runs; with one, a retry gets the first response back instead of running twice."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from smriti_api.core.deps import AppServices
from smriti_api.core.idempotency import validate_key


async def idempotent(
    services: AppServices,
    *,
    scope: str,
    subject: object,
    key: str | None,
    body: BaseModel | dict[str, Any] | None,
    fn: Callable[[], Awaitable[BaseModel]],
    status: int = 200,
    required: bool = False,
) -> JSONResponse:
    checked = validate_key(key, required=required)
    request_body = body.model_dump(mode="json") if isinstance(body, BaseModel) else (body or {})

    async def run() -> tuple[int, Any]:
        result = await fn()
        return status, jsonable_encoder(result)

    if checked is None:
        code, payload = await run()
    else:
        code, payload = await services.idempotency.run(
            scope=scope, subject=str(subject), key=checked, body=request_body, fn=run
        )
    return JSONResponse(payload, status_code=code)
