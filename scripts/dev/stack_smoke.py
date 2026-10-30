"""A scripted HTTP journey against a running local stack (``pnpm stack:smoke``, docs/LOCAL_DEV.md).

guest → onboarding answers → a real Current Electricity bundle from the manifest → lesson events
→ streak 1 → Google sign-in (dev) → practice drill on real questions → tutor message → Pro through
the fake Razorpay webhook. Every step checks the server's answer; the first failure exits 1.

    STACK_API_URL=http://127.0.0.1:8000 uv run --project apps/api python scripts/dev/stack_smoke.py

No study content is written here: the lesson and the questions come from the published bundles,
and the answers come from those bundles' own answer keys.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from smriti_api.integrations import DEV_RAZORPAY_WEBHOOK_SECRET

API = os.environ.get("STACK_API_URL", "http://127.0.0.1:8000").rstrip("/")
WEB = os.environ.get("STACK_WEB_URL", "").rstrip("/")
EXAM = os.environ.get("STACK_EXAM", "jee-main-2027")
CHAPTER = "phy.current-electricity."
TZ = "Asia/Kolkata"


class SmokeFailed(Exception):
    pass


def step(name: str) -> None:
    print(f"  - {name}", flush=True)


def check(cond: bool, what: str) -> None:
    if not cond:
        raise SmokeFailed(what)


class Client:
    def __init__(self, http: httpx.Client) -> None:
        self.http = http
        self.token = ""
        self.user_id = ""
        self.device_id = str(uuid.uuid4())

    def headers(self, **extra: str) -> dict[str, str]:
        h = {
            "X-Device-Id": self.device_id,
            "X-App-Variant": "jee",
            "X-Platform": "web",
            "X-App-Version": "1.0.0",
            **extra,
        }
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def call(self, method: str, path: str, expect: int = 200, **kw: Any) -> Any:
        extra = kw.pop("extra_headers", {})
        r = self.http.request(method, f"{API}{path}", headers=self.headers(**extra), **kw)
        if r.status_code != expect:
            raise SmokeFailed(f"{method} {path}: {r.status_code} {r.text[:300]}")
        if not r.content:
            return None
        ctype = r.headers.get("content-type", "")
        return r.json() if "json" in ctype else r.text

    def events(self, *events: tuple[str, dict[str, Any]]) -> dict[str, Any]:
        body = {
            "device_id": self.device_id,
            "events": [
                {
                    "event_id": str(uuid.uuid4()),
                    "type": kind,
                    "occurred_at": datetime.now(UTC).isoformat(),
                    "tz": TZ,
                    "payload": payload,
                }
                for kind, payload in events
            ],
        }
        out: dict[str, Any] = self.call("POST", "/v1/sync/events", json=body)
        rejected = out.get("rejected") or []
        check(not rejected, f"sync rejected events: {rejected}")
        return out


def idem() -> dict[str, str]:
    return {"Idempotency-Key": f"smoke-{uuid.uuid4().hex}"}


def journey(c: Client) -> None:
    step("guest session")
    s = c.call("POST", "/v1/dev/auth/anonymous")
    c.token, c.user_id = s["access_token"], s["user"]["id"]
    check(s["user"]["is_anonymous"] is True, "the first session is a guest")
    c.call("GET", "/v1/config")

    step("onboarding answers")
    c.events(
        ("onboarding_answer", {"step": "goal", "value": EXAM}),
        ("onboarding_answer", {"step": "class", "value": 12}),
        ("onboarding_answer", {"step": "birth_year", "value": 2006}),
        ("onboarding_answer", {"step": "level", "value": "basics"}),
        ("onboarding_answer", {"step": "daily_goal", "value": 10}),
    )
    state = c.call("GET", "/v1/sync/state")
    check(state["profile"]["primary_exam_profile_id"] == EXAM, "onboarding set the exam")

    step("Current Electricity bundle from the manifest")
    m = c.call("GET", f"/v1/content/manifest?exam={EXAM}&locale=en")
    manifest = m.get("manifest") or c.http.get(m["url"]).json()
    base = (m.get("base_url") or "").rstrip("/")
    topics = sorted(t for t in manifest["topics"] if t.startswith(CHAPTER))
    check(bool(topics), f"no {CHAPTER} topics in the {EXAM} manifest")
    topic = next(
        (t for t in topics if manifest["topics"][t]["bundles"].get("quick_revision")), topics[0]
    )
    entry = manifest["topics"][topic]["bundles"]["quick_revision"]
    r = c.http.get(f"{base}/{entry['path']}")
    check(r.status_code == 200, f"bundle {entry['path']}: {r.status_code}")
    check(
        hashlib.sha256(r.content).hexdigest() == entry["hash"],
        "the bundle's bytes match its manifest hash",
    )
    bundle = r.json()
    cards = bundle.get("cards") or []
    check(
        (bundle.get("topic") or {}).get("id") == topic and len(cards) > 0,
        "the bundle has cards for the topic",
    )

    step(f"lesson events ({topic}, {len(cards)} cards)")
    c.events(
        (
            "lesson_started",
            {
                "topic_id": topic,
                "mode": "quick_revision",
                "bundle_version": entry["hash"],
                "locale": "en",
            },
        ),
        *[
            (
                "lesson_card_viewed",
                {"topic_id": topic, "card_id": card["id"], "index": i, "ms_on_card": 4000},
            )
            for i, card in enumerate(cards)
        ],
        (
            "lesson_completed",
            {
                "topic_id": topic,
                "mode": "quick_revision",
                "cards_seen": len(cards),
                "correct": 0,
                "total": 0,
                "ms_total": 4000 * len(cards),
            },
        ),
    )

    step("streak 1")
    state = c.call("GET", "/v1/sync/state")
    check(state["streak"]["current"] == 1, f"streak is {state['streak']['current']}, not 1")
    check(state["streak"]["today_qualified"] is True, "today counts for the streak")

    step("Google sign-in (dev), keeping the guest's progress")
    s = c.call(
        "POST",
        "/v1/dev/auth/google",
        json={
            "email": f"smoke-{uuid.uuid4().hex[:10]}@example.invalid",
            "name": "Smoke Test",
            "link": True,
        },
    )
    check(s["user"]["id"] == c.user_id and not s["user"]["is_anonymous"], "linked, same user id")
    c.token = s["access_token"]

    step("practice drill on real questions")
    session = c.call(
        "POST",
        "/v1/practice/sessions",
        expect=201,
        json={"exam": EXAM, "topic_id": topic, "mode": "drill", "count": 3},
    )
    questions = session["questions"]
    check(len(questions) > 0, "the drill has questions")
    practice = manifest["topics"][topic]["bundles"].get("practice")
    bank: dict[str, Any] = {}
    if practice:
        bank = c.http.get(f"{base}/{practice['path']}").json().get("questions") or {}
    right = 0
    for q in questions:
        key = (bank.get(q["question_id"]) or {}).get("answer") or {}
        answer = (
            {"kind": "options", "option_ids": key["option_ids"]} if "option_ids" in key else None
        )
        res = c.call(
            "POST",
            f"/v1/practice/sessions/{session['id']}/answers",
            json={"question_id": q["question_id"], "answer": answer, "time_ms": 20000},
            extra_headers=idem(),
        )
        if answer is not None:
            check(res["check"]["correct"] is True, f"{q['question_id']}: the key answer is right")
            right += 1
    check(right > 0, "at least one question answered from its key")
    done = c.call("POST", f"/v1/practice/sessions/{session['id']}/complete", json={})
    check(done["answered"] == len(questions), "every answer was recorded")

    step("tutor message (AI_PROVIDER from the stack)")
    chat = c.call("POST", "/v1/tutor/sessions", json={"exam": EXAM})
    with c.http.stream(
        "POST",
        f"{API}/v1/tutor/sessions/{chat['id']}/messages",
        headers=c.headers(),
        json={
            "client_message_id": str(uuid.uuid4()),
            "text": "Why does a cell's terminal voltage drop when current flows?",
        },
    ) as r:
        check(r.status_code == 200, f"tutor message: {r.status_code}")
        stream = "".join(r.iter_text())
    check("event: done" in stream, "the tutor's answer finished")
    check("event: delta" in stream or "event: replace" in stream, "the tutor answered")

    step("Pro through the fake Razorpay webhook")
    sub = c.call(
        "POST",
        "/v1/billing/razorpay/subscription",
        json={"plan": "monthly"},
        extra_headers=idem(),
    )
    now = datetime.now(UTC).replace(microsecond=0)
    event = razorpay_event(
        sub["subscription_id"],
        c.user_id,
        now,
        intro=bool(sub["intro"]),
        amount=int(sub["amount_today_paise"]),
    )
    body = json.dumps(event).encode()
    sig = hmac.new(DEV_RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    r = c.http.post(
        f"{API}/v1/webhooks/razorpay",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Razorpay-Signature": sig,
            "X-Razorpay-Event-Id": f"evt_{uuid.uuid4().hex[:14]}",
        },
    )
    check(r.status_code == 200, f"webhook: {r.status_code} {r.text[:200]}")
    ent = c.call("GET", "/v1/billing/entitlement")
    check(ent["plan"] == "pro" and ent["source"] == "razorpay", f"Pro is on: {ent}")

    if WEB:
        step("web app answers")
        r = c.http.get(f"{WEB}/")
        check(r.status_code == 200 and "<html" in r.text.lower(), f"web app: {r.status_code}")


def razorpay_event(
    sub_id: str, user_id: str, now: datetime, *, intro: bool, amount: int
) -> dict[str, Any]:
    """A ``subscription.activated`` event shaped like Razorpay's webhook (as in the API tests'
    fixture); the local API checks it with the dev webhook secret."""
    end = now + timedelta(days=30)
    return {
        "entity": "event",
        "account_id": "acc_LocalStack",
        "event": "subscription.activated",
        "contains": ["subscription", "payment"],
        "payload": {
            "subscription": {
                "entity": {
                    "id": sub_id,
                    "entity": "subscription",
                    "plan_id": "plan_LocalStack",
                    "status": "active",
                    "current_start": int(now.timestamp()),
                    "current_end": int(end.timestamp()),
                    "notes": {"user_id": user_id, "intro": "1" if intro else "0", "variant": "web"},
                    "charge_at": int(end.timestamp()),
                    "start_at": int(now.timestamp()),
                    "paid_count": 1,
                    "total_count": 120,
                    "offer_id": "offer_LocalStack" if intro else None,
                    "created_at": int(now.timestamp()),
                }
            },
            "payment": {
                "entity": {
                    "id": f"pay_{uuid.uuid4().hex[:14]}",
                    "entity": "payment",
                    "amount": amount,
                    "currency": "INR",
                    "status": "captured",
                    "method": "upi",
                    "captured": True,
                    "created_at": int(now.timestamp()),
                }
            },
        },
        "created_at": int(now.timestamp()),
    }


def main() -> int:
    started = time.monotonic()
    print(f"smoke journey against {API}", flush=True)
    with httpx.Client(timeout=60) as http:
        try:
            journey(Client(http))
        except SmokeFailed as exc:
            print(f"FAILED: {exc}", file=sys.stderr, flush=True)
            return 1
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            print(f"FAILED: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            return 1
    print(f"smoke journey passed in {time.monotonic() - started:.1f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
