"""Sync v1.4 ``activity_completed`` against app-core's golden vector
(``packages/app-core/test-vectors/activity_completed.json``): accepted and rejected the same way,
the same XP per star, each accepted one a completed lesson on its local day (streak and path).
The vector is app-core's output and is never edited here."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from smriti_api.core.config import REPO_ROOT
from smriti_api.core.deps import AppServices
from smriti_api.services import sync as sync_service
from smriti_api.services.xp import XpRules
from tests.helpers import event, get_state, new_guest, post_events
from tests.money_helpers import set_profile
from tests.practice_helpers import flags

VECTOR: dict[str, Any] = json.loads(
    (REPO_ROOT / "packages" / "app-core" / "test-vectors" / "activity_completed.json").read_text()
)


@pytest.fixture(autouse=True)
def _vector_dates_stay_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    # The vector's dates are fixed; keep them inside the server's age window as time passes.
    monkeypatch.setattr(sync_service, "MAX_AGE", timedelta(days=36500))


def test_vector_config_matches_server_default() -> None:
    assert VECTOR["version"] == 1
    assert VECTOR["config"]["xp_little_activity_star"] == XpRules().little_activity_star


async def test_activity_vector(client: httpx.AsyncClient, services: AppServices) -> None:
    s = await new_guest(client)
    await set_profile(services, s.user_id, age_band="u10", timezone=VECTOR["time_zone"])
    events = [
        event(
            "activity_completed",
            c["payload"],
            at=datetime.fromisoformat(c["payload"]["completed_at"]),
            tz=VECTOR["time_zone"],
        )
        for c in VECTOR["cases"]
    ]
    # One at a time, as a device's outbox would send them over the day.
    for ev, case in zip(events, VECTOR["cases"], strict=True):
        out = await post_events(client, s, [ev])
        if case["expected"]["accepted"]:
            assert out["accepted"] == [ev["event_id"]], case["name"]
        else:
            assert [r["code"] for r in out["rejected"]] == [case["expected"]["code"]], case["name"]

    async with services.db.admin_tx() as session:
        xp = {
            str(r.event_id): int(r.amount)
            for r in (
                await session.execute(
                    text("select event_id, amount from game.xp_ledger where user_id = :u"),
                    {"u": s.user_id},
                )
            ).all()
        }
        days = {
            r.day.isoformat(): (int(r.lessons_completed), bool(r.qualified))
            for r in (
                await session.execute(
                    text(
                        "select day, lessons_completed, qualified from learn.activity_days"
                        " where user_id = :u"
                    ),
                    {"u": s.user_id},
                )
            ).all()
        }
    for ev, case in zip(events, VECTOR["cases"], strict=True):
        assert xp.get(ev["event_id"], 0) == case["expected"]["xp"], case["name"]
    assert days == {d["day"]: (d["lessons_completed"], True) for d in VECTOR["days"]}

    # The path: the activity's topic is learned, as after a completed lesson.
    state = await get_state(client, s)
    topics = {t["topic_id"]: t for t in state["topic_progress"]}
    assert topics[VECTOR["cases"][0]["payload"]["topic_id"]]["status"] == "learned"


async def test_star_xp_comes_from_the_flag(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    await set_profile(services, s.user_id, age_band="u10")
    payload = {**VECTOR["cases"][1]["payload"], "activity_id": "play.flag-check"}
    ev = event("activity_completed", payload, at=datetime.fromisoformat(payload["completed_at"]))
    async with flags(services, {"xp.little_activity_star": 2}):
        out = await post_events(client, s, [ev])
    assert out["accepted"] == [ev["event_id"]]
    async with services.db.admin_tx() as session:
        amount = (
            await session.execute(
                text("select amount from game.xp_ledger where event_id = :e"),
                {"e": ev["event_id"]},
            )
        ).scalar_one()
    assert amount == 2 * payload["stars"]
    # Free text is not part of the event: unknown fields are dropped, a bad kind is rejected.
    bad = event("activity_completed", {**payload, "kind": "video"})
    out = await post_events(client, s, [bad])
    assert out["rejected"][0]["code"] == "invalid_payload"
