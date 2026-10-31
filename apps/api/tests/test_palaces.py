"""Memory palaces (sync v1.5, memory-labs §5.6): the document operations and the sync rules
against app-core's golden vector (``packages/app-core/test-vectors/palace.json``, never edited
here), and the ``/v1/palaces`` routes on top of them."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from smriti_api.core.config import REPO_ROOT
from smriti_api.core.deps import AppServices
from smriti_api.schemas import palaces as ps
from smriti_api.services import palaces as ops
from smriti_api.services import sync as sync_service
from smriti_api.services.errors import DomainError
from tests.helpers import Session, event, get_state, new_guest, post_events
from tests.money_helpers import grant_pro

VECTOR: dict[str, Any] = json.loads(
    (REPO_ROOT / "packages" / "app-core" / "test-vectors" / "palace.json").read_text()
)


@pytest.fixture(autouse=True)
def _vector_dates_stay_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sync_service, "MAX_AGE", timedelta(days=36500))


def _no_new_id() -> uuid.UUID:
    raise AssertionError("vector cases give every id")


def _run(doc: ps.PalaceDoc, op: str, args: dict[str, Any]) -> ps.PalaceDoc:
    if op == "place":
        return ops.place(doc, uuid.UUID(args["item_id"]), uuid.UUID(args["room_id"]), args["spot"])
    if op == "unplace":
        return ops.unplace(doc, uuid.UUID(args["item_id"]))
    if op == "add_items":
        items = [ps.ItemNew.model_validate(i) for i in args["items"]]
        return ops.add_items(doc, items, args["auto_place"], _no_new_id)
    if op == "patch_item":
        patch = ps.ItemPatch.model_validate(args["patch"])
        return ops.patch_item(doc, uuid.UUID(args["item_id"]), patch)
    if op == "remove_item":
        return ops.remove_item(doc, uuid.UUID(args["item_id"]))
    if op == "set_rooms":
        rooms = [ps.RoomIn.model_validate(r) for r in args["rooms"]]
        return ops.set_rooms(doc, rooms, _no_new_id)
    raise AssertionError(op)


def test_default_spots_match_app_core() -> None:
    assert VECTOR["version"] == 1
    assert [list(p) for p in ops.DEFAULT_SPOT_POSITIONS] == VECTOR["default_spot_positions"]
    assert len(ops.DEFAULT_SPOT_POSITIONS) == ps.DEFAULT_SPOTS


@pytest.mark.parametrize("case", VECTOR["cases"], ids=lambda c: c["name"])
def test_operation_vector(case: dict[str, Any]) -> None:
    doc = ps.PalaceDoc.model_validate(VECTOR["base"])
    if "error" in case["expected"]:
        with pytest.raises(DomainError) as exc:
            _run(doc, case["op"], case["args"])
        assert exc.value.code == case["expected"]["error"]
        return
    out = _run(doc, case["op"], case["args"])
    assert out.model_dump(mode="json", exclude={"updated_at"}) == case["expected"]["doc"]
    assert out.updated_at == doc.updated_at


async def _set_plan(services: AppServices, s: Session, plan: str) -> None:
    if plan == "pro":
        await grant_pro(services, s.user_id)
    elif plan in ("free", "lapsed"):
        async with services.db.admin_tx() as session:
            await session.execute(
                text("update billing.entitlements set active = false where user_id = :u"),
                {"u": s.user_id},
            )


def _fresh_ids(value: Any) -> Any:
    """The vector's fixed ids, each swapped for a new one (the test database outlives a run)."""
    raw = json.dumps(value)
    fresh = {old: str(uuid.uuid4()) for old in set(_VECTOR_ID.findall(raw))}
    return json.loads(_VECTOR_ID.sub(lambda m: fresh[m.group(0)], raw))


_VECTOR_ID = re.compile(r"00000000-0000-4000-8000-[0-9a-f]{12}")


async def test_sync_vector(client: httpx.AsyncClient, services: AppServices) -> None:
    s = await new_guest(client)
    plan = "free"
    steps, palace_id = _fresh_ids([VECTOR["sync"], VECTOR["base"]["palace_id"]])
    for step in steps:
        if step["as"] != plan:
            plan = step["as"]
            await _set_plan(services, s, plan)
        at = datetime.fromisoformat(step["payload"].get("updated_at", "2026-10-02T13:00:00+05:30"))
        ev = event(step["type"], step["payload"], at=at, tz=VECTOR["time_zone"])
        out = await post_events(client, s, [ev])
        want = step["expected"]
        if "code" in want:
            assert [r["code"] for r in out["rejected"]] == [want["code"]], step["name"]
            continue
        assert out["accepted"] == [ev["event_id"]], (step["name"], out)
        r = await client.get("/v1/palaces", headers=s.headers)
        assert r.status_code == 200, r.text
        listing = r.json()
        if want.get("deleted"):
            assert listing["palaces"] == [] and listing["deleted"] == [palace_id], step["name"]
        if "name" in want:
            assert [p["name"] for p in listing["palaces"]] == [want["name"]], step["name"]
        if "card" in want:
            state = await get_state(client, s)
            assert want["card"] in [c["card_ref"] for c in state["srs"]["cards"]]
            async with services.db.admin_tx() as session:
                ctx = (
                    await session.execute(
                        text(
                            "select context from learn.srs_reviews where user_id = :u and card_ref = :r"
                        ),
                        {"u": s.user_id, "r": want["card"]},
                    )
                ).scalar_one()
            assert ctx == want["context"]
            palace = listing["palaces"][0]
            due = next(i["due_at"] for i in palace["items"] if i["card_ref"] == want["card"])
            assert due is not None and palace["next_walk_at"] == due
        if "deleted_card" in want:
            state = await get_state(client, s, since=0)
            assert want["deleted_card"] in state["srs"]["deleted"]
            assert want["deleted_card"] not in [c["card_ref"] for c in state["srs"]["cards"]]

    async with services.db.admin_tx() as session:
        row = (
            await session.execute(
                text(
                    "select name, (select count(*) from learn.palace_items where palace_id = p.id) as items"
                    " from learn.palaces p where id = :p"
                ),
                {"p": palace_id},
            )
        ).one()
        logged = (
            (
                await session.execute(
                    text(
                        "select payload from learn.sync_events where user_id = :u and type = 'palace_saved'"
                        " and status = 'applied'"
                    ),
                    {"u": s.user_id},
                )
            )
            .scalars()
            .all()
        )
    # A deleted palace keeps no words; the event log keeps only which palace and which version.
    assert row.name == "" and row.items == 0
    assert all(set(p) == {"palace_id", "updated_at"} for p in logged)


async def _pro(client: httpx.AsyncClient, services: AppServices) -> Session:
    s = await new_guest(client)
    await grant_pro(services, s.user_id)
    return s


async def test_rest_build_place_and_remove(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await _pro(client, services)
    body = {
        "name": "School walk",
        "template": "school",
        "template_id": "pt.school-basic",
        "rooms": [
            {"name": "Gate", "template_room": "gate", "loci": [{"pos": {"x": 0.1, "y": 0.2}}] * 3},
            {"name": "Library"},
        ],
    }
    r = await client.post(
        "/v1/palaces", json=body, headers={**s.headers, "Idempotency-Key": "create-1"}
    )
    assert r.status_code == 201, r.text
    palace = r.json()
    pid = palace["palace_id"]
    assert [len(room["loci"]) for room in palace["rooms"]] == [3, ps.DEFAULT_SPOTS]
    assert palace["next_walk_at"] is None
    again = await client.post(
        "/v1/palaces", json=body, headers={**s.headers, "Idempotency-Key": "create-1"}
    )
    assert again.status_code == 201 and again.json()["palace_id"] == pid
    assert len((await client.get("/v1/palaces", headers=s.headers)).json()["palaces"]) == 1

    items = [{"item_ref": f"kp:c.sample-list#{n}"} for n in range(1, 11)]
    r = await client.post(
        f"/v1/palaces/{pid}/items", json={"items": items, "auto_place": True}, headers=s.headers
    )
    assert r.status_code == 200, r.text
    palace = r.json()
    spots = [lo["locus_id"] for room in palace["rooms"] for lo in room["loci"]]
    assert [i["locus_id"] for i in palace["items"]] == [*spots, None, None]
    first, last = palace["items"][0], palace["items"][-1]
    assert first["card_ref"] == f"p:{first['item_id']}"

    lib = palace["rooms"][1]["room_id"]
    r = await client.put(
        f"/v1/palaces/{pid}/items/{last['item_id']}/place",
        json={"room_id": lib, "spot": 0},
        headers=s.headers,
    )
    assert r.status_code == 200, r.text
    moved = {i["item_id"]: i["locus_id"] for i in r.json()["items"]}
    assert moved[last["item_id"]] == palace["rooms"][1]["loci"][0]["locus_id"]
    assert moved[palace["items"][3]["item_id"]] is None  # swapped to where the tray item was

    r = await client.put(
        f"/v1/palaces/{pid}/items/{last['item_id']}/place",
        json={"room_id": lib, "spot": 9},
        headers=s.headers,
    )
    assert r.status_code == 404 and r.json()["code"] == "spot_not_found"

    r = await client.patch(
        f"/v1/palaces/{pid}/items/{first['item_id']}", json={"note": "my link"}, headers=s.headers
    )
    assert r.status_code == 200 and r.json()["items"][0]["note"] == "my link"

    rated = await post_events(
        client,
        s,
        [event("review_rated", {"card_ref": first["card_ref"], "rating": 3, "ms_to_answer": 3000})],
    )
    assert rated["rejected"] == []
    r = await client.delete(f"/v1/palaces/{pid}/items/{first['item_id']}", headers=s.headers)
    assert r.status_code == 200 and len(r.json()["items"]) == 9
    state = await get_state(client, s, since=0)
    assert first["card_ref"] in state["srs"]["deleted"]

    r = await client.delete(f"/v1/palaces/{pid}/items/{last['item_id']}/place", headers=s.headers)
    assert next(i for i in r.json()["items"] if i["item_id"] == last["item_id"])["locus_id"] is None

    r = await client.patch(
        f"/v1/palaces/{pid}",
        json={"name": "My school", "rooms": [{"room_id": lib, "name": "Library"}]},
        headers=s.headers,
    )
    assert r.status_code == 200, r.text
    palace = r.json()
    assert palace["name"] == "My school" and [x["room_id"] for x in palace["rooms"]] == [lib]
    assert sum(1 for i in palace["items"] if i["locus_id"] is not None) == ps.DEFAULT_SPOTS - 1

    r = await client.delete(f"/v1/palaces/{pid}", headers=s.headers)
    assert r.status_code == 200 and r.json()["palace_id"] == pid
    assert (await client.get(f"/v1/palaces/{pid}", headers=s.headers)).status_code == 404


async def test_rest_rules(client: httpx.AsyncClient, services: AppServices) -> None:
    free = await new_guest(client)
    r = await client.post(
        "/v1/palaces", json={"name": "Home", "template": "home"}, headers=free.headers
    )
    assert r.status_code == 403 and r.json()["code"] == "pro_required"

    owner, other = await _pro(client, services), await _pro(client, services)
    r = await client.post(
        "/v1/palaces", json={"name": "Home", "template": "home"}, headers=owner.headers
    )
    pid = r.json()["palace_id"]
    assert (await client.get(f"/v1/palaces/{pid}", headers=other.headers)).status_code == 404
    r = await client.patch(f"/v1/palaces/{pid}", json={"name": "Mine"}, headers=other.headers)
    assert r.status_code == 404
    r = await client.post(
        "/v1/palaces",
        json={"palace_id": pid, "name": "Same id", "template": "home"},
        headers=other.headers,
    )
    assert r.status_code == 409 and r.json()["code"] == "palace_exists"

    # Someone else's palace id in a snapshot is refused, and changes nothing.
    snap = (await client.get(f"/v1/palaces/{pid}", headers=owner.headers)).json()
    doc = ps.PalaceDoc.model_validate(snap).model_dump(mode="json")
    doc["name"] = "Taken over"
    doc["updated_at"] = datetime.fromisoformat(doc["updated_at"]).replace(year=2030).isoformat()
    out = await post_events(client, other, [event("palace_saved", doc)])
    assert [x["code"] for x in out["rejected"]] == ["palace_not_found"]
    # Their room ids in a palace of mine are refused too.
    doc["palace_id"] = str(uuid.uuid4())
    out = await post_events(client, other, [event("palace_saved", doc)])
    assert [x["code"] for x in out["rejected"]] == ["invalid_payload"]
    r = await client.get(f"/v1/palaces/{pid}", headers=owner.headers)
    assert r.json()["name"] == "Home"

    r = await client.post(
        f"/v1/palaces/{pid}/items",
        json={"items": [{"item_ref": "has spaces"}]},
        headers=owner.headers,
    )
    assert r.status_code == 422
