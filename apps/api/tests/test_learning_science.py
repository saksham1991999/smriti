"""Learning-science jobs and views (G-8, TRD §9.6)."""

from __future__ import annotations

import itertools
import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Any

import httpx
from fsrs import State
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services import learning_science as ls
from smriti_api.services.recompute import zone
from tests.helpers import Session
from tests.money_helpers import grant_pro, set_profile, signed_in
from tests.practice_helpers import flags, learner

TOPIC_A = "fx.chapter-a.topic-a"
TOPIC_B = "fx.chapter-a.topic-b"


# --- pure parts --------------------------------------------------------------------------------------


def test_dropping_groups_by_topic_and_ignores_cards_already_below() -> None:
    recalls = [
        ls.CardRecall("a:1", "t1", 0.95, 0.85),
        ls.CardRecall("a:2", "t1", 0.93, 0.88),
        ls.CardRecall("b:1", "t2", 0.97, 0.80),
        ls.CardRecall("c:1", "t3", 0.85, 0.80),  # already below the target: due, not "dropping"
        ls.CardRecall("d:1", "t4", 0.99, 0.95),  # stays above
    ]
    drops = ls.dropping(recalls, 0.9)
    assert [(d.topic_id, d.cards) for d in drops] == [("t1", 2), ("t2", 1)]
    assert drops[0].min_retrievability == 0.85


def test_interleave_deals_round_robin() -> None:
    order = ls.interleave({"b": ["b1", "b2"], "a": ["a1", "a2", "a3"]}, 5)
    assert order == ["a1", "b1", "a2", "b2", "a3"]
    assert ls.interleave({"a": ["a1"], "b": []}, 3) == ["a1"]


def test_bedtime_estimate_handles_after_midnight() -> None:
    ends = [time(23, 30), time(0, 10), time(23, 50), time(23, 40), time(18, 0)]
    est = ls.estimate(ends, [time(19, 0)] * 5, lookback_days=10)
    assert est.bedtime == time(23, 40)
    # 5 of 10 days had activity; 4 of those 5 ended within an hour of the median.
    assert est.confidence == round(0.5 * 4 / 5, 3)
    assert est.study_hour == time(19, 0)
    assert ls.estimate([], [], 14).bedtime is None


def test_topic_of_card_refs() -> None:
    assert ls.topic_of("fx.chapter-a.topic-a:deep_dive:3", {}) == TOPIC_A
    assert ls.topic_of("custom-card", {}) is None
    assert ls.topic_of("x", {"x": "t9"}) == "t9"


# --- predictive weak-area alerts ----------------------------------------------------------------------


async def _card(services: AppServices, user_id: uuid.UUID, ref: str, last_days: float) -> None:
    now = datetime.now(UTC)
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "insert into learn.srs_cards (user_id, card_ref, state, due_at, stability, difficulty,"
                " reps, last_review_at) values (:u, :r, :st, :due, 5, 5, 3, :last)"
            ),
            {
                "u": user_id,
                "r": ref,
                "st": int(State.Review),
                "due": now + timedelta(days=5 - last_days),
                "last": now - timedelta(days=last_days),
            },
        )


async def test_weak_area_job_queues_one_alert(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await signed_in(client)
    await set_profile(services, s.user_id, age_band="18p")
    # Stability 5 days, last seen 4 days ago: above 90% recall now, below it in 3 days.
    await _card(services, s.user_id, f"{TOPIC_A}:deep_dive:1", 4)
    await _card(services, s.user_id, f"{TOPIC_A}:deep_dive:2", 4)
    await _card(services, s.user_id, f"{TOPIC_B}:deep_dive:1", 4)
    view = (await client.get("/v1/insights/weak-areas", headers=s.headers)).json()
    assert view["horizon_days"] == 3 and view["target_retention"] == 0.9
    assert [(t["topic_id"], t["cards"]) for t in view["topics"]] == [(TOPIC_A, 2), (TOPIC_B, 1)]

    assert await ls.weak_area_alerts(services.db) >= 1
    assert await ls.weak_area_alerts(services.db) == 0  # once a day
    async with services.db.admin_tx() as session:
        alert = (
            await session.execute(
                text("select topic_id, cards from learn.weak_area_alerts where user_id = :u"),
                {"u": s.user_id},
            )
        ).one()
        outbox = (
            await session.execute(
                text("select payload from notify.outbox where user_id = :u and kind = 'weak_area'"),
                {"u": s.user_id},
            )
        ).scalar_one()
    assert (alert.topic_id, alert.cards) == (TOPIC_A, 2)
    assert outbox == {"topic_id": TOPIC_A, "n": 2}


# --- sleep review ------------------------------------------------------------------------------------


async def _evenings(services: AppServices, user_id: uuid.UUID, days: int, at: time) -> None:
    tz = zone("Asia/Kolkata")
    today = datetime.now(tz).date()
    async with services.db.admin_tx() as session:
        await session.execute(
            text("update app.profiles set timezone = 'Asia/Kolkata' where user_id = :u"),
            {"u": user_id},
        )
        for d in range(1, days + 1):
            day = today - timedelta(days=d)
            for when in (time(19, 0), at):
                await session.execute(
                    text(
                        "insert into learn.sync_events (event_id, user_id, type, occurred_at, tz,"
                        " local_day, payload, status) values (:e, :u, 'review_rated', :at,"
                        " 'Asia/Kolkata', :d, '{}', 'applied')"
                    ),
                    {
                        "e": uuid.uuid4(),
                        "u": user_id,
                        "at": datetime.combine(day, when, tz),
                        "d": day,
                    },
                )


async def _prefs(services: AppServices, user_id: uuid.UUID, **cols: Any) -> None:
    sets = ", ".join(f"{k} = :{k}" for k in cols)
    async with services.db.admin_tx() as session:
        await session.execute(
            text(f"update notify.prefs set {sets} where user_id = :u"), {"u": user_id, **cols}
        )


async def test_sleep_review_for_adults_and_fixed_time_for_teens(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await signed_in(client)
    await set_profile(services, s.user_id, age_band="18p")
    await grant_pro(services, s.user_id)
    await _evenings(services, s.user_id, 7, time(22, 30))
    await _card(services, s.user_id, f"{TOPIC_A}:deep_dive:1", 6)
    assert await ls.estimate_rhythms(services.db) >= 1
    async with services.db.admin_tx() as session:
        prefs = (
            await session.execute(
                text(
                    "select estimated_bedtime, bedtime_confidence, usual_study_hour from notify.prefs"
                    " where user_id = :u"
                ),
                {"u": s.user_id},
            )
        ).one()
    assert prefs.estimated_bedtime == time(22, 30) and prefs.usual_study_hour == time(19, 0)
    assert abs(prefs.bedtime_confidence - 0.5) < 1e-6  # 7 of 14 days, all near the median

    r = (await client.get("/v1/insights/sleep-review", headers=s.headers)).json()
    assert r["eligible"] is False and r["reason"] == "off"
    await _prefs(services, s.user_id, sleep_review=True)
    r = (await client.get("/v1/insights/sleep-review", headers=s.headers)).json()
    assert r["reason"] == "threshold_unset"
    async with flags(services, {"notify.sleep_review.min_confidence": 0.4}):
        r = (await client.get("/v1/insights/sleep-review", headers=s.headers)).json()
    assert r["eligible"] is True and r["source"] == "estimate" and r["bedtime"] == "22:30:00"
    assert len(r["cards"]) == 1
    notify_at = datetime.fromisoformat(r["notify_at"]).astimezone(zone("Asia/Kolkata"))
    assert notify_at.time() == time(22, 10)

    teen = await signed_in(client)
    await set_profile(services, teen.user_id, age_band="13_17")
    await grant_pro(services, teen.user_id)
    await _prefs(services, teen.user_id, sleep_review=True)
    r = (await client.get("/v1/insights/sleep-review", headers=teen.headers)).json()
    assert r["reason"] == "pick_a_time"
    async with services.db.admin_tx() as session:
        est = (
            await session.execute(
                text("select estimated_bedtime from notify.prefs where user_id = :u"),
                {"u": teen.user_id},
            )
        ).scalar_one()
    assert est is None  # never inferred for minors (R34)


# --- interleaved practice ------------------------------------------------------------------------------


async def _learned(services: AppServices, s: Session, *topics: str) -> None:
    async with services.db.admin_tx() as session:
        for t in topics:
            await session.execute(
                text(
                    "insert into learn.topic_status (user_id, topic_id, status, learned_via)"
                    " values (:u, :t, 'learned', 'lesson') on conflict do nothing"
                ),
                {"u": s.user_id, "t": t},
            )


async def test_interleaved_builder(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await learner(client, content)
    body = {"group_by": "topic", "count": 6}
    r = await client.post("/v1/practice/interleaved", json=body, headers=s.headers)
    assert r.status_code == 403
    async with flags(services, {"practice.mixed_enabled": True}):
        await _learned(services, s, TOPIC_A)
        r = await client.post("/v1/practice/interleaved", json=body, headers=s.headers)
        assert r.status_code == 409 and r.json()["code"] == "not_enough_variety"
        await _learned(services, s, TOPIC_B)
        # The fixture course has one chapter, so a chapter mix isn't possible yet.
        r = await client.post(
            "/v1/practice/interleaved", json={**body, "group_by": "chapter"}, headers=s.headers
        )
        assert r.json()["groups"] == 1
        sid = str(uuid.uuid4())
        r = await client.post(
            "/v1/practice/interleaved", json={**body, "session_id": sid}, headers=s.headers
        )
        assert r.status_code == 200, r.text
        qs = r.json()["questions"]
        ids = [q["question_id"] for q in qs]
        assert len(ids) == 6
        topics = [q["topic_id"] for q in qs]
        assert all(a != b for a, b in itertools.pairwise(topics))
        again = await client.post(
            "/v1/practice/interleaved", json={**body, "session_id": sid}, headers=s.headers
        )
        assert [q["question_id"] for q in again.json()["questions"]] == ids


# --- calibration ----------------------------------------------------------------------------------------


async def test_calibration_from_real_answers(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await signed_in(client)
    now = datetime.now(UTC)
    answers = [("sure", True)] * 3 + [("sure", False)] + [("guess", True), ("guess", False)]
    async with services.db.admin_tx() as session:
        for i, (conf, ok) in enumerate(answers):
            await session.execute(
                text(
                    "insert into learn.question_attempts (id, user_id, question_id, context, answer,"
                    " is_correct, time_ms, confidence, answered_at) values"
                    " (:id, :u, :q, 'practice', '{}', :ok, 20000, :c, :at)"
                ),
                {
                    "id": uuid.uuid4(),
                    "u": s.user_id,
                    "q": f"q.fx.chapter-a.topic-a.000{i % 5 + 1}",
                    "ok": ok,
                    "c": conf,
                    "at": now - timedelta(minutes=i),
                },
            )
    r = (await client.get("/v1/insights/calibration", headers=s.headers)).json()
    assert r["shown"] is False and r["reason"] == "threshold_unset" and r["tagged"] == 6
    async with flags(services, {"analytics.min_tagged_answers": 10}):
        r = (await client.get("/v1/insights/calibration", headers=s.headers)).json()
        assert r["reason"] == "below_threshold" and r["needed"] == 10
    async with flags(services, {"analytics.min_tagged_answers": 5}):
        r = (await client.get("/v1/insights/calibration", headers=s.headers)).json()
    assert r["shown"] is True
    levels = {lv["confidence"]: lv for lv in r["levels"]}
    assert (levels["sure"]["answers"], levels["sure"]["correct"]) == (4, 3)
    assert levels["fifty"]["accuracy"] is None
    assert r["overconfident"] == 0.25 and r["underconfident"] == 0.5
    assert r["by_subject"][0]["subject_id"] == "fx"
