"""PRC-14 cards (practice flow §5.6; R58): readiness, speed, confidence and mistake types from
the learner's own rows only, with nulls and a reason below each threshold flag."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from tests.helpers import Session
from tests.practice_helpers import flags, learner

Q1 = "q.fx.chapter-a.topic-a.0001"
Q2 = "q.fx.chapter-a.topic-a.0002"
Q3 = "q.fx.chapter-a.topic-d.0001"
THRESHOLDS = {
    "analytics.min_concepts_for_readiness": 2,
    "analytics.min_answers_total": 3,
    "analytics.min_tagged_answers": 3,
}


async def attempt(
    services: AppServices,
    s: Session,
    question: str,
    *,
    correct: bool,
    ms: int,
    confidence: str | None = None,
    mistake: str | None = None,
    context: str = "practice",
    days_ago: int = 0,
) -> None:
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "insert into learn.question_attempts (id, user_id, question_id, context, answer,"
                " is_correct, time_ms, confidence, mistake_type, answered_at)"
                " values (:id, :u, :q, :ctx, '{}', :ok, :ms, :c, :m, :at)"
            ),
            {
                "id": uuid.uuid4(),
                "u": s.user_id,
                "q": question,
                "ctx": context,
                "ok": correct,
                "ms": ms,
                "c": confidence,
                "m": mistake,
                "at": datetime.now(UTC) - timedelta(days=days_ago),
            },
        )


async def mastery(services: AppServices, s: Session, concept: str, value: float) -> None:
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "insert into learn.concept_mastery (user_id, concept_id, mastery, attempts, correct)"
                " values (:u, :c, :m, 1, 1)"
            ),
            {"u": s.user_id, "c": concept, "m": value},
        )


async def summary(client: httpx.AsyncClient, s: Session, **params: str) -> dict[str, Any]:
    r = await client.get("/v1/analytics/summary", params=params, headers=s.headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


async def test_empty_and_unset_thresholds(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await learner(client, content)
    async with flags(services, {k: None for k in THRESHOLDS}):
        out = await summary(client, s)
    assert out["exam_profile_id"] == content and out["period"] == "30d"
    for card in ("readiness", "speed", "confidence"):
        assert out[card]["shown"] is False and out[card]["reason"] == "threshold_unset"
    assert out["readiness"]["percent"] is None and out["readiness"]["total"] == 8
    assert out["speed"]["avg_ms"] is None and out["confidence"]["levels"] is None
    assert out["mistakes"] == {
        "shown": False,
        "reason": "not_enough_data",
        "have": 0,
        "needed": 1,
        "counts": None,
    }
    async with flags(services, THRESHOLDS):
        out = await summary(client, s)
    assert out["readiness"]["reason"] == "not_enough_data"
    assert (out["readiness"]["have"], out["readiness"]["needed"]) == (0, 2)
    assert (out["speed"]["have"], out["speed"]["needed"]) == (0, 3)
    r = await client.get("/v1/analytics/summary", params={"exam": "nope"}, headers=s.headers)
    assert r.status_code == 404


async def test_cards_from_real_rows(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await learner(client, content)
    other = await learner(client, content)
    # Ideal time is 60 s for these fixture questions.
    await attempt(services, s, Q1, correct=True, ms=30_000, confidence="sure")
    await attempt(services, s, Q2, correct=True, ms=90_000, confidence="sure")
    await attempt(
        services, s, Q3, correct=False, ms=20_000, confidence="guess", mistake="calculation"
    )
    # Not counted: a later attempt mirrored from a mock, another learner, and (for 30 days)
    # an old answer.
    await attempt(services, s, Q1, correct=False, ms=5_000, confidence="sure", context="mock")
    await attempt(services, other, Q1, correct=False, ms=1_000, confidence="guess")
    await attempt(
        services, s, Q2, correct=True, ms=60_000, confidence="guess", mistake="silly", days_ago=40
    )
    await mastery(services, s, "fx.chapter-a.topic-a.sub-1.concept-1", 0.8)
    await mastery(services, s, "fx.chapter-a.topic-a.sub-1.concept-2", 0.4)

    async with flags(services, THRESHOLDS):
        out = await summary(client, s, period="30d")
        everything = await summary(client, s, period="all")
    ready = out["readiness"]
    # Equal weights (no weightage yet): (0.8 + 0.4) over 8 concepts.
    assert (ready["shown"], ready["percent"], ready["practised"], ready["total"]) == (
        True,
        15,
        2,
        8,
    )
    assert ready["weighted"] is False
    speed = out["speed"]
    assert (speed["have"], speed["avg_ms"], speed["target_ms"]) == (3, 46_667, 60_000)
    assert (speed["right_but_slow"], speed["fast_and_wrong"]) == (1, 1)
    conf = out["confidence"]
    assert conf["shown"] is True and conf["lucky_guesses"] == 0
    assert [(lv["confidence"], lv["answers"], lv["accuracy"]) for lv in conf["levels"]] == [
        ("sure", 2, 1.0),
        ("fifty", 0, None),
        ("guess", 1, 0.0),
    ]
    counts = {c["type"]: c["count"] for c in out["mistakes"]["counts"]}
    assert counts == {"conceptual": 0, "calculation": 1, "misread": 0, "silly": 0, "time": 0}

    # All time adds the old answer: a lucky guess and a silly slip.
    assert everything["speed"]["have"] == 4
    assert everything["confidence"]["lucky_guesses"] == 1
    assert {c["type"]: c["count"] for c in everything["mistakes"]["counts"]}["silly"] == 1
    # Readiness ignores the period.
    assert everything["readiness"]["percent"] == 15
