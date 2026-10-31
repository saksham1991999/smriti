"""RLS tests generated from the catalogue (AGENTS.md "Tests": RLS tests for every user table).

For every table in the user schemas that has a column pointing at a user, the test writes a
row owned by user B (as the database owner, with triggers and foreign keys off), then acts as
user A through the same ``set local role authenticated`` + claims path the API uses, and
checks that A can't read, change, delete or create B's rows. ``anon`` sees no user rows.
A new table is covered automatically; if a row can't be synthesised the test fails and names it.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.deps import AppServices

USER_SCHEMAS = ("app", "learn", "game", "social", "billing", "ai", "notify", "ops")
USER_COLUMN_NAMES = {
    "user_id",
    "owner_user_id",
    "user_a",
    "user_b",
    "guardian_user_id",
    "learner_user_id",
    "child_user_id",
    "reporter_user_id",
    "requester_user_id",
    "target_user_id",
    "from_user_id",
    "to_user_id",
    "challenger_id",
    "opponent_id",
    "voter_user_id",
}
# Tables whose rows are intentionally readable beyond the owner (documented in DB_SCHEMA §12).
READ_SHARED: dict[str, str] = {}

_ENUM = re.compile(r"\(?\(?(\w+)\)?(?:::text)? = ANY \(\(?ARRAY\[(.*?)\]")
_EQ = re.compile(r"\(\(?(\w+)\)?(?:::text)? = '([^']*)'")


@dataclass
class Column:
    name: str
    type: str
    not_null: bool
    has_default: bool
    is_generated: bool


@dataclass
class Table:
    name: str
    columns: list[Column]
    user_columns: list[str]
    checks: list[str] = field(default_factory=list)


async def _tables(session: AsyncSession) -> list[Table]:
    rows = (
        await session.execute(
            text(
                """
                select n.nspname || '.' || c.relname as tbl, a.attname as col,
                       format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as nn,
                       a.atthasdef as has_def, a.attgenerated <> '' as gen,
                       exists (
                         select 1 from pg_constraint k
                          where k.conrelid = c.oid and k.contype = 'f' and a.attnum = any(k.conkey)
                            and k.confrelid = 'auth.users'::regclass) as fk_user
                  from pg_class c
                  join pg_namespace n on n.oid = c.relnamespace
                  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                 where n.nspname = any(:schemas) and c.relkind in ('r','p') and not c.relispartition
                 order by 1, a.attnum
                """
            ),
            {"schemas": list(USER_SCHEMAS)},
        )
    ).all()
    tables: dict[str, Table] = {}
    for r in rows:
        t = tables.setdefault(r.tbl, Table(r.tbl, [], []))
        t.columns.append(Column(r.col, r.typ, r.nn, r.has_def, r.gen))
        if r.typ == "uuid" and (r.fk_user or r.col in USER_COLUMN_NAMES):
            t.user_columns.append(r.col)
    checks = (
        await session.execute(
            text(
                "select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as cdef from pg_constraint"
                " where contype = 'c' and connamespace = any(select oid from pg_namespace where nspname = any(:s))"
            ),
            {"s": list(USER_SCHEMAS)},
        )
    ).all()
    for c in checks:
        if c.tbl in tables:
            tables[c.tbl].checks.append(c.cdef)
    return [t for t in tables.values() if t.user_columns]


def _allowed(table: Table, column: str) -> str | None:
    for check in table.checks:
        for m in _ENUM.finditer(check):
            if m.group(1) == column:
                first = re.search(r"'([^']*)'", m.group(2))
                if first:
                    return first.group(1)
        for m in _EQ.finditer(check):
            if m.group(1) == column:
                return m.group(2)
    return None


def _value(table: Table, col: Column) -> Any:
    allowed = _allowed(table, col.name)
    t = col.type
    if allowed is not None:
        return allowed
    if t == "uuid":
        return str(uuid.uuid4())
    if t in ("text", "citext") or t.startswith("character"):
        return f"rls-{uuid.uuid4().hex[:8]}"
    if (
        t in ("smallint", "integer", "bigint")
        or t.startswith("numeric")
        or t in ("real", "double precision")
    ):
        return "1"
    if t == "boolean":
        return "false"
    if t == "date":
        return "2026-10-29"
    if t.startswith("timestamp"):
        return "2026-10-29T10:00:00+05:30"
    if t.startswith("time"):
        return "08:00"
    if t == "i18n_text":
        return json.dumps({"en": "x", "hi": "x"})
    if t in ("jsonb", "json"):
        return "{}"
    if t.endswith("[]"):
        return "{}"
    if t == "interval":
        return "1 day"
    if t == "bytea":
        return "\\x00"
    if t == "inet":
        return "127.0.0.1"
    if t.startswith("vector"):
        return None
    raise AssertionError(f"{table.name}.{col.name}: no sample value for type {t}")


def _row(table: Table, owner: uuid.UUID, other: uuid.UUID) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for col in table.columns:
        if col.is_generated:
            continue
        if col.name in table.user_columns:
            # The first user column is the owner; any second one (a friend, a guardian) is C.
            values[col.name] = str(owner if col.name == table.user_columns[0] else other)
        elif col.type.startswith("vector"):
            continue
        elif col.not_null and not col.has_default:
            values[col.name] = _value(table, col)
    return values


def _insert_sql(table: Table, row: dict[str, Any]) -> str:
    cols = ", ".join(row)
    types = {c.name: c.type for c in table.columns}
    params = ", ".join(f"cast(cast(:{k} as text) as {types[k]})" for k in row)
    return f"insert into {table.name} ({cols}) values ({params})"


async def _make_user(services: AppServices) -> uuid.UUID:
    async with services.db.admin_tx() as session:
        uid = (
            await session.execute(
                text("insert into auth.users (is_anonymous) values (true) returning id")
            )
        ).scalar_one()
    return uuid.UUID(str(uid))


def _claims(user_id: uuid.UUID) -> dict[str, Any]:
    return {
        "sub": str(user_id),
        "role": "authenticated",
        "is_anonymous": True,
        "aud": "authenticated",
    }


async def test_every_user_table_isolates_users(services: AppServices) -> None:
    # Sorted so B < C, which pair tables such as social.friendships require (user_a < user_b).
    a, b, c = sorted([await _make_user(services) for _ in range(3)])
    async with services.db.admin_tx() as session:
        tables = await _tables(session)
    assert len(tables) >= 60, [t.name for t in tables]

    problems: list[str] = []
    seeded: list[tuple[Table, str]] = []
    for table in tables:
        row = _row(table, b, c)
        try:
            async with services.db.admin_tx() as session:
                await session.execute(text("set local session_replication_role = replica"))
                # One-row-per-user tables (profiles, stats) already hold B's row from the trigger.
                await session.execute(
                    text(_insert_sql(table, row) + " on conflict do nothing"), row
                )
            seeded.append((table, table.user_columns[0]))
        except DBAPIError as exc:
            problems.append(
                f"{table.name}: could not synthesise a row ({str(exc.orig).splitlines()[0]})"
            )

    for table, owner_col in seeded:
        where = " or ".join(f"{col} = cast(:b as uuid)" for col in table.user_columns)
        async with services.db.admin_tx() as session:
            present = (
                await session.execute(
                    text(f"select count(*) from {table.name} where {where}"), {"b": b}
                )
            ).scalar_one()
        if not present:
            problems.append(f"{table.name}: B's row is missing, so the checks below prove nothing")
        # Read
        try:
            async with services.db.user_tx(_claims(a)) as session:
                n = (
                    await session.execute(
                        text(f"select count(*) from {table.name} where {where}"), {"b": b}
                    )
                ).scalar_one()
            if n and table.name not in READ_SHARED:
                problems.append(f"{table.name}: user A can read {n} of B's rows")
        except DBAPIError as exc:
            if "permission denied" not in str(exc.orig):
                problems.append(
                    f"{table.name}: select failed oddly ({str(exc.orig).splitlines()[0]})"
                )
        # Update and delete
        for verb, sql in (
            ("update", f"update {table.name} set {owner_col} = {owner_col} where {where}"),
            ("delete", f"delete from {table.name} where {where}"),
        ):
            try:
                async with services.db.user_tx(_claims(a)) as session:
                    res = await session.execute(text(sql), {"b": b})
                    if res.rowcount:  # type: ignore[attr-defined]
                        problems.append(f"{table.name}: user A could {verb} B's rows")
            except DBAPIError as exc:
                if "permission denied" not in str(exc.orig):
                    problems.append(
                        f"{table.name}: {verb} failed oddly ({str(exc.orig).splitlines()[0]})"
                    )
        # Insert a row claiming to be B's
        row = _row(table, b, c)
        try:
            async with services.db.user_tx(_claims(a)) as session:
                await session.execute(text(_insert_sql(table, row)), row)
            problems.append(f"{table.name}: user A could insert a row owned by B")
        except DBAPIError as exc:
            msg = str(exc.orig)
            if "row-level security" not in msg and "permission denied" not in msg:
                # Any other failure (a check or FK) also means the row did not land, but the
                # policy wasn't what stopped it; only RLS or grants count as a pass.
                problems.append(
                    f"{table.name}: insert as A failed for another reason ({msg.splitlines()[0]})"
                )
        # anon sees nothing
        try:
            async with services.db.anon_tx() as session:
                n = (
                    await session.execute(
                        text(f"select count(*) from {table.name} where {where}"), {"b": b}
                    )
                ).scalar_one()
            if n:
                problems.append(f"{table.name}: anon can read B's rows")
        except DBAPIError as exc:
            if "permission denied" not in str(exc.orig):
                problems.append(
                    f"{table.name}: anon select failed oddly ({str(exc.orig).splitlines()[0]})"
                )

    assert not problems, "\n".join(problems)


async def test_owner_can_read_own_rows(services: AppServices) -> None:
    owner = await _make_user(services)
    # handle_new_user created these; each is readable by its owner only.
    for table in (
        "app.profiles",
        "game.user_stats",
        "game.plants",
        "notify.prefs",
        "app.sync_state",
    ):
        async with services.db.user_tx(_claims(owner)) as session:
            n = (
                await session.execute(
                    text(f"select count(*) from {table} where user_id = :u"), {"u": owner}
                )
            ).scalar_one()
        assert n == 1, table


async def test_rls_is_on_for_every_table(services: AppServices) -> None:
    async with services.db.admin_tx() as session:
        missing = (
            (
                await session.execute(
                    text(
                        "select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace"
                        " where n.nspname = any(:s) and c.relkind in ('r','p') and not c.relrowsecurity"
                        " and not c.relispartition"
                    ),
                    {"s": [*USER_SCHEMAS, "content"]},
                )
            )
            .scalars()
            .all()
        )
    assert missing == []


async def test_partitions_are_reachable_only_through_their_parent(services: AppServices) -> None:
    """Partitions don't inherit the parent's policies, so clients must have no grants on them."""
    async with services.db.admin_tx() as session:
        exposed = (
            (
                await session.execute(
                    text(
                        "select c.oid::regclass::text from pg_class c join pg_namespace n on n.oid = c.relnamespace"
                        " where n.nspname = any(:s) and c.relispartition and ("
                        " has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')"
                        " or has_table_privilege('anon', c.oid, 'select,insert,update,delete'))"
                    ),
                    {"s": list(USER_SCHEMAS)},
                )
            )
            .scalars()
            .all()
        )
    assert exposed == []
