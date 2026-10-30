"""Social: the gate (B4), how people show (R31), friends, requests, presets, blocks and reports
(B5, B11), Duos (B8), squads (B9) and the SOC-01 overview."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services import social_duos
from tests.helpers import new_guest
from tests.money_helpers import set_profile
from tests.practice_helpers import flags
from tests.social_helpers import befriend, consent, outbox, person


async def test_gate_states(client: httpx.AsyncClient, services: AppServices) -> None:
    guest = await new_guest(client)
    r = await client.get("/v1/friends", headers=guest.headers)
    assert r.status_code == 401 and r.json()["code"] == "login_required"
    assert (await client.get("/v1/social/gate", headers=guest.headers)).json()["state"] == "guest"

    little = await person(client, services, band="u10", scopes=("account",))
    r = await client.get("/v1/friends", headers=little.headers)
    assert r.status_code == 403 and r.json()["code"] == "social_not_available"
    gate = (await client.get("/v1/social/gate", headers=little.headers)).json()
    assert gate == {"state": "little_learner", "features": [], "first_visit": False}

    teen = await person(client, services, band="13_17", scopes=None)
    r = await client.get("/v1/friends", headers=teen.headers)
    assert r.status_code == 403 and r.json()["code"] == "guardian_consent_required"

    child = await person(client, services, band="10_12")
    gate = (await client.get("/v1/social/gate", headers=child.headers)).json()
    assert gate["state"] == "ok" and set(gate["features"]) == {"friends", "friend_duel", "cheer"}
    r = await client.get("/v1/duos", headers=child.headers)
    assert r.status_code == 403 and r.json()["code"] == "social_not_available"

    adult = await person(client, services)
    gate = (await client.get("/v1/social/gate", headers=adult.headers)).json()
    assert gate["state"] == "ok" and "league" in gate["features"] and gate["first_visit"]
    over = (await client.get("/v1/social/overview", headers=adult.headers)).json()
    assert over["gate"]["state"] == "ok" and over["league"]["state"] == "not_joined"
    locked = (await client.get("/v1/social/overview", headers=teen.headers)).json()
    assert locked["gate"]["state"] != "ok" and locked["me"]["streak"] == 0


async def test_minors_show_by_nickname_or_pet_name(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    adult = await person(client, services, name="Asha Verma")
    teen = await person(client, services, band="13_17", name="Riya Sharma", pet="Momo")
    stranger = await person(client, services, name="Kabir Rao")
    await befriend(client, adult, teen, via="qr")

    # The teen's own view assigns the nickname: the word list ships empty (Q-B11), so it falls
    # back to "Learner {n}".
    me = (await client.get("/v1/social/me", headers=teen.headers)).json()
    assert me["public_name"]["kind"] == "nickname"
    assert me["public_name"]["text"].startswith("Learner ")
    nickname = me["public_name"]["text"]

    friends = (await client.get("/v1/friends", headers=adult.headers)).json()
    assert [f["person"]["name"] for f in friends] == [{"kind": "pet_name", "text": "Momo"}]
    seen = (await client.get(f"/v1/social/people/{teen.user_id}", headers=stranger.headers)).json()
    assert seen["person"]["name"] == {"kind": "nickname", "text": nickname}
    assert seen["person"]["can_add_friend"] is False
    assert "Riya" not in str(seen)
    adult_seen = (
        await client.get(f"/v1/social/people/{adult.user_id}", headers=stranger.headers)
    ).json()
    assert adult_seen["person"]["name"] == {"kind": "display_name", "text": "Asha Verma"}

    # Hindi viewers get the Hindi fallback label.
    await set_profile(services, stranger.user_id, locale="hi")
    seen = (await client.get(f"/v1/social/people/{teen.user_id}", headers=stranger.headers)).json()
    assert seen["person"]["name"]["text"].startswith("शिक्षार्थी ")

    # Once the owner sets a word list (placeholder ids here, not a real list), the same student
    # gets words with the same number.
    words = {
        "first": [{"id": "t1", "en": "Alpha", "hi": "अल्फ़ा"}],
        "second": [{"id": "t2", "en": "Beta", "hi": "बीटा"}],
    }
    async with flags(services, {"social.nickname_words": words}):
        me = (await client.get("/v1/social/me", headers=teen.headers)).json()
        number = nickname.split(" ")[-1]
        assert me["public_name"]["text"] == f"Alpha Beta {number}"

    # A withdrawn consent hides the minor everywhere at once.
    await consent(services, teen.user_id, ("account",))
    friends = (await client.get("/v1/friends", headers=adult.headers)).json()
    assert friends == [] or friends[0]["person"]["name"]["kind"] == "hidden"


async def test_requests_presets_block_and_report(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    a = await person(client, services, name="Asha Verma")
    b = await person(client, services, name="Kabir Rao")
    handle = f"kabir_{uuid.uuid4().hex[:6]}"
    r = await client.put("/v1/social/me/handle", json={"handle": handle}, headers=b.headers)
    assert r.status_code == 200, r.text
    await client.put("/v1/social/me/privacy", json={"discoverable": True}, headers=b.headers)

    found = await client.get("/v1/friends/search", params={"handle": handle}, headers=a.headers)
    assert found.status_code == 200, found.text
    assert found.json()["can_add_friend"] is True
    r = await client.post(
        "/v1/friends/requests", json={"user_id": str(b.user_id)}, headers=a.headers
    )
    assert r.json()["status"] == "pending"
    inbox = (await client.get("/v1/social/inbox", headers=b.headers)).json()
    assert inbox["unread"] == 1 and inbox["items"][0]["kind"] == "friend_request"
    pushes = await outbox(services, b.user_id)
    assert [p.kind for p in pushes] == ["friend_request"]
    assert pushes[0].payload["friend"] == "Asha Verma"

    r = await client.post(f"/v1/friends/requests/{a.user_id}/accept", headers=b.headers)
    assert r.json()["status"] == "accepted"
    assert "friend_accepted" in [p.kind for p in await outbox(services, a.user_id)]

    # Preset cheers only, rate limited by flag.
    async with flags(services, {"social.cheers_per_friend_per_day": 1}):
        body = {"to_user_id": str(b.user_id), "kind": "cheer", "preset_id": "message_1"}
        r = await client.post("/v1/social/nudges", json=body, headers=a.headers)
        assert r.status_code == 200 and r.json()["sent"] is True, r.text
        r = await client.post("/v1/social/nudges", json=body, headers=a.headers)
        assert r.status_code == 429
    r = await client.post(
        "/v1/social/nudges",
        json={"to_user_id": str(b.user_id), "kind": "cheer", "preset_id": "message_999"},
        headers=a.headers,
    )
    assert r.status_code == 422

    r = await client.post(
        "/v1/social/reports",
        json={"target_kind": "person", "user_id": str(b.user_id), "reason": "bullying"},
        headers=a.headers,
    )
    assert r.status_code == 201 and r.json()["status"] == "open"

    r = await client.post("/v1/social/blocks", json={"user_id": str(b.user_id)}, headers=a.headers)
    assert r.status_code == 204
    assert (await client.get("/v1/friends", headers=a.headers)).json() == []
    r = await client.get(f"/v1/social/people/{a.user_id}", headers=b.headers)
    assert r.status_code == 404
    blocked = (await client.get("/v1/social/blocks", headers=a.headers)).json()
    assert [p["user_id"] for p in blocked] == [str(b.user_id)]
    r = await client.delete(f"/v1/social/blocks/{b.user_id}", headers=a.headers)
    assert r.status_code == 204


async def test_minor_pushes_wait_for_the_reminder_window(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    """R45: a friend's cheer to a minor goes to notify.outbox, and notify.decide holds it."""
    adult = await person(client, services)
    teen = await person(client, services, band="13_17", pet="Momo")
    await befriend(client, teen, adult, via="link")
    r = await client.post(
        "/v1/social/nudges",
        json={"to_user_id": str(teen.user_id), "kind": "cheer", "preset_id": "message_2"},
        headers=adult.headers,
    )
    assert r.status_code == 200, r.text
    pushes = [p for p in await outbox(services, teen.user_id) if p.kind == "friend_cheer"]
    assert len(pushes) == 1
    assert pushes[0].status in ("queued", "held")


async def stored_streak(services: AppServices, duo_id: str) -> tuple[int, int]:
    async with services.db.admin_tx() as session:
        row = (
            await session.execute(
                text("select shared_streak, best_streak from social.duos where id = :d"),
                {"d": duo_id},
            )
        ).one()
    return int(row.shared_streak), int(row.best_streak)


async def test_duo_streak(client: httpx.AsyncClient, services: AppServices) -> None:
    a = await person(client, services, name="Asha Verma")
    b = await person(client, services, name="Kabir Rao")
    await befriend(client, a, b)
    r = await client.post("/v1/duos", json={"friend_ids": [str(b.user_id)]}, headers=a.headers)
    assert r.status_code == 200, r.text
    duo_id = r.json()["invited"][0]["id"]
    assert "duo_invite" in [p.kind for p in await outbox(services, b.user_id)]
    r = await client.post(f"/v1/duos/{duo_id}/accept", headers=b.headers)
    assert r.json()["status"] == "active"

    # Days are the partners' local days (profile timezone, default Asia/Kolkata), not UTC.
    today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    async with services.db.admin_tx() as session:
        for uid in (a.user_id, b.user_id):
            for d in (today, today + timedelta(days=1)):
                await session.execute(
                    text(
                        "insert into learn.activity_days (user_id, day, qualified) values (:u, :d, true)"
                        " on conflict (user_id, day) do update set qualified = true"
                    ),
                    {"u": uid, "d": d},
                )
    await social_duos.rollup(services.db, datetime.now(UTC) + timedelta(days=2))
    assert await stored_streak(services, duo_id) == (2, 2)
    # The list counts today live once both have studied; the nightly rollup settles it.
    duo = next(
        d for d in (await client.get("/v1/duos", headers=a.headers)).json() if d["id"] == duo_id
    )
    assert duo["me_today"] and duo["partner_today"]

    # A missed day without a freeze or rest day resets it; the best stays.
    await social_duos.rollup(services.db, datetime.now(UTC) + timedelta(days=4))
    assert await stored_streak(services, duo_id) == (0, 2)

    r = await client.delete(f"/v1/duos/{duo_id}", headers=b.headers)
    assert r.status_code == 204


async def test_squads(client: httpx.AsyncClient, services: AppServices) -> None:
    owner = await person(client, services, name="Asha Verma")
    friend = await person(client, services, name="Kabir Rao")
    squad_id = str(uuid.uuid4())
    r = await client.post("/v1/squads", json={"squad_id": squad_id}, headers=owner.headers)
    assert r.status_code == 201, r.text
    squad = r.json()
    assert squad["name"].startswith("Squad ") and squad["my_role"] == "owner"
    # Creating again with the same id returns the same squad.
    again = await client.post("/v1/squads", json={"squad_id": squad_id}, headers=owner.headers)
    assert again.status_code in (200, 201) and again.json()["id"] == squad_id

    code = squad["invite_code"]
    preview = (await client.get(f"/v1/squads/join/{code}", headers=friend.headers)).json()
    assert preview["member_count"] == 1 and not preview["already_member"]
    r = await client.post(f"/v1/squads/join/{code}", json={"via": "link"}, headers=friend.headers)
    assert r.status_code == 200, r.text
    assert r.json()["member_count"] == 2

    r = await client.post(
        f"/v1/squads/{squad_id}/cheer", json={"preset_id": "squad_message"}, headers=friend.headers
    )
    assert r.status_code == 200, r.text

    board = (
        await client.get(
            "/v1/leaderboards",
            params={"scope": "squad", "squad_id": squad_id},
            headers=friend.headers,
        )
    ).json()
    assert {row["person"]["user_id"] for row in board["rows"]} == {
        str(owner.user_id),
        str(friend.user_id),
    }

    r = await client.delete(f"/v1/squads/{squad_id}/members/{owner.user_id}", headers=owner.headers)
    assert r.status_code == 204
    left = (await client.get(f"/v1/squads/{squad_id}", headers=friend.headers)).json()
    assert left["my_role"] == "owner" and left["member_count"] == 1
