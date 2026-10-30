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
  response is replayed for 24 h, and a reused key with another body is a 422.
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
| default | `merge_guest`, `purge_deleted_accounts` (cron :20), `nightly_rollup` (cron :05, the timezones whose local midnight just passed), `db_upkeep` (03:00 UTC, only without pg_cron) |
| content-publish | `content_publish`: runs `CONTENT_PUBLISH_CMD`, or `tools/content-publish` (package.json `publish` script, `publish.sh` or `run.sh`) when it exists, with `CONTENT_PUBLISH_REF` set |
| ai, media, notifications, pdf | `ping` until their jobs land |

## AI gateway

Features call `smriti_api.ai.gateway.AIGateway`, never a provider SDK. It picks the model for a
tier from `AI_TIER_<TIER>_MODEL`, enforces per-user daily budgets, records usage in
`ai.usage_daily` and `ai.generations` (an input hash, never the text), and logs no prompt or reply.

| Capability | Real provider | Turned on by | Otherwise |
|---|---|---|---|
| Chat, tutor, authoring | Agnes (OpenAI-compatible `/chat/completions`) | `AI_PROVIDER=agnes` (default), `AGNES_BASE_URL`, `AGNES_AI_API_KEY`, `AI_TIER_TUTOR_MODEL`, `AI_TIER_CHEAP_MODEL`, `AI_TIER_AUTHOR_MODEL` | `AI_PROVIDER=fake` |
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
