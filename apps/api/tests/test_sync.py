"""``POST /v1/sync/events`` and ``GET /v1/sync/state`` against the local Postgres: idempotency,
rejections, and the server recompute (streak across timezones, freezes, plant stages, FSRS)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.schemas.sync import SyncEventIn
from smriti_api.services.state import rollup_user
from smriti_api.services.sync import apply_batch
from tests.helpers import event, get_state, lesson_completed, new_guest, post_events

# A fixed "now" for recompute tests: 29 Oct 2026, 12:00 IST.
NOW = datetime(2026, 10, 29, 6, 30, tzinfo=UTC)


def ev(
    type_: str, at: datetime, payload: dict[str, Any] | None = None, tz: str = "Asia/Kolkata"
) -> SyncEventIn:
    return SyncEventIn(
        event_id=uuid.uuid4(), type=type_, occurred_at=at, tz=tz, payload=payload or {}
    )


def lesson(at: datetime, tz: str = "Asia/Kolkata") -> SyncEventIn:
    return ev(
        "lesson_completed",
        at,
        {
            "topic_id": "t-x",
            "mode": "deep_dive",
            "cards_seen": 5,
            "correct": 1,
            "total": 2,
            "ms_total": 60000,
        },
        tz,
    )


async def stats(services: AppServices, user_id: uuid.UUID) -> Any:
    async with services.db.admin_tx() as session:
        return (
            await session.execute(
                text(
                    "select s.current_streak, s.longest_streak, s.xp_total, p.stage, p.health, p.growth_points"
                    " from game.user_stats s join game.plants p using (user_id) where s.user_id = :u"
                ),
                {"u": user_id},
            )
        ).one()


async def test_first_lesson_gives_streak_one_and_sprout(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    result = await post_events(client, s, [lesson_completed()])
    assert result["rejected"] == []
    assert len(result["accepted"]) == 1
    state = await get_state(client, s)
    assert state["streak"]["current"] == 1
    assert state["streak"]["today_qualified"] is True
    assert state["plant"]["stage"] == "sprout"
    assert state["plant"]["study_days"] == 1
    assert state["wallet"]["xp_total"] == 16  # server formula, not the client's 9999
    assert state["profile"]["is_guest"] is True
    assert state["profile"]["timezone"] == "Asia/Kolkata"
    assert state["pet"] is None
    assert state["state_version"] == result["state_version"]


async def test_events_are_idempotent(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    batch = [
        lesson_completed(),
        event(
            "lesson_card_viewed", {"topic_id": "t1", "card_id": "c1", "index": 0, "ms_on_card": 900}
        ),
    ]
    first = await post_events(client, s, batch)
    second = await post_events(client, s, batch)
    assert sorted(first["accepted"]) == sorted(second["accepted"])
    assert second["state_version"] == first["state_version"]
    state = await get_state(client, s)
    assert state["wallet"]["xp_total"] == 16


async def test_same_event_in_one_batch_counts_once(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    e = lesson_completed()
    result = await post_events(client, s, [e, e])
    assert result["accepted"] == [e["event_id"], e["event_id"]]
    state = await get_state(client, s)
    assert state["wallet"]["xp_total"] == 16


async def test_bad_events_are_rejected_one_by_one(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    good = lesson_completed()
    unknown = event("teleported", {})
    invalid = event("lesson_completed", {"topic_id": "t"})
    future = lesson_completed(at=datetime.now(UTC) + timedelta(hours=2))
    free_text = event(
        "answer_submitted",
        {
            "topic_id": "t",
            "question_id": "q",
            "context": "practice",
            "response": "my phone is 98765",
            "correct": True,
            "attempt": 1,
            "confidence": None,
            "ms_to_answer": 10,
        },
    )
    result = await post_events(client, s, [good, unknown, invalid, future, free_text])
    codes = {r["event_id"]: r["code"] for r in result["rejected"]}
    assert result["accepted"] == [good["event_id"]]
    assert codes == {
        unknown["event_id"]: "unknown_type",
        invalid["event_id"]: "invalid_payload",
        future["event_id"]: "clock_skew",
        free_text["event_id"]: "invalid_payload",
    }
    # A retried rejected event gets the same answer; its payload was never stored.
    again = await post_events(client, s, [invalid])
    assert again["rejected"][0]["code"] == "invalid_payload"


async def test_another_users_event_id_is_rejected(client: httpx.AsyncClient) -> None:
    a = await new_guest(client)
    b = await new_guest(client)
    e = lesson_completed()
    await post_events(client, a, [e])
    result = await post_events(client, b, [e])
    assert result["rejected"][0]["code"] == "duplicate_event_id"


async def test_batch_limit_and_auth(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    too_many = [lesson_completed() for _ in range(201)]
    r = await client.post(
        "/v1/sync/events",
        json={"device_id": str(s.device_id), "events": too_many},
        headers=s.headers,
    )
    assert r.status_code == 422
    assert r.headers["content-type"].startswith("application/problem+json")
    r = await client.get("/v1/sync/state")
    assert r.status_code == 401
    assert r.json()["code"] == "unauthorized"
    r = await client.get("/v1/sync/state", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.json()["code"] == "invalid_token"


async def test_ten_reviews_qualify_and_schedule_cards(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    now = datetime.now(UTC)
    reviews = [
        event(
            "review_rated",
            {
                "card_ref": f"c:card-{i}",
                "rating": 3,
                "confidence": "sure",
                "ms_to_answer": 4000,
                "fsrs_state": {"state": 1},
            },
            at=now - timedelta(minutes=20 - i),
        )
        for i in range(9)
    ]
    await post_events(client, s, reviews)
    state = await get_state(client, s)
    assert state["streak"]["today_qualified"] is False
    assert len(state["srs"]["cards"]) == 9
    card = state["srs"]["cards"][0]
    assert card["reps"] == 1
    assert card["stability"] > 0
    version = state["state_version"]

    tenth = event(
        "review_rated",
        {"card_ref": "c:card-0", "rating": 3, "confidence": None, "ms_to_answer": 3000},
        at=now,
    )
    await post_events(client, s, [tenth])
    delta = await get_state(client, s, since=version)
    assert delta["streak"]["today_qualified"] is True
    assert delta["streak"]["current"] == 1
    assert [c["card_ref"] for c in delta["srs"]["cards"]] == ["c:card-0"]  # only the changed card
    assert delta["srs"]["cards"][0]["reps"] == 2
    assert "profile" not in delta


async def test_server_fsrs_wins_over_client_state(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    lie = {
        "due": "2099-01-01T00:00:00Z",
        "stability": 9999,
        "difficulty": 1,
        "elapsed_days": 0,
        "scheduled_days": 99999,
        "reps": 50,
        "lapses": 0,
        "state": 2,
    }
    await post_events(
        client,
        s,
        [
            event(
                "review_rated",
                {
                    "card_ref": "c:z",
                    "rating": 1,
                    "confidence": "guess",
                    "ms_to_answer": 1,
                    "fsrs_state": lie,
                },
            )
        ],
    )
    card = (await get_state(client, s))["srs"]["cards"][0]
    assert card["reps"] == 1
    assert card["stability"] < 100
    assert card["due"] < "2027"


async def test_streak_follows_the_students_timezone(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    # Two lessons 3 hours apart on the same UTC date: 27 Oct 22:30 and 28 Oct 01:30 in India.
    first = datetime(2026, 10, 27, 17, 0, tzinfo=UTC)
    second = datetime(2026, 10, 27, 20, 0, tzinfo=UTC)
    now = datetime(2026, 10, 27, 21, 0, tzinfo=UTC)
    india = await new_guest(client)
    await apply_batch(
        services.db,
        user_id=india.user_id,
        device_id=None,
        events=[lesson(first), lesson(second)],
        now=now,
    )
    assert (await stats(services, india.user_id)).current_streak == 2

    utc_user = await new_guest(client)
    await apply_batch(
        services.db,
        user_id=utc_user.user_id,
        device_id=None,
        events=[lesson(first, "UTC"), lesson(second, "UTC")],
        now=now,
    )
    assert (await stats(services, utc_user.user_id)).current_streak == 1

    # Los Angeles: 27 Oct 10:00 and 13:00 local, the same day.
    la = await new_guest(client)
    await apply_batch(
        services.db,
        user_id=la.user_id,
        device_id=None,
        events=[lesson(first, "America/Los_Angeles"), lesson(second, "America/Los_Angeles")],
        now=now,
    )
    assert (await stats(services, la.user_id)).current_streak == 1


async def test_freeze_protects_a_missed_day_and_is_refunded_by_late_events(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    day = timedelta(days=1)
    d26, d27, d28, d29 = (NOW - 3 * day, NOW - 2 * day, NOW - day, NOW)
    await apply_batch(
        services.db, user_id=s.user_id, device_id=None, events=[lesson(d26), lesson(d27)], now=d27
    )
    # 28 Oct is missed; on 29 Oct the monthly freeze (equipped on grant) covers it.
    await apply_batch(services.db, user_id=s.user_id, device_id=None, events=[lesson(d29)], now=NOW)
    row = await stats(services, s.user_id)
    assert row.current_streak == 3
    async with services.db.admin_tx() as session:
        used = (
            (
                await session.execute(
                    text("select used_on from game.streak_freezes where user_id = :u"),
                    {"u": s.user_id},
                )
            )
            .scalars()
            .all()
        )
    assert [str(u) for u in used] == ["2026-10-28"]

    # The phone was offline on 28 Oct: its lesson arrives late, the day qualifies, the freeze returns.
    await apply_batch(services.db, user_id=s.user_id, device_id=None, events=[lesson(d28)], now=NOW)
    row = await stats(services, s.user_id)
    assert row.current_streak == 4
    async with services.db.admin_tx() as session:
        used = (
            (
                await session.execute(
                    text("select used_on from game.streak_freezes where user_id = :u"),
                    {"u": s.user_id},
                )
            )
            .scalars()
            .all()
        )
    assert used == [None]


async def test_missed_days_without_freeze_reset_and_droop(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    day = timedelta(days=1)
    events = [lesson(NOW - 10 * day), lesson(NOW - 9 * day)]
    await apply_batch(
        services.db, user_id=s.user_id, device_id=None, events=events, now=NOW - 9 * day
    )
    async with services.db.admin_tx() as session:
        # This month's freeze was already spent elsewhere, so nothing protects the gap.
        await session.execute(
            text(
                "update game.streak_freezes set equipped_at = null, used_on = '2026-10-01' where user_id = :u"
            ),
            {"u": s.user_id},
        )
    async with services.db.system_tx() as session:
        await rollup_user(session, s.user_id, NOW)
    row = await stats(services, s.user_id)
    assert (row.current_streak, row.longest_streak) == (0, 2)
    assert row.health == "wilted"  # 8 missed days in a row
    assert row.growth_points == 2


async def test_plant_reaches_sapling_after_seven_study_days(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    events = [lesson(NOW - timedelta(days=i)) for i in range(7)]
    await apply_batch(
        services.db,
        user_id=s.user_id,
        device_id=None,
        events=events[1:],
        now=NOW - timedelta(days=1),
    )
    assert (await stats(services, s.user_id)).stage == "sprout"
    await apply_batch(services.db, user_id=s.user_id, device_id=None, events=events[:1], now=NOW)
    row = await stats(services, s.user_id)
    assert (row.stage, row.growth_points, row.current_streak) == ("sapling", 7, 7)


async def test_onboarding_pet_and_settings_events(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    events = [
        event("onboarding_answer", {"step": "goal", "value": "jee-main-2027"}),
        event("onboarding_answer", {"step": "daily_goal", "value": 20}),
        event("onboarding_answer", {"step": "class", "value": 11}),
        event("pet_named", {"species": "dog", "name": "Bholu"}),
        event("settings_changed", {"key": "theme", "value": "dark"}),
        event("onboarding_answer", {"step": "daily_goal", "value": 17}),
    ]
    result = await post_events(client, s, events)
    assert [r["event_id"] for r in result["rejected"]] == [events[-1]["event_id"]]
    state = await get_state(client, s)
    profile = state["profile"]
    assert profile["exam_profile_ids"] == ["jee-main-2027"]
    assert profile["primary_exam_profile_id"] == "jee-main-2027"
    assert profile["daily_goal_minutes"] == 20
    assert profile["age_band"] == "13_17"
    assert profile["settings"]["theme"] == "dark"
    assert state["pet"]["species"] == "dog"
    assert state["pet"]["name"] == "Bholu"


async def test_deck_cards_and_tombstones(client: httpx.AsyncClient) -> None:
    s = await new_guest(client)
    deck, card = str(uuid.uuid4()), str(uuid.uuid4())
    await post_events(
        client,
        s,
        [
            event(
                "deck_card_upserted",
                {"user_card_id": card, "deck_id": deck, "front": "front text", "back": "back text"},
            )
        ],
    )
    await post_events(
        client,
        s,
        [
            event(
                "review_rated",
                {"card_ref": f"d:{card}", "rating": 4, "confidence": "sure", "ms_to_answer": 1000},
            )
        ],
    )
    state = await get_state(client, s)
    assert [c["card_ref"] for c in state["srs"]["cards"]] == [f"d:{card}"]
    version = state["state_version"]
    await post_events(client, s, [event("deck_card_deleted", {"user_card_id": card})])
    delta = await get_state(client, s, since=version)
    assert delta["srs"]["deleted"] == [f"d:{card}"]
    assert delta["srs"]["cards"] == []
