"""Practice: drill sessions, online answer checks, the free daily count, PYQs, weak spots, the hub
and the daily challenge (docs/flows/practice.md §5)."""

from __future__ import annotations

import uuid

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from tests.helpers import get_state
from tests.practice_helpers import flags, learner, make_pro, opts

TOPIC_A = "fx.chapter-a.topic-a"
Q_A1 = "q.fx.chapter-a.topic-a.0001"  # key c
Q_A2 = "q.fx.chapter-a.topic-a.0002"  # numerical 2.5 m
Q_MOCK_ONLY = "q.fx.chapter-a.topic-c.0004"
Q_DAILY = "q.fx.chapter-a.topic-b.0005"  # key a
PAPER = "fx-exam-2025-s1"


async def test_limits_for_a_new_guest(client: httpx.AsyncClient, content: str) -> None:
    s = await learner(client, content)
    r = await client.get("/v1/practice/limits", headers=s.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_pro"] is False
    assert body["practice_questions"] == {
        "unlimited": False,
        "limit": 30,
        "used": 0,
        "remaining": 30,
        "resets_at": body["practice_questions"]["resets_at"],
    }
    assert body["tutor_messages"]["limit"] == 5
    assert body["sectional_mocks"]["remaining"] == 1


async def test_drill_session_answers_and_mastery(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await learner(client, content)
    sid = str(uuid.uuid4())
    r = await client.post(
        "/v1/practice/sessions",
        json={"session_id": sid, "topic_id": TOPIC_A, "count": 3, "source": "topic"},
        headers=s.headers,
    )
    assert r.status_code == 201, r.text
    session = r.json()
    assert session["kind"] == "drill" and session["size"] == 3
    ids = [q["question_id"] for q in session["questions"]]
    assert all(i.startswith("q.fx.chapter-a.topic-a.") for i in ids)
    assert all(q["bundle_ref"] == f"{TOPIC_A}:practice" for q in session["questions"])
    # Creating it again with the same client id returns the same session.
    again = await client.post(
        "/v1/practice/sessions", json={"session_id": sid, "topic_id": TOPIC_A}, headers=s.headers
    )
    assert [q["question_id"] for q in again.json()["questions"]] == ids

    fixed = await client.post(
        "/v1/practice/sessions",
        json={"question_ids": [Q_A1, Q_A2], "source": "similar_questions"},
        headers=s.headers,
    )
    assert fixed.status_code == 201, fixed.text
    fsid = fixed.json()["id"]
    wrong = await client.post(
        f"/v1/practice/sessions/{fsid}/answers",
        json={"question_id": Q_A1, "answer": opts("b"), "time_ms": 4000, "confidence": "sure"},
        headers=s.headers,
    )
    assert wrong.status_code == 200, wrong.text
    w = wrong.json()
    assert w["check"] == {"correct": False, "partial": 0.0, "response": {"option_ids": ["b"]}}
    assert w["counted"] is True and w["quota"]["used"] == 1
    assert w["solution"]["answer"] == {"option_ids": ["c"]}
    retry = await client.post(
        f"/v1/practice/sessions/{fsid}/answers",
        json={"question_id": Q_A1, "answer": opts("c"), "attempt": 2, "time_ms": 2000},
        headers=s.headers,
    )
    assert retry.json()["check"]["correct"] is True
    assert retry.json()["counted"] is False and retry.json()["quota"]["used"] == 1
    # Only first attempts count for the session's accuracy.
    assert retry.json()["session_answered"] == 1 and retry.json()["session_correct"] == 0

    num = await client.post(
        f"/v1/practice/sessions/{fsid}/answers",
        json={
            "question_id": Q_A2,
            "answer": {"kind": "number", "value": "250", "unit": "cm"},
            "time_ms": 9000,
            "mistake_type": None,
        },
        headers=s.headers,
    )
    assert num.json()["check"]["correct"] is True
    assert num.json()["check"]["response"] == {"value": 250.0, "unit": "cm"}

    async with services.db.admin_tx() as db:
        rows = (
            await db.execute(
                text(
                    "select question_id, context, attempt_no, is_correct, session_id, confidence"
                    " from learn.question_attempts where user_id = :u order by answered_at"
                ),
                {"u": s.user_id},
            )
        ).all()
        mastery = (
            await db.execute(
                text(
                    "select attempts, sure_total from learn.concept_mastery where user_id = :u and concept_id = :c"
                ),
                {"u": s.user_id, "c": "fx.chapter-a.topic-a.sub-1.concept-1"},
            )
        ).one()
    assert [(r.question_id, r.context, r.attempt_no, r.is_correct) for r in rows] == [
        (Q_A1, "drill", 1, False),
        (Q_A1, "drill", 2, True),
        (Q_A2, "drill", 1, True),
    ]
    assert all(str(r.session_id) == fsid for r in rows)
    assert mastery.attempts == 2 and mastery.sure_total == 1

    done = await client.post(f"/v1/practice/sessions/{fsid}/complete", json={}, headers=s.headers)
    assert done.status_code == 200 and done.json()["ended_at"] is not None
    state = await get_state(client, s)
    assert state["wallet"]["xp_total"] > 0
    listed = await client.get("/v1/practice/sessions", headers=s.headers)
    assert {x["id"] for x in listed.json()} == {sid, fsid}


async def test_answers_are_checked_against_the_session(
    client: httpx.AsyncClient, content: str
) -> None:
    s = await learner(client, content)
    r = await client.post("/v1/practice/sessions", json={"question_ids": [Q_A1]}, headers=s.headers)
    sid = r.json()["id"]
    outside = await client.post(
        f"/v1/practice/sessions/{sid}/answers",
        json={"question_id": Q_A2, "answer": opts("a"), "time_ms": 1},
        headers=s.headers,
    )
    assert outside.status_code == 422 and outside.json()["code"] == "question_not_in_session"
    second_first = await client.post(
        f"/v1/practice/sessions/{sid}/answers",
        json={"question_id": Q_A1, "answer": opts("a"), "attempt": 2, "time_ms": 1},
        headers=s.headers,
    )
    assert second_first.json()["code"] == "first_attempt_missing"
    dont_know = await client.post(
        f"/v1/practice/sessions/{sid}/answers",
        json={"question_id": Q_A1, "answer": None, "time_ms": 1},
        headers=s.headers,
    )
    assert dont_know.json()["check"] == {"correct": False, "partial": 0.0, "response": None}
    # Server-only questions (mock and daily keys) can't be drilled.
    mock_only = await client.post(
        "/v1/practice/sessions", json={"question_ids": [Q_MOCK_ONLY]}, headers=s.headers
    )
    assert mock_only.status_code == 422 and mock_only.json()["code"] == "unknown_questions"
    other = await learner(client, content)
    stranger = await client.get(f"/v1/practice/sessions/{sid}", headers=other.headers)
    assert stranger.status_code == 404


async def test_free_daily_count_is_enforced_on_the_server(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await learner(client, content)
    async with flags(services, {"free.practice_questions_per_day": 2}):
        r = await client.post(
            "/v1/practice/sessions", json={"topic_id": TOPIC_A, "count": 5}, headers=s.headers
        )
        session = r.json()
        # Sized up front to what is left today, so it never stops mid-way (X1).
        assert session["size"] == 2 and session["capped_by_free_limit"] is True
        for q in session["questions"]:
            await client.post(
                f"/v1/practice/sessions/{session['id']}/answers",
                json={"question_id": q["question_id"], "answer": None, "time_ms": 10},
                headers=s.headers,
            )
        blocked = await client.post(
            "/v1/practice/sessions", json={"topic_id": TOPIC_A}, headers=s.headers
        )
        assert blocked.status_code == 403
        problem = blocked.json()
        assert problem["code"] == "free_limit_reached"
        assert problem["paywall_trigger"] == "practice_limit" and problem["limit"] == 2
        assert problem["resets_at"]
        # Synced answers from another device count too: the server's count wins.
        limits = (await client.get("/v1/practice/limits", headers=s.headers)).json()
        assert limits["practice_questions"]["remaining"] == 0

        await make_pro(services, s)
        pro = await client.post(
            "/v1/practice/sessions", json={"topic_id": TOPIC_A, "count": 5}, headers=s.headers
        )
        assert pro.status_code == 201 and pro.json()["capped_by_free_limit"] is False
        assert pro.json()["quota"]["unlimited"] is True


async def test_pyq_papers_and_filters(client: httpx.AsyncClient, content: str) -> None:
    s = await learner(client, content)
    papers = await client.get("/v1/pyq/papers", headers=s.headers)
    assert papers.status_code == 200, papers.text
    assert [p["id"] for p in papers.json()] == [PAPER]
    assert papers.json()[0]["question_count"] == 1
    detail = (await client.get(f"/v1/pyq/papers/{PAPER}", headers=s.headers)).json()
    item = detail["items"][0]
    assert item["question_id"] == "q.fx.chapter-a.topic-a.0005" and item["status"] == "not_tried"
    assert item["chapter_id"] == "fx.chapter-a"

    session = await client.post(
        "/v1/practice/sessions", json={"paper_id": PAPER}, headers=s.headers
    )
    assert session.json()["kind"] == "pyq"
    await client.post(
        f"/v1/practice/sessions/{session.json()['id']}/answers",
        json={"question_id": item["question_id"], "answer": opts("b"), "time_ms": 30_000},
        headers=s.headers,
    )
    listed = await client.get(
        "/v1/pyq", params={"status": "correct", "year": 2025}, headers=s.headers
    )
    assert [q["question_id"] for q in listed.json()] == [item["question_id"]]
    none = await client.get("/v1/pyq", params={"difficulty": "easy"}, headers=s.headers)
    assert none.json() == []


async def test_weak_spots_follow_owner_thresholds(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await learner(client, content)
    empty = (await client.get("/v1/practice/weak-spots", headers=s.headers)).json()
    assert empty["items"] == [] and len(empty["unset_thresholds"]) == 4
    r = await client.post("/v1/practice/sessions", json={"question_ids": [Q_A1]}, headers=s.headers)
    await client.post(
        f"/v1/practice/sessions/{r.json()['id']}/answers",
        json={"question_id": Q_A1, "answer": opts("a"), "time_ms": 1, "confidence": "sure"},
        headers=s.headers,
    )
    async with flags(
        services,
        {
            "practice.weak_min_attempts": 1,
            "practice.weak_accuracy_below": 0.6,
            "practice.weak_sure_wrong_min": 1,
        },
    ):
        spots = (await client.get("/v1/practice/weak-spots", headers=s.headers)).json()
        assert spots["unset_thresholds"] == ["practice.weak_recent_mocks"]
        assert [w["concept_id"] for w in spots["items"]] == ["fx.chapter-a.topic-a.sub-1.concept-1"]
        assert spots["items"][0]["reasons"] == ["low_accuracy", "overconfident"]
        assert spots["items"][0]["accuracy"] == 0.0
    async with flags(
        services, {"practice.weak_min_attempts": 5, "practice.weak_accuracy_below": 0.6}
    ):
        more = (await client.get("/v1/practice/weak-spots", headers=s.headers)).json()
        assert more["items"] == [] and more["needs_more_answers"] == 4


async def test_daily_challenge_lifecycle(
    client: httpx.AsyncClient, services: AppServices, content: str
) -> None:
    s = await learner(client, content)
    today = await client.get("/v1/daily-challenge/today", headers=s.headers)
    assert today.status_code == 200, today.text
    ch = today.json()
    assert ch["question"] is None and ch["result"] is None
    hub = (await client.get("/v1/practice/hub", headers=s.headers)).json()
    assert hub["daily_challenge"]["state"] == "not_played"
    assert hub["daily_challenge"]["challenge_id"] == ch["id"]

    early = await client.post(
        f"/v1/daily-challenge/{ch['id']}/answer",
        json={"answer": opts("a"), "client_time_ms": 1000},
        headers=s.headers,
    )
    assert early.status_code == 409 and early.json()["code"] == "challenge_not_started"

    started = (await client.post(f"/v1/daily-challenge/{ch['id']}/start", headers=s.headers)).json()
    assert started["question"]["id"] == Q_DAILY
    assert "answer" not in started["question"] and "solution" not in started["question"]

    answered = await client.post(
        f"/v1/daily-challenge/{ch['id']}/answer",
        json={
            "answer": opts("a"),
            "confidence": "sure",
            "client_time_ms": 4200,
            "tz": "Asia/Kolkata",
        },
        headers=s.headers,
    )
    assert answered.status_code == 200, answered.text
    result = answered.json()["result"]
    assert result["correct"] is True and result["time_ms"] == 4200
    assert result["rank"] is None and result["players"] >= 1  # no threshold set: no ranks
    assert answered.json()["solution"]["answer"] == {"option_ids": ["a"]}

    again = await client.post(
        f"/v1/daily-challenge/{ch['id']}/answer",
        json={"answer": opts("b"), "client_time_ms": 1},
        headers=s.headers,
    )
    assert again.json()["result"]["correct"] is True  # one attempt: the first answer stands

    state = await get_state(client, s)
    assert state["streak"]["today_qualified"] is True and state["streak"]["current"] == 1
    async with services.db.admin_tx() as db:
        attempts = (
            (
                await db.execute(
                    text("select context from learn.question_attempts where user_id = :u"),
                    {"u": s.user_id},
                )
            )
            .scalars()
            .all()
        )
    assert attempts == ["daily"]
    limits = (await client.get("/v1/practice/limits", headers=s.headers)).json()
    assert limits["practice_questions"]["used"] == 0  # the challenge never counts (R25)

    board = (
        await client.get(f"/v1/daily-challenge/{ch['id']}/leaderboard", headers=s.headers)
    ).json()
    assert board["ranked"] is False and board["rows"] == []
    async with flags(services, {"daily.min_players_for_rank": 1}):
        board = (
            await client.get(f"/v1/daily-challenge/{ch['id']}/leaderboard", headers=s.headers)
        ).json()
        assert board["ranked"] is True
        # A guest is never listed for others, but sees their own standing.
        assert all(not r["is_you"] for r in board["rows"])
        assert board["you"]["is_you"] is True and board["you"]["correct"] is True
        mine = (await client.get("/v1/daily-challenge/today", headers=s.headers)).json()
        assert mine["result"]["rank"] is not None


async def test_hub_in_one_call(client: httpx.AsyncClient, content: str) -> None:
    s = await learner(client, content)
    hub = await client.get("/v1/practice/hub", headers=s.headers)
    assert hub.status_code == 200, hub.text
    body = hub.json()
    assert body["exam"] == content
    assert body["limits"]["practice_questions"]["limit"] == 30
    assert body["mock_in_progress"] is None and body["recent_sessions"] == []
    no_exam = await client.post("/v1/dev/auth/anonymous")
    token = no_exam.json()["access_token"]
    r = await client.get("/v1/practice/hub", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 422 and r.json()["code"] == "exam_required"


async def test_drill_preview(client: httpx.AsyncClient, content: str) -> None:
    s = await learner(client, content)
    r = await client.get(
        "/v1/practice/drill",
        params={"concept": "fx.chapter-a.topic-a.sub-1.concept-1", "count": 5},
        headers=s.headers,
    )
    assert r.status_code == 200, r.text
    assert set(r.json()["question_ids"]) == {Q_A1, "q.fx.chapter-a.topic-a.0003"}
