"""Every mutation declares the ``Idempotency-Key`` header in OpenAPI (AGENTS.md "API": mutations
that touch progress or money take one), unless it is listed below with the reason it doesn't need
one. A new mutation fails this test until it takes a key or is added here with a reason, so the
audit stays current."""

from __future__ import annotations

from smriti_api.openapi import build_openapi

_NATURAL_ID = "idempotent by an id in the request (event_id, client_message_id, session id)"
_DELETE = "a DELETE: a repeat finds nothing and changes nothing"
_SOCIAL = "social or settings state, no progress or money; a repeat sets the same state"
_TRANSITION = "a one-way state transition; a repeat answers 409 or returns the same state"
_SSE = "a server-sent event stream; it resumes by the session's message ids instead"
_AUTH = "auth, device or integrity plumbing, not progress or money"
_WEBHOOK = "a provider webhook, deduplicated by the provider's event id"
_SECRET = "returns a one-time secret (a code or token) that must never be replayed from a cache"
_DEV = "a dev-only route"
_METERED = "metered speech; each call is a new clip and is rate-limited"

EXEMPT: dict[tuple[str, str], str] = {
    ("POST", "/v1/sync/events"): _NATURAL_ID,
    ("POST", "/v1/tutor/sessions/{session_id}/messages"): _NATURAL_ID,
    ("POST", "/v1/tutor/ask/card"): _NATURAL_ID,
    ("POST", "/v1/tutor/ask/question"): _NATURAL_ID,
    ("POST", "/v1/tutor/sessions"): _NATURAL_ID,
    ("POST", "/v1/ai/doubt-photos/{photo_id}/solve"): _SSE,
    ("DELETE", "/v1/account"): _DELETE,
    ("DELETE", "/v1/account/deletion"): _DELETE,
    ("DELETE", "/v1/billing/family/invites/{invite_id}"): _DELETE,
    ("DELETE", "/v1/billing/family/members/{user_id}"): _DELETE,
    ("DELETE", "/v1/decks/{deck_id}/share"): _DELETE,
    ("DELETE", "/v1/devices/{device_id}"): _DELETE,
    ("DELETE", "/v1/duels/random"): _DELETE,
    ("DELETE", "/v1/duos/{duo_id}"): _DELETE,
    ("DELETE", "/v1/friends/{user_id}"): _DELETE,
    ("DELETE", "/v1/guardian/learners/{learner_id}/friends/{friend_id}"): _DELETE,
    ("DELETE", "/v1/guardian/link-requests/{request_id}"): _DELETE,
    ("DELETE", "/v1/guardian/consent-requests/{request_id}"): _DELETE,
    ("DELETE", "/v1/live/mocks/{mock_id}/registration"): _DELETE,
    ("DELETE", "/v1/social/blocks/{user_id}"): _DELETE,
    ("DELETE", "/v1/social/reactions/{item_id}"): _DELETE,
    ("DELETE", "/v1/squads/{squad_id}/members/{user_id}"): _DELETE,
    ("DELETE", "/v1/tutor/sessions/{session_id}"): _DELETE,
    ("POST", "/v1/account/merge-intents"): _AUTH,
    ("POST", "/v1/devices"): _AUTH,
    ("POST", "/v1/integrity/app-attest/keys"): _AUTH,
    ("POST", "/v1/integrity/challenge"): _AUTH,
    ("POST", "/v1/billing/family/invites"): _SECRET,
    ("POST", "/v1/guardian/children/{child_id}/session"): _SECRET,
    ("POST", "/v1/guardian/learners/{learner_id}/pay-links"): _SECRET,
    ("POST", "/v1/webhooks/razorpay"): _WEBHOOK,
    ("POST", "/v1/webhooks/revenuecat"): _WEBHOOK,
    ("POST", "/v1/dev/auth/anonymous"): _DEV,
    ("POST", "/v1/dev/auth/google"): _DEV,
    ("POST", "/v1/dev/auth/refresh"): _DEV,
    ("POST", "/v1/dev/auth/verify-otp"): _DEV,
    ("POST", "/v1/speech/dictation"): _METERED,
    ("POST", "/v1/speech/read-aloud"): _METERED,
    ("POST", "/v1/voice/sessions"): _TRANSITION,
    ("POST", "/v1/voice/sessions/{session_id}/end"): _TRANSITION,
    ("POST", "/v1/voice/sessions/{session_id}/tools"): _TRANSITION,
    ("POST", "/v1/duels"): _TRANSITION,
    ("POST", "/v1/duels/random"): _TRANSITION,
    ("POST", "/v1/duels/{duel_id}/accept"): _TRANSITION,
    ("POST", "/v1/duels/{duel_id}/async"): _TRANSITION,
    ("POST", "/v1/duels/{duel_id}/decline"): _TRANSITION,
    ("POST", "/v1/duels/{duel_id}/leave"): _TRANSITION,
    ("POST", "/v1/duels/{duel_id}/rematch"): _TRANSITION,
    ("POST", "/v1/duos"): _TRANSITION,
    ("POST", "/v1/duos/{duo_id}/accept"): _TRANSITION,
    ("POST", "/v1/duos/{duo_id}/decline"): _TRANSITION,
    ("POST", "/v1/me/link-requests/claim"): _TRANSITION,
    ("POST", "/v1/live/mocks/{mock_id}/registration"): _TRANSITION,
    ("POST", "/v1/leagues/join"): _TRANSITION,
    ("POST", "/v1/friends/invite/{code}/accept"): _TRANSITION,
    ("POST", "/v1/friends/requests"): _TRANSITION,
    ("POST", "/v1/friends/requests/{user_id}/accept"): _TRANSITION,
    ("POST", "/v1/friends/requests/{user_id}/decline"): _TRANSITION,
    ("POST", "/v1/squads"): _TRANSITION,
    ("POST", "/v1/squads/join/{code}"): _TRANSITION,
    ("POST", "/v1/squads/{squad_id}/code"): _TRANSITION,
    ("POST", "/v1/shared-decks/{code}/copy"): _TRANSITION,
    ("POST", "/v1/decks/{deck_id}/share"): _TRANSITION,
    ("POST", "/v1/content/reports"): _SOCIAL,
    ("POST", "/v1/duos/{duo_id}/nudge"): _SOCIAL,
    ("PUT", "/v1/leagues/opt-out"): _SOCIAL,
    ("PATCH", "/v1/me"): _SOCIAL,
    ("PUT", "/v1/me/exams"): _SOCIAL,
    ("PATCH", "/v1/notification-prefs"): _SOCIAL,
    ("POST", "/v1/notifications/opened"): _SOCIAL,
    ("PUT", "/v1/shared-decks/{code}/helpful"): _SOCIAL,
    ("POST", "/v1/social/blocks"): _SOCIAL,
    ("POST", "/v1/social/inbox/seen"): _SOCIAL,
    ("POST", "/v1/social/me/first-visit"): _SOCIAL,
    ("PUT", "/v1/social/me/handle"): _SOCIAL,
    ("PUT", "/v1/social/me/privacy"): _SOCIAL,
    ("POST", "/v1/social/nudges"): _SOCIAL,
    ("POST", "/v1/social/reactions"): _SOCIAL,
    ("POST", "/v1/social/reports"): _SOCIAL,
    ("POST", "/v1/squads/{squad_id}/cheer"): _SOCIAL,
    ("POST", "/v1/tutor/messages/{message_id}/feedback"): _SOCIAL,
}

# The ones the apps asked about by name (mock and daily-challenge mutations).
MUST_HAVE = {
    ("POST", "/v1/mocks/generate"),
    ("POST", "/v1/mocks/{mock_id}/attempts"),
    ("PUT", "/v1/attempts/{attempt_id}/answers"),
    ("POST", "/v1/attempts/{attempt_id}/pause"),
    ("POST", "/v1/attempts/{attempt_id}/resume"),
    ("POST", "/v1/attempts/{attempt_id}/takeover"),
    ("POST", "/v1/attempts/{attempt_id}/sections/{section_code}/submit"),
    ("POST", "/v1/attempts/{attempt_id}/abandon"),
    ("POST", "/v1/attempts/{attempt_id}/submit"),
    ("POST", "/v1/daily-challenge/{challenge_id}/start"),
    ("POST", "/v1/daily-challenge/{challenge_id}/answer"),
    ("POST", "/v1/practice/sessions"),
    ("POST", "/v1/practice/sessions/{session_id}/complete"),
}


def _mutations() -> dict[tuple[str, str], bool]:
    out = {}
    for path, item in build_openapi()["paths"].items():
        for method, op in item.items():
            if method not in ("post", "put", "patch", "delete"):
                continue
            headers = {p["name"] for p in op.get("parameters", []) if p.get("in") == "header"}
            out[(method.upper(), path)] = "Idempotency-Key" in headers
    return out


def test_every_mutation_declares_idempotency_key_or_says_why_not() -> None:
    found = _mutations()
    missing = sorted(op for op, has in found.items() if not has and op not in EXEMPT)
    assert not missing, f"take an IdempotencyKey or add a reason to EXEMPT: {missing}"
    # Exemptions for routes that are gone, or that now take a key, are dropped.
    stale = sorted(op for op in EXEMPT if op in found and found[op])
    assert not stale, f"these take a key now; remove them from EXEMPT: {stale}"


def test_mock_and_daily_challenge_mutations_take_a_key() -> None:
    found = _mutations()
    assert all(found.get(op) for op in MUST_HAVE), sorted(op for op in MUST_HAVE if not found[op])
