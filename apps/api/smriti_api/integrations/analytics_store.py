"""Reading the analytics store (IMPLEMENTATION_PLAN G-11, DB_SCHEMA §14, TRD §15).

The data jobs (IRT calibration, per-user FSRS optimisation) read raw history through
``AnalyticsStore``. In production that is ClickHouse over its HTTP interface, configured by
``CLICKHOUSE_URL``, ``CLICKHOUSE_USER``, ``CLICKHOUSE_PASSWORD`` and ``CLICKHOUSE_DATABASE``; the
queries use server-side parameters (``{name:Type}``), never string formatting. Without that env,
the Postgres tables that hold the same facts stand in (``learn.srs_reviews`` and
``learn.question_attempts``), which is enough for local work and small deployments.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

import httpx
import structlog
from sqlalchemy import text

from smriti_api.core.db import Database

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class ReviewRow:
    card_ref: str
    rating: int
    reviewed_at: datetime
    duration_ms: int | None


@dataclass(frozen=True)
class ResponseRow:
    user_id: uuid.UUID
    question_id: str
    correct: bool


@dataclass(frozen=True)
class QuestionCount:
    question_id: str
    responses: int
    correct: int


class AnalyticsStore(Protocol):
    name: str

    async def review_counts(self) -> dict[uuid.UUID, int]:
        """Reviews per user (all time)."""

    async def review_logs(self, user_id: uuid.UUID) -> list[ReviewRow]:
        """One user's review history, oldest first."""

    async def question_counts(self, min_responses: int) -> list[QuestionCount]:
        """First-attempt responses per question, for questions with at least ``min_responses``."""

    async def responses(self, question_ids: Sequence[str]) -> list[ResponseRow]:
        """First-attempt responses to these questions (the IRT response matrix)."""


class ClickHouseError(Exception):
    pass


@dataclass
class ClickHouseClient:
    """ClickHouse's HTTP interface: queries with typed parameters, results as JSONEachRow."""

    http: httpx.AsyncClient
    url: str
    user: str
    password: str
    database: str
    timeout_s: float = 30.0

    def _headers(self) -> dict[str, str]:
        return {"X-ClickHouse-User": self.user, "X-ClickHouse-Key": self.password}

    async def query(
        self, sql: str, params: Mapping[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        query_params: dict[str, str] = {"database": self.database, "default_format": "JSONEachRow"}
        for name, value in (params or {}).items():
            query_params[f"param_{name}"] = _ch_value(value)
        try:
            r = await self.http.post(
                self.url,
                params=query_params,
                content=sql.encode(),
                headers=self._headers(),
                timeout=self.timeout_s,
            )
        except httpx.HTTPError as exc:
            raise ClickHouseError(type(exc).__name__) from exc
        if r.status_code != 200:
            # The body names the failing part of the query; it holds no personal data.
            raise ClickHouseError(f"{r.status_code}: {r.text[:300]}")
        return [json.loads(line) for line in r.text.splitlines() if line.strip()]

    async def insert(self, table: str, rows: Sequence[Mapping[str, Any]]) -> None:
        if not rows:
            return
        if not table.replace("_", "").isalnum():
            raise ValueError("table names are identifiers")
        body = "\n".join(json.dumps(dict(r), default=str) for r in rows)
        try:
            r = await self.http.post(
                self.url,
                params={
                    "database": self.database,
                    "query": f"INSERT INTO {table} FORMAT JSONEachRow",
                },
                content=body.encode(),
                headers=self._headers(),
                timeout=self.timeout_s,
            )
        except httpx.HTTPError as exc:
            raise ClickHouseError(type(exc).__name__) from exc
        if r.status_code != 200:
            raise ClickHouseError(f"{r.status_code}: {r.text[:300]}")


def _ch_value(value: Any) -> str:
    if isinstance(value, list | tuple):
        return "[" + ",".join(f"'{_escape(str(v))}'" for v in value) + "]"
    if isinstance(value, bool):
        return "1" if value else "0"
    return str(value)


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


# The sync events land in ``events`` with the event payload as ``props`` (DB_SCHEMA §14).
_CH_REVIEW_COUNTS = (
    "SELECT toString(user_id) AS user_id, count() AS n FROM events FINAL"
    " WHERE type = 'review_rated' AND NOT is_guest GROUP BY user_id"
)
_CH_REVIEW_LOGS = (
    "SELECT JSONExtractString(props, 'card_ref') AS card_ref,"
    " JSONExtractInt(props, 'rating') AS rating,"
    " toString(occurred_at) AS reviewed_at,"
    " JSONExtractInt(props, 'ms_to_answer') AS duration_ms"
    " FROM events FINAL WHERE type = 'review_rated' AND user_id = {u:UUID}"
    " ORDER BY occurred_at"
)
_CH_FIRST_ANSWERS = (
    "SELECT toString(user_id) AS user_id, JSONExtractString(props, 'question_id') AS question_id,"
    " JSONExtractBool(props, 'correct') AS correct"
    " FROM events FINAL WHERE type = 'answer_submitted' AND NOT is_guest"
    " AND JSONExtractInt(props, 'attempt') = 1 AND JSONExtractString(props, 'question_id') != ''"
)

# Built from constants only; values travel as ClickHouse query parameters.
_CH_QUESTION_COUNTS = (
    "SELECT question_id, count() AS n, countIf(correct) AS ok FROM ("  # noqa: S608
    + _CH_FIRST_ANSWERS
    + ") GROUP BY question_id HAVING n >= {m:UInt32} ORDER BY question_id"
)
_CH_RESPONSES = (
    "SELECT * FROM ("  # noqa: S608
    + _CH_FIRST_ANSWERS
    + ") WHERE has({q:Array(String)}, question_id)"
)


@dataclass
class ClickHouseAnalyticsStore:
    client: ClickHouseClient
    name: str = "clickhouse"

    async def review_counts(self) -> dict[uuid.UUID, int]:
        rows = await self.client.query(_CH_REVIEW_COUNTS)
        return {uuid.UUID(r["user_id"]): int(r["n"]) for r in rows}

    async def review_logs(self, user_id: uuid.UUID) -> list[ReviewRow]:
        rows = await self.client.query(_CH_REVIEW_LOGS, {"u": str(user_id)})
        return [
            ReviewRow(
                card_ref=str(r["card_ref"]),
                rating=int(r["rating"]),
                reviewed_at=datetime.fromisoformat(str(r["reviewed_at"])),
                duration_ms=int(r["duration_ms"]) if r.get("duration_ms") else None,
            )
            for r in rows
        ]

    async def question_counts(self, min_responses: int) -> list[QuestionCount]:
        rows = await self.client.query(_CH_QUESTION_COUNTS, {"m": min_responses})
        return [QuestionCount(str(r["question_id"]), int(r["n"]), int(r["ok"])) for r in rows]

    async def responses(self, question_ids: Sequence[str]) -> list[ResponseRow]:
        rows = await self.client.query(_CH_RESPONSES, {"q": list(question_ids)})
        return [
            ResponseRow(uuid.UUID(r["user_id"]), str(r["question_id"]), bool(r["correct"]))
            for r in rows
        ]


@dataclass
class PostgresAnalyticsStore:
    """Local stand-in: the same facts from the Postgres tables the app already keeps."""

    db: Database
    name: str = "postgres"

    async def review_counts(self) -> dict[uuid.UUID, int]:
        async with self.db.system_tx() as session:
            rows = (
                await session.execute(
                    text("select user_id, count(*) as n from learn.srs_reviews group by user_id")
                )
            ).all()
        return {r.user_id: int(r.n) for r in rows}

    async def review_logs(self, user_id: uuid.UUID) -> list[ReviewRow]:
        async with self.db.system_tx() as session:
            rows = (
                await session.execute(
                    text(
                        "select card_ref, rating, reviewed_at, duration_ms from learn.srs_reviews"
                        " where user_id = :u order by reviewed_at"
                    ),
                    {"u": user_id},
                )
            ).all()
        return [ReviewRow(r.card_ref, int(r.rating), r.reviewed_at, r.duration_ms) for r in rows]

    async def question_counts(self, min_responses: int) -> list[QuestionCount]:
        async with self.db.system_tx() as session:
            rows = (
                await session.execute(
                    text(
                        "select question_id, count(*) as n, count(*) filter (where is_correct) as ok"
                        " from learn.question_attempts where attempt_no = 1"
                        " group by question_id having count(*) >= :m order by question_id"
                    ),
                    {"m": min_responses},
                )
            ).all()
        return [QuestionCount(r.question_id, int(r.n), int(r.ok)) for r in rows]

    async def responses(self, question_ids: Sequence[str]) -> list[ResponseRow]:
        async with self.db.system_tx() as session:
            rows = (
                await session.execute(
                    text(
                        "select user_id, question_id, is_correct from learn.question_attempts"
                        " where attempt_no = 1 and question_id = any(:q)"
                    ),
                    {"q": list(question_ids)},
                )
            ).all()
        return [ResponseRow(r.user_id, r.question_id, bool(r.is_correct)) for r in rows]


def build_analytics_store(
    http: httpx.AsyncClient,
    db: Database,
    *,
    url: str,
    user: str,
    password: str,
    database: str,
) -> AnalyticsStore:
    if url:
        return ClickHouseAnalyticsStore(
            ClickHouseClient(http, url=url, user=user, password=password, database=database)
        )
    return PostgresAnalyticsStore(db)
