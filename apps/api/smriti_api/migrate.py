"""Applies ``supabase/migrations`` on release (Railway pre-deploy command, docs/DEPLOY.md).

    python -m smriti_api.migrate [--seed] [--check] [--dir supabase/migrations]

- Idempotent. Each applied file is recorded in ``supabase_migrations.schema_migrations``, the
  same table the Supabase CLI keeps, so ``supabase db push`` and ``supabase migration list`` agree
  with it. Files already recorded are skipped, and a second run applies nothing.
- Each file runs in its own transaction together with its history row. A failure rolls that file
  back and stops the run with exit code 1, and nothing after it is attempted.
- One run at a time: a session advisory lock serialises concurrent deploys. A lock needs a
  session connection, so ``MIGRATIONS_DATABASE_URL`` should be Supabase's direct or session-mode
  URL (port 5432), not the transaction pooler. ``DATABASE_URL`` is the fallback.
- ``--seed`` then applies ``supabase/seed.sql``. The seed holds config rows only, each written with
  ``on conflict do nothing``, so an owner's later change to a flag is never overwritten.
- ``--check`` lists pending files and exits 3 when there are any, without applying them.

Only file versions and names are printed. No SQL text, connection string or row data is logged.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import asyncpg  # type: ignore[import-untyped]

from smriti_api.core.config import REPO_ROOT

LOCK_KEY = 0x534D524954494D47  # "SMRITIMG": one lock id for every migration run
LOCK_WAIT_S = 300.0
_FILE = re.compile(r"^(?P<version>\d{14})_(?P<name>[a-z0-9_]+)\.sql$")

HISTORY_DDL = """
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
"""


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    path: Path


class MigrationError(RuntimeError):
    pass


def discover(folder: Path) -> list[Migration]:
    """Every migration file in version order. A file that does not follow the Supabase CLI's
    ``<14-digit version>_<name>.sql`` pattern is an error, not something to skip silently."""
    found: list[Migration] = []
    for path in sorted(folder.glob("*.sql")):
        m = _FILE.match(path.name)
        if not m:
            raise MigrationError(f"not a migration file name: {path.name}")
        found.append(Migration(m["version"], m["name"], path))
    versions = [m.version for m in found]
    if len(set(versions)) != len(versions):
        raise MigrationError("two migration files share a version")
    return found


def asyncpg_dsn(url: str) -> str:
    """asyncpg takes ``postgresql://``; the app's URL carries SQLAlchemy's ``+asyncpg`` driver."""
    return re.sub(r"^postgres(ql)?(\+asyncpg)?://", "postgresql://", url)


def database_url(env: dict[str, str] | None = None) -> str:
    env = dict(os.environ) if env is None else env
    url = env.get("MIGRATIONS_DATABASE_URL") or env.get("DATABASE_URL") or ""
    if not url:
        raise MigrationError("set MIGRATIONS_DATABASE_URL (or DATABASE_URL)")
    return asyncpg_dsn(url)


async def _lock(conn: asyncpg.Connection, wait_s: float) -> None:
    deadline = asyncio.get_running_loop().time() + wait_s
    while not await conn.fetchval("select pg_try_advisory_lock($1)", LOCK_KEY):
        if asyncio.get_running_loop().time() > deadline:
            raise MigrationError("another migration run holds the lock")
        await asyncio.sleep(2)


async def applied_versions(conn: asyncpg.Connection) -> set[str]:
    exists = await conn.fetchval(
        "select to_regclass('supabase_migrations.schema_migrations') is not null"
    )
    if not exists:
        return set()
    rows = await conn.fetch("select version from supabase_migrations.schema_migrations")
    return {str(r["version"]) for r in rows}


async def run(
    dsn: str,
    folder: Path,
    *,
    seed: Path | None = None,
    check: bool = False,
    lock_wait_s: float = LOCK_WAIT_S,
    out: list[str] | None = None,
) -> list[str]:
    """Applies the pending migrations and returns their versions (pending ones with ``check``)."""

    def say(line: str) -> None:
        if out is not None:
            out.append(line)
        print(line, flush=True)

    migrations = discover(folder)
    conn: asyncpg.Connection = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        await _lock(conn, lock_wait_s)
        try:
            done = await applied_versions(conn)
            pending = [m for m in migrations if m.version not in done]
            if check:
                for m in pending:
                    say(f"pending {m.version}_{m.name}")
                return [m.version for m in pending]
            await conn.execute(HISTORY_DDL)
            for m in pending:
                sql = await asyncio.to_thread(m.path.read_text, encoding="utf-8")
                try:
                    async with conn.transaction():
                        await conn.execute(sql)
                        await conn.execute(
                            "insert into supabase_migrations.schema_migrations"
                            " (version, name, statements) values ($1, $2, $3)",
                            m.version,
                            m.name,
                            [sql],
                        )
                except asyncpg.PostgresError as exc:
                    # The server's message names the object, never row data.
                    raise MigrationError(
                        f"{m.version}_{m.name} failed: {type(exc).__name__}: {exc}"
                    ) from exc
                say(f"applied {m.version}_{m.name}")
            if not pending:
                say(f"up to date ({len(migrations)} migrations)")
            if seed is not None:
                seed_sql = await asyncio.to_thread(seed.read_text, encoding="utf-8")
                async with conn.transaction():
                    await conn.execute(seed_sql)
                say(f"seed applied ({seed.name})")
            return [m.version for m in pending]
        finally:
            await conn.execute("select pg_advisory_unlock($1)", LOCK_KEY)
    finally:
        await conn.close()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m smriti_api.migrate", description=__doc__)
    parser.add_argument("--dir", type=Path, default=REPO_ROOT / "supabase" / "migrations")
    parser.add_argument("--seed", action="store_true", help="apply supabase/seed.sql afterwards")
    parser.add_argument("--seed-file", type=Path, default=REPO_ROOT / "supabase" / "seed.sql")
    parser.add_argument("--check", action="store_true", help="list pending files; exit 3 if any")
    args = parser.parse_args(argv)
    try:
        dsn = database_url()
        result = asyncio.run(
            run(dsn, args.dir, seed=args.seed_file if args.seed else None, check=args.check)
        )
    except (MigrationError, OSError, asyncpg.PostgresError) as exc:
        print(f"migrate: {exc}", file=sys.stderr, flush=True)
        return 1
    return 3 if args.check and result else 0


if __name__ == "__main__":
    raise SystemExit(main())
