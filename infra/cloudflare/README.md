# Cloudflare: web app, site, CDN and R2

Three Workers, each with a `staging` and a `production` environment (`--env`). The first deploy is in
[docs/DEPLOY.md](../../docs/DEPLOY.md). `.github/workflows/deploy-web.yml` deploys all three.

| Worker | Config | Serves | Domain (production / staging) |
|---|---|---|---|
| `smriti-web` | [web/wrangler.jsonc](web/wrangler.jsonc) | `apps/web/dist`, static assets with SPA fallback | `app.<domain>` / `app-staging.<domain>` |
| `smriti-site` | [site/wrangler.jsonc](site/wrangler.jsonc) | `apps/site/dist`, static Astro with `404.html` | `<domain>`, `www.<domain>` / `staging.<domain>` |
| `smriti-cdn` | [cdn/wrangler.jsonc](cdn/wrangler.jsonc) | R2: `/c/*` from `smriti-content`, the rest from `smriti-assets` | `cdn.<domain>` / `cdn-staging.<domain>` |

TRD §4 names Workers static assets for hosting, so these are Workers, not Pages projects. They
give the same SPA fallback and `_headers` support.

## Headers (`_headers`, generated per build)

`node tools/deploy/src/headers-cli.ts web|site <dist>` writes `<dist>/_headers` from the build's
environment (logic and tests in `tools/deploy/src/headers.ts`):

- **Web, every path:** `Content-Security-Policy` allowing only `'self'`, the API (`VITE_API_BASE_URL`),
  the CDN (`VITE_CDN_BASE_URL`), Supabase (`VITE_SUPABASE_URL`, https and wss), and, when set,
  the analytics endpoint and the Sentry ingest host. Razorpay Checkout's script, frame and log hosts
  are also allowed, because `apps/web/src/lib/billing.ts` loads Checkout. No `unsafe-eval`, and no
  inline script except by hash. `frame-ancestors 'none'`, HSTS, `nosniff`,
  `strict-origin-when-cross-origin`, and a Permissions-Policy that allows only the microphone (voice
  tutor) and payment. `Cache-Control: no-cache` for `index.html`, the SPA fallback, `sw.js`,
  `registerSW.js` and the manifest, so a deploy shows on the next load.
- **Web `/assets/*`** (Vite's hashed output): `public, max-age=31536000, immutable`.
- **Web `/sims/*`:** sims run in a sandboxed iframe with an opaque origin, so they get
  `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`, their own CSP
  (own files only, `frame-ancestors 'self'`) and `X-Frame-Options: SAMEORIGIN`. Hashed sim assets
  are immutable.
- **Site:** the same security headers. Astro's inline island scripts are allowed by sha256 hashes
  computed from the built HTML. Images may come from `CDN_BASE_URL`, and connections may go to
  `SITE_ANALYTICS_ENDPOINT`. `/_astro/*` is immutable, and HTML is `max-age=0, must-revalidate`.

- **Site `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`:**
  `application/json`, `max-age=3600`.

## App link files (site)

`node tools/deploy/src/app-links-cli.ts apps/site/dist` writes the two files that let the store
apps open `https://<domain>/...` links (logic and tests in `tools/deploy/src/app-links.ts`). They
list every variant in `packages/config` with its bundle id and its `deepLinkPath`, exam apps before
the all-exams app, so a `/jee` link opens the JEE app when both are installed. The Apple team id is
`APPLE_TEAM_ID`, and `ANDROID_APP_LINK_CERTS` gives each package's signing certificate SHA-256
fingerprints (`jee=AA:BB:...|CC:DD:...,neet=...`). A variant with no fingerprint is left out of
`assetlinks.json`. deploy-web.yml runs it in the site job.

## Source maps (web)

The web build makes hidden source maps (`sourcemap: "hidden"`: no `sourceMappingURL` comment). When
`SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT_WEB` are set, deploy-web.yml uploads them to
Sentry for the release (`VITE_RELEASE`, the commit sha). It then deletes every `.map` file from
`apps/web/dist` and fails if any file still points at one, so no source map is ever deployed.

Google Identity Services and Turnstile are not in the web CSP yet, because `apps/web` doesn't load
them today. Add their hosts in `tools/deploy/src/headers.ts` in the same change that adds the
scripts (`accounts.google.com/gsi/client`, `challenges.cloudflare.com`).

## R2 buckets (TRD §8)

Create each of these once per environment. The staging names add `-staging`, as in
`smriti-assets-staging`.

| Bucket | Access | Contents | Written by |
|---|---|---|---|
| `smriti-assets` | public through `smriti-cdn` only (no r2.dev URL, no public bucket) | media `assets/{sha256}.{webp,avif,glb,mp3}`, sims `sims/{id}/…` | content publish (`--target r2`), deploy-content.yml (sims) |
| `smriti-content` | public through `smriti-cdn` at `/c/` | `bundles/{hash}.json`, `patches/{from}-{to}.json`, `manifests/{exam}/{locale}.json` | content publish |
| `smriti-uploads` | private (signed URLs from the API) | doubt photos, avatars, PDF exports | API and worker |
| `smriti-staging` | private | agent-made media waiting for QA | content skills (R55: Drive archive until it exists) |

- **Immutable, versioned paths.** Bundles, patches and media are content-addressed, so a changed
  file always has a new name. The publisher uploads them with
  `Cache-Control: public, max-age=31536000, immutable`, and nothing ever overwrites them. Only
  manifests and `sims/index.json` change in place, with `public, max-age=300`. A client sees new
  content within 5 minutes without any purge.
- **The CDN Worker** honours each object's `Cache-Control`, adds `Access-Control-Allow-Origin: *`
  and `Cross-Origin-Resource-Policy: cross-origin` (the web app and sandboxed sims fetch it
  cross-origin, and mobile reads sims from `EXPO_PUBLIC_SIM_BASE_URL=https://cdn.<domain>/sims`),
  answers conditional and range requests from R2, and keeps plain GETs in the edge cache. It is
  read-only (GET, HEAD, OPTIONS). The uploads and staging buckets are not bound, so it cannot
  serve them.
- **Uploads CORS.** Browsers PUT to signed URLs on `smriti-uploads`, so that bucket needs a CORS rule
  for the web origin (see docs/DEPLOY.md step 4).
- **API tokens.** `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` for Railway get Object Read & Write
  on `smriti-uploads`, `smriti-assets` and `smriti-content`. The GitHub content-publish token gets
  Object Read & Write on `smriti-assets` and `smriti-content` only.
- **Cost guardrail (TRD §8):** R2 has no egress fees. Watch Class A and B operation counts in the
  dashboard. The edge cache keeps Class B reads to about one per object per edge.
