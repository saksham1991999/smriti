"""Parent mode, Phase 3 (me-money §4.7): the dashboard and weekly report from the child's own
data, controls the server enforces (social, tutor, time), time requests, the parent friends list
and the weekly digest. Every call needs a live guardian link and an active consent."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services import parent_mode
from tests.helpers import Session
from tests.social_helpers import befriend, outbox, person

IST = ZoneInfo("Asia/Kolkata")
TOPIC = "fx.chapter-a.topic-a"


def key() -> dict[str, str]:
    return {"Idempotency-Key": f"parent-{uuid.uuid4().hex}"}


async def link(
    services: AppServices,
    guardian: Session,
    child: Session,
    scopes: tuple[str, ...] = ("account", "social"),
    kind: str = "consent",
) -> None:
    """A guardian link plus the guardian's own consent, as AUTH-20 leaves them."""
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "update app.guardian_consents set revoked_at = now()"
                " where user_id = :u and revoked_at is null"
            ),
            {"u": child.user_id},
        )
        await session.execute(
            text(
                """
                insert into app.guardian_consents (user_id, guardian_user_id, guardian_sub_hash,
                  method, age_assurance, scope, notice_version, consented_at)
                values (:u, :g, 'test-hash', 'google_own_device', 'self_declared',
                        cast(:s as jsonb), 'test', now())
                """
            ),
            {
                "u": child.user_id,
                "g": guardian.user_id,
                "s": json.dumps(dict.fromkeys(scopes, True)),
            },
        )
        await session.execute(
            text(
                "insert into app.guardian_links (guardian_user_id, learner_user_id, kind)"
                " values (:g, :u, :k) on conflict do nothing"
            ),
            {"g": guardian.user_id, "u": child.user_id, "k": kind},
        )
        await session.execute(
            text("update app.profiles set guardian_consent_state = 'granted' where user_id = :u"),
            {"u": child.user_id},
        )


async def family(
    client: httpx.AsyncClient, services: AppServices, band: str = "13_17"
) -> tuple[Session, Session]:
    guardian = await person(client, services, name="Sunita Sharma")
    child = await person(client, services, band=band, name="Riya Sharma", scopes=None, pet="Momo")
    await link(services, guardian, child)
    return guardian, child


async def controls(
    client: httpx.AsyncClient, guardian: Session, child: Session, **body: Any
) -> httpx.Response:
    return await client.put(
        f"/v1/guardian/learners/{child.user_id}/controls",
        json=body,
        headers={**guardian.headers, **key()},
    )


def today_ist() -> date:
    return datetime.now(UTC).astimezone(IST).date()


async def study(services: AppServices, child: Session, day: date, **cols: int) -> None:
    names = ", ".join(cols)
    values = ", ".join(f":{k}" for k in cols)
    updates = ", ".join(f"{k} = excluded.{k}" for k in cols)
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                f"insert into learn.activity_days (user_id, day, {names}) values (:u, :d, {values})"
                f" on conflict (user_id, day) do update set {updates}"
            ),
            {"u": child.user_id, "d": day, **cols},
        )


async def test_dashboard_and_weekly_report(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    guardian, child = await family(client, services)
    today = today_ist()
    start = parent_mode.week_start(today)
    await study(services, child, start, minutes=20, lessons_completed=2, cards_reviewed=10)
    await study(services, child, start + timedelta(days=1), minutes=15, cards_reviewed=4)
    now = datetime.now(UTC)
    async with services.db.admin_tx() as session:
        await session.execute(
            text("update game.user_stats set current_streak = 4 where user_id = :u"),
            {"u": child.user_id},
        )
        await session.execute(
            text(
                "insert into learn.topic_status (user_id, topic_id, status) values (:u, :t, 'learned')"
            ),
            {"u": child.user_id, "t": TOPIC},
        )
        for ctx in ("practice", "practice", "duel"):
            await session.execute(
                text(
                    "insert into learn.question_attempts (id, user_id, question_id, context, answer,"
                    " is_correct, time_ms, answered_at) values (:id, :u, 'q-1', :c, '{}', true, 1000, :t)"
                ),
                {"id": uuid.uuid4(), "u": child.user_id, "c": ctx, "t": now},
            )
        await session.execute(
            text(
                "insert into learn.mock_attempts (id, user_id, blueprint_id, language, status,"
                " started_at, submitted_at, server_deadline_at, score, max_score, percentile)"
                " values (:id, :u, :b, 'en', 'submitted', :t, :t, :t, 120, 300, 81.5)"
            ),
            {"id": uuid.uuid4(), "u": child.user_id, "b": uuid.uuid4(), "t": now},
        )

    r = await client.get("/v1/guardian/dashboard", headers=guardian.headers)
    assert r.status_code == 200, r.text
    card = next(c for c in r.json()["learners"] if c["user_id"] == str(child.user_id))
    assert card["first_name"] == "Riya" and card["pet"]["name"] == "Momo"
    assert card["week_minutes"] == 35 and card["streak"] == 4
    assert card["practice_questions"] == 2
    assert card["last_mock"]["score"] == 120 and card["last_mock"]["max_score"] == 300
    assert card["needs_you"] is False and card["is_pro"] is False

    r = await client.get(
        f"/v1/guardian/learners/{child.user_id}/report",
        params={"week": (start + timedelta(days=3)).isoformat()},
        headers=guardian.headers,
    )
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["week_start"] == start.isoformat() and len(rep["days"]) == 7
    assert [d["minutes"] for d in rep["days"][:2]] == [20, 15]
    assert rep["minutes"] == 35 and rep["lessons"] == 2 and rep["reviews"] == 14
    assert rep["practice_questions"] == 2 and rep["streak"] == 4
    assert rep["subjects"][0]["topics"][0]["en"] == "Fixture topic A"
    assert rep["mocks"][0]["percentile"] == 81.5
    # A week with nothing in it is all zeros, not an error.
    r = await client.get(
        f"/v1/guardian/learners/{child.user_id}/report",
        params={"week": (start - timedelta(days=70)).isoformat()},
        headers=guardian.headers,
    )
    assert r.json()["minutes"] == 0 and r.json()["subjects"] == []

    # Someone else, or the guardian after the consent ends, sees nothing.
    stranger = await person(client, services, name="Kabir Rao")
    r = await client.get(f"/v1/guardian/learners/{child.user_id}/report", headers=stranger.headers)
    assert r.status_code == 404 and r.json()["code"] == "learner_not_found"
    async with services.db.admin_tx() as session:
        await session.execute(
            text("update app.guardian_consents set revoked_at = now() where user_id = :u"),
            {"u": child.user_id},
        )
    r = await client.get(f"/v1/guardian/learners/{child.user_id}/report", headers=guardian.headers)
    assert r.status_code == 404
    dash = (await client.get("/v1/guardian/dashboard", headers=guardian.headers)).json()
    assert all(c["user_id"] != str(child.user_id) for c in dash["learners"])


async def test_controls_turn_social_and_tutor_off(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    guardian, child = await family(client, services)
    r = await client.get(
        f"/v1/guardian/learners/{child.user_id}/controls", headers=guardian.headers
    )
    assert r.json()["social_enabled"] is True and r.json()["daily_limit_min"] is None
    assert (await client.get("/v1/social/gate", headers=child.headers)).json()["state"] == "ok"

    r = await controls(client, guardian, child, social_enabled=False, tutor_enabled=False)
    assert r.status_code == 200, r.text
    assert r.json()["social_enabled"] is False and r.json()["weekly_report"] is True
    assert (await client.get("/v1/social/gate", headers=child.headers)).json()[
        "state"
    ] == "parent_off"
    r = await client.get("/v1/friends/invite", headers=child.headers)
    assert r.status_code == 403 and r.json()["code"] == "parent_turned_off"
    r = await client.post("/v1/tutor/sessions", json={}, headers=child.headers)
    assert r.status_code == 403 and r.json()["code"] == "parent_turned_off"

    r = await controls(client, guardian, child)
    assert (
        await client.post("/v1/tutor/sessions", json={}, headers=child.headers)
    ).status_code == 200

    # Bad shapes: a limit that isn't on the SET-16 list, or half of the allowed hours.
    assert (await controls(client, guardian, child, daily_limit_min=20)).status_code == 422
    assert (await controls(client, guardian, child, allowed_from="16:00")).status_code == 422

    # A little learner has no tutor until the parent turns the Tutor button on (R14).
    parent2, little = await family(client, services, band="u10")
    r = await client.post("/v1/tutor/sessions", json={}, headers=little.headers)
    assert r.status_code == 403 and r.json()["code"] == "parent_turned_off"
    await controls(client, parent2, little, tutor_button=True)
    assert (
        await client.post("/v1/tutor/sessions", json={}, headers=little.headers)
    ).status_code == 200


async def test_time_limit_and_asking_for_more(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    guardian, child = await family(client, services)
    # No limit set: nothing to extend.
    r = await client.post("/v1/me/time-requests", headers=child.headers)
    assert r.status_code == 409 and r.json()["code"] == "no_time_limit"
    assert (await client.get("/v1/me/limits", headers=child.headers)).json()["controlled"] is False

    await controls(client, guardian, child, daily_limit_min=15)
    await study(services, child, today_ist(), minutes=20)
    limits = (await client.get("/v1/me/limits", headers=child.headers)).json()
    assert limits["limit_today"] == 15 and limits["remaining_minutes"] == 0
    r = await client.post("/v1/tutor/sessions", json={}, headers=child.headers)
    assert r.status_code == 403 and r.json()["code"] == "time_limit_reached"

    asked = await client.post("/v1/me/time-requests", headers=child.headers)
    assert asked.status_code == 201, asked.text
    req = asked.json()
    assert req["status"] == "pending" and req["minutes"] == 15
    again = await client.post("/v1/me/time-requests", headers=child.headers)
    assert again.json()["id"] == req["id"]
    sent = [o for o in await outbox(services, guardian.user_id) if o.kind == "parent_time_request"]
    assert len(sent) == 1 and sent[0].payload["child"] == "Riya"

    card = (await client.get("/v1/guardian/dashboard", headers=guardian.headers)).json()[
        "learners"
    ][0]
    assert card["needs_you"] is True and card["time_requests"][0]["id"] == req["id"]

    stranger = await person(client, services, name="Kabir Rao")
    r = await client.post(
        f"/v1/guardian/time-requests/{req['id']}/decision",
        json={"allow": True},
        headers={**stranger.headers, **key()},
    )
    assert r.status_code == 404
    r = await client.post(
        f"/v1/guardian/time-requests/{req['id']}/decision",
        json={"allow": True},
        headers={**guardian.headers, **key()},
    )
    assert r.status_code == 200 and r.json()["status"] == "allowed"
    limits = (await client.get("/v1/me/limits", headers=child.headers)).json()
    assert limits["extra_minutes"] == 15 and limits["remaining_minutes"] == 10
    assert limits["request"]["status"] == "allowed"
    assert (
        await client.post("/v1/tutor/sessions", json={}, headers=child.headers)
    ).status_code == 200

    # A "Not today" ends asking for the day.
    second = (await client.post("/v1/me/time-requests", headers=child.headers)).json()
    await client.post(
        f"/v1/guardian/time-requests/{second['id']}/decision",
        json={"allow": False},
        headers={**guardian.headers, **key()},
    )
    r = await client.post("/v1/me/time-requests", headers=child.headers)
    assert r.status_code == 409 and r.json()["code"] == "declined_today"

    # Outside the allowed hours the tutor waits: a window that ended an hour ago.
    now_local = datetime.now(UTC).astimezone(IST)
    frm = (now_local - timedelta(hours=2)).strftime("%H:%M")
    to = (now_local - timedelta(hours=1)).strftime("%H:%M")
    await controls(client, guardian, child, allowed_from=frm, allowed_to=to)
    assert (await client.get("/v1/me/limits", headers=child.headers)).json()[
        "within_hours"
    ] is False
    r = await client.post("/v1/tutor/sessions", json={}, headers=child.headers)
    assert r.status_code == 403 and r.json()["code"] == "outside_allowed_hours"


async def test_parent_sees_and_removes_friends(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    guardian, child = await family(client, services)
    friend = await person(client, services, name="Meera Iyer")
    await befriend(client, child, friend)
    rows = (
        await client.get(f"/v1/guardian/learners/{child.user_id}/friends", headers=guardian.headers)
    ).json()
    assert len(rows) == 1 and rows[0]["person"]["user_id"] == str(friend.user_id)

    r = await client.delete(
        f"/v1/guardian/learners/{child.user_id}/friends/{friend.user_id}", headers=guardian.headers
    )
    assert r.status_code == 204
    rows = (
        await client.get(f"/v1/guardian/learners/{child.user_id}/friends", headers=guardian.headers)
    ).json()
    assert rows == []
    assert (await client.get("/v1/friends", headers=child.headers)).json() == []
    # Only a linked guardian can do this.
    r = await client.delete(
        f"/v1/guardian/learners/{child.user_id}/friends/{friend.user_id}", headers=friend.headers
    )
    assert r.status_code == 404


async def test_weekly_digest(client: httpx.AsyncClient, services: AppServices) -> None:
    guardian, child = await family(client, services)
    # Sunday 1 November 2026, 15:30 in India: held until 19:00 there.
    sunday = datetime(2026, 11, 1, 10, 0, tzinfo=UTC)
    await study(services, child, date(2026, 10, 27), minutes=25, lessons_completed=3)
    assert await parent_mode.send_weekly_digests(services.db, now=sunday) >= 1
    sent = [o for o in await outbox(services, guardian.user_id) if o.kind == "parent_weekly_report"]
    assert len(sent) == 1
    assert sent[0].payload == {
        "child": "Riya",
        "min": 25,
        "n": 3,
        "learner_id": str(child.user_id),
        "week": "2026-10-26",
    }
    assert sent[0].not_before == datetime(2026, 11, 1, 19, 0, tzinfo=IST)
    # Once per child per week.
    await parent_mode.send_weekly_digests(services.db, now=sunday)
    sent = [o for o in await outbox(services, guardian.user_id) if o.kind == "parent_weekly_report"]
    assert len(sent) == 1

    # The parent can switch it off (SET-14 "Weekly email report").
    await controls(client, guardian, child, weekly_report=False)
    await parent_mode.send_weekly_digests(services.db, now=sunday + timedelta(days=7))
    sent = [o for o in await outbox(services, guardian.user_id) if o.kind == "parent_weekly_report"]
    assert len(sent) == 1
