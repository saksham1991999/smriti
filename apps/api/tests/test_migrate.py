"""The release migrator (``python -m smriti_api.migrate``) on a scratch database: every migration
and the seed apply on an empty database, a second run applies nothing, and a failing file rolls
back without recording itself."""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg  # type: ignore[import-untyped]
import pytest

from smriti_api import migrate
from smriti_api.core.config import REPO_ROOT

MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
SEED = REPO_ROOT / "supabase" / "seed.sql"
SHIM = REPO_ROOT / "supabase" / "local" / "10_auth_shim.sql"


def _dsn(db: str) -> str:
    base = migrate.asyncpg_dsn(os.environ["DATABASE_URL"])
    return base.rsplit("/", 1)[0] + "/" + db


@pytest.fixture
async def scratch_db() -> AsyncIterator[str]:
    name = f"smriti_migrate_{uuid.uuid4().hex[:10]}"
    admin = await asyncpg.connect(_dsn("postgres"))
    try:
        await admin.execute(f'create database "{name}"')
    except asyncpg.InsufficientPrivilegeError:
        await admin.close()
        pytest.skip("the test role cannot create databases")
    try:
        conn = await asyncpg.connect(_dsn(name))
        try:
            # As on Supabase: extensions on the search path, and the auth schema in place.
            await conn.execute(
                f'alter database "{name}" set search_path = "$user", public, extensions'
            )
            await conn.close()
            conn = await asyncpg.connect(_dsn(name))
            await conn.execute(SHIM.read_text(encoding="utf-8"))
        finally:
            await conn.close()
        yield _dsn(name)
    finally:
        await admin.execute(f'drop database if exists "{name}" with (force)')
        await admin.close()


def test_discover_orders_and_validates(tmp_path: Path) -> None:
    found = migrate.discover(MIGRATIONS)
    assert [m.version for m in found] == sorted(m.version for m in found)
    assert len(found) == len(list(MIGRATIONS.glob("*.sql")))
    (tmp_path / "20260101000000_ok.sql").write_text("select 1;")
    (tmp_path / "notes.sql").write_text("select 1;")
    with pytest.raises(migrate.MigrationError, match=r"notes\.sql"):
        migrate.discover(tmp_path)


def test_database_url_prefers_the_session_url() -> None:
    env = {
        "DATABASE_URL": "postgresql+asyncpg://u@pooler:6543/db",
        "MIGRATIONS_DATABASE_URL": "postgresql://u@direct:5432/db",
    }
    assert migrate.database_url(env) == "postgresql://u@direct:5432/db"
    assert migrate.database_url({"DATABASE_URL": env["DATABASE_URL"]}) == (
        "postgresql://u@pooler:6543/db"
    )
    with pytest.raises(migrate.MigrationError):
        migrate.database_url({})


async def test_applies_everything_once(scratch_db: str) -> None:
    lines: list[str] = []
    first = await migrate.run(scratch_db, MIGRATIONS, seed=SEED, out=lines)
    assert first == [m.version for m in migrate.discover(MIGRATIONS)]
    assert lines[-1] == "seed applied (seed.sql)"
    # Nothing but versions and names is printed.
    assert all(line.startswith(("applied ", "seed applied")) for line in lines)

    conn = await asyncpg.connect(scratch_db)
    try:
        recorded = await conn.fetchval("select count(*) from supabase_migrations.schema_migrations")
        flags = await conn.fetchval("select count(*) from ops.flags")
        # An owner's change to a seeded row survives the next release's seed.
        key = await conn.fetchval("select key from ops.flags order by key limit 1")
        await conn.execute("update ops.flags set value = '123'::jsonb where key = $1", key)
    finally:
        await conn.close()
    assert recorded == len(first)
    assert flags > 0

    assert await migrate.run(scratch_db, MIGRATIONS, check=True) == []
    again: list[str] = []
    assert await migrate.run(scratch_db, MIGRATIONS, seed=SEED, out=again) == []
    assert again[0].startswith("up to date")

    conn = await asyncpg.connect(scratch_db)
    try:
        assert await conn.fetchval("select value from ops.flags where key = $1", key) == "123"
        assert await conn.fetchval("select count(*) from ops.flags") == flags
    finally:
        await conn.close()


async def test_a_failing_file_rolls_back(scratch_db: str, tmp_path: Path) -> None:
    (tmp_path / "20990101000001_good.sql").write_text("create table public.m_good (id int);")
    (tmp_path / "20990101000002_bad.sql").write_text(
        "create table public.m_bad (id int); select * from public.no_such_table;"
    )
    (tmp_path / "20990101000003_later.sql").write_text("create table public.m_later (id int);")
    with pytest.raises(migrate.MigrationError, match="20990101000002_bad failed"):
        await migrate.run(scratch_db, tmp_path)
    assert await migrate.run(scratch_db, tmp_path, check=True) == [
        "20990101000002",
        "20990101000003",
    ]
    conn = await asyncpg.connect(scratch_db)
    try:
        tables = {
            r["tablename"]
            for r in await conn.fetch("select tablename from pg_tables where schemaname = 'public'")
        }
    finally:
        await conn.close()
    assert "m_good" in tables
    assert "m_bad" not in tables
    assert "m_later" not in tables


async def test_check_exit_code(scratch_db: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MIGRATIONS_DATABASE_URL", scratch_db)
    # main() runs its own event loop, so call it from a worker thread.
    code = await asyncio.to_thread(migrate.main, ["--check"])
    assert code == 3
