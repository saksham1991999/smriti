"""Test fixtures. Integration tests run against the local Postgres (``smriti_test``) and Redis
started by ``scripts/dev/db.sh``; run ``pnpm db:reset`` (or ``scripts/dev/db.sh reset``) first.
Live provider tests run only with ``RUN_LIVE=1``."""

from __future__ import annotations

import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://postgres:postgres@127.0.0.1:54322/smriti_test"
)
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:56379/1")
os.environ.setdefault("AI_PROVIDER", "fake")
os.environ.setdefault("JOBS_MODE", "inline")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("VARIANTS_DIR", "/nonexistent-variants-dir")

from collections.abc import AsyncIterator

import httpx
import pytest
from sqlalchemy import text

from smriti_api.core.config import Settings
from smriti_api.core.deps import AppServices
from smriti_api.main import build_services, close_services, create_app
from smriti_api.services import flags as flag_service
from smriti_api.services.analytics import FakeAnalyticsSink
from smriti_api.services.jobs import InlineJobQueue


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if os.environ.get("RUN_LIVE") == "1":
        return
    skip = pytest.mark.skip(reason="live provider test: set RUN_LIVE=1")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings()


@pytest.fixture(scope="session")
async def services(settings: Settings) -> AsyncIterator[AppServices]:
    svc = await build_services(settings)
    svc.analytics = FakeAnalyticsSink()
    if isinstance(svc.jobs, InlineJobQueue):
        svc.jobs._deps.analytics = svc.analytics
    try:
        async with svc.db.admin_tx() as session:
            await session.execute(text("select 1"))
        await svc.redis.ping()
    except Exception as exc:  # pragma: no cover - environment guard
        await close_services(svc)
        pytest.exit(
            f"local Postgres/Redis not reachable ({type(exc).__name__}); run scripts/dev/db.sh reset"
        )
    await svc.redis.flushdb()
    yield svc
    await close_services(svc)


@pytest.fixture
async def client(settings: Settings, services: AppServices) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings, services)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    if isinstance(services.jobs, InlineJobQueue):
        await services.jobs.drain()


@pytest.fixture(autouse=True)
def _fresh_flag_cache() -> None:
    flag_service.clear_cache()
