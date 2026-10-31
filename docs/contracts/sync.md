# Sync contract (client outbox ↔ API)

Status: v1.6, 31 Oct 2026. Shared by `packages/app-core` (client) and `apps/api` (server). The server's Pydantic models in `apps/api` are the source of truth for OpenAPI; this file describes the wire format they implement. If you need to change it, change both sides in the same pull request.

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
| `answer_submitted` | `topic_id`, `card_id` or `question_id`, `context` (`lesson` \| `check` \| `fix` \| `practice` \| `review` \| `challenge` \| `chapter_test` \| `mock`), `attempt_id` (with `mock` only), `response` (the option ids, number or text key, never free text typed by the student), `correct` (bool), `attempt` (1 or 2), `confidence` (`sure` \| `fifty_fifty` \| `guess` \| null), `ms_to_answer` |
| `lesson_completed` | `topic_id`, `mode`, `cards_seen`, `correct`, `total`, `ms_total`, `xp` |
| `review_rated` | `card_ref` (`c:<card_id>` content card, `d:<user_card_id>` own deck card, `q:<question_id>`, (v1.5) `p:<item_id>` memory palace item), `rating` (1 Again \| 2 Hard \| 3 Good \| 4 Easy), `confidence`, `ms_to_answer`, `fsrs_state` (the client's computed state: `due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `state`) |
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
| `activity_completed` (v1.4) | `kind` (`story` \| `song` \| `play`), `activity_id`, `topic_id`, `concept_ids` (at most 50), `bundle_version`, `locale` (`en` \| `hi`), `stars` (0 to 100), `ms_total`, `completed_at` (ISO time with offset). Built by app-core's `activityCompletedPayload` from lesson-core's `ActivityCompletion`; no free text |
| `palace_saved` (v1.5) | A memory palace, whole: `palace_id`, `name`, `template` (`home` \| `school` \| `monument` \| `pano360` \| `custom`), `template_id` (`pt.` id of the `palace_template@1` it came from, or null), `source` (`list` \| `topic` \| `deck` \| `mnemonics` \| null), `rooms` (1 to 20, walk order: `room_id`, `name`, `sort`, `template_room` slug or null, `loci` 1 to 20 spots: `locus_id`, `sort`, `pos` `{x, y}` fractions or `{yaw, pitch}` degrees), `items` (at most 200: `item_id`, `item_ref` (`kp:<concept>#<n>`, `card:<id>`, a card ref, `m:<mnemonic_id>` or a concept id; never free text), `label`, `note`, `locus_id` or null for the tray), `updated_at` (the device's time of the edit, with offset). Built by app-core's `palaceSavedPayload` |
| `palace_deleted` (v1.5) | `palace_id` |
| `topic_tested_out` (v1.6) | `check_id` (UUID, one per Test out), `kind` (`test_out`), `chapter_id`, `topic_ids` (1 to 100, the topics the check passed). Built by app-core's `topicTestedOutPayload` |
| `topic_test_out_undone` (v1.6) | `check_id`, `topics` (1 to 100: `topic_id`, `previous_status` `not_started` \| `in_progress` \| null, the row that check replaced). Built by app-core's `topicTestOutUndonePayload` from the device's marks |
| `chapter_reset` (v1.6) | `chapter_id`. Built by app-core's `chapterResetPayload` |

The server recomputes XP, mastery, FSRS schedules, activity days, the streak, plant health and growth, and pet mood from events (TRD §10). A streak day counts when the student's local day has one qualifying activity: `lesson_completed` (or an `activity_completed`), 10 `review_rated`, a `mock_section_submitted`, or a `daily_challenge_completed` (rulings R1 and R23).

## Wire rules (v1.1)

- `tz` is required on every event (an IANA zone). The server uses it to place the event on the student's local day (R1, R23).
- Card refs use `c:`, `d:` and `q:`. Servers also accept `u:` as an alias of `d:`.
- Confidence on the wire is `sure`, `fifty_fifty` or `guess`. The database stores `fifty` for `fifty_fifty`.
- Pet care on the wire is `pet`, `feed` or `play`. The UI word "treat" maps to `feed`.
- When a whole batch gets a `4xx` other than `401`, the client halves the batch until it finds the bad event, then drops only that one. A `401` refreshes the token and retries.
- "I don't know yet" sends `answer_submitted` with `response: null`, `correct: false`.
- For checks (`context: check`, `lesson_started.mode: quick_check`), `topic_id` carries the scope the check covers: a topic, chapter or exam-profile id. Fix mistakes (`context: fix`) sends answer events only, no lesson events.
- Content bundle hashes are sha256 of canonical JSON (keys sorted, no whitespace), in lowercase hex. The publish job and `ContentManager` must hash the same way.
- (v1.3) Mock answers update mastery: when an attempt is submitted the server records one `answer_submitted` per scored answer with `context: mock` and the `attempt_id`, so clients don't send them. A mock answer for an attempt that isn't submitted, or a repeat for the same attempt and question, is rejected (`invalid_payload`, `already_recorded`). `practice_session_completed` and `mock_section_submitted` count once per `session_id` and per `attempt_id` + `section_code`: whichever of the device's outbox or the server records it first wins, and a later one is rejected with `already_recorded` (drop it, as with any rejected event).

- (v1.4) `activity_completed` counts as a completed lesson: it qualifies the student's local day for the streak, adds one to the day's lessons and its `ms_total` to the day's minutes, and marks `topic_id` learned on the path, exactly as `lesson_completed` does. It earns `stars` x the `xp.little_activity_star` flag in XP (proposed, default 1; 0 stars earn none). The same `activity_id` and `bundle_version` count once per local day of `completed_at` (in the event's `tz`); a repeat is rejected with `already_recorded`, and a `completed_at` in the future with `clock_skew`. It is on the under-10 strict analytics allow-list.

- (v1.5) Memory palaces (memory-labs §5.6). A palace is saved whole with `palace_saved`; the outbox keeps only the newest pending one per palace (app-core `enqueuePalaceSaved`). The server keeps the snapshot with the newest `updated_at`; an older one is accepted and ignored, and so is any `palace_saved` after `palace_deleted` (a deleted palace stays deleted). Ids in a snapshot must be unique, every placed item's `locus_id` must be a spot of the same palace and one spot holds one item (else `invalid_payload`); ids that belong to someone else's palace are rejected (`palace_not_found`, `invalid_payload`). Building a new palace needs Pro (`pro_required`); edits to a palace that already exists are always kept, so nothing written offline is lost when a plan lapses. Names, labels and notes are the student's own words: they stay on the account, are never logged or sent to analytics, and the server's event log keeps only `palace_id` and `updated_at`.
- (v1.5) Each palace item is an FSRS card `p:<item_id>` (a UUID). Rating it in a palace quiz, or as a "Palace spot" review card, is an ordinary `review_rated`: the server stores it with `context = 'palace_walk'` and it counts toward the 10 reviews of a streak day like any review. A `p:` ref whose item isn't in one of the student's palaces is rejected with `unknown_card`. A card exists only after its first rating. Removing an item (a `palace_saved` without it) or deleting the palace deletes the item's card, which comes back in `srs.deleted`. `cards_queued.card_refs` stays on `c:`, `d:` and `q:`.
- (v1.5) `GET /v1/palaces` returns `{ palaces, deleted }`: every live palace (each item with its `card_ref` and `due_at`, each palace with `next_walk_at`, the earliest due item) and the ids of deleted ones. A device merges it with app-core `mergeServerPalaces`: the newer `updated_at` wins, and a palace with an unsent edit is kept. The REST mutations under `/v1/palaces` apply the same events through the same batch, so the online and offline paths agree. Golden vector: `packages/app-core/test-vectors/palace.json`.

- (v1.6) Topic marks (learn §6.4, X13), applied by the rule in app-core's `applyTopicMark`:
  - `topic_tested_out` marks each topic learned with `learned_via: test_out`, unless it is already learned. Every topic must be in the chapter (`content.topics`), else `invalid_payload`. A `check_id` counts once (`already_recorded`).
  - `topic_test_out_undone` sets each listed topic that the check marked, and that is still `learned_via: test_out`, back to `previous_status` (null means `not_started`) with no `learned_via`. Anything else is left alone. An unknown `check_id` is `invalid_payload`.
  - `chapter_reset` sets every topic of the chapter that has a row to `not_started` with no `learned_via`, and deletes the chapter's lesson positions (`learn.lesson_progress`). Review cards, XP and the streak stay. An unknown chapter is `invalid_payload`.
  - All three change `topic_progress`. A device may delete a row where the server says `not_started`; both mean the same.
  - Golden vector: `packages/app-core/test-vectors/topic_marks.json`.

## State

`GET /v1/sync/state?since=<state_version>` returns what changed since that version (or everything when `since` is missing):

```json
{
  "state_version": 43,
  "profile": { "id": "uuid", "display_name": null, "locale": "en", "is_guest": true, "age_band": "13_17", "exam_profile_ids": ["jee_main"], "daily_goal_minutes": 10 },
  "streak": { "current": 3, "longest": 5, "today_qualified": true, "freezes_equipped": 1, "freezes_available": 1, "rest_day": null, "at_risk": false, "freeze_used_days": ["2026-10-30"], "incident_days_covered": [], "next_free_freeze_on": "2026-11-01" },
  "plant": { "stage": "sprout", "health": "thriving", "study_days": 3, "next_stage_at": 7 },
  "pet": { "species": "cat", "name": "Miso", "mood": 80, "energy": 70, "state": "happy" },
  "wallet": { "xp_total": 120, "xp_today": 40, "gems": 35 },
  "srs": { "cards": [ { "card_ref": "c:...", "due": "...", "stability": 1.2, "difficulty": 5.1, "state": 2, "reps": 1, "lapses": 0, "last_review": "..." } ], "deleted": [] },
  "topic_progress": [ { "topic_id": "...", "status": "learned", "percent": 100, "learned_via": "test_out" } ],
  "entitlement": { "plan": "free", "pro_until": null, "managed_in": "none" }
}
```

Server values win on conflict. The client replaces its local copy of each section it receives.

(v1.4) `entitlement.managed_in` says who can manage the plan, so Manage plan goes to the right place: `web` (Razorpay, in the app), `play`, `app_store`, `parent` (PAY-17: the subscription's payer is a guardian and only they manage it; the child's own cancel answers 403 `managed_by_parent`), `family` (a seat on someone else's family plan) or `none` (free, or a promo grant). Clients that talk to an older server without the field infer it: `parent` when the subscription details say `payer: guardian`, otherwise from `source`.

(v1.4) `streak.freeze_used_days` and `streak.incident_days_covered` are the missed local days between the last studied day (before today) and today that a freeze or an outage (R28) covered, at most 60 days back, oldest first. They are facts, not a prompt: ENT-08 shows its freeze or incident variant from them at most once a day, and they stay until the next studied day after today closes the gap. `streak.next_free_freeze_on` is when this month's R36 grant arrives (the first day of next month in the student's zone), or null when the plan gets no monthly freeze.

## Dev auth

Locally there is no Supabase Auth server. `apps/api` exposes `POST /v1/dev/auth/anonymous` and `POST /v1/dev/auth/google` (body `{ "email": "...", "name": "..." }`) only when `APP_ENV=local` or `test`. They return `{ "access_token": "...", "token_type": "bearer", "expires_in": 3600, "refresh_token": "...", "user": { "id": "uuid", "is_anonymous": true } }`, like Supabase's token endpoint. `POST /v1/dev/auth/refresh` (body `{ "refresh_token": "..." }`) returns the same shape. The access token is a JWT signed with the dev key and shaped exactly like a Supabase access token (`sub`, `role: authenticated`, `is_anonymous`, `aud`, `exp`, `amr`). Clients use them through the same auth interface they use for Supabase, so switching to real Supabase is config only.

## Changelog

- v1.6 (31 Oct 2026): `topic_tested_out`, `topic_test_out_undone` and `chapter_reset`, so Test out marks, their undo and a chapter reset survive a pull. `topic_progress[].learned_via` on `GET /v1/sync/state`. Additive; a v1.5 server rejects the events as `unknown_type`, so send them only to a v1.6 server (`CONTRACT_V16_EVENT_TYPES`). Golden vector: `packages/app-core/test-vectors/topic_marks.json`, checked by app-core and `apps/api/tests/test_topic_marks.py`.
- v1.5 (31 Oct 2026): memory palaces sync: `palace_saved` and `palace_deleted`, and `p:<item_id>` card refs in `review_rated` (context `palace_walk`). Additive; a v1.4 server rejects the two events as `unknown_type`, so clients send them only to a v1.5 server. Golden vector: `packages/app-core/test-vectors/palace.json`, checked by app-core and `apps/api/tests/test_palaces.py`.
- v1.4 (31 Oct 2026): `entitlement.managed_in` on `GET /v1/sync/state` (`web`, `play`, `app_store`, `parent`, `family`, `none`). Additive; clients fall back to inferring it.
- v1.4 (31 Oct 2026): `activity_completed` for little-learner story, song and play completions. See the rules below the wire rules. Golden vector: `packages/app-core/test-vectors/activity_completed.json`, checked by app-core and `apps/api/tests/test_activity_completed.py`.
- v1.4 (31 Oct 2026): `streak.freeze_used_days`, `streak.incident_days_covered` and `streak.next_free_freeze_on` for ENT-08. Additive.
- v1.3 (30 Oct 2026): mock answers update mastery; practice and mock section events count once.
