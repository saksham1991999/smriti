# Local development

How to run the whole of Smriti on one machine, without Docker. Postgres 16 and Redis run as native
processes (`scripts/dev/db.sh`). The API, the worker and the web app run from the workspace.

## Prerequisites

- Node 22 and pnpm 10, then `pnpm install`
- Python 3.12 and uv, then `uv sync` in `apps/api` and in `apps/worker`
- Postgres 16 binaries in `/usr/lib/postgresql/16/bin`, or set `PGBIN`
- `redis-server` and `redis-cli` on the `PATH`

## One command: `pnpm stack`

```sh
pnpm stack                # reset the stack database, publish content/, start API, worker, web
pnpm stack --keep-db      # keep the database; create it only when it is missing
pnpm stack --no-web       # API and worker only
```

`pnpm stack` runs `scripts/dev/stack.sh`, which does the following in order:

1. **Database.** `db.sh reset` (or `up` with `--keep-db`) on the `smriti_stack` database. This starts
   Postgres on port 54322 and Redis on port 56379, then applies `supabase/local/*.sql`, every migration
   and `supabase/seed.sql`, then `supabase/seed_dev.sql` (dev quests for ME-20; local only, release
   runs `migrate --seed`, which reads `seed.sql` alone).
2. **Content.** Runs the real content publish (`@smriti/content-publish publish:local`) on `content/`
   into `.dev/stack/content`, as a local build (`--env local`): media that is not approved yet ships as
   unavailable and is listed in `publish-report.json` (`unapproved_media` and the warnings); only
   `--env production` refuses it. It then applies that folder's `metadata.sql` to the database and
   rebuilds `content.card_index` from the lesson files (`scripts/dev/card_index.py`), as the
   worker's `content_publish` job does.

   `tools/content-publish/out` stays the fixture course, which the API tests and the web e2e use.
3. **Processes.** Each one runs in its own process group, with its log in `.dev/stack/logs/`:
   - the API: `uvicorn smriti_api.main:app`, with `APP_ENV=local`, `JOBS_MODE=arq`, and
     `AI_PROVIDER` from your environment (default `fake`)
   - the arq **default** worker, which also runs the crons
   - the web app in `dev:api` mode, so it talks to the real API with dev sign-in
4. **URLs.** Prints the URLs and waits. **Ctrl-C stops every process it started.** Postgres and
   Redis keep running; stop them with `pnpm db:down`.

| What | Where |
|---|---|
| API | http://127.0.0.1:8000 (OpenAPI at `/docs`) |
| Web app | http://127.0.0.1:5173 |
| Published content | `/v1/content/files/...` on the API (the CDN's job in production) |
| Logs | `.dev/stack/logs/{db,publish,api,worker,web}.log` |

### Settings

| Variable | Default | Notes |
|---|---|---|
| `STACK_DB` | `smriti_stack` | `db.sh` also makes `<name>_test` |
| `API_PORT`, `WEB_PORT` | `8000`, `5173` | The script stops if a port is taken |
| `REDIS_DB` | `5` | Redis is shared, so the stack uses its own index |
| `AI_PROVIDER` | `fake` | `agnes` needs `AGNES_AI_API_KEY` and the `AI_TIER_*_MODEL` names |

The stack sets these for the API and the worker: `CONTENT_LOCAL_DIR`, `CONTENT_MANIFEST_PATH`,
`CONTENT_ROOT`, `CONTENT_PUBLISH_REPORT_DIR`, `JOBS_MODE=arq`, `API_PUBLIC_URL` and `WEB_APP_URL`.
It sets these for the web app: `VITE_API_BASE_URL`, `VITE_AUTH_MODE=dev`, `VITE_APP_ENV=local` and
`VITE_APP_VARIANT=all`.

Fakes in the local stack, all named as such in code:

- `FakeRazorpay`, with the dev webhook secret
- the fake push and mail senders
- the dev auth routes `/v1/dev/auth/*`, which stand in for Supabase Auth
- the `fake` AI provider, unless you set another

Postgres, Redis, the API, the worker, the job queue and the content are real.

The Supabase Auth calls the local stack fakes (managed child identities, token hashes, the sign-up hook) still need one run against a real project: `docs/SUPABASE_SPIKE.md` lists each request and what to check.

## Smoke journey: `pnpm stack:smoke`

```sh
pnpm stack:smoke
API_PORT=18080 WEB_PORT=15173 STACK_DB=smriti_stack_b pnpm stack:smoke   # beside another stack
```

This starts the stack, runs `scripts/dev/stack_smoke.py` against it, stops everything, and exits
non-zero on the first failed step. The journey is all HTTP:

1. A guest session (`/v1/dev/auth/anonymous`).
2. Onboarding answers as sync events: the exam, class, birth year, level and daily goal.
3. The `jee-main-2027` manifest from `/v1/content/manifest`. It picks a Current Electricity topic
   (`phy.current-electricity.*`), downloads its Quick Revision bundle, and checks the bytes against
   the manifest hash.
4. Lesson events for that bundle's cards: started, each card viewed, completed.
5. A streak of 1 in `/v1/sync/state`.
6. Dev Google sign-in linked to the guest. The user id stays the same.
7. A practice drill on that topic. Each question is answered from the published practice bundle's
   answer key, and the server must mark it correct.
8. A tutor message (SSE), with the stack's `AI_PROVIDER`.
9. A web checkout (`/v1/billing/razorpay/subscription`), then a signed `subscription.activated`
   webhook. Pro must then be on in `/v1/billing/entitlement`.
10. The web app's index page (skipped with `--no-web`).

The journey writes no study content. Lessons and questions come from the published bundles.

## Other commands

| Task | Command |
|---|---|
| Databases only | `pnpm db:up`, `pnpm db:reset`, `pnpm db:down` |
| API tests | `cd apps/api && uv run pytest` (needs `pnpm db:up`; uses `smriti_test`) |
| Fixture content for tests | `pnpm --filter @smriti/content-publish publish:fixtures` |
| Two worktrees on one Postgres | `SMRITI_DB_NAME=smriti_a pnpm db:reset`, then point `DATABASE_URL` at it |
