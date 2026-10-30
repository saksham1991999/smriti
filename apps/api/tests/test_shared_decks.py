"""Shared decks (tutor-social B12, R20, R41): moderation before the link works, anonymity,
who may open a link, copies, helpful votes and stopping."""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator, Sequence
from contextlib import contextmanager

import httpx

from smriti_api.ai.fakes import FakeLLMProvider
from smriti_api.core.deps import AppServices
from tests.helpers import Session, event, new_guest, post_events
from tests.practice_helpers import flags
from tests.social_helpers import befriend, person


@contextmanager
def fake_llm(services: AppServices, replies: Sequence[str] | None = None) -> Iterator[None]:
    old = services.ai.llm
    services.ai.llm = FakeLLMProvider(replies)
    try:
        yield
    finally:
        services.ai.llm = old


async def make_deck(client: httpx.AsyncClient, s: Session, cards: int = 4) -> str:
    """A deck the student made on the device, synced as cards (test text, not study content)."""
    deck_id = str(uuid.uuid4())
    events = [
        event(
            "deck_card_upserted",
            {
                "user_card_id": str(uuid.uuid4()),
                "deck_id": deck_id,
                "front": f"Front {i}",
                "back": f"Back {i}",
            },
        )
        for i in range(cards)
    ]
    result = await post_events(client, s, events)
    assert result["rejected"] == [], result
    return deck_id


async def share(
    client: httpx.AsyncClient, s: Session, deck_id: str, title: str = "My cards", **extra: str
) -> httpx.Response:
    return await client.post(
        f"/v1/decks/{deck_id}/share", json={"title": title, **extra}, headers=s.headers
    )


async def test_share_find_copy_and_vote(client: httpx.AsyncClient, services: AppServices) -> None:
    author = await person(client, services, name="Asha Verma", exam="fx-deck-exam")
    friend = await person(client, services, name="Kabir Rao", exam="fx-deck-exam")
    stranger = await person(client, services, name="Meera Iyer", exam="fx-deck-exam")
    await befriend(client, author, friend)
    deck_id = await make_deck(client, author)

    with fake_llm(services):
        r = await share(client, author, deck_id, list_for_exam="fx-deck-exam")
    assert r.status_code == 200, r.text
    shared = r.json()
    assert shared["share_status"] == "shared" and shared["path"] == f"/deck/{shared['share_code']}"
    code = shared["share_code"]

    rows = (await client.get("/v1/shared-decks", headers=friend.headers)).json()
    row = next(x for x in rows if x["code"] == code)
    assert row["shared_by"] == "friend" and row["card_count"] == 4 and row["helpful"] == 0
    assert "Asha" not in json.dumps(rows)

    # Listing for the exam is behind a flag.
    r = await client.get("/v1/shared-decks", params={"scope": "exam"}, headers=stranger.headers)
    assert r.status_code == 404
    async with flags(services, {"social.deck_listing": True}):
        listed = (
            await client.get("/v1/shared-decks", params={"scope": "exam"}, headers=stranger.headers)
        ).json()
    assert next(x for x in listed if x["code"] == code)["shared_by"] == "student"

    # A guest can preview an adult's deck link but must sign in to copy.
    guest = await new_guest(client)
    preview = (await client.get(f"/v1/shared-decks/{code}", headers=guest.headers)).json()
    assert len(preview["sample_cards"]) == 3 and preview["can_copy"] is False
    r = await client.post(f"/v1/shared-decks/{code}/copy", headers=guest.headers)
    assert r.status_code == 401 and r.json()["code"] == "login_required"

    copy = await client.post(f"/v1/shared-decks/{code}/copy", headers=stranger.headers)
    assert copy.status_code == 201, copy.text
    assert len(copy.json()["cards"]) == 4 and copy.json()["deck_id"] != deck_id

    voted = await client.put(
        f"/v1/shared-decks/{code}/helpful", json={"on": True}, headers=stranger.headers
    )
    assert voted.json()["helpful"] == 1 and voted.json()["i_found_helpful"] is True
    again = await client.put(
        f"/v1/shared-decks/{code}/helpful", json={"on": True}, headers=stranger.headers
    )
    assert again.json()["helpful"] == 1
    own = await client.put(
        f"/v1/shared-decks/{code}/helpful", json={"on": True}, headers=author.headers
    )
    assert own.status_code == 409

    report = await client.post(
        "/v1/social/reports",
        json={"target_kind": "deck", "deck_code": code, "reason": "wrong_facts"},
        headers=stranger.headers,
    )
    assert report.status_code == 201

    stopped = await client.delete(f"/v1/decks/{deck_id}/share", headers=author.headers)
    assert stopped.json()["share_status"] == "stopped" and stopped.json()["share_code"] is None
    r = await client.get(f"/v1/shared-decks/{code}", headers=stranger.headers)
    assert r.status_code == 404
    # The copy stays with the receiver.
    assert copy.json()["title"] == "My cards"


async def test_moderation_blocks_a_deck(client: httpx.AsyncClient, services: AppServices) -> None:
    author = await person(client, services)
    deck_id = await make_deck(client, author, cards=1)
    with fake_llm(services, ['{"category": "sexual"}']):
        r = await share(client, author, deck_id)
    assert r.json()["share_status"] == "blocked" and r.json()["share_code"] is None
    # Personal data never needs the model to block it.
    deck2 = str(uuid.uuid4())
    await post_events(
        client,
        author,
        [
            event(
                "deck_card_upserted",
                {
                    "user_card_id": str(uuid.uuid4()),
                    "deck_id": deck2,
                    "front": "Call me",
                    "back": "9876543210",
                },
            )
        ],
    )
    with fake_llm(services):
        r = await share(client, author, deck2)
    assert r.json()["share_status"] == "blocked"


async def test_minors_and_sharing(client: httpx.AsyncClient, services: AppServices) -> None:
    teen = await person(client, services, band="13_17", scopes=("account", "social"))
    deck_id = await make_deck(client, teen)
    r = await share(client, teen, deck_id)
    assert r.status_code == 403 and r.json()["code"] == "guardian_consent_required"

    sharer = await person(client, services, band="13_17", scopes=("account", "social", "community"))
    friend = await person(client, services)
    stranger = await person(client, services)
    await befriend(client, sharer, friend)
    deck_id = await make_deck(client, sharer)
    with fake_llm(services):
        r = await share(client, sharer, deck_id, list_for_exam="fx-deck-exam")
    code = r.json()["share_code"]
    assert code
    # A teen's deck opens for the teen's friends only.
    assert (await client.get(f"/v1/shared-decks/{code}", headers=friend.headers)).status_code == 200
    assert (
        await client.get(f"/v1/shared-decks/{code}", headers=stranger.headers)
    ).status_code == 404
    guest = await new_guest(client)
    r = await client.get(f"/v1/shared-decks/{code}", headers=guest.headers)
    assert r.status_code == 401

    child = await person(client, services, band="10_12", scopes=("account", "social", "community"))
    child_deck = await make_deck(client, child)
    r = await share(client, child, child_deck)
    assert r.status_code == 403 and r.json()["code"] == "social_not_available"
