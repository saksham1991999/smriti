"""Helpers for the practice, mock and tutor tests."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services import flags as flag_service
from tests.helpers import Session, new_guest


async def learner(client: httpx.AsyncClient, exam: str) -> Session:
    s = await new_guest(client)
    r = await client.put(
        "/v1/me/exams", json={"exam_profile_ids": [exam], "primary": exam}, headers=s.headers
    )
    assert r.status_code == 200, r.text
    return s


async def make_pro(services: AppServices, s: Session) -> None:
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "insert into billing.entitlements (user_id, entitlement, active, expires_at)"
                " values (:u, 'pro', true, :exp)"
                " on conflict (user_id, entitlement) do update set active = true, expires_at = :exp"
            ),
            {"u": s.user_id, "exp": datetime.now(UTC) + timedelta(days=30)},
        )


@asynccontextmanager
async def flags(services: AppServices, values: dict[str, Any]) -> AsyncIterator[None]:
    """Sets ``ops.flags`` rows for the duration of a block, then restores them."""
    async with services.db.admin_tx() as session:
        old = {
            r.key: r.value
            for r in (
                await session.execute(
                    text("select key, value from ops.flags where key = any(:k)"),
                    {"k": list(values)},
                )
            ).all()
        }
        for key, value in values.items():
            await session.execute(
                text(
                    "insert into ops.flags (key, value, description) values (:k, cast(:v as jsonb), 'test')"
                    " on conflict (key) do update set value = excluded.value"
                ),
                {"k": key, "v": json.dumps(value)},
            )
    flag_service.clear_cache()
    try:
        yield
    finally:
        async with services.db.admin_tx() as session:
            for key in values:
                if key in old:
                    await session.execute(
                        text("update ops.flags set value = cast(:v as jsonb) where key = :k"),
                        {"k": key, "v": json.dumps(old[key])},
                    )
                else:
                    await session.execute(text("delete from ops.flags where key = :k"), {"k": key})
        flag_service.clear_cache()


def opts(*ids: str) -> dict[str, Any]:
    return {"kind": "options", "option_ids": list(ids)}
