"""Live mocks (Phase 3, practice §6.11): registration, the room, the start and clock fan-out,
frozen ranks from real in-window attempts, and the R31 leaderboard. The paper is one published
fixture question; the tests write no study content."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.integrations.realtime import RecordingRealtime, RedisRealtime
from smriti_api.services import live_mocks
from tests.helpers import Session
from tests.money_helpers import grant_pro, set_profile, signed_in
from tests.practice_helpers import flags

LIVE = {"live.enabled": True}


@pytest.fixture(scope="module")
async def active_blueprint(services: AppServices, content: str) -> AsyncIterator[str]:
    async with services.db.admin_tx() as session:
        await session.execute(
            text("update content.exam_blueprints set status = 'active' where exam_profile_id = :e"),
            {"e": content},
        )
    yield content
    async with services.db.admin_tx() as session:
        await session.execute(
            text("update content.exam_blueprints set status = 'draft' where exam_profile_id = :e"),
            {"e": content},
        )


async def _live_mock(
    services: AppServices, exam: str, start: datetime, end: datetime
) -> tuple[str, str]:
    """A live mock over one fixture question that the blueprint's first section takes."""
    mock_id = f"live-test-{uuid.uuid4().hex[:8]}"
    async with services.db.admin_tx() as session:
        bp = (
            await session.execute(
                text(
                    "select id, spec from content.exam_blueprints where exam_profile_id = :e"
                    " order by version desc limit 1"
                ),
                {"e": exam},
            )
        ).one()
        section = bp.spec["sections"][0]
        qid = (
            await session.execute(
                text(
                    "select q.id from content.questions q join content.question_keys k"
                    " on k.question_id = q.id where q.type = any(:t) and q.id like 'q.fx.%'"
                    " and k.answer ? 'option_ids' order by q.id limit 1"
                ),
                {"t": list(section["question_types"])},
            )
        ).scalar_one()
        await session.execute(
            text(
                "insert into content.mocks (id, exam_profile_id, blueprint_id, kind, title,"
                " window_start, window_end, status) values (:id, :e, :bp, 'live',"
                " cast(:title as jsonb), :ws, :we, 'open')"
            ),
            {
                "id": mock_id,
                "e": exam,
                "bp": bp.id,
                "title": json.dumps({"en": "Live test", "hi": "Live test"}),
                "ws": start,
                "we": end,
            },
        )
        await session.execute(
            text(
                "insert into content.mock_items (mock_id, section_code, position, question_id)"
                " values (:m, :s, 1, :q)"
            ),
            {"m": mock_id, "s": section["code"], "q": qid},
        )
    return mock_id, qid


async def _pro(
    client: httpx.AsyncClient, services: AppServices, exam: str, **profile: Any
) -> Session:
    s = await signed_in(client)
    r = await client.put(
        "/v1/me/exams", json={"exam_profile_ids": [exam], "primary": exam}, headers=s.headers
    )
    assert r.status_code == 200, r.text
    await set_profile(services, s.user_id, **({"age_band": "18p"} | profile))
    await grant_pro(services, s.user_id)
    return s


async def _answer(services: AppServices, qid: str, right: bool) -> dict[str, Any]:
    async with services.db.admin_tx() as session:
        key = (
            await session.execute(
                text("select answer from content.question_keys where question_id = :q"),
                {"q": qid},
            )
        ).scalar_one()
    options = list(key["option_ids"])
    if not right:
        options = [next(o for o in ("a", "b", "c", "d") if o not in options)]
    return {"kind": "options", "option_ids": options}


async def _sit(
    client: httpx.AsyncClient,
    services: AppServices,
    s: Session,
    mock_id: str,
    qid: str,
    right: bool,
) -> str:
    r = await client.post(
        f"/v1/mocks/{mock_id}/attempts",
        json={"attempt_id": str(uuid.uuid4()), "language": "en"},
        headers=s.headers,
    )
    assert r.status_code == 201, r.text
    attempt = r.json()
    assert attempt["time_policy"] == "live"
    row = {
        "question_id": qid,
        "answer": await _answer(services, qid, right),
        "palette_status": "answered",
        "time_spent_ms": 30_000,
        "visits": 1,
        "client_updated_at": datetime.now(UTC).isoformat(),
    }
    r = await client.put(
        f"/v1/attempts/{attempt['id']}/answers", json={"answers": [row]}, headers=s.headers
    )
    assert r.status_code == 200, r.text
    r = await client.post(f"/v1/attempts/{attempt['id']}/submit", headers=s.headers)
    assert r.status_code == 200, r.text
    return str(attempt["id"])


async def test_room_registration_and_reminder(
    client: httpx.AsyncClient, services: AppServices, active_blueprint: str
) -> None:
    now = datetime.now(UTC)
    soon, _ = await _live_mock(
        services, active_blueprint, now + timedelta(hours=2), now + timedelta(hours=3)
    )
    s = await _pro(client, services, active_blueprint)
    assert (await client.get(f"/v1/live/mocks/{soon}", headers=s.headers)).status_code == 404

    async with flags(services, {**LIVE, "live.room_lead_min": 30}):
        room = (await client.get(f"/v1/live/mocks/{soon}", headers=s.headers)).json()
        assert room["status"] == "scheduled" and room["can_start"] is False
        assert room["channel"] == f"mock:{soon}" and room["registered"] is False
        opens = datetime.fromisoformat(room["room_opens_at"])
        assert opens == datetime.fromisoformat(room["window_start"]) - timedelta(minutes=30)

        free = await signed_in(client)
        r = await client.post(f"/v1/live/mocks/{soon}/registration", headers=free.headers)
        assert r.status_code == 403 and r.json()["paywall_source"] == "live_mock"

        r = await client.post(f"/v1/live/mocks/{soon}/registration", headers=s.headers)
        assert r.status_code == 200, r.text
        assert datetime.fromisoformat(r.json()["reminder_at"]) == opens
        room = (await client.get(f"/v1/live/mocks/{soon}", headers=s.headers)).json()
        assert room["registered"] is True and room["registrations"] == 1

        async with services.db.admin_tx() as session:
            outbox = (
                await session.execute(
                    text(
                        "select payload, not_before from notify.outbox where user_id = :u"
                        " and kind = 'mock_reminder'"
                    ),
                    {"u": s.user_id},
                )
            ).one()
        assert outbox.payload == {"mock_id": soon} and outbox.not_before == opens

        r = await client.delete(f"/v1/live/mocks/{soon}/registration", headers=s.headers)
        assert r.json()["registered"] is False
        async with services.db.admin_tx() as session:
            left = (
                await session.execute(
                    text(
                        "select count(*) from notify.outbox where user_id = :u and kind = 'mock_reminder'"
                    ),
                    {"u": s.user_id},
                )
            ).scalar_one()
        assert left == 0


async def test_start_clock_and_frozen_ranks(
    client: httpx.AsyncClient, services: AppServices, active_blueprint: str
) -> None:
    now = datetime.now(UTC)
    end = now + timedelta(minutes=50)
    mock_id, qid = await _live_mock(services, active_blueprint, now - timedelta(minutes=10), end)
    rt = RecordingRealtime()
    async with flags(services, LIVE):
        a = await _pro(client, services, active_blueprint)
        b = await _pro(client, services, active_blueprint)
        teen = await _pro(client, services, active_blueprint, age_band="13_17")
        room = (await client.get(f"/v1/live/mocks/{mock_id}", headers=a.headers)).json()
        assert room["status"] == "live" and room["can_start"] is True
        assert datetime.fromisoformat(room["deadline_if_started_now"]) <= end

        first_a = await _sit(client, services, a, mock_id, qid, right=True)
        first_b = await _sit(client, services, b, mock_id, qid, right=False)
        await _sit(client, services, teen, mock_id, qid, right=True)

        await live_mocks.tick(services.db, rt, now)
        mine = [(e, p) for c, e, p in rt.sent if c == f"mock:{mock_id}"]
        assert [e for e, _ in mine] == ["start", "clock"]
        await live_mocks.tick(services.db, rt, now + timedelta(minutes=1))
        assert [e for c, e, _ in rt.sent if c == f"mock:{mock_id}"].count("start") == 1

        report = (await client.get(f"/v1/attempts/{first_b}/report", headers=b.headers)).json()
        assert report["standing"]["reason"] == "results_pending"
        board = (
            await client.get(f"/v1/live/mocks/{mock_id}/leaderboard", headers=a.headers)
        ).json()
        assert board["published"] is False and board["reason"] == "results_pending"

        after = end + timedelta(minutes=1)
        async with flags(services, {"mock.min_attempts_for_percentile": 3}):
            await live_mocks.tick(services.db, rt, after)
        events = [e for c, e, _ in rt.sent if c == f"mock:{mock_id}"]
        assert events[-2:] == ["closed", "results"]

        report = (await client.get(f"/v1/attempts/{first_b}/report", headers=b.headers)).json()
        assert report["standing"]["shown"] is True
        assert (report["standing"]["rank"], report["standing"]["of"]) == (3, 3)
        assert report["standing"]["percentile"] == pytest.approx(33.33)
        report = (await client.get(f"/v1/attempts/{first_a}/report", headers=a.headers)).json()
        assert report["standing"]["rank"] == 1 and report["standing"]["percentile"] == 100

        board = (
            await client.get(f"/v1/live/mocks/{mock_id}/leaderboard", headers=a.headers)
        ).json()
        assert board["published"] is True and board["ranked"] == 3
        # The teen has no guardian consent for social, so only the two adults are listed.
        assert [(r["rank"], r["is_you"]) for r in board["rows"]] == [(1, True), (3, False)]
        board = (
            await client.get(f"/v1/live/mocks/{mock_id}/leaderboard", headers=teen.headers)
        ).json()
        assert board["you"]["rank"] == 1 and board["you"]["avatar"] is None
        assert all(not r["is_you"] for r in board["rows"])

        # Published once: later ticks leave the frozen ranks alone.
        assert (await live_mocks.tick(services.db, rt, after + timedelta(minutes=5)))[
            "published"
        ] == 0


async def test_unset_threshold_publishes_without_ranks(
    client: httpx.AsyncClient, services: AppServices, active_blueprint: str
) -> None:
    now = datetime.now(UTC)
    end = now + timedelta(minutes=50)
    mock_id, qid = await _live_mock(services, active_blueprint, now - timedelta(minutes=5), end)
    async with flags(services, LIVE):
        s = await _pro(client, services, active_blueprint)
        attempt = await _sit(client, services, s, mock_id, qid, right=True)
        await live_mocks.tick(services.db, None, end + timedelta(minutes=1))
        report = (await client.get(f"/v1/attempts/{attempt}/report", headers=s.headers)).json()
        assert report["standing"]["reason"] == "threshold_unset"
        board = (
            await client.get(f"/v1/live/mocks/{mock_id}/leaderboard", headers=s.headers)
        ).json()
        assert board["published"] is True and board["reason"] == "threshold_unset"
        assert board["rows"] == []


async def test_server_sent_events_stream(services: AppServices) -> None:
    rt = RedisRealtime(services.redis)
    stream = live_mocks.event_stream(rt, "m-sse", heartbeat_s=0.2)
    hello = await asyncio.wait_for(anext(stream), 5)
    assert hello.startswith("event: hello\n")

    async def publish() -> None:
        await asyncio.sleep(0.3)
        await rt.publish("mock:m-sse", "start", {"server_time": "t"})

    task = asyncio.create_task(publish())
    seen: list[str] = []
    while not any(chunk.startswith("event: start") for chunk in seen):
        seen.append(await asyncio.wait_for(anext(stream), 5))
    await task
    assert 'data: {"server_time": "t"}' in seen[-1]
    await stream.aclose()  # type: ignore[attr-defined]
