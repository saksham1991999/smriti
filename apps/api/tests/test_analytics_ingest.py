"""``POST /v1/analytics/events``: the catalogue, the age-band and consent policy, the props guard,
the caps, and the event store (a MemoryEventStore stands in for ClickHouse)."""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.integrations.event_store import FileEventStore, MemoryEventStore
from smriti_api.schemas.analytics_ingest import MAX_BODY_BYTES, MAX_EVENTS
from smriti_api.services.analytics_ingest import catalogue
from tests.helpers import Session, new_guest
from tests.money_helpers import set_profile
from tests.practice_helpers import flags

CONTEXT = {"platform": "android", "app_variant": "jee", "locale": "en", "app_version": "1.0.0"}


def ev(name: str, props: dict[str, Any] | None = None, **kw: Any) -> dict[str, Any]:
    return {
        "event_id": str(kw.get("event_id") or uuid.uuid4()),
        "name": name,
        "occurred_at": (kw.get("at") or datetime.now(UTC)).isoformat(),
        "props": props or {},
        "context": kw.get("context") or CONTEXT,
    }


@pytest.fixture
def store(services: AppServices) -> Iterator[MemoryEventStore]:
    assert services.integrations is not None
    old = services.integrations.event_store
    mem = MemoryEventStore()
    services.integrations.event_store = mem
    try:
        yield mem
    finally:
        services.integrations.event_store = old


async def send(client: httpx.AsyncClient, s: Session, events: list[dict[str, Any]]) -> Any:
    r = await client.post("/v1/analytics/events", json={"events": events}, headers=s.headers)
    assert r.status_code == 200, r.text
    return r.json()


async def person(client: httpx.AsyncClient, services: AppServices, band: str) -> Session:
    s = await new_guest(client)
    await set_profile(services, s.user_id, age_band=band)
    return s


def reasons(body: Any) -> dict[str, str]:
    return {d["event_id"]: d["reason"] for d in body["dropped"]}


async def test_an_adult_product_event_is_kept_with_only_its_catalogue_props(
    client: httpx.AsyncClient, services: AppServices, store: MemoryEventStore
) -> None:
    s = await person(client, services, "18p")
    e = ev(
        "analytics_card_opened",
        {
            "card": "speed",
            "colour": "red",  # not in the catalogue entry
            "email": "a@b.co",  # personal data
            "gaid": "abc",  # an ad id
        },
    )
    learning = ev("answer_dont_know", {"question_id": "q-1", "time_ms": 900})
    free_text = ev("answer_dont_know", {"question_id": "I was not sure at all", "time_ms": 1})
    body = await send(client, s, [e, learning, free_text])

    assert body["accepted"] == [e["event_id"], learning["event_id"], free_text["event_id"]]
    assert body["dropped"] == []
    codes = {(i["event_id"], i["prop"]): i["code"] for i in body["issues"]}
    assert codes == {
        (e["event_id"], "colour"): "unknown_prop",
        (e["event_id"], "email"): "blocked_name",
        (e["event_id"], "gaid"): "blocked_name",
        (free_text["event_id"], "question_id"): "free_text",
    }
    rows = {r["event_id"]: r for r in store.rows}
    assert json.loads(rows[e["event_id"]]["props"]) == {"card": "speed"}
    assert json.loads(rows[free_text["event_id"]]["props"]) == {"time_ms": 1}
    row = rows[learning["event_id"]]
    assert row["user_id"] == str(s.user_id)
    assert row["device_id"] == str(s.device_id)
    assert row["type"] == "answer_dont_know"
    assert row["platform"] == "android" and row["locale"] == "en"
    # Values never reach the response, and no value the guard removed reaches the store.
    assert "a@b.co" not in json.dumps(body) and "a@b.co" not in json.dumps(store.rows)
    assert "not sure" not in json.dumps(store.rows)


async def test_unknown_server_only_stale_and_repeated_events_are_dropped(
    client: httpx.AsyncClient, services: AppServices, store: MemoryEventStore
) -> None:
    s = await person(client, services, "18p")
    server = next(k for k, v in catalogue().events.items() if v["stream"] == "server")
    keep = ev("answer_dont_know", {"question_id": "q-1"})
    events = [
        ev("not_in_the_catalogue"),
        ev(server),
        ev("answer_dont_know", at=datetime.now(UTC) - timedelta(days=401)),
        ev("answer_dont_know", at=datetime.now(UTC) + timedelta(days=2)),
        keep,
        dict(keep),
    ]
    body = await send(client, s, events)
    assert body["accepted"] == [keep["event_id"]]
    assert [d["reason"] for d in body["dropped"]] == [
        "unknown_event",
        "server_only",
        "too_old",
        "in_the_future",
        "duplicate_in_batch",
    ]
    assert len(store.rows) == 1


async def test_adults_who_opt_out_keep_only_learning_and_essential_events(
    client: httpx.AsyncClient, services: AppServices, store: MemoryEventStore
) -> None:
    s = await person(client, services, "18p")
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "update app.profiles set settings = coalesce(settings, '{}'::jsonb)"
                " || '{\"analytics_opt_out\": true}'::jsonb where user_id = :u"
            ),
            {"u": s.user_id},
        )
    product = ev("analytics_card_opened", {"card": "speed"})
    essential = ev("account_delete_requested", {"provider": "google"})
    learning = ev("answer_dont_know", {"question_id": "q-1"})
    body = await send(client, s, [product, essential, learning])
    assert reasons(body) == {product["event_id"]: "opted_out"}
    assert body["accepted"] == [essential["event_id"], learning["event_id"]]


async def test_minors_keep_learning_and_essential_events_without_tracking_props(
    client: httpx.AsyncClient, services: AppServices, store: MemoryEventStore
) -> None:
    s = await person(client, services, "13_17")
    product = ev("analytics_card_opened", {"card": "speed"})
    shared = next(
        k
        for k, v in catalogue().events.items()
        if v["stream"] != "server" and "share_target" in v.get("props", {})
    )
    shared_def = catalogue().events[shared]
    tracked = ev(shared, {"share_target": "whatsapp"})
    learning = ev("answer_dont_know", {"question_id": "q-1", "utm_source": "x"})
    body = await send(client, s, [product, tracked, learning])

    assert reasons(body)[product["event_id"]] == "minor_not_allowed"
    if shared_def.get("essential") or shared_def["stream"] == "learning":
        assert tracked["event_id"] in body["accepted"]
        issue = {(i["event_id"], i["prop"]): i["code"] for i in body["issues"]}
        assert issue[(tracked["event_id"], "share_target")] == "stripped_for_minor"
    else:
        assert reasons(body)[tracked["event_id"]] == "minor_not_allowed"
    assert learning["event_id"] in body["accepted"]
    codes = {(i["event_id"], i["prop"]): i["code"] for i in body["issues"]}
    assert codes[(learning["event_id"], "utm_source")] == "blocked_name"
    for row in store.rows:
        props = json.loads(row["props"])
        assert not any(k.startswith("utm_") or k in catalogue().minor_stripped for k in props)


async def test_little_learners_get_the_allow_list_only(
    client: httpx.AsyncClient, services: AppServices, store: MemoryEventStore
) -> None:
    s = await person(client, services, "u10")
    allowed = sorted(
        k
        for k in catalogue().little_allowlist
        if catalogue().events.get(k, {}).get("stream") == "product"
    )
    product = ev("analytics_card_opened", {"card": "speed"})
    events = [product] + [ev(k) for k in allowed[:1]]
    body = await send(client, s, events)
    assert reasons(body) == {product["event_id"]: "little_learner_not_allowed"}
    assert len(body["accepted"]) == len(allowed[:1])


async def test_the_server_reads_the_age_band_not_the_client(
    client: httpx.AsyncClient, services: AppServices, store: MemoryEventStore
) -> None:
    s = await person(client, services, "10_12")
    claim = {**CONTEXT, "audience": "adult", "is_guest": False, "age_band": "18p"}
    product = ev("analytics_card_opened", {"card": "speed"}, context=claim)
    body = await send(client, s, [product])
    assert reasons(body) == {product["event_id"]: "minor_not_allowed"}
    assert store.rows == []


async def test_a_minor_waiting_on_consent_sends_nothing_when_the_flag_is_on(
    client: httpx.AsyncClient, services: AppServices, store: MemoryEventStore
) -> None:
    s = await person(client, services, "13_17")
    learning = ev("answer_dont_know", {"question_id": "q-1"})
    async with flags(services, {"minor.defer_sync_until_consent": True}):
        body = await send(client, s, [learning])
    assert reasons(body) == {learning["event_id"]: "awaiting_consent"}
    assert store.rows == []


async def test_caps_and_a_missing_store(
    client: httpx.AsyncClient, services: AppServices, store: MemoryEventStore
) -> None:
    s = await person(client, services, "18p")
    too_many = [ev("answer_dont_know") for _ in range(MAX_EVENTS + 1)]
    r = await client.post("/v1/analytics/events", json={"events": too_many}, headers=s.headers)
    assert r.status_code == 422
    r = await client.post("/v1/analytics/events", json={"events": []}, headers=s.headers)
    assert r.status_code == 422

    big = json.dumps({"events": [ev("answer_dont_know")], "pad": "x" * (MAX_BODY_BYTES + 1)})
    r = await client.post(
        "/v1/analytics/events",
        content=big,
        headers={**s.headers, "Content-Type": "application/json"},
    )
    assert r.status_code == 413
    assert r.json()["code"] == "batch_too_large"

    r = await client.post("/v1/analytics/events", json={"events": [ev("answer_dont_know")]})
    assert r.status_code == 401

    assert services.integrations is not None
    services.integrations.event_store = None
    r = await client.post(
        "/v1/analytics/events", json={"events": [ev("answer_dont_know")]}, headers=s.headers
    )
    assert r.status_code == 503
    assert r.json()["code"] == "analytics_unavailable"


async def test_the_file_store_appends_json_lines(tmp_path: Any) -> None:
    path = tmp_path / "events.jsonl"
    fs = FileEventStore(path)
    await fs.write([{"event_id": "a", "props": "{}"}])
    await fs.write([{"event_id": "b", "props": "{}"}])
    await fs.write([])
    lines = path.read_text(encoding="utf-8").splitlines()
    assert [json.loads(x)["event_id"] for x in lines] == ["a", "b"]


def test_the_catalogue_is_the_package_export() -> None:
    cat = catalogue()
    assert len(cat.events) > 100
    assert "share_target" in cat.minor_stripped
    assert "email" in cat.blocked_names and "gaid" in cat.blocked_names
