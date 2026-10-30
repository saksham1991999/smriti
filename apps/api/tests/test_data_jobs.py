"""Analytics store and the G-11 data jobs (FSRS optimisation, IRT calibration skeleton)."""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fsrs.scheduler import DEFAULT_PARAMETERS
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.integrations import analytics_store as st
from smriti_api.services import data_jobs
from tests.helpers import new_guest
from tests.practice_helpers import flags


async def test_clickhouse_client_uses_typed_parameters() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if "INSERT" in request.url.params.get("query", ""):
            return httpx.Response(200, text="")
        rows = [
            {
                "card_ref": "d:a",
                "rating": 3,
                "reviewed_at": "2026-10-01 10:00:00.000",
                "duration_ms": 0,
            },
            {
                "card_ref": "d:a",
                "rating": 1,
                "reviewed_at": "2026-10-03 10:00:00.000",
                "duration_ms": 4200,
            },
        ]
        return httpx.Response(200, text="\n".join(json.dumps(r) for r in rows) + "\n")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        store = st.ClickHouseAnalyticsStore(
            st.ClickHouseClient(
                http, url="https://ch.example:8443", user="u", password="p", database="smriti"
            )
        )
        assert isinstance(store, st.ClickHouseAnalyticsStore)
        uid = uuid.uuid4()
        logs = await store.review_logs(uid)
        assert [(r.rating, r.duration_ms) for r in logs] == [(3, None), (1, 4200)]
        req = seen[0]
        assert req.url.params["database"] == "smriti"
        assert req.url.params["param_u"] == str(uid)
        assert "{u:UUID}" in req.content.decode() and str(uid) not in req.content.decode()
        assert req.headers["X-ClickHouse-User"] == "u" and req.headers["X-ClickHouse-Key"] == "p"
        await store.client.insert("events", [{"event_id": str(uid)}])
        assert seen[-1].url.params["query"] == "INSERT INTO events FORMAT JSONEachRow"
        with pytest.raises(ValueError):
            await store.client.insert("events; drop", [{"x": 1}])

    def failing(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="Code: 60. Unknown table")

    async with httpx.AsyncClient(transport=httpx.MockTransport(failing)) as http:
        client = st.ClickHouseClient(http, url="https://ch", user="u", password="p", database="d")
        with pytest.raises(st.ClickHouseError, match="500"):
            await client.query("SELECT 1")


async def _reviews(services: AppServices, user_id: uuid.UUID, n: int) -> None:
    start = datetime.now(UTC) - timedelta(days=n)
    async with services.db.admin_tx() as session:
        for i in range(n):
            await session.execute(
                text(
                    "insert into learn.srs_reviews (id, user_id, card_ref, rating, state_before,"
                    " elapsed_days, scheduled_days, stability_after, difficulty_after, duration_ms,"
                    " context, reviewed_at) values (:id, :u, :c, :r, 2, 1, 1, 1, 5, 3000, 'review', :at)"
                ),
                {
                    "id": uuid.uuid4(),
                    "u": user_id,
                    "c": f"d:card-{i % 3}",
                    "r": 3 if i % 4 else 1,
                    "at": start + timedelta(days=i),
                },
            )


async def test_fsrs_optimise_on_postgres_review_logs(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    await _reviews(services, s.user_id, 6)
    store = st.PostgresAnalyticsStore(services.db)
    logs = await store.review_logs(s.user_id)
    assert len(logs) == 6 and logs[0].reviewed_at < logs[-1].reviewed_at
    assert (await store.review_counts())[s.user_id] == 6

    assert (await data_jobs.fsrs_optimise(services.db, store)).status == "threshold_unset"
    async with flags(services, {"memory.fsrs.optimise_min_reviews": 5}):
        report = await data_jobs.fsrs_optimise(services.db, store)
        if not data_jobs.optimizer_available():
            # py-fsrs's optimiser extra (torch, pandas) is not installed here.
            assert report.status == "optimizer_unavailable" and report.eligible >= 1

        fits: list[int] = []

        def fake_fit(rows: Sequence[st.ReviewRow]) -> list[float]:
            fits.append(len(rows))
            return list(DEFAULT_PARAMETERS)  # stands in for a fit; py-fsrs's own defaults

        def bad_fit(rows: Sequence[st.ReviewRow]) -> list[float]:
            return [0.5] * len(DEFAULT_PARAMETERS)

        other = await new_guest(client)
        await _reviews(services, other.user_id, 6)
        await data_jobs.fsrs_optimise(services.db, store, fit=bad_fit)
        async with services.db.admin_tx() as session:
            stored = (
                await session.execute(
                    text("select count(*) from learn.fsrs_params where user_id = :u"),
                    {"u": other.user_id},
                )
            ).scalar_one()
        assert stored == 0  # out-of-bounds parameters are never stored

        report = await data_jobs.fsrs_optimise(services.db, store, fit=fake_fit)
        assert report.status == "ok" and report.done >= 1 and 6 in fits
        async with services.db.admin_tx() as session:
            row = (
                await session.execute(
                    text("select weights, review_count from learn.fsrs_params where user_id = :u"),
                    {"u": s.user_id},
                )
            ).one()
        assert row.review_count == 6 and len(row.weights) == len(DEFAULT_PARAMETERS)
        # No new reviews since the fit: not eligible again.
        fits.clear()
        await data_jobs.fsrs_optimise(services.db, store, fit=fake_fit)
        assert 6 not in fits


class FakeCalibrator:
    name = "fake"

    def __init__(self) -> None:
        self.seen: list[st.ResponseRow] = []

    def fit(self, responses: Sequence[st.ResponseRow]) -> dict[str, data_jobs.ItemParams]:
        self.seen = list(responses)
        return {
            r.question_id: data_jobs.ItemParams(difficulty=0.25, discrimination=1.1)
            for r in responses
        }


async def test_irt_skeleton(client: httpx.AsyncClient, services: AppServices, content: str) -> None:
    qid = "q.fx.chapter-a.topic-b.0001"
    async with services.db.admin_tx() as session:
        before = (
            await session.execute(
                text("select difficulty, discrimination from content.questions where id = :q"),
                {"q": qid},
            )
        ).one()
        for ok in (True, False, True):
            s = await new_guest(client)
            await session.execute(
                text(
                    "insert into learn.question_attempts (id, user_id, question_id, context, answer,"
                    " is_correct, time_ms, answered_at) values (:id, :u, :q, 'practice', '{}', :ok,"
                    " 20000, now())"
                ),
                {"id": uuid.uuid4(), "u": s.user_id, "q": qid, "ok": ok},
            )
    store = st.PostgresAnalyticsStore(services.db)
    assert (await data_jobs.irt_calibrate(services.db, store)).status == "threshold_unset"
    async with flags(services, {"irt.min_responses": 3}):
        counts = {c.question_id: c for c in await store.question_counts(3)}
        assert counts[qid].responses >= 3
        report = await data_jobs.irt_calibrate(services.db, store)
        assert report.status == "calibrator_unavailable" and report.eligible >= 1
        cal = FakeCalibrator()
        report = await data_jobs.irt_calibrate(services.db, store, calibrator=cal)
        assert report.status == "ok" and report.done >= 1
        assert {r.question_id for r in cal.seen} >= {qid}
    async with services.db.admin_tx() as session:
        after = (
            await session.execute(
                text("select difficulty, discrimination from content.questions where id = :q"),
                {"q": qid},
            )
        ).one()
        assert float(after.difficulty) == 0.25 and float(after.discrimination) == 1.1
        await session.execute(
            text("update content.questions set difficulty = :b, discrimination = :a where id = :q"),
            {"b": before.difficulty, "a": before.discrimination, "q": qid},
        )
