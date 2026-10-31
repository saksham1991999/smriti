# First deploy runbook

This is the owner's checklist for the first staging and production deploy. Follow it in order:
later steps need the values earlier steps create. It lists names only. Never paste a value into
the repo, an issue or a pull request. Values go in the store named at each step.

How the pieces fit (TRD §4, §17):

| Part | Runs on | Config | Deployed by |
|---|---|---|---|
| API (`apps/api`) | Railway service `api` | `infra/railway/api.railway.json`, `apps/api/Dockerfile` | `.github/workflows/deploy-backend.yml` |
| Worker and crons (`apps/worker`) | Railway service `worker` | `infra/railway/worker.railway.json`, `apps/worker/Dockerfile` | `deploy-backend.yml` |
| Redis | Railway Redis | none | Railway |
| Database and auth | Supabase | `supabase/migrations/`, `supabase/seed.sql` | the API's pre-deploy step (`python -m smriti_api.migrate --seed`) |
| Web app (`apps/web`) | Cloudflare Worker `smriti-web` | `infra/cloudflare/web/wrangler.jsonc` | `deploy-web.yml` |
| Marketing site (`apps/site`) | Cloudflare Worker `smriti-site` | `infra/cloudflare/site/wrangler.jsonc` | `deploy-web.yml` |
| CDN for content, media and sims | Cloudflare Worker `smriti-cdn` over R2 | `infra/cloudflare/cdn/wrangler.jsonc` | `deploy-web.yml` |
| Content bundles, media and sims | R2 | `tools/content-publish` | `deploy-content.yml` |
| Mobile apps | EAS Build | `apps/mobile/eas.json`, `app.config.ts` | `deploy-mobile.yml` |

Release rules, which every deploy workflow enforces through `.github/workflows/deploy-gate.yml`:

- **Staging** deploys on every push to `main` whose CI run passed.
- **Production** deploys on a tag (`v*` for backend, web, site and content; `mobile-v*` for the
  apps). It runs only if CI passed on that commit, and only after a reviewer approves the GitHub
  `production` environment.
- Each job checks that its secrets exist first. While they are missing it skips with a notice
  instead of failing, so you can merge this before any account exists.

The detailed notes behind each step are in `infra/railway/README.md`,
`infra/cloudflare/README.md` and `infra/eas/README.md`. Every environment variable is listed, with
a one-line meaning, in `.env.example` (server) and `apps/web/.env.example`,
`apps/mobile/.env.example` and `apps/site/.env.example` (public build config).

---

## 0. Decide the domain

The brand and domain are open (TRD D7). Everything below writes the domain as `<domain>`. Pick it
first, because OAuth consent screens, store listings, deep links and email all use it.

Once it is chosen, set it in one place: `domain` in `packages/config/brand.json` (now the
working name, `smriti.app`). Each variant's deep link prefix is that domain plus the variant's
`deepLinkPath`, and the mobile app's associated domains, the site's app link files and the API's
`/v1/config` all derive from it. The bundle ids (`bundleId`, `androidPackage` in
`packages/config/variants/*.json`) also follow the brand, and must be final before step 7.

`GUARDIAN_LINK_BASE_URL` defaults to `WEB_APP_URL` plus `/guardian/`, so it needs setting only if
the consent page lives elsewhere.

## 1. Create the accounts

Create these in this order. Use a shared company login with two-factor authentication, not a
personal account, and record who has access.

1. **GitHub**: the organisation that owns this repository (it exists).
2. **Cloudflare**: holds the domain's DNS zone, the Workers, R2 and Turnstile.
3. **Supabase**: two projects, `smriti-staging` and `smriti-production`. Pick the region closest
   to India that Supabase offers, the same for both.
4. **Railway**: one project, `smriti`. Pick the region closest to the Supabase region.
5. **Google Cloud**: one project for OAuth clients and the Play Integrity API.
6. **Apple Developer Program** (organisation enrolment, which needs a D-U-N-S number): Sign in
   with Apple, App Attest, push and App Store Connect.
7. **Google Play Console** (organisation account).
8. **Expo** (EAS): one organisation for builds, updates and push.
9. **Agnes AI**: LLM calls and all image generation.
10. **Google AI Studio or Vertex AI**: the Gemini Live key for the voice tutor.
11. **Deepgram**: text-to-speech and speech-to-text.
12. **ClickHouse Cloud**: the analytics event store.
13. **Grafana Cloud**: dashboards on ClickHouse, and the OTLP endpoint for traces.
14. **Sentry**: error reporting for the API, worker, web and mobile.
15. **Razorpay**: web subscriptions. Business KYC takes days, so start early.
16. **RevenueCat**: App Store and Play subscriptions.
17. **Resend**: transactional email (guardian consent links).

## 2. DNS records (Cloudflare zone for `<domain>`)

Move the domain's nameservers to Cloudflare first. Then create the records below as each service
asks for them in later steps. The Worker domains are added from Cloudflare itself (step 4.5), which
creates their records.

| Name | Type | Target | Proxy | Created in |
|---|---|---|---|---|
| `<domain>`, `www` | Worker custom domain | `smriti-site` (production) | proxied | step 4.5 |
| `staging` | Worker custom domain | `smriti-site-staging` | proxied | step 4.5 |
| `app` | Worker custom domain | `smriti-web` (production) | proxied | step 4.5 |
| `app-staging` | Worker custom domain | `smriti-web-staging` | proxied | step 4.5 |
| `cdn` | Worker custom domain | `smriti-cdn` (production) | proxied | step 4.5 |
| `cdn-staging` | Worker custom domain | `smriti-cdn-staging` | proxied | step 4.5 |
| `api` | CNAME, plus any TXT Railway shows | the target Railway shows for `api` in production | DNS only | step 5.6 |
| `api-staging` | CNAME, plus any TXT Railway shows | the target Railway shows for `api` in staging | DNS only | step 5.6 |
| `auth`, `auth-staging` (optional) | CNAME and TXT | what Supabase shows for a custom domain | DNS only | step 3.9 |
| the sending subdomain Resend asks for | TXT (SPF), TXT (DKIM), MX | the values Resend shows | DNS only | step 9 |
| `_dmarc` | TXT | a DMARC policy, starting with `p=none` and a report address | DNS only | step 9 |
| `managed` | MX `0 .` (null MX) | none | DNS only | step 3.8 |

Keep `api` and `auth` as DNS only (grey cloud): Railway and Supabase issue their own certificates,
and the API's WebSocket and server-sent event streams should not pass through a second proxy.

## 3. Supabase (do each step in both projects)

1. **API keys.** Settings > API: copy the project URL, the anon key and the service role key.
   They become `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. The service role
   key is a secret: it goes to Railway only.
2. **Signing keys.** Settings > JWT Keys: switch to asymmetric signing keys, so the API verifies
   tokens against the public keys. Set:
   - `SUPABASE_JWKS_URL` = `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`
   - `JWT_ISSUER` = `https://<project-ref>.supabase.co/auth/v1`
   (If you add a custom domain in step 9, use the same paths on that domain only if the tokens'
   `iss` changes to it. Check one token's `iss` before you change `JWT_ISSUER`.)
3. **Database URLs.** Settings > Database > Connection string:
   - `DATABASE_URL`: the **transaction pooler** (port 6543), with the scheme changed to
     `postgresql+asyncpg://`. Used by the API and worker.
   - `MIGRATIONS_DATABASE_URL`: the **direct** or **session pooler** URL (port 5432), same scheme.
     The migrator takes an advisory lock, which a transaction pooler can't hold.
   - The pooler's client limit must allow about 60 connections for the worker plus the API's pool
     (`infra/railway/README.md`). Raise the pool size or the compute size if it doesn't.
4. **Do not run `supabase db push`.** The API's pre-deploy step applies `supabase/migrations/` and
   records each file in `supabase_migrations.schema_migrations`, the same table the CLI uses, so
   `supabase migration list` stays correct. To apply them before the first deploy, run once from a
   trusted machine: `MIGRATIONS_DATABASE_URL=... uv run --package smriti-api python -m smriti_api.migrate --seed`.
5. **Auth > Sign In / Providers:**
   - Turn on **anonymous sign-ins** (guest learners start as anonymous users).
   - Turn on **Google**. Client IDs: the web client ID plus every iOS client ID from step 6, comma
     separated (`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`). Secret: the web client's secret
     (`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`). Turn on "skip nonce check" only if the mobile
     Google library can't pass a nonce; the apps send one.
   - Turn on **Apple**. Client IDs: every variant's bundle ID (`SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID`).
     Secret: the client secret JWT from step 7 (`SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`). It expires
     after at most six months, so put a renewal reminder in the calendar.
   - Both apps sign in with ID tokens (`signInWithIdToken`), so no OAuth redirect is used today.
     Still set **URL Configuration > Site URL** to `https://app.<domain>` (staging:
     `https://app-staging.<domain>`) and add the same to the redirect allow list.
6. **Auth > Attack Protection:** turn on captcha with **Cloudflare Turnstile** and paste the
   Turnstile secret from step 4.4 (`TURNSTILE_SECRET_KEY`). The web app sends the token with the
   anonymous sign-in (`VITE_TURNSTILE_SITE_KEY`).
7. **Backups.** Production: turn on point-in-time recovery when the plan allows. Download one
   backup and restore it into a scratch project once, so you know the steps work.
8. **Managed child identities.** Set `MANAGED_IDENTITY_DOMAIN` to `managed.<domain>`. It is used
   only as the address domain of internal identities for managed children. The null MX record in
   step 2 makes sure no mail is ever delivered there.
9. **Custom auth domain (optional, paid add-on).** Settings > Custom Domains: `auth.<domain>`.
   Add the CNAME and TXT it shows (step 2). Then change `SUPABASE_URL`, `VITE_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_URL` to it, and add it to the Google and Apple provider settings.

## 4. Cloudflare

You need the account ID (dashboard sidebar): it is `CLOUDFLARE_ACCOUNT_ID` and also
`R2_ACCOUNT_ID`.

### 4.1 R2 buckets

Create these eight buckets (R2 > Create bucket). None of them gets a public `r2.dev` URL or a
public bucket domain. The CDN Worker is the only public way in.

| Production | Staging | Holds |
|---|---|---|
| `smriti-assets` | `smriti-assets-staging` | media and sims, served by `smriti-cdn` |
| `smriti-content` | `smriti-content-staging` | content bundles, patches and manifests, served at `/c/` |
| `smriti-uploads` | `smriti-uploads-staging` | private user files, signed URLs only |
| `smriti-staging` | `smriti-staging-staging` | private agent-made media waiting for QA (R55) |

Content and media keys are content-addressed and immutable: a changed file always gets a new name,
and the publisher uploads them with `Cache-Control: public, max-age=31536000, immutable`. Only the
manifests and `sims/index.json` change in place (`max-age=300`), so no cache purge is ever needed.

### 4.2 Uploads CORS

Browsers send files straight to signed URLs on the uploads bucket, so it needs a CORS rule. In R2 >
`smriti-uploads` > Settings > CORS policy, allow origin `https://app.<domain>`, methods `PUT` and
`GET`, header `Content-Type`, exposed header `ETag`, max age 3600. Do the same on
`smriti-uploads-staging` with `https://app-staging.<domain>`.

### 4.3 API tokens

1. **R2 token for Railway** (R2 > Manage API tokens): Object Read & Write on `smriti-assets`,
   `smriti-content` and `smriti-uploads` (and their staging twins in a second token). The access key
   ID and secret become `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in Railway. The S3 endpoint it
   shows is `R2_ENDPOINT` (optional; derived from `R2_ACCOUNT_ID` when empty).
2. **R2 token for GitHub content publish**: Object Read & Write on `smriti-assets` and
   `smriti-content` only. It becomes the GitHub secrets `R2_ACCESS_KEY_ID` and
   `R2_SECRET_ACCESS_KEY` (step 8).
3. **Cloudflare API token for GitHub** (My Profile > API Tokens > Create token, "Edit Cloudflare
   Workers" template): Account > Workers Scripts: Edit, Account > Workers R2 Storage: Read (for the
   bindings), Zone > Workers Routes: Edit on `<domain>`. It becomes `CLOUDFLARE_API_TOKEN`.

### 4.4 Turnstile

Turnstile > Add widget, hostnames `app.<domain>` and `app-staging.<domain>`, managed mode. The site
key is `VITE_TURNSTILE_SITE_KEY` (public). The secret key is `TURNSTILE_SECRET_KEY`, which goes into
Supabase (step 3.6), not Railway.

### 4.5 Workers and their domains

The first `deploy-web.yml` run creates the Workers (step 10). Afterwards, in Workers & Pages >
each Worker > Settings > Domains & Routes, add the custom domains from step 2:

- `smriti-site`: `<domain>` and `www.<domain>`; `smriti-site-staging`: `staging.<domain>`.
- `smriti-web`: `app.<domain>`; `smriti-web-staging`: `app-staging.<domain>`.
- `smriti-cdn`: `cdn.<domain>`; `smriti-cdn-staging`: `cdn-staging.<domain>`.

Then set `CDN_BASE_URL=https://cdn.<domain>` (staging `https://cdn-staging.<domain>`) everywhere it
is listed: Railway, the GitHub variables and EAS.

### 4.6 What the Cloudflare config sends

You don't set these by hand. They are generated per build by `tools/deploy/src/headers.ts` and
the CDN Worker, and listed here so you can check them after the first deploy (step 11):

- **Web app:** a Content-Security-Policy that allows only the app itself, the API, the CDN,
  Supabase (https and wss), the analytics and Sentry hosts when set, and Razorpay Checkout. It also
  sends HSTS, `nosniff`, `X-Frame-Options: DENY` and a strict referrer policy. `index.html`, the SPA
  fallback, the service worker and the manifest are `no-cache`; `/assets/*` is immutable.
- **Sims** (on the web app at `/sims/*`, and on the CDN under `https://cdn.<domain>/sims/`): every
  response carries **`Cross-Origin-Resource-Policy: cross-origin`** and
  `Access-Control-Allow-Origin: *`. Sims run in a sandboxed iframe with an opaque origin, and the
  web preview's isolation headers block a sim without CORP. The mobile apps load sims from
  **`EXPO_PUBLIC_SIM_BASE_URL=https://cdn.<domain>/sims`** (staging
  `https://cdn-staging.<domain>/sims`), set in EAS (step 7.4).
- **CDN:** CORS `*`, CORP `cross-origin`, the object's own `Cache-Control`, and conditional and
  range requests. It is read-only and can't reach the uploads or staging buckets.

## 5. Railway

1. Create the project `smriti` with two environments, `staging` and `production`.
2. In each environment, add **Redis** from Railway's template.
3. Add two services from this GitHub repository, root directory `/`:
   - `api`, with Settings > Config-as-code path `/infra/railway/api.railway.json`.
   - `worker`, with path `/infra/railway/worker.railway.json`.
   There is no cron service: the crons run inside the worker.
4. **Turn off auto-deploy** on both services (Settings > Source: no trigger branch). GitHub Actions
   deploys after CI passes. A Railway auto-deploy would skip that check.
5. **Variables.** Put the shared names in a shared variable group, referenced by both services.
   The full lists per service are in `infra/railway/README.md`. The values come from:
   - Supabase (step 3): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
     `SUPABASE_JWKS_URL`, `JWT_ISSUER`, `DATABASE_URL`, and `MIGRATIONS_DATABASE_URL` (api only).
   - Railway: `REDIS_URL=${{Redis.REDIS_URL}}`.
   - Cloudflare (step 4): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
     `R2_BUCKET_ASSETS`, `R2_BUCKET_CONTENT`, `R2_BUCKET_UPLOADS` (the bucket names for that
     environment), `CDN_BASE_URL`.
   - Your own values: `APP_ENV` (`staging` or `production`), `API_PUBLIC_URL`
     (`https://api.<domain>` or `https://api-staging.<domain>`), `WEB_APP_URL`
     (`https://app.<domain>` or `https://app-staging.<domain>`), `MANAGED_IDENTITY_DOMAIN`,
     `BRAND_NAME`, `MAIL_FROM`, and `GUARDIAN_LINK_BASE_URL` only if it isn't `WEB_APP_URL/guardian/`.
   - Random secrets you generate (for example `openssl rand -hex 32`), different per environment
     and never rotated casually: `LOG_HASH_SALT`, `AUTH_IDENTITY_HASH_PEPPER`.
   - Providers (step 9): the AI, voice, analytics, payments, email, push and attestation keys.
   - `api` only: `OTEL_SERVICE_NAME=smriti-api`, the Sign in with Apple values (step 7.2),
     optionally `WEB_CONCURRENCY` and `CORS_ORIGINS`.
   - `worker` only: `WORKER_QUEUE=all`, `OTEL_SERVICE_NAME=smriti-worker`.
   - Never set `JOBS_MODE`, `DEV_JWT_SECRET`, `AI_PROVIDER=fake` or `ATTESTATION_PROVIDER=fake`
     outside local and test. Outside local and test, the API refuses to use a fake for any
     provider whose keys are missing, so a missing key shows up as a clear error, not silent fakes.
6. **Domains.** `api` > Settings > Networking > Custom domain: `api.<domain>` in production,
   `api-staging.<domain>` in staging. Add the records Railway shows (step 2). The worker gets no
   public domain.
7. **Tokens.** Project Settings > Tokens: create one **project token per environment**. Each goes
   into the matching GitHub environment as `RAILWAY_TOKEN` (step 8).

## 6. Google Cloud

1. **OAuth consent screen**: external, with the brand name, the support email, `<domain>` as an
   authorised domain, and the privacy policy and terms URLs on the site. Brand verification needs
   the final name (D7).
2. **OAuth clients** (APIs & Services > Credentials):
   - One **Web** client. Authorised JavaScript origins: `https://app.<domain>` and
     `https://app-staging.<domain>`. Its ID is `VITE_GOOGLE_WEB_CLIENT_ID` and
     `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; its secret is `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`.
   - One **iOS** client per variant bundle ID. Put each ID and its reversed URL scheme in
     `packages/config/variants/<variant>.json` (public), or override them per build with
     `GOOGLE_IOS_CLIENT_ID_<VARIANT>` and `GOOGLE_IOS_URL_SCHEME_<VARIANT>` in EAS.
   - One **Android** client per variant package name, with the SHA-1 of the Play app signing key
     (from Play Console after step 7.3) and of the EAS upload key.
3. **Play Integrity API**: enable it, link the Cloud project in Play Console for each app, and
   create a service account with the Play Integrity role. Its JSON key is
   `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`, and `PLAY_INTEGRITY_PACKAGES` lists `variant=package` pairs.

## 7. Apple, Google Play and EAS

1. **App IDs.** One per variant (`app.smriti.<variant>` today; follow the final brand). Turn on Sign
   in with Apple, App Attest, Push Notifications and App Groups.
2. **Sign in with Apple key.** Keys > create with Sign in with Apple. Record `APPLE_TEAM_ID`,
   `APPLE_SIGNIN_KEY_ID` and the `.p8` file (`APPLE_SIGNIN_PRIVATE_KEY`). Generate the client secret
   JWT from them for Supabase (step 3.5). Keep the `.p8` in a password manager, not in the repo.
   The API uses the same key to revoke a user's Apple tokens when they delete their account (App
   Store review requires it). Set on `api` in Railway: `APPLE_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`,
   `APPLE_SIGNIN_PRIVATE_KEY` (the `.p8` contents; `\n` escapes are accepted) and
   `APPLE_SIGNIN_CLIENT_IDS` (every variant bundle id, comma separated). The API builds a short-lived
   client secret per call, so this one does not expire like the Supabase secret.
3. **Store apps.** Create one App Store Connect app and one Play Console app per variant that ships.
   R7 phases mean only `all`, `jee`, `neet` and `upsc` are needed first. Add each app's App Store
   Connect ID to `apps/mobile/eas.json` as `submit.production-<variant>.ios.ascAppId`, and create
   the submit credentials as EAS variables (`ASC_API_KEY_PATH`, `ASC_API_KEY_ID`,
   `ASC_API_KEY_ISSUER_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`; see `infra/eas/README.md`).
   Set `APP_ATTEST_APP_IDS` (`variant=TEAMID.bundle.id` pairs) and `APP_ATTEST_ENVIRONMENT=production`
   in Railway production.
   For app links, set the GitHub variables `APPLE_TEAM_ID` and `ANDROID_APP_LINK_CERTS`
   (`variant=SHA256|SHA256,...`, the Play app signing key's SHA-256 from Play Console > App
   integrity, plus the upload key's if you install builds outside Play). The site deploy writes
   `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` from them.
4. **EAS.** Create one Expo project per store app (variant), then:
   - Set each project's ID as the GitHub variable `EAS_PROJECT_ID_<VARIANT>` (for example
     `EAS_PROJECT_ID_JEE`) and as an EAS variable of the same name in that project.
   - Create EAS environment variables for `preview` and `production` (`eas env:create`). The public
     ones are listed in `apps/mobile/.env.example`: `EXPO_PUBLIC_APP_ENV`,
     `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_CDN_BASE_URL`,
     **`EXPO_PUBLIC_SIM_BASE_URL`** (`https://cdn.<domain>/sims`), `EXPO_PUBLIC_AUTH_MODE=supabase`,
     `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`,
     `EXPO_PUBLIC_GOOGLE_SIGNIN=native`, `EXPO_PUBLIC_BILLING=revenuecat`,
     `EXPO_PUBLIC_REVENUECAT_APPLE_KEY`, `EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY`,
     `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_ANALYTICS_URL`. Every `EXPO_PUBLIC_*` value ships
     inside the app, so none of them may be a secret.
   - Create an access token for CI (Account > Access tokens): GitHub secret `EXPO_TOKEN`.
   - Create a separate access token with push permission for the server: Railway `EXPO_ACCESS_TOKEN`.
   - The `staging-<variant>` profiles build the store apps against staging (TestFlight and the
     Play internal track); `preview-<variant>` builds separate `.preview` apps for ad hoc installs.
     Profiles, channels and submit entries are in `infra/eas/README.md`.

## 8. GitHub environments, secrets and variables

Settings > Environments: create `staging` and `production`.

- `production`: add **required reviewers** (at least one person who isn't the usual tagger), and
  limit deployment tags to `v*` and `mobile-v*`.
- `staging`: limit deployment branches to `main`.
- Settings > Rules: protect `main` (pull requests and CI required) and protect the `v*` and
  `mobile-v*` tag patterns so only maintainers can push them.

**Secrets** (per environment, from the steps above):

| Secret | From | Used by |
|---|---|---|
| `RAILWAY_TOKEN` | step 5.7 | deploy-backend |
| `CLOUDFLARE_API_TOKEN` | step 4.3.3 | deploy-web |
| `CLOUDFLARE_ACCOUNT_ID` | step 4 | deploy-web |
| `R2_ACCOUNT_ID` | step 4 | deploy-content |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | step 4.3.2 | deploy-content |
| `DATABASE_URL` | step 3.3 (the session or direct URL is fine here) | deploy-content (metadata and card index) |
| `EXPO_TOKEN` | step 7.4 | deploy-mobile |
| `SENTRY_AUTH_TOKEN` | Sentry > Settings > Auth Tokens, with `project:releases` and `org:read` | deploy-web (source map upload) |

**Variables** (per environment; public values):

| Variable | Value |
|---|---|
| `API_PUBLIC_URL` | `https://api.<domain>` / `https://api-staging.<domain>` |
| `WEB_APP_URL` | `https://app.<domain>` / `https://app-staging.<domain>` |
| `SITE_URL` | `https://<domain>` / `https://staging.<domain>` |
| `CDN_BASE_URL` | `https://cdn.<domain>` / `https://cdn-staging.<domain>` |
| `VITE_API_BASE_URL` | same as `API_PUBLIC_URL` |
| `VITE_CDN_BASE_URL` | same as `CDN_BASE_URL` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | step 3.1 |
| `VITE_GOOGLE_WEB_CLIENT_ID` | step 6.2 |
| `VITE_TURNSTILE_SITE_KEY` | step 4.4 |
| `VITE_SENTRY_DSN` | Sentry web project (step 9) |
| `SENTRY_ORG`, `SENTRY_PROJECT_WEB` | the Sentry organisation and web project slugs; with `SENTRY_AUTH_TOKEN`, deploy-web uploads source maps |
| `APPLE_TEAM_ID`, `ANDROID_APP_LINK_CERTS` | step 7.3 (app link files) |
| `VITE_ANALYTICS_URL` | the analytics collector URL, or empty |
| `SITE_ANALYTICS_ENDPOINT` | the site's cookie-free collector, or empty |
| `BRAND_NAME_EN`, `BRAND_NAME_HI`, `BRAND_LEGAL_NAME`, `BRAND_SUPPORT_EMAIL` | the brand (D7) |
| `PRICE_PRO_MONTHLY_INR`, `PRICE_PRO_INTRO_INR` | must match the Razorpay plans (step 9) |
| `R2_BUCKET_CONTENT`, `R2_BUCKET_ASSETS` | the bucket names for that environment |
| `EAS_PROJECT_ID_<VARIANT>` | step 7.4, one per variant |

The workflows set `VITE_APP_ENV`, `VITE_APP_VARIANT=all` and `VITE_AUTH_MODE=supabase` themselves,
and `SITE_NOINDEX=1` everywhere except production.

## 9. Provider keys and webhooks

Create separate keys for staging and production wherever the provider allows, and put them in the
matching Railway environment.

| Provider | Railway variables | Notes |
|---|---|---|
| Agnes AI | `AGNES_AI_API_KEY`, `AGNES_BASE_URL`, `AI_TIER_TUTOR_MODEL`, `AI_TIER_CHEAP_MODEL`, `AI_TIER_AUTHOR_MODEL`, `AI_TIER_IMAGE_MODEL` | Model names live only in these variables, never in code. |
| Gemini | `GEMINI_API_KEY`, `GEMINI_LIVE_MODEL` | Voice tutor. |
| Deepgram | `DEEPGRAM_API_KEY`, `DEEPGRAM_TTS_MODEL`, `DEEPGRAM_STT_MODEL` | Check Hindi quality first (D3). |
| ClickHouse | `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE` | Create a user that can only insert and select in the events database. |
| Grafana Cloud | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` | The OTLP endpoint and its `Authorization=Basic <token>` header. Connect Grafana to ClickHouse with a read-only user. |
| Sentry | `SENTRY_DSN` (api and worker), optionally `SENTRY_RELEASE` | Create a server project (or one each for api and worker, set per service), a web project and a mobile project. The web and mobile DSNs are `VITE_SENTRY_DSN` and `EXPO_PUBLIC_SENTRY_DSN`. Events carry only the internal user id: request bodies, cookies, auth headers, query strings, job arguments and email addresses are stripped before sending. |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_ID`, `RAZORPAY_INTRO_OFFER_ID`, and the optional plan names in `.env.example` | Create the plans in the dashboard. Webhook URL: `https://api.<domain>/v1/webhooks/razorpay`, with the subscription and payment events and a secret you generate. Staging uses test mode with `https://api-staging.<domain>/v1/webhooks/razorpay`. |
| RevenueCat | `REVENUECAT_API_KEY`, `REVENUECAT_WEBHOOK_SECRET` | Connect each store app. Webhook URL: `https://api.<domain>/v1/webhooks/revenuecat`, with an Authorization header value you generate; the same value is `REVENUECAT_WEBHOOK_SECRET`. The public SDK keys go to EAS. |
| Resend | `MAIL_PROVIDER=resend`, `MAIL_FROM`, `RESEND_API_KEY` | Add the sending domain and the SPF, DKIM and MX records it shows, plus a DMARC record (step 2). |
| Expo push | `PUSH_PROVIDER=expo` (the default outside local), `EXPO_ACCESS_TOKEN` | Step 7.4. |
| Web Push | `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT` | Generate one VAPID key pair per environment; the subject is a `mailto:` support address. |
| Play Integrity, App Attest | `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`, `PLAY_INTEGRITY_PACKAGES`, `APP_ATTEST_APP_IDS`, `APP_ATTEST_ENVIRONMENT` | Steps 6.3 and 7.3. |

## 10. First deploy, in order

1. **Check the repo.** `pnpm env:check` passes, and CI is green on `main`.
2. **Backend to staging.** Run `deploy-backend.yml` from the Actions tab with `staging` (or push to
   `main`). The `api` deploy runs the migrations as its pre-deploy step, then the worker deploys.
   In Railway, check the `api` deploy log shows `applied ...` lines and then
   `up to date (N migrations)` on the next deploy.
3. **Web, site and CDN to staging.** Run `deploy-web.yml` with `staging`. Then add the Worker
   domains (step 4.5) and set `CDN_BASE_URL` everywhere.
4. **Content to staging.** Run `deploy-content.yml` with `staging`. It publishes bundles, patches,
   manifests and media to R2, applies the content metadata and card index to the database, and
   syncs the sims to `smriti-assets-staging` under `sims/`.
5. **Smoke test staging:**
   - `https://api-staging.<domain>/readyz` returns ready, and `/v1/config` returns 200 (the deploy
     workflow checks both).
   - `https://app-staging.<domain>` loads, a guest can start, and the browser console shows no CSP
     errors.
   - A lab opens a sim with no CSP or CORP errors. `curl -I https://cdn-staging.<domain>/sims/index.json`
     shows `cross-origin-resource-policy: cross-origin`.
   - A file under `https://cdn-staging.<domain>/c/manifests/` returns 200 with `max-age=300`, and a
     bundle returns `immutable`.
   - Google sign-in works on the web. A Razorpay test-mode subscription turns Pro on through the
     webhook.
   - `curl -s https://staging.<domain>/.well-known/apple-app-site-association` returns JSON with
     your team id, and `assetlinks.json` lists the packages that have fingerprints. The staging
     site lists the `.preview` ids; the apps verify against the production site's file, which lists
     the store ids.
   - No script points at a source map: `curl -s https://app-staging.<domain>/assets/<any>.js | grep -c sourceMappingURL` prints 0.
   - A staging build (`deploy-mobile.yml`, `staging`) signs in, loads content and opens a sim.
6. **Production.** Repeat steps 2 to 4 for production by pushing a tag, for example `v0.1.0`. Each
   job waits for a reviewer to approve the `production` environment. Check that `SITE_NOINDEX` is
   off on `https://<domain>/robots.txt`.
7. **Store builds.** Push a `mobile-v0.1.0` tag. After approval, `eas build` runs for each variant
   with the `production-<variant>` profile. Submit with
   `eas submit --profile production-<variant> --latest` once that app's `ascAppId` is in eas.json.

## 11. Rolling back

- **API or worker:** in Railway, redeploy the previous deployment (Deployments > ... > Redeploy).
  Migrations do not roll back, which is why every migration must stay compatible with the version
  before it (`infra/railway/README.md`). Fix forward with a new migration if a schema change is wrong.
- **Web, site or CDN:** `npx wrangler@4.151.1 rollback` against the Worker and environment, or
  Workers & Pages > Deployments > Rollback.
- **Content:** bundles are immutable, so roll back by publishing the previous good content again:
  re-run that commit's `deploy-content.yml` run from the Actions tab (a re-run uses the same
  commit), or revert the content change on `main`. The manifests point back within five minutes.
- **Mobile:** republish the previous good update with `eas update --channel production-<variant>`
  (or `eas update:roll-back-to-embedded`). A store build can only be replaced by a new one.

## 12. Not wired yet

These are known gaps. None of them blocks a staging deploy.

- **Mobile Sentry:** `EXPO_PUBLIC_SENTRY_DSN` is read, but the app has no Sentry SDK yet.
- **Apple revocation from the app:** the API revokes Apple tokens on deletion when the request
  carries `apple_authorization_code` and `apple_client_id`; the mobile app does not send them yet.
- **Google Identity Services and Turnstile scripts** are not in the web CSP until `apps/web` loads
  them (`infra/cloudflare/README.md`).
- **Preview environments** per pull request (TRD §17) are not set up.
- **`ios.ascAppId`** per app in `apps/mobile/eas.json` (step 7.3).
