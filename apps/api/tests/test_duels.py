"""Challenge duels (tutor-social B10): server-picked questions, the server clock and scoring,
friend (live and async), random matching, solo rounds, quits, rematch, the event channel, and
flagged XP left out of leagues."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services import duels, leagues
from tests.helpers import Session
from tests.practice_helpers import flags
from tests.social_helpers import befriend, outbox, person

DUEL_FLAGS: dict[str, Any] = {
    "duel.question_seconds": 30,
    "duel.question_count": 3,
    "duel.speed_bonus_max": 0,
    "xp.duel_per_correct": 2,
    "xp.duel_win": 5,
    "duel.rematch_wait_seconds": 60,
}


@asynccontextmanager
async def duel_flags(services: AppServices, **extra: Any) -> AsyncIterator[None]:
    async with flags(services, {**DUEL_FLAGS, **extra}):
        yield


async def key_of(services: AppServices, question_id: str) -> list[str]:
    async with services.db.admin_tx() as session:
        answer = (
            await session.execute(
                text("select body -> 'answer' from content.question_bodies where question_id = :q"),
                {"q": question_id},
            )
        ).scalar_one()
    return list(answer["option_ids"])


async def start_now(services: AppServices, duel_id: str) -> None:
    """Skip the 3-2-1 so the test doesn't wait for it."""
    past = datetime.now(UTC) - timedelta(seconds=1)
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "update social.duels set start_at = :t, question_opened_at = :t"
                " where id = :d and mode = 'live'"
            ),
            {"t": past, "d": duel_id},
        )


async def answer(
    client: httpx.AsyncClient,
    services: AppServices,
    s: Session,
    duel: dict[str, Any],
    *,
    right: bool,
) -> dict[str, Any]:
    qid = duel["current"]["question_id"]
    options = await key_of(services, qid) if right else ["zz"]
    r = await client.post(
        f"/v1/duels/{duel['id']}/answers",
        json={"question_id": qid, "option_ids": options},
        headers=s.headers,
    )
    assert r.status_code == 200, r.text
    out: dict[str, Any] = r.json()
    return out


async def test_duels_need_config_and_friends(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    a = await person(client, services, exam=content)
    b = await person(client, services, exam=content)
    r = await client.post("/v1/duels", json={"solo": True}, headers=a.headers)
    assert r.status_code == 409 and r.json()["code"] == "duel_unavailable"
    async with duel_flags(services):
        r = await client.post("/v1/duels", json={"opponent_id": str(b.user_id)}, headers=a.headers)
        assert r.status_code == 403 and r.json()["code"] == "not_friends"
        r = await client.post(
            "/v1/duels", json={"solo": True, "subject_id": "no-such-subject"}, headers=a.headers
        )
        assert r.status_code == 409 and r.json()["reason"] == "not_enough_questions"
        child = await person(client, services, band="10_12", exam=content)
        r = await client.post("/v1/duels/random", json={}, headers=child.headers)
        assert r.status_code == 403


async def test_solo_round(client: httpx.AsyncClient, services: AppServices, content: str) -> None:
    a = await person(client, services, exam=content)
    async with duel_flags(services):
        r = await client.post("/v1/duels", json={"solo": True}, headers=a.headers)
        assert r.status_code == 201, r.text
        duel = r.json()
        assert duel["relation"] == "solo" and duel["status"] == "live"
        assert duel["current"]["index"] == 0 and "answer" not in str(duel["current"]["body"])
        out = await answer(client, services, a, duel, right=True)
        assert out["correct"] and out["points"] == 1 and out["key"] is not None
        duel = out["duel"]
        # Same question again: the first answer stands.
        r = await client.post(
            f"/v1/duels/{duel['id']}/answers",
            json={"question_id": out["duel"]["my_answers"][0]["question_id"], "option_ids": ["zz"]},
            headers=a.headers,
        )
        assert r.status_code == 200 and r.json()["correct"] is True
        duel = (await answer(client, services, a, duel, right=False))["duel"]
        duel = (await answer(client, services, a, duel, right=True))["duel"]
        assert duel["status"] == "finished"
        assert duel["result"]["winner"] == "none" and duel["result"]["xp_earned"] == 4  # no win XP
        rematch = (await client.post(f"/v1/duels/{duel['id']}/rematch", headers=a.headers)).json()
        assert rematch["relation"] == "solo" and rematch["id"] != duel["id"]


async def test_friend_live_duel_with_events_and_flags(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    a = await person(client, services, name="Asha Verma", exam=content)
    b = await person(client, services, name="Kabir Rao", exam=content)
    await befriend(client, a, b)
    async with duel_flags(services, **{"duel.min_answer_ms": 3_600_000}):
        r = await client.post("/v1/duels", json={"opponent_id": str(b.user_id)}, headers=a.headers)
        assert r.status_code == 201, r.text
        duel = r.json()
        assert duel["status"] == "pending" and duel["current"] is None
        push = [p for p in await outbox(services, b.user_id) if p.kind == "duel_challenge"]
        assert push and push[0].payload["code"] == duel["code"]
        inbox = (await client.get("/v1/social/inbox", headers=b.headers)).json()
        assert "duel_challenge" in [i["kind"] for i in inbox["items"]]

        r = await client.post(f"/v1/duels/{duel['id']}/accept", headers=b.headers)
        assert r.json()["status"] == "live" and r.json()["start_at"]
        await start_now(services, duel["id"])
        da = (await client.get(f"/v1/duels/{duel['id']}", headers=a.headers)).json()
        db_ = (await client.get(f"/v1/duels/code/{duel['code']}", headers=b.headers)).json()
        assert da["current"]["question_id"] == db_["current"]["question_id"]

        for i in range(3):
            out = await answer(client, services, a, da, right=True)
            assert out["key"] is None  # revealed only once both have answered
            opp = out["duel"]["players"]
            assert all(p["score"] in (0, None) or p["is_me"] or i > 0 for p in opp)
            out_b = await answer(client, services, b, db_, right=i == 0)
            assert out_b["key"] is not None
            da = (await client.get(f"/v1/duels/{duel['id']}", headers=a.headers)).json()
            db_ = out_b["duel"]
        assert da["status"] == "finished"
        assert da["result"]["winner"] == "me" and da["result"]["xp_earned"] == 3 * 2 + 5
        assert db_["result"]["winner"] == "them" and db_["result"]["xp_earned"] == 2
        # Every answer was "too fast" for this flag, so both are flagged: the result stands,
        # each sees the neutral "not counted" line, and leagues leave the XP out.
        assert da["result"]["not_counted"] is True
        week = leagues.week_opens(leagues.week_start(datetime.now(UTC)))
        async with services.db.admin_tx() as session:
            counted = await leagues.counted_xp(session, [a.user_id], week, datetime.now(UTC))
        assert counted[a.user_id] == 0

        ev = (await client.get(f"/v1/duels/{duel['id']}/events", headers=a.headers)).json()
        kinds = [e["kind"] for e in ev["events"]]
        assert kinds[0] == "started" and kinds.count("reveal") == 3 and kinds[-1] == "finished"
        assert "option_ids" not in str([e for e in ev["events"] if e["kind"] == "answered"])
        later = (
            await client.get(
                f"/v1/duels/{duel['id']}/events",
                params={"after": ev["last_event_id"]},
                headers=a.headers,
            )
        ).json()
        assert later["events"] == []
        outsider = await person(client, services, exam=content)
        r = await client.get(f"/v1/duels/{duel['id']}", headers=outsider.headers)
        assert r.status_code == 404

        # Rematch needs both taps.
        first = (await client.post(f"/v1/duels/{duel['id']}/rematch", headers=a.headers)).json()
        assert first["rematch"]["requested_by_me"] and first["rematch"]["duel_id"] is None
        second = (await client.post(f"/v1/duels/{duel['id']}/rematch", headers=b.headers)).json()
        assert second["id"] != duel["id"] and second["status"] == "live"

        # Leaving a live duel gives the other player the win.
        await client.post(f"/v1/duels/{second['id']}/leave", headers=b.headers)
        left = (await client.get(f"/v1/duels/{second['id']}", headers=a.headers)).json()
        assert left["status"] == "abandoned" and left["result"]["winner"] == "me"
        assert left["result"]["abandoned_by_them"] is True

        listed = (await client.get("/v1/duels", headers=b.headers)).json()
        assert {d["id"] for d in listed} >= {duel["id"], second["id"]}


async def test_async_challenge(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    a = await person(client, services, exam=content)
    b = await person(client, services, exam=content)
    await befriend(client, a, b)
    async with duel_flags(services):
        duel = (
            await client.post("/v1/duels", json={"opponent_id": str(b.user_id)}, headers=a.headers)
        ).json()
        r = await client.post(f"/v1/duels/{duel['id']}/async", headers=a.headers)
        assert r.status_code == 200, r.text
        duel = r.json()
        assert duel["mode"] == "async" and duel["current"]["index"] == 0
        for right in (True, True, False):
            duel = (await answer(client, services, a, duel, right=right))["duel"]
        assert duel["status"] == "pending"  # waiting for the friend
        theirs = next(p for p in duel["players"] if not p["is_me"])
        assert theirs["score"] is None

        mine = (await client.get("/v1/duels", headers=b.headers)).json()
        assert next(d for d in mine if d["id"] == duel["id"])["my_turn"] is True
        duel_b = (await client.post(f"/v1/duels/{duel['id']}/accept", headers=b.headers)).json()
        assert duel_b["status"] == "live" and duel_b["current"]["index"] == 0
        for _ in range(3):
            duel_b = (await answer(client, services, b, duel_b, right=False))["duel"]
        assert duel_b["status"] == "finished" and duel_b["result"]["winner"] == "them"
        assert "duel_result" in {p.kind for p in await outbox(services, a.user_id)}


async def test_async_challenge_expires(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    a = await person(client, services, exam=content)
    b = await person(client, services, exam=content)
    await befriend(client, a, b)
    async with duel_flags(services):
        duel = (
            await client.post("/v1/duels", json={"opponent_id": str(b.user_id)}, headers=a.headers)
        ).json()
        await client.post(f"/v1/duels/{duel['id']}/async", headers=a.headers)
        await duels.sweep(services.db, datetime.now(UTC) + timedelta(hours=25))
        after = (await client.get(f"/v1/duels/{duel['id']}", headers=a.headers)).json()
        assert after["status"] == "expired" and after["result"] is None


async def test_random_matching_and_quit_pause(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    exam = content
    async with services.db.admin_tx() as session:
        await session.execute(text("delete from social.duel_queue"))
    a = await person(client, services, exam=exam)
    b = await person(client, services, exam=exam)
    teen = await person(client, services, band="13_17", exam=exam)
    quit_flags = {
        "duel.quit_limit": 1,
        "duel.quit_window_hours": 24,
        "duel.quit_cooldown_minutes": 30,
    }
    async with duel_flags(services, **quit_flags):
        r = await client.post("/v1/duels/random", json={}, headers=a.headers)
        assert r.json()["state"] == "waiting" and r.json()["timed_out"] is False
        # Adults with adults, teens with teens.
        r = await client.post("/v1/duels/random", json={}, headers=teen.headers)
        assert r.json()["state"] == "waiting"
        r = await client.post("/v1/duels/random", json={}, headers=b.headers)
        matched = r.json()
        assert matched["state"] == "matched" and matched["duel"]["relation"] == "random"
        seen_by_a = (await client.get("/v1/duels/random", headers=a.headers)).json()
        assert seen_by_a["state"] == "matched"
        assert seen_by_a["duel"]["id"] == matched["duel"]["id"]
        await client.delete("/v1/duels/random", headers=teen.headers)

        duel_id = matched["duel"]["id"]
        await start_now(services, duel_id)
        r = await client.post(f"/v1/duels/{duel_id}/leave", headers=b.headers)
        assert r.json()["status"] == "abandoned"
        r = await client.post("/v1/duels/random", json={}, headers=b.headers)
        assert r.status_code == 409 and r.json()["code"] == "duel_paused"
        friend_ok = await client.post("/v1/duels", json={"solo": True}, headers=b.headers)
        assert friend_ok.status_code == 201


async def test_both_away_expires_live_duel(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    a = await person(client, services, exam=content)
    b = await person(client, services, exam=content)
    await befriend(client, a, b)
    async with duel_flags(services):
        duel = (
            await client.post("/v1/duels", json={"opponent_id": str(b.user_id)}, headers=a.headers)
        ).json()
        await client.post(f"/v1/duels/{duel['id']}/accept", headers=b.headers)
        await start_now(services, duel["id"])
        await duels.sweep(services.db, datetime.now(UTC) + timedelta(minutes=5))
        after = (await client.get(f"/v1/duels/{duel['id']}", headers=a.headers)).json()
        assert after["status"] == "expired"
        async with services.db.admin_tx() as session:
            xp = (
                await session.execute(
                    text("select count(*) from game.xp_ledger where ref = :r"),
                    {"r": f"duel:{duel['id']}"},
                )
            ).scalar_one()
        assert xp == 0


def test_has_media() -> None:
    assert duels._has_media({"stem": {"en": "x"}, "media": [{"ref": "img.a"}]})
    assert not duels._has_media({"stem": {"en": "x"}, "media": []})
