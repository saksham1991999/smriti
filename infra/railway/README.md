# Railway: API and worker

One Railway project, `smriti`, with two environments, `staging` and `production`, and three
services in each. The first deploy is in [docs/DEPLOY.md](../../docs/DEPLOY.md).

| Service | Source | Config file (service Settings > Config-as-code) | Start | Health |
|---|---|---|---|---|
| `api` | this repo, root directory `/` | `/infra/railway/api.railway.json` | Gunicorn with Uvicorn workers (`smriti_api.server.Worker`) on `$PORT`, `WEB_CONCURRENCY` workers; the Dockerfile `CMD` | `/readyz` (Postgres and Redis) gates each deploy; Docker `HEALTHCHECK` on `/healthz` |
| `worker` | this repo, root directory `/` | `/infra/railway/worker.railway.json` | `python -m smriti_worker` (`WORKER_QUEUE=all`) | Docker `HEALTHCHECK`: `python -m smriti_worker.health` reads each queue's arq key |
| `Redis` | Railway's Redis template | none | | |

There is no separate cron service. The arq crons run inside the worker's `default` queue
(`apps/worker/smriti_worker/main.py`). Every cron is `unique`, so a second worker replica never
runs a cron twice. To scale one queue on its own, add a service from the same config with
`WORKER_QUEUE=<queue>` and take that queue out of the first service's list, e.g.
`default,ai,media,notifications,content-publish`. Every queue needs a consumer somewhere.

## The API process

TRD §5 runs Uvicorn workers under Gunicorn. Gunicorn binds `0.0.0.0:$PORT`, starts
`WEB_CONCURRENCY` workers (2 by default in the image), restarts any that die, and kills a worker
whose event loop stops checking in for 30 seconds (`--timeout`). Uvicorn's own `--workers` mode
restarts dead workers too, but its health ping is answered from a thread, so it can't see a stuck
loop. On a deploy, Gunicorn gives open requests 20 seconds (`--graceful-timeout`), inside
Railway's `drainingSeconds` of 25. Proxy headers are trusted from any address because only
Railway's edge reaches the service. The start command is the Dockerfile `CMD`; api.railway.json
does not override it.

## Release step: migrations

`api.railway.json` runs `python -m smriti_api.migrate --seed` as Railway's **pre-deploy command**.
It runs in the new image, with the service's variables, before traffic moves. If it fails, the
deploy stops and the old version keeps serving.

- It applies the files in `supabase/migrations/` that are not yet recorded in
  `supabase_migrations.schema_migrations`. That is the Supabase CLI's own history table, so
  `supabase migration list` agrees with it. Each file runs in one transaction with its history row.
- A second run applies nothing, so the step is idempotent. An advisory lock means two deploys
  never migrate at once. The lock needs a session connection, so set `MIGRATIONS_DATABASE_URL` to
  Supabase's direct or session-pooler URL (port 5432), not the transaction pooler.
- `--seed` re-applies `supabase/seed.sql`. It holds config rows only, all `on conflict do nothing`,
  so a value the owner changed later is never overwritten.
- Migrations must stay backward compatible with the version still serving: add, backfill, then
  remove in a later release. During a deploy the old API runs against the new schema for up to
  `overlapSeconds`.
- The worker has no pre-deploy step. The deploy workflow deploys `api` (and so migrates) before
  `worker`.

## Deploys

Turn off Railway's GitHub auto-deploy for both services (Settings > Source > disconnect, or no
trigger branch). `.github/workflows/deploy-backend.yml` deploys with `railway up --ci` after CI
has passed: `staging` on every green `main`, `production` on a `v*` tag after the GitHub
`production` environment's reviewers approve. The CLI authenticates with a project token per
environment, `RAILWAY_TOKEN`, stored as a GitHub environment secret.

## Variables (names only; values in Railway)

Put the names both services share in a **shared variable** group and reference it from each
service. Reference the Redis service as `REDIS_URL=${{Redis.REDIS_URL}}` (private network).

**Both `api` and `worker`:**
`APP_ENV` (`staging` or `production`), `DATABASE_URL`, `REDIS_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS_URL`, `JWT_ISSUER`,
`LOG_HASH_SALT`, `API_PUBLIC_URL`, `WEB_APP_URL`, `CDN_BASE_URL`, `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_ASSETS`, `R2_BUCKET_CONTENT`,
`R2_BUCKET_UPLOADS`, `AGNES_AI_API_KEY`, `AI_TIER_TUTOR_MODEL`, `AI_TIER_CHEAP_MODEL`,
`AI_TIER_AUTHOR_MODEL`, `AI_TIER_IMAGE_MODEL`, `GEMINI_API_KEY`, `GEMINI_LIVE_MODEL`,
`DEEPGRAM_API_KEY`, `DEEPGRAM_TTS_MODEL`, `DEEPGRAM_STT_MODEL`, `CLICKHOUSE_URL`,
`CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`, `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_ID`, `RAZORPAY_INTRO_OFFER_ID`,
`REVENUECAT_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `AUTH_IDENTITY_HASH_PEPPER`,
`MANAGED_IDENTITY_DOMAIN`, `GUARDIAN_LINK_BASE_URL`, `BRAND_NAME`, `MAIL_PROVIDER`, `MAIL_FROM`,
`RESEND_API_KEY`, `PUSH_PROVIDER`, `EXPO_ACCESS_TOKEN`, `WEB_PUSH_VAPID_PRIVATE_KEY`,
`WEB_PUSH_VAPID_SUBJECT`, `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`, `PLAY_INTEGRITY_PACKAGES`,
`APP_ATTEST_APP_IDS`, `APP_ATTEST_ENVIRONMENT`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS`, `SENTRY_DSN` (a different DSN per service is fine).

**`api` only:** `MIGRATIONS_DATABASE_URL`, `CORS_ORIGINS` (if more than `WEB_APP_URL`),
`WEB_CONCURRENCY`, `OTEL_SERVICE_NAME=smriti-api`, and for Sign in with Apple token revocation
on account deletion `APPLE_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY`,
`APPLE_SIGNIN_CLIENT_IDS`.

**`worker` only:** `WORKER_QUEUE=all`, `OTEL_SERVICE_NAME=smriti-worker`. With `all`, each of
the six queue workers opens its own database pool, up to 10 connections each (`jobs.startup`),
so allow about 60 client connections on the Supavisor pooler.

Optional names and their defaults are in [.env.example](../../.env.example). Never set `JOBS_MODE`,
`DEV_JWT_SECRET`, `AI_PROVIDER=fake` or `ATTESTATION_PROVIDER=fake` outside local and test.
