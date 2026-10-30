# Sync contract (client outbox ↔ API)

Status: v1.2, 30 Oct 2026. Shared by `packages/app-core` (client) and `apps/api` (server). The server's Pydantic models in `apps/api` are the source of truth for OpenAPI; this file describes the wire format they implement. If you need to change it, change both sides in the same pull request.

## Envelope

`POST /v1/sync/events`, headers `Authorization: Bearer <jwt>`, `X-App-Variant`, `X-Device-Id`.

```json
{
  "device_id": "uuid",
  "events": [
    {
      "event_id": "uuidv7",
      "type": "lesson_card_viewed",
      "occurred_at": "2026-10-29T10:00:00.000Z",
      "tz": "Asia/Kolkata",
      "payload": { }
    }
  ]
}
```

- Up to 200 events per request, ordered by the client's `seq`.
- `event_id` is the idempotency key. A repeated `event_id` is accepted again with no effect.
- Response `200`:

```json
{
  "accepted": ["uuidv7"],
  "rejected": [{ "event_id": "uuidv7", "code": "invalid_payload", "detail": "..." }],
  "state_version": 42
}
```

- A rejected event is dropped by the client (it is logged, never retried). A `5xx` or network error keeps the batch for retry with backoff.

## Event types (v1)

| type | payload |
|---|---|
| `lesson_started` | `topic_id`, `mode` (`deep_dive` \| `quick_revision` \| `onboarding` \| `quick_check`), `bundle_version`, `locale` |
| `lesson_card_viewed` | `topic_id`, `card_id`, `index`, `ms_on_card` |
| `answer_submitted` | `topic_id`, `card_id` or `question_id`, `context` (`lesson` \| `check` \| `fix` \| `practice` \| `review` \| `challenge` \| `chapter_test`), `response` (the option ids, number or text key, never free text typed by the student), `correct` (bool), `attempt` (1 or 2), `confidence` (`sure` \| `fifty_fifty` \| `guess` \| null), `ms_to_answer` |
| `lesson_completed` | `topic_id`, `mode`, `cards_seen`, `correct`, `total`, `ms_total`, `xp` |
| `review_rated` | `card_ref` (`c:<card_id>` content card, `d:<user_card_id>` own deck card, `q:<question_id>`), `rating` (1 Again \| 2 Hard \| 3 Good \| 4 Easy), `confidence`, `ms_to_answer`, `fsrs_state` (the client's computed state: `due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `state`) |
| `practice_session_completed` | `session_id`, `kind` (`drill` \| `pyq` \| `weak_spots`), `answered`, `correct`, `ms_total` |
| `daily_challenge_completed` | `challenge_date` (IST date), `score`, `ms_total` |
| `mock_section_submitted` | `attempt_id`, `section_code` |
| `pet_care` | `action` (`pet` \| `feed` \| `play`), `item_id`? |
| `pet_named` | `species` (`cat` \| `dog`), `name` |
| `plant_seeded` | (empty) |
| `onboarding_answer` | `step` (`goal` \| `class` \| `birth_year` \| `exam_date` \| `level` \| `daily_goal` \| `reminder`), `value` |
| `settings_changed` | `key`, `value` (keys from DB_SCHEMA §3 `settings`) |
| `deck_card_upserted` | `user_card_id`, `deck_id`, `front`, `back` (the student's own card text stays on their account and is never sent to analytics) |
| `deck_card_deleted` | `user_card_id` |
| `focus_session_completed` | `minutes`, `rounds` |
| `quest_claimed` | `quest_id` |
| `freeze_equipped` | `slot` |
| `rescue_completed` | `cards` (count), `ms_total` (the 2-minute rescue, R23) |
| `cards_queued` | `concept_ids`, `source` (`lesson` \| `practice` \| `comeback`) |
| `comeback_plan_started` | `days_away`, `cards` (count) |

The server recomputes XP, mastery, FSRS schedules, activity days, the streak, plant health and growth, and pet mood from events (TRD §10). A streak day counts when the student's local day has one qualifying activity: `lesson_completed`, 10 `review_rated`, a `mock_section_submitted`, or a `daily_challenge_completed` (rulings R1 and R23).

## Wire rules (v1.1)

- `tz` is required on every event (an IANA zone). The server uses it to place the event on the student's local day (R1, R23).
- Card refs use `c:`, `d:` and `q:`. Servers also accept `u:` as an alias of `d:`.
- Confidence on the wire is `sure`, `fifty_fifty` or `guess`. The database stores `fifty` for `fifty_fifty`.
- Pet care on the wire is `pet`, `feed` or `play`. The UI word "treat" maps to `feed`.
- When a whole batch gets a `4xx` other than `401`, the client halves the batch until it finds the bad event, then drops only that one. A `401` refreshes the token and retries.
- "I don't know yet" sends `answer_submitted` with `response: null`, `correct: false`.
- For checks (`context: check`, `lesson_started.mode: quick_check`), `topic_id` carries the scope the check covers: a topic, chapter or exam-profile id. Fix mistakes (`context: fix`) sends answer events only, no lesson events.
- Content bundle hashes are sha256 of canonical JSON (keys sorted, no whitespace), in lowercase hex. The publish job and `ContentManager` must hash the same way.

## State

`GET /v1/sync/state?since=<state_version>` returns what changed since that version (or everything when `since` is missing):

```json
{
  "state_version": 43,
  "profile": { "id": "uuid", "display_name": null, "locale": "en", "is_guest": true, "age_band": "13_17", "exam_profile_ids": ["jee_main"], "daily_goal_minutes": 10 },
  "streak": { "current": 3, "longest": 5, "today_qualified": true, "freezes_equipped": 1, "freezes_available": 1, "rest_day": null, "at_risk": false },
  "plant": { "stage": "sprout", "health": "thriving", "study_days": 3, "next_stage_at": 7 },
  "pet": { "species": "cat", "name": "Miso", "mood": 80, "energy": 70, "state": "happy" },
  "wallet": { "xp_total": 120, "xp_today": 40, "gems": 35 },
  "srs": { "cards": [ { "card_ref": "c:...", "due": "...", "stability": 1.2, "difficulty": 5.1, "state": 2, "reps": 1, "lapses": 0, "last_review": "..." } ], "deleted": [] },
  "topic_progress": [ { "topic_id": "...", "status": "learned", "percent": 100 } ],
  "entitlement": { "plan": "free", "pro_until": null }
}
```

Server values win on conflict. The client replaces its local copy of each section it receives.

## Dev auth

Locally there is no Supabase Auth server. `apps/api` exposes `POST /v1/dev/auth/anonymous` and `POST /v1/dev/auth/google` (body `{ "email": "...", "name": "..." }`) only when `APP_ENV=local` or `test`. They return `{ "access_token": "...", "token_type": "bearer", "expires_in": 3600, "refresh_token": "...", "user": { "id": "uuid", "is_anonymous": true } }`, like Supabase's token endpoint. `POST /v1/dev/auth/refresh` (body `{ "refresh_token": "..." }`) returns the same shape. The access token is a JWT signed with the dev key and shaped exactly like a Supabase access token (`sub`, `role: authenticated`, `is_anonymous`, `aud`, `exp`, `amr`). Clients use them through the same auth interface they use for Supabase, so switching to real Supabase is config only.
