"""Mocks: catalogue, access, the attempt lifecycle, autosave, scoring and the report
(docs/flows/practice.md §6). The paper is built from the published fixture course; the tests
answer with the published keys and write no study content."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services import mocks as mock_service
from tests.conftest import FIXTURE_EXAM
from tests.helpers import Session
from tests.practice_helpers import flags, learner, make_pro

FULL = f"bp:{FIXTURE_EXAM}:paper-1"
SECTION_A = f"{FULL}:section-a"
PYQ = "pyq:fx-exam-2025-s1"


@pytest.fixture(scope="module")
async def blueprint(services: AppServices, content: str) -> AsyncIterator[str]:
    """The fixture blueprint is published as a draft (nobody reviewed it); mocks use only reviewed
    blueprints, so the tests mark it active for this module."""
    async with services.db.admin_tx() as session:
        await session.execute(
            text("update content.exam_blueprints set status = 'active' where exam_profile_id = :e"),
            {"e": content},
        )
    yield content
    async with services.db.admin_tx() as session:
        await session.execute(
            text("update content.exam_blueprints set status = 'draft' where exam_profile_id = :e"),
            {"e": content},
        )


async def _keys(services: AppServices, ids: list[str]) -> dict[str, dict[str, Any]]:
    async with services.db.admin_tx() as session:
        rows = (
            await session.execute(
                text(
                    "select question_id, answer from content.question_keys where question_id = any(:ids)"
                ),
                {"ids": ids},
            )
        ).all()
    return {r.question_id: dict(r.answer) for r in rows}


def _right(key: dict[str, Any]) -> dict[str, Any]:
    if "option_ids" in key:
        return {"kind": "options", "option_ids": key["option_ids"]}
    return {"kind": "number", "value": key["value"], "unit": key.get("unit")}


def _wrong(key: dict[str, Any]) -> dict[str, Any]:
    wrong = next(o for o in ("a", "b", "c", "d") if o not in key["option_ids"])
    return {"kind": "options", "option_ids": [wrong]}


def _row(qid: str, answer: dict[str, Any] | None, **extra: Any) -> dict[str, Any]:
    return {
        "question_id": qid,
        "answer": answer,
        "palette_status": "answered" if answer else "not_answered",
        "time_spent_ms": extra.pop("time_spent_ms", 30_000),
        "visits": 1,
        "client_updated_at": extra.pop("at", datetime.now(UTC).isoformat()),
        **extra,
    }


async def _start(
    client: httpx.AsyncClient, s: Session, mock_id: str, **body: Any
) -> httpx.Response:
    return await client.post(
        f"/v1/mocks/{mock_id}/attempts",
        json={"attempt_id": str(uuid.uuid4()), "language": "en", **body},
        headers=s.headers,
    )


async def test_catalogue_and_detail(client: httpx.AsyncClient, blueprint: str) -> None:
    s = await learner(client, blueprint)
    cards = {c["id"]: c for c in (await client.get("/v1/mocks", headers=s.headers)).json()}
    full = cards[FULL]
    assert full["kind"] == "full" and full["duration_min"] == 30 and full["question_count"] == 6
    assert full["max_marks"] == 24 and full["ranked"] is False
    # Free: no sample full mock is published, so the blueprint full mock is Pro.
    assert full["access"] == {
        "allowed": False,
        "paywall_trigger": "mock_limit",
        "paywall_source": "mock_lock",
        "reason": None,
    }
    sec = cards[SECTION_A]
    assert sec["kind"] == "sectional" and sec["access"]["allowed"] is True
    # A sectional mock without its own timer gets the blueprint's pace: 30 min x 4/6 → 20 min.
    assert sec["duration_min"] == 20 and sec["question_count"] == 4
    assert cards[PYQ]["kind"] == "pyq_paper" and cards[PYQ]["ranked"] is True
    assert cards[PYQ]["access"]["paywall_source"] == "pyq_paper"

    detail = (await client.get(f"/v1/mocks/{FULL}", headers=s.headers)).json()
    assert [x["code"] for x in detail["sections"]] == ["section-a", "section-b"]
    assert detail["sections"][1]["marking"]["mcq_multi"]["partial"] == {
        "requires_no_wrong": True,
        "per_correct_option": 1,
    }
    assert detail["source"]["url"].startswith("https://")
    assert detail["marked_answer_evaluated"] is True and detail["past_attempts"] == []
    r = await client.get("/v1/mocks/bp:nope:paper-9", headers=s.headers)
    assert r.status_code == 404


async def test_full_mock_scoring_report_and_solutions(
    client: httpx.AsyncClient, services: AppServices, blueprint: str
) -> None:
    s = await learner(client, blueprint)
    r = await _start(client, s, FULL)
    assert r.status_code == 403 and r.json()["code"] == "pro_required"
    await make_pro(services, s)
    r = await _start(client, s, FULL, time_policy="strict")
    assert r.status_code == 201, r.text
    attempt = r.json()
    aid = attempt["id"]
    assert attempt["status"] == "in_progress" and attempt["time_policy"] == "strict"
    assert attempt["remaining_ms"] > 29 * 60 * 1000
    questions = attempt["questions"]
    assert len(questions) == 6
    for q in questions:
        assert "answer" not in q["body"] and "solution" not in q["body"]
    by_section: dict[str, list[dict[str, Any]]] = {}
    for q in questions:
        by_section.setdefault(q["section_code"], []).append(q)
    a_ids = [q["question_id"] for q in by_section["section-a"]]
    b = {q["type"]: q["question_id"] for q in by_section["section-b"]}
    keys = await _keys(services, a_ids + list(b.values()))

    rows = [
        _row(a_ids[0], _right(keys[a_ids[0]]), confidence="sure"),
        _row(a_ids[1], _right(keys[a_ids[1]]), confidence="guess"),
        _row(a_ids[2], _wrong(keys[a_ids[2]]), confidence="fifty_fifty", time_spent_ms=5_000),
        _row(a_ids[3], None),
        # Within the question's tolerance (key 2.5 m, ±0.1).
        _row(b["numerical"], {"kind": "number", "value": "2.55", "unit": "m"}),
        # Two of three right options and no wrong one: partial marking, 1 per correct option.
        _row(
            b["mcq_multi"],
            {"kind": "options", "option_ids": keys[b["mcq_multi"]]["option_ids"][:2]},
        ),
    ]
    r = await client.put(f"/v1/attempts/{aid}/answers", json={"answers": rows}, headers=s.headers)
    assert r.status_code == 200, r.text
    saved = r.json()
    assert sorted(saved["saved"]) == sorted(x["question_id"] for x in rows)
    assert saved["rejected"] == [] and saved["status"] == "in_progress"

    r = await client.post(
        f"/v1/attempts/{aid}/submit", headers={**s.headers, "Idempotency-Key": "submit-1"}
    )
    assert r.status_code == 200, r.text
    report = r.json()
    # 4 + 4 - 1 + 0 (section A) + 4 (numerical) + 2 (partial) = 13 of 24.
    assert report["score"] == 13 and report["max_score"] == 24
    assert report["locked"] == [] and report["status"] == "submitted"
    assert report["accuracy"] == 60  # 3 right of 5 attempted
    assert report["time_lost_wrong_ms"] == 5_000 + 30_000  # the wrong one and the partial one
    assert report["standing"] == {
        "shown": False,
        "percentile": None,
        "rank": None,
        "of": None,
        "counted": None,
        "needed": None,
        "reason": "personal_paper",
    }
    statuses = {q["question_id"]: q["status"] for q in report["questions"]}
    assert statuses[a_ids[3]] == "skipped" and statuses[b["mcq_multi"]] == "partial"
    sections = {x["code"]: x for x in report["sections"]}
    assert sections["section-a"]["marks"] == 7 and sections["section-b"]["marks"] == 6
    conf = {c["confidence"]: c for c in report["confidence"]}
    assert conf["guess"]["correct"] == 1 and conf["fifty_fifty"]["wrong"] == 1
    assert report["time_buckets"]["lucky_guesses"] == 1
    assert report["fix_next"] and report["fix_next"][0]["marks_lost"] > 0

    again = await client.post(
        f"/v1/attempts/{aid}/submit", headers={**s.headers, "Idempotency-Key": "submit-2"}
    )
    assert again.json()["score"] == 13
    r = await client.put(
        f"/v1/attempts/{aid}/answers", json={"answers": rows[:1]}, headers=s.headers
    )
    assert r.status_code == 409 and r.json()["code"] == "attempt_closed"

    sol = (await client.get(f"/v1/attempts/{aid}/solutions?locale=en", headers=s.headers)).json()
    assert len(sol["items"]) == 6
    first = next(i for i in sol["items"] if i["question_id"] == a_ids[0])
    assert first["solution"]["answer"] == keys[a_ids[0]] and first["status"] == "correct"

    # Both sections qualify today and pay XP once (R1), whoever records them first.
    async with services.db.admin_tx() as session:
        n = (
            await session.execute(
                text(
                    "select count(*) from learn.sync_events where user_id = :u"
                    " and type = 'mock_section_submitted' and status = 'applied'"
                ),
                {"u": s.user_id},
            )
        ).scalar_one()
        day = (
            await session.execute(
                text("select mock_sections, qualified from learn.activity_days where user_id = :u"),
                {"u": s.user_id},
            )
        ).one()
    assert n == 2 and day.mock_sections == 2 and day.qualified
    dup = await client.post(
        "/v1/sync/events",
        json={
            "device_id": str(s.device_id),
            "events": [
                {
                    "event_id": str(uuid.uuid4()),
                    "type": "mock_section_submitted",
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "tz": "Asia/Kolkata",
                    "payload": {"attempt_id": aid, "section_code": "section-a"},
                }
            ],
        },
        headers=s.headers,
    )
    assert dup.json()["rejected"][0]["code"] == "already_recorded"

    history = (await client.get("/v1/attempts", headers=s.headers)).json()
    assert history[0]["id"] == aid and history[0]["score"] == 13


async def test_autosave_rules(
    client: httpx.AsyncClient, services: AppServices, blueprint: str
) -> None:
    s = await learner(client, blueprint)
    attempt = (await _start(client, s, SECTION_A)).json()
    aid = attempt["id"]
    assert attempt["kind"] == "sectional" and len(attempt["questions"]) == 4
    assert attempt["section_navigation"] == "free"
    q1 = attempt["questions"][0]["question_id"]
    now = datetime.now(UTC)
    newer = _row(q1, {"kind": "options", "option_ids": ["a"]}, at=now.isoformat())
    older = _row(
        q1, {"kind": "options", "option_ids": ["b"]}, at=(now - timedelta(seconds=5)).isoformat()
    )
    r = await client.put(
        f"/v1/attempts/{aid}/answers", json={"answers": [newer]}, headers=s.headers
    )
    assert r.json()["saved"] == [q1]
    r = await client.put(
        f"/v1/attempts/{aid}/answers", json={"answers": [older]}, headers=s.headers
    )
    assert r.json()["kept_newer"] == [q1]
    late = (now + timedelta(hours=2)).isoformat()
    r = await client.put(
        f"/v1/attempts/{aid}/answers",
        json={
            "answers": [
                _row("q.not.here", None),
                _row(q1, {"kind": "number", "value": 3}),
                _row(q1, {"kind": "options", "option_ids": ["c"]}, at=late),
                # No answer can't be "answered": the palette becomes "not answered".
                _row(attempt["questions"][1]["question_id"], None, palette_status="answered"),
            ]
        },
        headers=s.headers,
    )
    body = r.json()
    codes = {(x["question_id"], x["code"]) for x in body["rejected"]}
    assert codes == {("q.not.here", "not_in_paper"), (q1, "invalid_answer"), (q1, "clock_skew")}
    view = (await client.get(f"/v1/attempts/{aid}", headers=s.headers)).json()
    saved = {q["question_id"]: q["saved"] for q in view["questions"]}
    assert saved[q1]["answer"]["option_ids"] == ["a"]
    assert saved[attempt["questions"][1]["question_id"]]["palette_status"] == "not_answered"

    # Another device can't write until it takes over (one device at a time, practice §6.6).
    other = {**s.headers, "X-Device-Id": str(uuid.uuid4())}
    r = await client.put(f"/v1/attempts/{aid}/answers", json={"answers": [newer]}, headers=other)
    assert r.status_code == 409 and r.json()["code"] == "other_device"
    assert (await client.get(f"/v1/attempts/{aid}", headers=other)).json()[
        "active_device"
    ] == "other"
    r = await client.post(f"/v1/attempts/{aid}/takeover", headers=other)
    assert r.json()["active_device"] == "this"
    r = await client.put(
        f"/v1/attempts/{aid}/answers", json={"answers": [newer]}, headers=s.headers
    )
    assert r.json()["code"] == "other_device"


async def test_sectional_quota_refund_and_one_at_a_time(
    client: httpx.AsyncClient, services: AppServices, blueprint: str
) -> None:
    s = await learner(client, blueprint)
    first = (await _start(client, s, SECTION_A)).json()
    r = await _start(client, s, f"{FULL}:section-b")
    assert r.status_code == 409 and r.json()["code"] == "mock_in_progress"
    assert r.json()["attempt_id"] == first["id"]
    r = await client.post(f"/v1/attempts/{first['id']}/abandon", headers=s.headers)
    assert r.json()["status"] == "abandoned"
    r = await client.get(f"/v1/attempts/{first['id']}/report", headers=s.headers)
    assert r.json()["code"] == "report_not_ready"
    # One sectional a week (R25); an abandoned one is refunded only within the owner's grace.
    r = await _start(client, s, f"{FULL}:section-b")
    assert r.status_code == 403 and r.json()["code"] == "free_limit_reached"
    assert r.json()["paywall_trigger"] == "mock_limit"
    async with flags(services, {"mock.free_grace_min": 10}):
        r = await _start(client, s, f"{FULL}:section-b")
        assert r.status_code == 201, r.text
        assert r.json()["questions"][0]["section_code"] == "section-b"
    limits = (await client.get("/v1/practice/limits", headers=s.headers)).json()
    assert limits["sectional_mocks"]["used"] == 2


async def test_strict_timer_auto_submits_after_the_deadline(
    client: httpx.AsyncClient, services: AppServices, blueprint: str
) -> None:
    s = await learner(client, blueprint)
    attempt = (await _start(client, s, SECTION_A, time_policy="strict")).json()
    aid = attempt["id"]
    async with services.db.admin_tx() as session:
        # The paper started 21 minutes ago (a 20-minute section): its time is over.
        await session.execute(
            text(
                "update learn.mock_attempts set started_at = started_at - interval '21 minutes',"
                " server_deadline_at = server_deadline_at - interval '21 minutes' where id = :id"
            ),
            {"id": aid},
        )
    r = await client.post(f"/v1/attempts/{aid}/pause", json={}, headers=s.headers)
    assert r.json()["code"] == "attempt_closed"  # the read settles the timer first
    view = (await client.get(f"/v1/attempts/{aid}", headers=s.headers)).json()
    assert view["status"] == "auto_submitted" and view["remaining_ms"] == 0
    report = (await client.get(f"/v1/attempts/{aid}/report", headers=s.headers)).json()
    assert report["status"] == "auto_submitted" and report["score"] == 0
    assert report["summary"]["skipped"] == 4


async def test_auto_submit_job(
    client: httpx.AsyncClient, services: AppServices, blueprint: str
) -> None:
    s = await learner(client, blueprint)
    aid = (await _start(client, s, SECTION_A, time_policy="strict")).json()["id"]
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "update learn.mock_attempts set server_deadline_at = now() - interval '1 minute'"
                " where id = :id"
            ),
            {"id": aid},
        )
    assert await mock_service.auto_submit_expired(services.db) >= 1
    view = (await client.get(f"/v1/attempts/{aid}", headers=s.headers)).json()
    assert view["status"] == "auto_submitted"


async def test_practice_pause_and_resume(
    client: httpx.AsyncClient, services: AppServices, blueprint: str
) -> None:
    s = await learner(client, blueprint)
    attempt = (await _start(client, s, SECTION_A)).json()
    aid = attempt["id"]
    deadline = datetime.fromisoformat(attempt["server_deadline_at"])
    paused = (await client.post(f"/v1/attempts/{aid}/pause", json={}, headers=s.headers)).json()
    assert paused["paused"] is True
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "update learn.mock_attempts set paused_at = paused_at - interval '5 minutes' where id = :id"
            ),
            {"id": aid},
        )
    resumed = (await client.post(f"/v1/attempts/{aid}/resume", headers=s.headers)).json()
    assert resumed["paused"] is False and resumed["pause_count"] == 1
    moved = datetime.fromisoformat(resumed["server_deadline_at"]) - deadline
    assert timedelta(minutes=5) <= moved < timedelta(minutes=6)
    assert resumed["paused_ms"] >= 300_000

    # An interruption: past the deadline with no pause recorded, a practice attempt waits.
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "update learn.mock_attempts set server_deadline_at = now() - interval '1 minute',"
                " last_saved_at = now() - interval '10 minutes' where id = :id"
            ),
            {"id": aid},
        )
    view = (await client.get(f"/v1/attempts/{aid}", headers=s.headers)).json()
    assert view["status"] == "in_progress" and view["paused"] is True and view["remaining_ms"] > 0
    resumed = (await client.post(f"/v1/attempts/{aid}/resume", headers=s.headers)).json()
    assert resumed["pause_count"] == 2
    assert datetime.fromisoformat(resumed["server_deadline_at"]) > datetime.now(UTC)
    submitted = await client.post(f"/v1/attempts/{aid}/submit", headers=s.headers)
    assert submitted.json()["summary"]["pause_count"] == 2

    await make_pro(services, s)
    strict = (await _start(client, s, SECTION_A, time_policy="strict")).json()
    r = await client.post(f"/v1/attempts/{strict['id']}/pause", json={}, headers=s.headers)
    assert r.status_code == 409 and r.json()["code"] == "pause_not_allowed"


async def test_pyq_paper_mock_and_percentile(
    client: httpx.AsyncClient, services: AppServices, blueprint: str
) -> None:
    s = await learner(client, blueprint)
    r = await _start(client, s, PYQ)
    assert r.status_code == 403 and r.json()["paywall_source"] == "pyq_paper"
    async with flags(services, {"free.pyq_papers_free": ["fx-exam-2025-s1"]}):
        attempt = (await _start(client, s, PYQ)).json()
    qids = [q["question_id"] for q in attempt["questions"]]
    assert qids == ["q.fx.chapter-a.topic-a.0005"]
    keys = await _keys(services, qids)
    await client.put(
        f"/v1/attempts/{attempt['id']}/answers",
        json={"answers": [_row(qids[0], _right(keys[qids[0]]))]},
        headers=s.headers,
    )
    report = (await client.post(f"/v1/attempts/{attempt['id']}/submit", headers=s.headers)).json()
    assert report["score"] == 4 and report["standing"]["reason"] == "threshold_unset"
    # Free: the deeper sections are inline locked rows (R25).
    assert {"time_analysis", "concept_heatmap", "confidence"} <= set(report["locked"])
    assert report["questions"] is None and report["concepts"] is None
    assert report["fix_next"] == []
    async with flags(services, {"mock.min_attempts_for_percentile": 1}):
        report = (
            await client.get(f"/v1/attempts/{attempt['id']}/report", headers=s.headers)
        ).json()
        standing = report["standing"]
        assert standing["shown"] is True and standing["rank"] >= 1
        assert standing["of"] == standing["counted"] >= 1 and 0 < standing["percentile"] <= 100
        async with flags(services, {"free.pyq_papers_free": ["fx-exam-2025-s1"]}):
            second = (await _start(client, s, PYQ)).json()
        assert second["attempt_no"] == 2
        report = (
            await client.post(f"/v1/attempts/{second['id']}/submit", headers=s.headers)
        ).json()
        assert report["standing"]["reason"] == "not_first_attempt"
    async with flags(services, {"mock.min_attempts_for_percentile": 100000}):
        report = (
            await client.get(f"/v1/attempts/{attempt['id']}/report", headers=s.headers)
        ).json()
        assert report["standing"]["reason"] == "below_threshold"
        assert report["standing"]["needed"] == 100000


async def test_generated_mocks(
    client: httpx.AsyncClient, services: AppServices, blueprint: str
) -> None:
    s = await learner(client, blueprint)
    body = {
        "attempt_id": str(uuid.uuid4()),
        "kind": "custom",
        "concepts": ["fx.chapter-a.topic-a.c1"],
        "question_count": 3,
        "language": "en",
    }
    r = await client.post("/v1/mocks/generate", json=body, headers=s.headers)
    assert r.status_code == 403 and r.json()["paywall_source"] == "custom_mock"
    chapter = await client.post(
        "/v1/mocks/generate",
        json={
            "attempt_id": str(uuid.uuid4()),
            "kind": "chapter",
            "chapter_id": "fx.chapter-a",
            "question_count": 5,
            "language": "en",
        },
        headers=s.headers,
    )
    assert chapter.status_code == 201, chapter.text
    c = chapter.json()
    assert c["kind"] == "chapter" and c["mock_id"] is None and len(c["questions"]) == 5
    # The blueprint's pace: 5 questions x 30 min / 6 → 25 min.
    duration = datetime.fromisoformat(c["server_deadline_at"]) - datetime.fromisoformat(
        c["started_at"]
    )
    assert duration == timedelta(minutes=25)
    await client.post(f"/v1/attempts/{c['id']}/submit", headers=s.headers)

    await make_pro(services, s)
    concepts = await _a_concept(services)
    r = await client.post(
        "/v1/mocks/generate", json={**body, "concepts": concepts}, headers=s.headers
    )
    assert r.status_code == 201, r.text
    g = r.json()
    assert g["kind"] == "custom" and 1 <= len(g["questions"]) <= 3
    r = await client.post(
        "/v1/mocks/generate",
        json={**body, "attempt_id": str(uuid.uuid4()), "concepts": None},
        headers=s.headers,
    )
    assert r.status_code == 422


async def _a_concept(services: AppServices) -> list[str]:
    async with services.db.admin_tx() as session:
        cid = (
            await session.execute(
                text(
                    "select concept_id from content.question_concepts"
                    " where question_id = 'q.fx.chapter-a.topic-a.0001' limit 1"
                )
            )
        ).scalar_one()
    return [str(cid)]


async def test_submitted_mock_answers_update_mastery_once(
    client: httpx.AsyncClient, services: AppServices, blueprint: str
) -> None:
    """Sync v1.3: a submitted attempt's scored answers become ``context: mock`` question attempts,
    once, and update concept mastery; skipped questions don't."""
    s = await learner(client, blueprint)
    attempt = (await _start(client, s, SECTION_A)).json()
    aid = attempt["id"]
    qids = [q["question_id"] for q in attempt["questions"]]
    keys = await _keys(services, qids)
    rows = [
        _row(qids[0], _right(keys[qids[0]])),
        _row(qids[1], _wrong(keys[qids[1]])),
        _row(qids[2], None),
    ]
    await client.put(f"/v1/attempts/{aid}/answers", json={"answers": rows}, headers=s.headers)

    def mock_answer(qid: str) -> dict[str, Any]:
        return {
            "event_id": str(uuid.uuid4()),
            "type": "answer_submitted",
            "occurred_at": datetime.now(UTC).isoformat(),
            "tz": "Asia/Kolkata",
            "payload": {
                "question_id": qid,
                "context": "mock",
                "attempt_id": aid,
                "correct": True,
                "ms_to_answer": 1000,
            },
        }

    early = await client.post(
        "/v1/sync/events",
        json={"device_id": str(s.device_id), "events": [mock_answer(qids[0])]},
        headers=s.headers,
    )
    assert early.json()["rejected"][0]["code"] == "invalid_payload"

    r = await client.post(f"/v1/attempts/{aid}/submit", headers=s.headers)
    assert r.status_code == 200, r.text
    await client.post(f"/v1/attempts/{aid}/submit", headers=s.headers)
    await client.get(f"/v1/attempts/{aid}/report", headers=s.headers)

    async def recorded() -> list[Any]:
        async with services.db.admin_tx() as session:
            return list(
                (
                    await session.execute(
                        text(
                            "select question_id, is_correct, session_id from learn.question_attempts"
                            " where user_id = :u and context = 'mock' order by question_id"
                        ),
                        {"u": s.user_id},
                    )
                ).all()
            )

    rows_now = await recorded()
    assert sorted((r.question_id, r.is_correct) for r in rows_now) == sorted(
        [(qids[0], True), (qids[1], False)]
    )
    assert all(str(r.session_id) == aid for r in rows_now)
    async with services.db.admin_tx() as session:
        attempts = (
            await session.execute(
                text(
                    "select coalesce(sum(attempts), 0) from learn.concept_mastery where user_id = :u"
                ),
                {"u": s.user_id},
            )
        ).scalar_one()
    assert attempts >= 2

    dup = await client.post(
        "/v1/sync/events",
        json={"device_id": str(s.device_id), "events": [mock_answer(qids[0])]},
        headers=s.headers,
    )
    assert dup.json()["rejected"][0]["code"] == "already_recorded"
    assert len(await recorded()) == 2


def test_locked_sections_follow_their_timers() -> None:
    """Section locking (practice §6.8) on a synthetic two-section paper with timers."""
    start = datetime(2026, 10, 30, 10, 0, tzinfo=UTC)
    paper = {
        "navigation": "locked_in_order",
        "sections": [
            {"code": "s1", "timer_s": 600, "questions": []},
            {"code": "s2", "timer_s": 900, "questions": []},
        ],
    }
    state = mock_service._initial_state(paper, start)
    assert state["current"] == "s1"
    assert state["sections"]["s2"]["opened_at"] is None
    row = type("Row", (), {"time_policy": "strict", "id": uuid.uuid4()})()
    a = mock_service._Attempt(
        row=row,
        paper=paper,
        state=state,
        deadline=start + timedelta(minutes=25),
        paused_at=None,
        paused_ms=0,
        pause_count=0,
        status="in_progress",
    )
    assert mock_service._advance(a, start + timedelta(minutes=9)) == []
    # Ten minutes in, s1 closes and s2 opens at that instant; time doesn't wait.
    assert mock_service._advance(a, start + timedelta(minutes=12)) == ["s1"]
    assert a.state["current"] == "s2"
    assert a.state["sections"]["s2"]["opened_at"] == (start + timedelta(minutes=10)).isoformat()
    assert a.state["sections"]["s2"]["closes_at"] == (start + timedelta(minutes=25)).isoformat()
    assert mock_service._advance(a, start + timedelta(minutes=26)) == ["s2"]
    assert a.state["current"] is None
    assert mock_service._due(a, start + timedelta(minutes=26), timedelta(0))
