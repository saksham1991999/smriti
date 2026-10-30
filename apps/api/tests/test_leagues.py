"""Leagues and leaderboards (tutor-social B6, B7; R30, R31)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services import leagues
from smriti_api.services.usage import Flags
from tests.practice_helpers import flags
from tests.social_helpers import add_xp, befriend, outbox, person

EXAM = f"fx-league-{uuid.uuid4().hex[:8]}"  # one exam group per run


def test_week_and_zones() -> None:
    f = Flags({})
    # Thursday 30 Oct 2026, 20:28 IST: the week began Monday 26 Oct, 00:00 IST.
    now = datetime(2026, 10, 30, 14, 58, tzinfo=UTC)
    start = leagues.week_start(now)
    assert start.isoformat() == "2026-10-26"
    assert leagues.week_opens(start) == datetime(2026, 10, 25, 18, 30, tzinfo=UTC)
    # Sunday 23:59 IST is the last minute that counts.
    assert leagues.closes_at(start, f) == datetime(2026, 11, 1, 18, 30, tzinfo=UTC)
    assert leagues.tier_name(f, 1).en == "Seed" and leagues.tier_name(f, 10).hi == "बरगद"
    z = leagues.zones(30, 5, 7, 5)
    assert [z[r] for r in (1, 7, 8, 25, 26, 30)] == [
        "promote",
        "promote",
        "safe",
        "safe",
        "demote",
        "demote",
    ]
    assert "promote" not in leagues.zones(30, 10, 7, 5).values()
    assert "demote" not in leagues.zones(30, 1, 7, 5).values()
    # A small cohort never puts one rank in both zones.
    assert leagues.zones(3, 5, 7, 5) == {1: "promote", 2: "promote", 3: "promote"}


async def _clear_exam(services: AppServices) -> None:
    async with services.db.admin_tx() as session:
        await session.execute(
            text("delete from game.league_cohorts where exam_group = :e"), {"e": EXAM}
        )


async def test_join_rules(client: httpx.AsyncClient, services: AppServices) -> None:
    teen = await person(client, services, band="13_17", exam=EXAM)
    league = (await client.get("/v1/leagues/current", headers=teen.headers)).json()
    assert league["state"] == "join_available"
    r = await client.post("/v1/leagues/join", headers=teen.headers)
    assert r.json()["state"] == "not_joined"  # in on the first XP of the week
    child = await person(client, services, band="10_12", exam=EXAM)
    r = await client.get("/v1/leagues/current", headers=child.headers)
    assert r.status_code == 403 and r.json()["code"] == "social_not_available"
    board = await client.get(
        "/v1/leaderboards", params={"scope": "all_india"}, headers=child.headers
    )
    assert board.status_code == 403
    friends_board = await client.get(
        "/v1/leaderboards", params={"scope": "friends"}, headers=child.headers
    )
    assert friends_board.status_code == 200
    # Opting out leaves this week's cohort at once; turning it back on starts next week.
    adult = await person(client, services, exam=EXAM)
    await add_xp(services, adult.user_id, 10)
    assert (await client.get("/v1/leagues/current", headers=adult.headers)).json()["state"] == (
        "in_cohort"
    )
    r = await client.put("/v1/leagues/opt-out", json={"on": True}, headers=adult.headers)
    assert r.json()["state"] == "opted_out" and r.json()["rows"] == []
    r = await client.put("/v1/leagues/opt-out", json={"on": False}, headers=adult.headers)
    assert r.json()["state"] == "opted_out"

    guest_like = await person(client, services, band="13_17", scopes=None, exam=EXAM)
    r = await client.get("/v1/leagues/current", headers=guest_like.headers)
    assert r.json()["code"] == "guardian_consent_required"


async def test_cohort_rollover_and_boards(client: httpx.AsyncClient, services: AppServices) -> None:
    await _clear_exam(services)
    a = await person(client, services, name="Asha Verma", exam=EXAM)
    b = await person(client, services, name="Kabir Rao", exam=EXAM)
    c = await person(client, services, name="Meera Iyer", exam=EXAM)
    teen = await person(client, services, band="13_17", name="Riya Sharma", exam=EXAM)
    await befriend(client, a, b)
    for s, xp in ((a, 120), (b, 80), (c, 30), (teen, 50)):
        await add_xp(services, s.user_id, xp)
    await client.post("/v1/leagues/join", headers=teen.headers)

    league = (await client.get("/v1/leagues/current", headers=a.headers)).json()
    assert league["state"] == "in_cohort" and league["tier"] == 1
    assert league["tier_name"] == {"en": "Seed", "hi": "बीज"}
    assert league["my_xp"] == 120 and league["my_rank"] == 1
    assert league["demote_count"] == 0  # no demotion from the first tier

    # The hourly job places everyone else who earned XP this week.
    placed = await leagues.assign_active(services.db)
    assert placed >= 2  # the teen joined (and was placed) by tapping Join
    league = (await client.get("/v1/leagues/current", headers=a.headers)).json()
    rows = league["rows"]
    assert [r["xp"] for r in rows] == [120, 80, 50, 30]
    teen_row = rows[2]["person"]
    assert teen_row["name"]["kind"] == "nickname" and teen_row["can_add_friend"] is False

    # Boards: friends, and all India for the exam group.
    friends_board = (
        await client.get("/v1/leaderboards", params={"scope": "friends"}, headers=a.headers)
    ).json()
    assert [r["xp"] for r in friends_board["rows"]] == [120, 80]
    india = (
        await client.get(
            "/v1/leaderboards",
            params={"scope": "all_india", "period": "all_time"},
            headers=c.headers,
        )
    ).json()
    assert [r["xp"] for r in india["rows"]][:4] == [120, 80, 50, 30]
    assert india["me"]["rank"] == 4
    r = await client.get(
        "/v1/leaderboards", params={"scope": "friends", "period": "all_time"}, headers=a.headers
    )
    assert r.status_code == 422
    school = (
        await client.get("/v1/leaderboards", params={"scope": "school"}, headers=a.headers)
    ).json()
    assert school["available"] is False and school["reason"] == "school_not_set"

    # Sunday close: top 1 promoted, bottom 1 would be demoted but tier 1 has no demotion.
    start = leagues.week_start(datetime.now(UTC))
    async with flags(services, {"league.promote_count": 1, "league.demote_count": 1}):
        close = leagues.closes_at(start, Flags({}))
        assert await leagues.rollover(services.db, close - timedelta(minutes=5)) == 0
        ranked = await leagues.rollover(services.db, close + timedelta(seconds=30))
        assert ranked >= 4
        assert await leagues.rollover(services.db, close + timedelta(seconds=60)) == 0

    result = (await client.get("/v1/leagues/result", headers=a.headers)).json()
    assert result["result"] == "promoted" and result["tier_now"] == 2 and result["first_view"]
    assert result["tier_name"]["en"] == "Sprout" and result["rank"] == 1 and result["xp"] == 120
    again = (await client.get("/v1/leagues/result", headers=a.headers)).json()
    assert again["first_view"] is False
    stayed = (await client.get("/v1/leagues/result", headers=c.headers)).json()
    assert stayed["result"] == "stayed" and stayed["tier_now"] == 1
    pushes = {p.kind: p for p in await outbox(services, a.user_id)}
    assert pushes["league_promoted"].payload["tier"] == "Sprout"
    assert "league_result" in {p.kind for p in await outbox(services, c.user_id)}
    league = (await client.get("/v1/leagues/current", headers=a.headers)).json()
    assert league["best_week"] == {"xp": 120, "tier": 1, "week_start": start.isoformat()}
    async with services.db.admin_tx() as session:
        promoted = (
            await session.execute(
                text(
                    "select count(*) from social.activity_items where user_id = :u"
                    " and kind = 'league_promoted'"
                ),
                {"u": a.user_id},
            )
        ).scalar_one()
    assert promoted == 1
