"""Database access (TRD §5, DB_SCHEMA §12).

Three kinds of transaction:

* ``user_tx(claims)`` runs as the student: ``set local role authenticated`` plus
  ``request.jwt.claims``, so every RLS policy applies. Use it for reads and for writes to
  tables the student owns.
* ``system_tx()`` runs as ``service_role`` (bypasses RLS) for server-authoritative writes:
  the sync recompute, ledgers, merges, purges. Every query in it filters by user id explicitly.
* ``anon_tx()`` runs as ``anon`` for public catalogue reads.

All settings are transaction-scoped (``set local``), which is safe with Supavisor's
transaction pooler; asyncpg's statement cache is off for the same reason.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

_ALLOWED_ROLES = {"service_role", "postgres", "anon", "authenticated"}


class Database:
    def __init__(self, url: str, *, pool_size: int = 10, system_role: str = "service_role") -> None:
        if system_role not in _ALLOWED_ROLES:
            raise ValueError(f"unsupported system role: {system_role}")
        sa_url = make_url(url).update_query_dict({"prepared_statement_cache_size": "0"})
        self.engine: AsyncEngine = create_async_engine(
            sa_url,
            pool_size=pool_size,
            max_overflow=pool_size,
            pool_pre_ping=True,
            hide_parameters=True,  # bound values can hold personal data; never put them in logs
            connect_args={"statement_cache_size": 0, "server_settings": {"timezone": "UTC"}},
        )
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)
        self.system_role = system_role

    @asynccontextmanager
    async def user_tx(self, claims: dict[str, Any]) -> AsyncIterator[AsyncSession]:
        async with self.sessionmaker() as session, session.begin():
            await session.execute(text("set local role authenticated"))
            await session.execute(
                text("select set_config('request.jwt.claims', :claims, true)"),
                {"claims": json.dumps(claims, default=str)},
            )
            yield session

    @asynccontextmanager
    async def system_tx(self) -> AsyncIterator[AsyncSession]:
        async with self.sessionmaker() as session, session.begin():
            if self.system_role != "postgres":
                await session.execute(text(f"set local role {self.system_role}"))
            yield session

    @asynccontextmanager
    async def anon_tx(self) -> AsyncIterator[AsyncSession]:
        async with self.sessionmaker() as session, session.begin():
            await session.execute(text("set local role anon"))
            yield session

    @asynccontextmanager
    async def admin_tx(self) -> AsyncIterator[AsyncSession]:
        """The connection's own role. Local dev auth and tests only (the auth schema shim)."""
        async with self.sessionmaker() as session, session.begin():
            yield session

    async def dispose(self) -> None:
        await self.engine.dispose()
