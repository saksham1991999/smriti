"""Sync contract v1.1 (docs/contracts/sync.md "Wire rules (v1.1)" and "Dev auth")."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from tests.helpers import Session, event, get_state, lesson_completed, new_guest, post_events


async def test_tz_is_required_on_every_event(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    bad = lesson_completed()
    del bad["tz"]
    r = await client.post(
        "/v1/sync/events",
        json={"device_id": str(s.device_id), "events": [lesson_completed(), bad]},
        headers=s.headers,
    )
    # The whole batch is a 4xx, so the client halves it until it finds the bad event.
    assert r.status_code == 422
    assert r.json()["code"] == "validation_error"


async def test_unknown_zone_rejects_only_that_event(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    good, bad = lesson_completed(), lesson_completed(tz="Mars/Olympus_Mons")
    result = await post_events(client, s, [good, bad])
    assert result["accepted"] == [good["event_id"]]
    assert result["rejected"] == [
        {"event_id": bad["event_id"], "code": "invalid_tz", "detail": "tz is not an IANA time zone"}
    ]


async def test_event_tz_places_the_event_on_its_local_day(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    # The profile adopts India from the first sync; a later event from a phone set to
    # Los Angeles at 01:00 UTC is still the previous local day there.
    await post_events(client, s, [lesson_completed()])
    at = datetime.now(UTC).replace(hour=1, minute=0, second=0, microsecond=0)
    if at > datetime.now(UTC):
        at -= timedelta(days=1)
    la = event(
        "focus_session_completed", {"minutes": 25, "rounds": 1}, at=at, tz="America/Los_Angeles"
    )
    await post_events(client, s, [la])
    async with services.db.admin_tx() as session:
        day = (
            await session.execute(
                text("select local_day from learn.sync_events where event_id = :e"),
                {"e": uuid.UUID(la["event_id"])},
            )
        ).scalar_one()
    assert day == (at - timedelta(hours=8)).date() or day == (at - timedelta(hours=7)).date()
    assert day < at.date()


async def test_u_card_refs_are_stored_as_d_and_confidence_maps_to_fifty(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    deck, card = str(uuid.uuid4()), str(uuid.uuid4())
    await post_events(
        client,
        s,
        [
            event(
                "deck_card_upserted",
                {"user_card_id": card, "deck_id": deck, "front": "f", "back": "b"},
            ),
            event(
                "review_rated",
                {
                    "card_ref": f"u:{card}",
                    "rating": 3,
                    "confidence": "fifty_fifty",
                    "ms_to_answer": 800,
                },
            ),
        ],
    )
    state = await get_state(client, s)
    assert [c["card_ref"] for c in state["srs"]["cards"]] == [f"d:{card}"]
    async with services.db.admin_tx() as session:
        row = (
            await session.execute(
                text("select card_ref, confidence from learn.srs_reviews where user_id = :u"),
                {"u": s.user_id},
            )
        ).one()
    assert (row.card_ref, row.confidence) == (f"d:{card}", "fifty")


async def stats_row(services: AppServices, s: Session) -> tuple[int, str]:
    async with services.db.admin_tx() as session:
        row = (
            await session.execute(
                text(
                    "select s.current_streak, p.health from game.user_stats s"
                    " join game.plants p using (user_id) where s.user_id = :u"
                ),
                {"u": s.user_id},
            )
        ).one()
    return int(row.current_streak), str(row.health)


async def test_rescue_waters_the_plant_but_is_not_a_streak_day(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    now = datetime.now(UTC)
    rescue = event("rescue_completed", {"cards": 5, "ms_total": 120000}, at=now - timedelta(days=1))
    result = await post_events(client, s, [lesson_completed(at=now - timedelta(days=2)), rescue])
    assert len(result["accepted"]) == 2
    async with services.db.admin_tx() as session:
        day = (
            await session.execute(
                text(
                    "select rescue_done, qualified from learn.activity_days where user_id = :u and rescue_done"
                ),
                {"u": s.user_id},
            )
        ).one()
    assert (day.rescue_done, day.qualified) == (True, False)
    current, health = await stats_row(services, s)
    assert health == "thriving"  # watered yesterday, so no missed day yet
    # Not a streak day: the monthly freeze covered it, so the streak stays at 1, not 2.
    assert current == 1


async def test_cards_queued_starts_new_cards_and_pulls_started_ones_forward(
    client: httpx.AsyncClient,
) -> None:
    s = await new_guest(client)
    # The shape packages/app-core sends (queueCardsForConcepts).
    queued = event(
        "cards_queued",
        {
            "source": "practice_summary",
            "concept_ids": ["phy.kinematics.velocity"],
            "card_refs": ["c:card-velocity-1", "c:card-velocity-2"],
        },
    )
    await post_events(client, s, [queued])
    cards = {c["card_ref"]: c for c in (await get_state(client, s))["srs"]["cards"]}
    assert set(cards) == {"c:card-velocity-1", "c:card-velocity-2"}
    assert all(c["state"] == 0 and c["reps"] == 0 for c in cards.values())

    # A reviewed card keeps its history; queueing it again only pulls it into today's queue.
    review = event(
        "review_rated",
        {"card_ref": "c:card-velocity-2", "rating": 4, "confidence": None, "ms_to_answer": 500},
    )
    await post_events(client, s, [review])
    reviewed = next(
        c
        for c in (await get_state(client, s))["srs"]["cards"]
        if c["card_ref"] == "c:card-velocity-2"
    )
    assert reviewed["due"] > datetime.now(UTC).isoformat()
    again = event(
        "cards_queued",
        {"source": "mock_report", "concept_ids": [], "card_refs": ["c:card-velocity-2"]},
    )
    await post_events(client, s, [again])
    pulled = next(
        c
        for c in (await get_state(client, s))["srs"]["cards"]
        if c["card_ref"] == "c:card-velocity-2"
    )
    assert pulled["reps"] == 1
    assert pulled["due"] <= datetime.now(UTC).isoformat()


async def test_cards_queued_with_unknown_concepts_queues_nothing(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    # No published system card teaches this concept (test_card_queue.py covers known ones).
    result = await post_events(
        client,
        s,
        [event("cards_queued", {"concept_ids": ["phy.kinematics.speed"], "source": "lesson"})],
    )
    assert len(result["accepted"]) == 1
    assert (await get_state(client, s))["srs"]["cards"] == []


async def test_new_events_accept_the_app_core_and_contract_shapes(
    client: httpx.AsyncClient,
) -> None:
    s = await new_guest(client)
    events = [
        event("rescue_completed", {"cards": 5, "ms_total": 120000}),
        event("rescue_completed", {"cards": 5, "reached_qualify": False}),
        event("comeback_plan_started", {"days_away": 12, "cards": 30}),
        event(
            "comeback_plan_started",
            {
                "start_day": "2026-10-30",
                "plan_days": 5,
                "daily_chunk": 12,
                "relearn_topics": ["t-1"],
            },
        ),
    ]
    result = await post_events(client, s, events)
    assert len(result["accepted"]) == 4, result
    bad = await post_events(
        client, s, [event("cards_queued", {"concept_ids": [], "source": "lesson"})]
    )
    assert bad["rejected"][0]["code"] == "invalid_payload"


async def test_dev_auth_returns_the_supabase_token_shape_and_refreshes(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    r = await client.post("/v1/dev/auth/anonymous")
    body = r.json()
    assert set(body) == {
        "access_token",
        "token_type",
        "expires_in",
        "expires_at",
        "refresh_token",
        "user",
    }
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 3600
    assert body["user"]["is_anonymous"] is True
    user_id = body["user"]["id"]

    # A refresh token is not an access token.
    assert (
        await client.get("/v1/me", headers={"Authorization": f"Bearer {body['refresh_token']}"})
    ).status_code == 401

    fresh = await client.post("/v1/dev/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert fresh.status_code == 200, fresh.text
    again = fresh.json()
    assert again["user"]["id"] == user_id
    assert (
        again["access_token"] != body["access_token"]
        or again["refresh_token"] != body["refresh_token"]
    )
    me = await client.get("/v1/me", headers={"Authorization": f"Bearer {again['access_token']}"})
    assert me.status_code == 200

    # After linking, a refresh returns a signed-in session that keeps the sign-in time.
    linked = await client.post(
        "/v1/dev/auth/google",
        json={"email": f"r-{uuid.uuid4().hex[:8]}@example.com", "name": "Neha", "link": True},
        headers={"Authorization": f"Bearer {again['access_token']}"},
    )
    assert linked.status_code == 200, linked.text
    signed = linked.json()
    refreshed = (
        await client.post("/v1/dev/auth/refresh", json={"refresh_token": signed["refresh_token"]})
    ).json()
    assert refreshed["user"] == {
        "id": user_id,
        "is_anonymous": False,
        "email": signed["user"]["email"],
    }
    old_ctx = await services.verifier.verify(signed["access_token"])
    new_ctx = await services.verifier.verify(refreshed["access_token"])
    assert new_ctx.amr[0].timestamp == old_ctx.amr[0].timestamp
    assert new_ctx.amr[0].method == "oauth"

    bad = await client.post("/v1/dev/auth/refresh", json={"refresh_token": body["access_token"]})
    assert bad.status_code == 401
    assert bad.json()["code"] == "invalid_grant"


async def test_refresh_after_the_guest_is_gone_ends_the_session(client: httpx.AsyncClient) -> None:
    body = (await client.post("/v1/dev/auth/anonymous")).json()
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    assert (await client.delete("/v1/account", headers=headers)).status_code == 204
    r = await client.post("/v1/dev/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert r.status_code == 401
    assert r.json()["code"] == "session_ended"
