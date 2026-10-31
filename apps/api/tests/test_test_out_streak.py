"""Learn flow Q7 against app-core's golden vector (``test-vectors/test_out_streak.json``): a passed
Test out counts toward the streak as one lesson on its local day, once per check; a repeat, an
undo and a chapter reset count nothing. The vector is app-core's output and is never edited."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from smriti_api.core.config import REPO_ROOT
from smriti_api.core.deps import AppServices
from smriti_api.services import sync as sync_service
from tests.helpers import event, new_guest, post_events
from tests.money_helpers import set_profile

VECTOR: dict[str, Any] = json.loads(
    (REPO_ROOT / "packages" / "app-core" / "test-vectors" / "test_out_streak.json").read_text()
)


@pytest.fixture(autouse=True)
def _vector_dates_stay_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sync_service, "MAX_AGE", timedelta(days=36500))


async def test_a_passed_test_out_is_one_lesson_for_the_streak(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    assert VECTOR["version"] == 1
    tz = VECTOR["time_zone"]
    s = await new_guest(client)
    await set_profile(services, s.user_id, timezone=tz)
    for case in VECTOR["cases"]:
        ev = event(case["type"], case["payload"], at=datetime.fromisoformat(case["at"]), tz=tz)
        out = await post_events(client, s, [ev])
        codes = [r["code"] for r in out["rejected"]]
        expected = case["expected"]
        assert codes == ([] if expected["accepted"] else [expected["code"]]), case["name"]

    async with services.db.admin_tx() as session:
        rows = {
            r.day: r
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
    for day in VECTOR["days"]:
        row = rows.get(date.fromisoformat(day["day"]))
        got = (row.lessons_completed, row.qualified) if row is not None else (0, False)
        assert got == (day["lessons_completed"], day["qualified"]), day["day"]
