"""Gamification endpoints: pet care, freezes, rest days, the gem shop, quests and badges."""

from __future__ import annotations

import json
import uuid
from datetime import date

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from tests.helpers import Session, event, get_state, lesson_completed, new_guest, post_events


async def give_gems(services: AppServices, user_id: uuid.UUID, gems: int) -> None:
    async with services.db.admin_tx() as session:
        await session.execute(
            text("update game.user_stats set gems = gems + :g where user_id = :u"),
            {"g": gems, "u": user_id},
        )
        await session.execute(
            text(
                "insert into game.gem_ledger (user_id, delta, reason) values (:u, :g, 'test_reward')"
            ),
            {"u": user_id, "g": gems},
        )


async def with_pet(client: httpx.AsyncClient) -> Session:
    s = await new_guest(client)
    await post_events(
        client, s, [lesson_completed(), event("pet_named", {"species": "cat", "name": "Miso"})]
    )
    return s


async def test_pet_care_limits(client: httpx.AsyncClient, services: AppServices) -> None:
    s = await new_guest(client)
    r = await client.post("/v1/pet/care", json={"action": "pet"}, headers=s.headers)
    assert r.status_code == 409
    assert r.json()["code"] == "no_pet"

    s = await with_pet(client)
    for _ in range(3):
        r = await client.post("/v1/pet/care", json={"action": "play"}, headers=s.headers)
        assert r.status_code == 200, r.text
    r = await client.post("/v1/pet/care", json={"action": "play"}, headers=s.headers)
    assert r.json()["code"] == "care_limit_reached"
    pet = (await client.get("/v1/pet", headers=s.headers)).json()
    assert pet["care_today"] == {"play": 3}
    assert pet["pet"]["energy"] == 100  # 80 start + 20 study day, capped

    r = await client.post("/v1/pet/care", json={"action": "feed"}, headers=s.headers)
    assert r.json()["code"] == "no_treat"
    await give_gems(services, s.user_id, 50)
    buy = await client.post(
        "/v1/shop/purchase",
        json={"item_id": "pet_treat"},
        headers={**s.headers, "Idempotency-Key": "buy-treat-1"},
    )
    assert buy.status_code == 200, buy.text
    r = await client.post("/v1/pet/care", json={"action": "feed"}, headers=s.headers)
    assert r.status_code == 200
    assert r.json()["treats_held"] == 0


async def test_pet_care_with_idempotency_key_counts_once(client: httpx.AsyncClient) -> None:
    s = await with_pet(client)
    headers = {**s.headers, "Idempotency-Key": "care-0000-1"}
    for _ in range(2):
        assert (
            await client.post("/v1/pet/care", json={"action": "pet"}, headers=headers)
        ).status_code == 200
    pet = (await client.get("/v1/pet", headers=s.headers)).json()
    assert pet["care_today"] == {"pet": 1}


async def test_shop_purchase_is_idempotent_and_needs_gems(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    no_key = await client.post(
        "/v1/shop/purchase", json={"item_id": "streak_freeze"}, headers=s.headers
    )
    assert no_key.json()["code"] == "idempotency_key_required"
    poor = await client.post(
        "/v1/shop/purchase",
        json={"item_id": "streak_freeze"},
        headers={**s.headers, "Idempotency-Key": "buy-0000-1"},
    )
    assert poor.status_code == 409
    assert poor.json()["code"] == "not_enough_gems"

    await give_gems(services, s.user_id, 250)
    headers = {**s.headers, "Idempotency-Key": "buy-0000-2"}
    first = await client.post(
        "/v1/shop/purchase", json={"item_id": "streak_freeze"}, headers=headers
    )
    second = await client.post(
        "/v1/shop/purchase", json={"item_id": "streak_freeze"}, headers=headers
    )
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert first.json()["gems"] == 50
    reused = await client.post("/v1/shop/purchase", json={"item_id": "pet_treat"}, headers=headers)
    assert reused.status_code == 422
    assert reused.json()["code"] == "idempotency_key_reused"

    shop = (await client.get("/v1/shop", headers=s.headers)).json()
    assert shop["gems"] == 50
    freeze = next(i for i in shop["items"] if i["id"] == "streak_freeze")
    assert freeze["owned"] == 1
    missing = await client.post(
        "/v1/shop/purchase",
        json={"item_id": "nope"},
        headers={**s.headers, "Idempotency-Key": "buy-0000-3"},
    )
    assert missing.status_code == 404


async def test_gem_ledger_pages(client: httpx.AsyncClient, services: AppServices) -> None:
    s = await new_guest(client)
    for _ in range(5):
        await give_gems(services, s.user_id, 1)
    page = (await client.get("/v1/gems/ledger", params={"limit": 2}, headers=s.headers)).json()
    assert len(page["items"]) == 2
    seen = [i["id"] for i in page["items"]]
    while page["next_cursor"]:
        page = (
            await client.get(
                "/v1/gems/ledger",
                params={"limit": 2, "cursor": page["next_cursor"]},
                headers=s.headers,
            )
        ).json()
        seen += [i["id"] for i in page["items"]]
    assert len(seen) == len(set(seen)) == 5


async def test_freeze_equip_and_rest_day(client: httpx.AsyncClient, services: AppServices) -> None:
    s = await new_guest(client)
    await post_events(client, s, [lesson_completed()])
    streak = (await get_state(client, s))["streak"]
    assert streak["freezes_equipped"] == 1  # this month's free freeze is equipped on grant
    r = await client.post("/v1/streak/freeze", json={"slot": 1}, headers=s.headers)
    assert r.status_code == 409
    assert r.json()["code"] == "no_freeze_available"

    today = date.fromisoformat(
        (await client.get("/v1/me/summary", headers=s.headers)).json()["today"]["date"]
    )
    r = await client.post("/v1/streak/rest-day", json={"day": today.isoformat()}, headers=s.headers)
    assert r.status_code == 200, r.text
    assert r.json()["rest_day"] == today.isoformat()
    assert r.json()["at_risk"] is False
    r = await client.post("/v1/streak/rest-day", json={"day": "2020-01-01"}, headers=s.headers)
    assert r.status_code == 422
    r = await client.delete(f"/v1/streak/rest-day/{today.isoformat()}", headers=s.headers)
    assert r.json()["rest_day"] is None


async def test_quests_and_badges(client: httpx.AsyncClient, services: AppServices) -> None:
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "insert into game.quests (id, period, spec, reward, active_from) values"
                " ('test-daily-lesson', 'daily', cast(:s as jsonb), cast(:r as jsonb), '2026-01-01')"
                " on conflict (id) do nothing"
            ),
            {
                "s": json.dumps({"counter": "lessons_completed", "target": 1}),
                "r": json.dumps({"gems": 5, "xp": 10}),
            },
        )
        await session.execute(
            text(
                "insert into game.badges (id, name, description, rule) values"
                " ('test-first-day', cast(:n as jsonb), cast(:n as jsonb), cast(:r as jsonb)) on conflict (id) do nothing"
            ),
            {
                "n": json.dumps({"en": "Placeholder", "hi": "प्लेसहोल्डर"}),
                "r": json.dumps({"metric": "study_days", "gte": 1}),
            },
        )
    s = await new_guest(client)
    quest = next(
        q
        for q in (await client.get("/v1/quests", headers=s.headers)).json()
        if q["id"] == "test-daily-lesson"
    )
    assert (quest["progress"], quest["completed"]) == (0, False)
    early = await client.post("/v1/quests/test-daily-lesson/claim", headers=s.headers)
    assert early.json()["code"] == "quest_not_complete"

    await post_events(client, s, [lesson_completed()])
    claim = await client.post("/v1/quests/test-daily-lesson/claim", headers=s.headers)
    assert claim.status_code == 200, claim.text
    assert (claim.json()["gems"], claim.json()["xp"]) == (5, 10)
    twice = await client.post("/v1/quests/test-daily-lesson/claim", headers=s.headers)
    assert twice.json()["code"] == "already_claimed"
    quest = next(
        q
        for q in (await client.get("/v1/quests", headers=s.headers)).json()
        if q["id"] == "test-daily-lesson"
    )
    assert quest["claimed"] is True

    badge = next(
        b
        for b in (await client.get("/v1/badges", headers=s.headers)).json()
        if b["id"] == "test-first-day"
    )
    assert badge["earned_at"] is not None


async def test_me_patch_and_summary(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    r = await client.patch(
        "/v1/me",
        json={
            "display_name": "Meera",
            "locale": "hi",
            "daily_goal_minutes": 20,
            "settings": {"theme": "dark"},
        },
        headers=s.headers,
    )
    assert r.status_code == 200, r.text
    profile = r.json()["profile"]
    assert (profile["display_name"], profile["locale"], profile["daily_goal_minutes"]) == (
        "Meera",
        "hi",
        20,
    )
    assert profile["settings"] == {"theme": "dark"}
    assert (
        await client.patch("/v1/me", json={"timezone": "Mars/Base"}, headers=s.headers)
    ).status_code == 422
    assert (
        await client.patch("/v1/me", json={"display_name": "call me 999"}, headers=s.headers)
    ).status_code == 422
    assert (await client.patch("/v1/me", json={"discoverable": True}, headers=s.headers)).json()[
        "code"
    ] == "login_required"
    r = await client.put(
        "/v1/me/exams",
        json={"exam_profile_ids": ["neet-ug-2027", "jee-main-2027"], "primary": "jee-main-2027"},
        headers=s.headers,
    )
    assert r.json()["profile"]["primary_exam_profile_id"] == "jee-main-2027"
    assert (
        await client.put("/v1/me/exams", json={"exam_profile_ids": ["nope"]}, headers=s.headers)
    ).status_code == 422

    await post_events(client, s, [lesson_completed()])
    summary = (await client.get("/v1/me/summary", headers=s.headers)).json()
    assert summary["today"]["lessons_completed"] == 1
    assert summary["today"]["minutes"] == 5
    assert summary["today"]["goal_minutes"] == 20
    assert summary["streak"]["current"] == 1
    assert summary["entitlement"]["plan"] == "free"
    assert summary["limits"]["tutor_messages_per_day"] == 5
