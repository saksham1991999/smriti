# apps/api: the Smriti API

FastAPI (Python 3.12, uv) on Railway, with Supabase Auth and Postgres, Redis, and an arq worker in
`apps/worker`. It serves config and flags, the catalogue and content manifests, the sync endpoints
that the app-core outbox talks to, accounts (link, guest merge, deletion), gamification, and the AI
gateway. Architecture: `docs/TRD.md`. Wire format of sync: `docs/contracts/sync.md` (v1.1).

## Run it locally

```bash
bash scripts/dev/db.sh reset          # or: pnpm db:reset  (Postgres 16 on :54322, Redis on :56379)
cd apps/api
uv sync
uv run uvicorn smriti_api.main:app --port 8000 --reload
curl -s localhost:8000/v1/config | head -c 300
```

`APP_ENV=local` is the default: dev auth is mounted, jobs run inline after the request, and
missing AI keys fall back to the fakes. Set `AI_PROVIDER=fake` to stay offline.

The local database is plain Postgres 16 with a small Supabase shim (`auth.users`,
`auth.identities`, `auth.uid()`, `auth.jwt()`, and the `anon`, `authenticated` and `service_role`
roles), so the same migrations and RLS policies run here and on Supabase.
`scripts/dev/db.sh up|reset|down` manages it; `reset` rebuilds `smriti` and `smriti_test` from
`supabase/migrations` and `supabase/seed.sql` (config rows only, no study content). pgvector and
pg_cron are skipped when they are not installed (a notice says so); the worker's `db_upkeep` cron
does pg_cron's jobs then.

A first session with curl:

```bash
TOKEN=$(curl -s -X POST localhost:8000/v1/dev/auth/anonymous | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
curl -s -X POST localhost:8000/v1/sync/events -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_id":"6f1c2a52-7d8e-4c1b-9a51-0d3c55a1e001","events":[{"event_id":"6f1c2a52-7d8e-4c1b-9a51-0d3c55a1e002","type":"lesson_completed","occurred_at":"'"$(date -u +%FT%TZ)"'","tz":"Asia/Kolkata","payload":{"topic_id":"t","mode":"deep_dive","cards_seen":6,"correct":3,"total":4,"ms_total":300000}}]}'
curl -s localhost:8000/v1/sync/state -H "Authorization: Bearer $TOKEN"   # streak 1, plant sprout
```

## Checks

```bash
cd apps/api
uv run ruff check && uv run ruff format --check
uv run mypy
uv run pytest            # needs scripts/dev/db.sh reset; RUN_LIVE=1 adds the live Agnes tests
cd ../worker && uv run ruff check && uv run mypy && uv run pytest
```

The tests use `smriti_test` and Redis db 1 (the worker's use db 2). `tests/test_rls.py` reads the
catalogue and checks every table with a user column, so a new table is covered automatically.
`tests/test_vectors.py` runs the server's streak, plant, pet and FSRS rules against
`packages/app-core/test-vectors`, so the client and the server can't drift.

## Layout

```
smriti_api/
  main.py          app factory, services wiring, middleware (request log, CORS), routers
  openapi.py       prints the OpenAPI document (dev routes marked x-dev-only)
  core/            settings, auth (JWKS + dev HS256), db (user/system/anon/admin transactions),
                   RFC 7807 errors, cursor pagination, Redis idempotency and rate limits,
                   structlog (no PII; user ids hashed), OpenTelemetry
  schemas/         Pydantic models: the OpenAPI source of truth (sync.py is the sync contract)
  routes/          thin handlers; business logic lives in services/
  services/        sync, recompute (streak, plant, pet, freezes), srs (FSRS), gamify (pure rules),
                   game and game_ops (shop, quests, badges, care), accounts (link, merge, deletion),
                   catalog, app_config, flags, jobs, dev_auth, analytics sink
  ai/              gateway, tiers, Agnes LLM and image providers, Deepgram and Gemini Live
                   adapters, fakes for every interface
  models/          SQLAlchemy models for typed reads
tests/             pytest (async, against the local Postgres)
```

## How requests run

- **Auth.** Supabase access tokens are verified against `SUPABASE_JWKS_URL` (ES256/RS256/EdDSA,
  cached). In `local` and `test` the dev auth endpoints mint HS256 tokens with the same claims
  (`sub`, `role`, `is_anonymous`, `aud`, `exp`, `amr`) and return Supabase's token response shape.
- **Database.** A request runs as the caller: `set local role authenticated` plus
  `request.jwt.claims`, so RLS applies exactly as with PostgREST. Recompute and jobs use the
  system role. SQL parameters never reach logs.
- **Errors.** Every error is `application/problem+json` with a stable `code`
  (`login_required`, `not_enough_gems`, `idempotency_key_reused`, …).
- **Idempotency.** Mutations that touch progress or money take `Idempotency-Key`; the first
  response is replayed for 24 h, and a reused key with another body is a 422. Every mutation
  declares the header in OpenAPI unless `tests/test_idempotency_audit.py` lists why it doesn't
  need one (an id in the body, a DELETE, a one-time secret, a webhook); a new mutation fails that
  test until it does one or the other. All mock and daily-challenge mutations take it.
- **Sync.** `POST /v1/sync/events` stores each event once (`learn.sync_events` is the idempotency
  store) and applies it in its own savepoint, so one bad event is rejected alone. Each event is
  placed on the local day of its own `tz`. The server then recomputes activity days, the streak,
  freezes, plant, pet, XP and badges, and FSRS schedules from history (server values win), and bumps
  the version of each changed section. `GET /v1/sync/state?since=` returns only changed sections.
- **Rules.** `services/gamify.py` (streak, plant, pet) and `services/srs.py` (FSRS) follow
  `packages/app-core` and its flag keys in `packages/config`. Flags are rows in `ops.flags`, served by
  `/v1/config`.

## Jobs and the worker

`JOBS_MODE=inline` (default in local and test) runs a job in-process after the response;
`JOBS_MODE=arq` (default elsewhere) puts it on Redis for `apps/worker`:

```bash
cd apps/worker
uv run python -m smriti_worker                  # default queue: merges, purges, nightly roll-up, upkeep crons
uv run python -m smriti_worker content-publish  # also: ai, media, notifications, pdf
```

| Queue | Jobs |
|---|---|
| default | `merge_guest`, `mocks_auto_submit` (strict and live attempts past their deadline; cron every minute at :30s), `tutor_retention` (deletes tutor messages older than `ai.tutor_retention_days`; cron 02:15 UTC), `purge_deleted_accounts` (cron :20), `nightly_rollup` (cron :05, the timezones whose local midnight just passed), `db_upkeep` (03:00 UTC, only without pg_cron), `league_assign` (hourly), `league_rollover` (Sunday after `league.close_time` IST; safe to re-run), `duo_rollup` (nightly), `duel_sweep` (every minute), `squad_quests` (hourly) |
| ai | `deck_moderation` (retries minors' shared decks still `checking`; cron every 10 minutes on the default worker) |
| notifications | `parent_digest` (the SET-15 weekly push and email to guardians; cron Sunday 13:00 UTC on the default worker, held until 19:00 in the guardian's zone; the email goes through the Mailer at dispatch, to the sign-in address read then) |
| content-publish | `content_publish`: runs `CONTENT_PUBLISH_CMD`, or `tools/content-publish` (package.json `publish` script, `publish.sh` or `run.sh`) when it exists, with `CONTENT_PUBLISH_REF` set |
| ai, media, notifications, pdf | `ping` until their jobs land |

## AI gateway

Features call `smriti_api.ai.gateway.AIGateway`, never a provider SDK. It picks the model for a
tier from `AI_TIER_<TIER>_MODEL`, enforces per-user daily budgets, records usage in
`ai.usage_daily` and `ai.generations` (an input hash, never the text), and logs no prompt or reply.

| Capability | Real provider | Turned on by | Otherwise |
|---|---|---|---|
| Chat, tutor, authoring | Agnes (OpenAI-compatible `/chat/completions`) | `AI_PROVIDER=agnes` (default), `AGNES_BASE_URL`, `AGNES_AI_API_KEY`, `AI_TIER_TUTOR_MODEL`, `AI_TIER_CHEAP_MODEL`, `AI_TIER_AUTHOR_MODEL` | `AI_PROVIDER=fake` |
| Photo doubt reading (AI-18) | Agnes `/chat/completions` with an image part | `AI_TIER_VISION_MODEL` (a vision-capable model; empty means photo doubt answers `ai_unavailable`) | `AI_PROVIDER=fake` |
| Images | Agnes `/images/generations` | `AI_TIER_IMAGE_MODEL` | fake image |
| Text to speech, speech to text | Deepgram | `DEEPGRAM_API_KEY`, `DEEPGRAM_TTS_MODEL`, `DEEPGRAM_STT_MODEL` | fake in local/test; an `AIConfigError` elsewhere |
| Realtime voice tutor | Gemini Live (ephemeral session for the client) | `GEMINI_API_KEY`, `GEMINI_LIVE_MODEL` | same |

The live tests (`RUN_LIVE=1 uv run pytest -m live`) call Agnes once for chat and once for an image.
On 30 Oct 2026 they passed with `AI_TIER_CHEAP_MODEL=agnes-2.5-flash` (a reasoning model: give it a
few hundred output tokens) and `AI_TIER_IMAGE_MODEL=agnes-image-2.1-flash`. These are values for
the environment, not defaults in code. The Deepgram and Gemini Live request shapes have no live test
yet.

## Configuration

Names are in the root `.env.example`; values live in Railway secrets.

| Variable | Default | Meaning |
|---|---|---|
| `APP_ENV` | `local` | `local`, `test`, `staging`, `production`. Dev auth only in local and test |
| `DATABASE_URL` | local `smriti` | `postgresql+asyncpg://…` |
| `DB_SYSTEM_ROLE` | `service_role` | role for recompute and jobs |
| `REDIS_URL` | `redis://127.0.0.1:56379/0` | idempotency, rate limits, config cache, arq |
| `SUPABASE_JWKS_URL`, `JWT_AUDIENCE`, `JWT_ISSUER` | – , `authenticated`, – | token verification |
| `DEV_JWT_SECRET` | random per process | local/test token key |
| `JOBS_MODE` | inline in local/test, arq elsewhere | |
| `CORS_ORIGINS`, `WEB_APP_URL` | – | extra allowed origins |
| `CONTENT_LOCAL_DIR`, `CDN_BASE_URL` | – | where bundles and manifests are read and linked |
| `VARIANTS_DIR` | `packages/config/variants` | app variant files for `/v1/config` |
| `LOG_LEVEL`, `LOG_HASH_SALT` | `INFO`, – | user ids in logs are salted hashes |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | – | traces off when empty |

## OpenAPI and the TypeScript client

The Pydantic models are the OpenAPI source. After changing the API:

```bash
pnpm --filter @smriti/api-client generate     # writes packages/api-client/openapi.json and src/schema.ts
```

`tests/test_openapi_export.py` fails when the committed document is stale.

## Endpoints

| Method | Path | What |
|---|---|---|
| GET | `/healthz`, `/readyz` | liveness, readiness (database and Redis) |
| GET | `/v1/time` | server time (clock skew check) |
| GET | `/v1/config` | variant, flags, free limits, pricing, app version gate (cached 60 s) |
| GET, PATCH | `/v1/me` | profile and settings |
| PUT | `/v1/me/exams` | exam profiles and the primary one |
| GET | `/v1/me/summary` | today, streak, entitlement and limits for Home |
| POST | `/v1/sync/events` | apply a batch of outbox events |
| GET | `/v1/sync/state` | state sections, or only those changed `?since=` |
| POST | `/v1/analytics/events` | packages/analytics batches (1–100 events, 256 KB, `RATE_ANALYTICS_PER_MIN`): checked against `packages/analytics/catalogue.json`, the profile's age band, `analytics_opt_out` and guardian consent; unknown props, personal-data names and free text are removed; rows go to ClickHouse (`CLICKHOUSE_URL`) or locally to `ANALYTICS_EVENTS_FILE`; 503 when neither. See `docs/contracts/analytics-ingest.md` |
| GET | `/v1/catalog/exams`, `/v1/catalog/subjects` | catalogue |
| GET | `/v1/catalog/chapters/{chapter_id}`, `/v1/catalog/topics/{topic_id}` | chapter and topic with bundle links |
| GET | `/v1/content/manifest` | the current content manifest for an exam and locale |
| GET | `/v1/content/files/{path}` | local content files (dev; the CDN serves them elsewhere) |
| POST | `/v1/auth/linked` | after linkIdentity: finish the profile (handle, age rules) |
| POST | `/v1/account/merge-intents` | a guest asks to merge into an existing account |
| POST | `/v1/account/merges` | the account starts the merge (202, a job) |
| GET | `/v1/account/merges/{merge_id}` | merge status |
| DELETE | `/v1/account` | erase a guest now |
| POST, DELETE | `/v1/account/deletion` | schedule (fresh sign-in, grace period) or cancel deletion |
| GET | `/v1/pet`, `/v1/plant` | buddy and plant |
| POST | `/v1/pet/care` | pet, play, feed |
| POST | `/v1/streak/freeze` | equip a freeze |
| POST | `/v1/streak/rest-day` | plan a rest day |
| DELETE | `/v1/streak/rest-day/{day}` | cancel it |
| GET | `/v1/shop` | items, prices, owned |
| POST | `/v1/shop/purchase` | buy with gems |
| GET | `/v1/gems/ledger` | gem history (cursor pages) |
| GET | `/v1/quests` | quests and progress |
| POST | `/v1/quests/{quest_id}/claim` | claim a reward |
| GET | `/v1/badges` | badges and when earned |
| POST | `/v1/dev/auth/anonymous`, `/v1/dev/auth/google`, `/v1/dev/auth/refresh` | local/test stand-ins for Supabase Auth |

### Practice, mocks and the tutor

| Method | Path | What |
|---|---|---|
| GET | `/v1/practice/limits`, `/v1/practice/hub` | free counters for today and this week; the practice hub |
| GET | `/v1/practice/weak-spots`, `/v1/practice/drill` | weak spots from mastery; drill questions for a concept or topic |
| POST, GET | `/v1/practice/sessions` | start a session; recent sessions |
| GET | `/v1/practice/sessions/{session_id}` | a session |
| POST | `/v1/practice/sessions/{session_id}/answers` | check an answer on the server (vectors shared with lesson-core) |
| POST | `/v1/practice/sessions/{session_id}/complete` | end a session |
| GET | `/v1/pyq/papers`, `/v1/pyq/papers/{paper_id}`, `/v1/pyq` | past papers, one paper, filtered PYQs |
| GET | `/v1/daily-challenge/today` | today's challenge (IST date) |
| POST | `/v1/daily-challenge/{challenge_id}/start`, `.../answer` | the server clock starts; answer once |
| GET | `/v1/daily-challenge/{challenge_id}/leaderboard` | ranks once enough players have played |
| GET | `/v1/mocks`, `/v1/mocks/{mock_id}` | full, sectional, PYQ and published mocks, with access |
| POST | `/v1/mocks/generate` | a custom or chapter mock from the bank |
| POST | `/v1/mocks/{mock_id}/attempts` | start an attempt (paper pinned, server timer) |
| GET | `/v1/attempts`, `/v1/attempts/{attempt_id}` | past attempts; one attempt with its timer and section state |
| PUT | `/v1/attempts/{attempt_id}/answers` | autosave (refuses locked sections and a replaced device) |
| POST | `/v1/attempts/{attempt_id}/pause`, `/resume`, `/takeover`, `/abandon` | attempt lifecycle |
| POST | `/v1/attempts/{attempt_id}/sections/{code}/submit` | close a section |
| POST | `/v1/attempts/{attempt_id}/submit` | submit and score (idempotency key) |
| GET | `/v1/attempts/{attempt_id}/report`, `/solutions` | score, standing, time and topic analysis; solutions |
| POST, GET | `/v1/tutor/sessions` | open or reuse a chat; list chats |
| GET, DELETE | `/v1/tutor/sessions/{session_id}` | one chat; delete it |
| POST | `/v1/tutor/sessions/{session_id}/messages` | ask (SSE: delta, replace, safety, citations, chips, quota, done) |
| POST | `/v1/tutor/ask/card`, `/v1/tutor/ask/question` | ask about a card or a question (SSE, `session` event first) |
| POST | `/v1/tutor/messages/{message_id}/feedback` | thumbs up or down with reasons |
| GET | `/v1/ai/doubt-photos/{id}/similar?count=` | AI-19: course concepts the confirmed question matches and published practice questions on them (a PRC-03 fixed set) |
| POST, GET | `/v1/roleplay/chats`, `/v1/roleplay/chats/{id}` | AI-21: start (or resume) the role play for a published card; the chat with goals met and the summary. See `docs/contracts/roleplay.md` |
| POST | `/v1/roleplay/chats/{id}/turns`, `.../wrap-up` | a suggested reply or typed text (under-13s: replies only); end now |
| POST, GET | `/v1/content/reports` | report content (SET-24); my reports |

### Social (Phase 2)

Every route runs the social gate: guests get `login_required`, class 1-5 `social_not_available`,
minors without the guardian's `social` scope `guardian_consent_required`. No free text between
students; minors show by pet avatar and auto nickname (pet name to invite or QR friends).

| Method | Path | What |
|---|---|---|
| GET | `/v1/social/gate`, `/v1/social/overview` | the SOC-02 state; SOC-01 in one call |
| GET, PUT | `/v1/social/me`, `/v1/social/me/handle`, `/v1/social/me/privacy` | handle, nickname, privacy; `POST /v1/social/me/first-visit` |
| GET | `/v1/social/handles/{handle}` | is a username free |
| GET | `/v1/friends`, `/v1/friends/search?handle=` | friends; exact-handle search for adults |
| GET, POST | `/v1/friends/invite`, `/v1/friends/invite/{code}`, `.../accept` | invite link and QR; preview; add |
| POST | `/v1/friends/requests`, `.../{user_id}/accept`, `.../decline` | requests between adults |
| DELETE | `/v1/friends/{user_id}` | remove a friend (silent) |
| GET | `/v1/social/people/{user_id}` | mini profile (pet, tier, streak) |
| GET, POST | `/v1/social/inbox`, `/v1/social/inbox/seen` | requests, invites, cheers |
| POST | `/v1/social/nudges` | preset cheer or nudge (rate limited by flag) |
| GET, POST, DELETE | `/v1/social/feed`, `/v1/social/reactions` | friend activity and reactions |
| POST | `/v1/social/reports` | report a person or a deck |
| GET, POST, DELETE | `/v1/social/blocks` | block and unblock |
| GET, POST, DELETE | `/v1/duos`, `/v1/duos/{id}/accept`, `/decline`, `/nudge` | Duo streaks |
| GET, POST, DELETE | `/v1/squads`, `/v1/squads/join/{code}`, `/v1/squads/{id}`, `.../members/{user_id}`, `.../code`, `.../cheer` | squads |
| GET, POST, PUT | `/v1/leagues/current`, `/v1/leagues/result`, `/v1/leagues/join`, `/v1/leagues/opt-out` | weekly leagues |
| GET | `/v1/leaderboards?scope=&period=&squad_id=` | friends, squad, school, city, all India |
| GET, POST | `/v1/duels`, `/v1/duels/{id}`, `/v1/duels/code/{code}` | create (friend or solo), read |
| POST, GET, DELETE | `/v1/duels/random` | random matching queue |
| POST | `/v1/duels/{id}/accept`, `/decline`, `/async`, `/answers`, `/leave`, `/rematch` | duel actions (answers take an idempotency key) |
| GET | `/v1/duels/{id}/events?after=`, `/v1/duels/{id}/stream` | the duel channel by polling or SSE |
| POST, DELETE | `/v1/decks/{deck_id}/share` | share (moderated) or stop sharing |
| GET, POST, PUT | `/v1/shared-decks`, `/v1/shared-decks/{code}`, `.../copy`, `.../helpful` | find, preview, copy, vote |

A minor's deck that the model can't check stays `checking` with no link until the `deck_moderation` job gets a clear answer; adults' decks fail open.

### Parent mode (Phase 3)

Every guardian call needs a live `app.guardian_links` row and an active consent for the child; otherwise 404 `learner_not_found`.

| Method | Path | What |
|---|---|---|
| GET | `/v1/guardian/dashboard` | SET-14 child cards: pet, minutes this week, streak, practice questions, last mock, "Needs you" |
| GET | `/v1/guardian/learners/{id}/report?week=` | SET-15 weekly report (counts and topic names only) |
| GET, PUT | `/v1/guardian/learners/{id}/controls` | time limit, allowed hours, break reminders, ask-before-switching, tutor button, Picture rhymes, tutor on/off, social on/off, weekly report |
| POST | `/v1/guardian/time-requests/{id}/decision` | allow or decline a SET-19 ask (the child gets the SET-19 line by push) |
| POST | `/v1/guardian/children` | AUTH-24/26: create a managed child, adopting this device's guest (`adopt_guest`) or a new account; consent `parent_created` |
| POST | `/v1/guardian/children/{id}/session` | one-time token hash for a child session (`verifyOtp` type `email`; locally `/v1/dev/auth/verify-otp`); needs a sign-in in the last 10 minutes |
| DELETE | `/v1/guardian/children/{id}` | schedule the child's erasure after the grace period |
| POST | `/v1/guardian/link-requests` | AUTH-27 (SET-18 path 2): ask to link an existing teen by their sign-in email or invite code, or as a QR code the teen claims; `Idempotency-Key` required; `auth.link_requests_per_day` per guardian (429 `rate_limited`), open for `auth.link_request_ttl_h`; the answer never says whether an account matched |
| GET, DELETE | `/v1/guardian/link-requests`, `.../link-requests/{id}` | the guardian's requests (the teen's name only once accepted), or withdraw an open one |
| GET | `/v1/me/link-requests` | the teen's open requests ("Link {parent_first_name} as your guardian?"); also counted as `pending_link_requests` on `GET /v1/guardian/consent`, and pushed as `guardian_link_request` |
| POST | `/v1/me/link-requests/claim` | the teen scanned or typed the guardian's code |
| POST | `/v1/me/link-requests/{id}/accept`, `.../decline` | accept records the teen's evidence and opens the §6.10 consent request (`initiated_by = 'guardian'`, same code) that only that guardian can confirm on AUTH-20; decline links nothing |
| GET, POST | `/v1/guardian/learners/{id}/pro`, `.../pro/verify`, `.../pro/cancel` | PAY-17: a plan on the child's account with `payer = guardian`; only the guardian manages it |
| GET, DELETE | `/v1/guardian/learners/{id}/friends`, `.../friends/{friend_id}` | the parent friends list (B13) |
| GET | `/v1/me/limits` | the child's limits for today, cached by the device |
| GET | `/v1/guardian/consent-notice?locale=` | the current consent notice version and full-notice URL (owner flags `auth.consent_notice_version`, `auth.consent_notice_url`); `published: false` until set. Confirm, accept and child creation answer 409 `consent_notice_outdated` when the client's `notice_version` is stale |
| DELETE | `/v1/guardian/consent-requests/{id}` | the teen cancels a pending consent request (204) |
| POST | `/v1/me/time-requests` | "Ask for 15 more minutes": pushes every linked guardian |

### Plans (PRD §11.2)

`POST /v1/billing/razorpay/subscription` takes `plan`: `monthly` (default, with the ₹1 intro), `yearly` (₹799) or `family_monthly` / `family_yearly` (hidden until the owner sets `billing.family_seats` and the price flag).

| Method | Path | What |
|---|---|---|
| GET | `/v1/billing/family` | the payer's seats, members and invites, or a member's view |
| POST, DELETE | `/v1/billing/family/members`, `.../members/{user_id}` | the payer adds a linked child; the payer removes someone or a member leaves |
| POST, DELETE | `/v1/billing/family/invites`, `.../invites/{id}` | a code for an adult (shown once), or withdraw it |
| POST | `/v1/billing/family/invites/{code}/accept` | an adult joins (minors join through Parent mode) |
| POST, DELETE | `/v1/billing/child-payment-links`, `.../child-payment-links/{id}` | PAY-17: a teen makes a short-lived pay link (`pay.child_link_ttl_h`, one open at a time) for a guardian, or withdraws it |
| GET, POST | `/v1/billing/child-payment-links/{token}`, `.../{token}/subscription`, `.../{token}/verify` | the guardian's side, without signing in: what the link pays for, then the Razorpay checkout (`Idempotency-Key` required) and its verification; IP rate-limited |
