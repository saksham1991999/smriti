"""Sync state v1.4 facts for ENT-08's freeze variant: which missed days a freeze covered, and when
the next free freeze arrives."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from smriti_api.core.deps import AppServices
from tests.helpers import get_state, lesson_completed, new_guest, post_events

IST = ZoneInfo("Asia/Kolkata")


async def test_freeze_used_days_and_next_free_freeze(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    now = datetime.now(UTC)
    today = now.astimezone(IST).date()
    # Studied the day before yesterday, missed yesterday: this month's equipped freeze covers it.
    studied = datetime.combine(today - timedelta(days=2), datetime.min.time(), IST) + timedelta(
        hours=12
    )
    out = await post_events(client, s, [lesson_completed(at=studied)])
    assert len(out["accepted"]) == 1, out
    streak = (await get_state(client, s))["streak"]
    yesterday = (today - timedelta(days=1)).isoformat()
    assert streak["freeze_used_days"] == [yesterday], streak
    assert streak["current"] >= 1 and streak["incident_days_covered"] == []
    first_next_month = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    assert streak["next_free_freeze_on"] == first_next_month.isoformat()

    # Studying today keeps the fact (ENT-08 decides when to show it, once a day); the streak
    # carries on through the covered day.
    await post_events(client, s, [lesson_completed()])
    after = (await get_state(client, s))["streak"]
    assert after["freeze_used_days"] == [yesterday] and after["today_qualified"] is True
    assert after["current"] == streak["current"] + 1


def test_next_month_rolls_over_the_year() -> None:
    d = date(2026, 12, 31)
    assert (d.replace(day=1) + timedelta(days=32)).replace(day=1) == date(2027, 1, 1)
