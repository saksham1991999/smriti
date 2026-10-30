"""Worker tests run against the same local Postgres (``smriti_test``) and Redis as the API tests.
Start them with ``scripts/dev/db.sh reset`` first."""

from __future__ import annotations

import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://postgres:postgres@127.0.0.1:54322/smriti_test"
)
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:56379/2")
os.environ.setdefault("AI_PROVIDER", "fake")
os.environ.setdefault("JOBS_MODE", "inline")
os.environ.setdefault("LOG_LEVEL", "WARNING")

from collections.abc import AsyncIterator
from typing import Any

import pytest
from smriti_api.services import flags as flag_service
from smriti_api.services.analytics import FakeAnalyticsSink
from smriti_api.services.jobs import JobDeps
from sqlalchemy import text

from smriti_worker import jobs


@pytest.fixture(scope="session")
async def ctx() -> AsyncIterator[dict[str, Any]]:
    context: dict[str, Any] = {}
    await jobs.startup(context)
    deps: JobDeps = context["deps"]
    deps.analytics = FakeAnalyticsSink()
    try:
        async with deps.db.admin_tx() as session:
            await session.execute(text("select 1"))
    except Exception as exc:  # pragma: no cover - environment guard
        await jobs.shutdown(context)
        pytest.exit(
            f"local Postgres not reachable ({type(exc).__name__}); run scripts/dev/db.sh reset"
        )
    yield context
    await jobs.shutdown(context)


@pytest.fixture
def deps(ctx: dict[str, Any]) -> JobDeps:
    d: JobDeps = ctx["deps"]
    return d


@pytest.fixture(autouse=True)
def _fresh_flag_cache() -> None:
    flag_service.clear_cache()
