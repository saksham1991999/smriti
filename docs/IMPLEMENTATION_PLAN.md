# Smriti — Implementation Plan

Status: Draft v0.1, 28 Oct 2026. Builds what `PRD.md` describes, using the architecture in `TRD.md` and the tables in `DB_SCHEMA.md`.

## 1. How to read this plan

- The work is split into **four phases** that match PRD §17. Each phase ends with exit criteria that must all be true before the next phase starts.
- Inside a phase, work is grouped into **epics** with IDs (for example `F-3`). Each epic lists its tasks, so a coding agent or a developer can pick one up, open a branch and ship it as one pull request.
- **Durations assume** a core team of 2 backend or full-stack engineers, 2 React Native engineers, 1 product designer, 1 content lead, and coding agents running the content skills. With a smaller team, the order stays the same and the dates move.
- **Content is not built by hand.** Phases build the machinery and the skills. Content for each exam is produced by agents running the skills in `skills/` and checked by `content-qa` and a human reviewer (PRD §14).

| Phase | Weeks (estimate) | Outcome |
|---|---|---|
| 0 · Foundations | 1–6 | Monorepo, infra, design system, content pipeline, auth with guest mode, lesson player, FSRS, pet and plant engine |
| 1 · MVP | 7–18 | All-exams app, Smriti JEE and Smriti NEET in the stores, web app and Astro site, JEE Main and NEET mocks, AI tutor chat, Pro with the ₹1 month |
| 2 · Growth | 19–32 | UPSC Prelims and SSC CGL apps, voice tutor, leagues and friends, widgets, memory palaces, PDF export, classes 9–10 |
| 3 · Scale | 33+ | JEE Advanced depth, more government exams, live all-India mocks, classes 1–8, parent mode, more languages |

---

## 2. Before week 1: what the owner needs to set up

Some of these have lead times of several weeks, so they should start now.

| Item | Why | Lead time |
|---|---|---|
| **Agnes AI API docs** and `AGNES_API_KEY` in the cloud environment | LLM, images and possibly embeddings all go through Agnes (TRD §9) | Blocks F-8 |
| **Final brand name and domain** | Store listings, bundle IDs, the site domain and the logo all depend on it. Brand strings are config, so code can start with "Smriti". | Before store submission (week 16) |
| **DLT registration** (entity, sender ID, OTP template) with an SMS provider such as MSG91 | Phone OTP in India can't be sent without it | 1–3 weeks |
| Apple Developer (organisation) and Google Play Console accounts | Store builds, in-app purchase products, TestFlight | 1–2 weeks (D-U-N-S number for Apple) |
| Razorpay account with Subscriptions and UPI Autopay enabled | Web payments | 1–2 weeks (KYC) |
| Accounts: Supabase, Railway, Cloudflare (R2, Workers), Expo (EAS), RevenueCat, Sentry, Grafana Cloud, ClickHouse Cloud, Deepgram, Google AI Studio (Gemini Live) | Infra and providers | Days |
| Legal review: privacy policy, terms, DPDP consent flow for minors | Required before public launch | 3–4 weeks |

---

## 3. Phase 0 · Foundations (weeks 1–6)

**Goal:** a student can open the app as a guest, pick a pet, do a real lesson from a published bundle, review cards offline, and see their streak plant grow. All of it is traced end to end.

### F-1 Monorepo and tooling (week 1)
- pnpm workspaces + Turborepo, `uv` for Python, shared TypeScript, ESLint and Prettier config, Ruff and mypy.
- The folder layout from TRD §2 with empty, building packages.
- GitHub Actions: lint, typecheck, test, and content checks on every pull request. Turborepo remote cache.
- `.env.example` with every variable from TRD §17 (names only). `AGENTS.md` at the root.

### F-2 Infrastructure and environments (weeks 1–2)
- Supabase projects for staging and production, with branching for previews. The Data API is turned off for the app schemas.
- Railway services: `api`, `worker`, Redis. Preview environments per pull request.
- Cloudflare: R2 buckets (`assets`, `content`, `uploads`, `staging`), `cdn.` domain with cache rules, Workers static hosting for `app.` and the site.
- ClickHouse Cloud service and the `events` table (DB_SCHEMA §14). Grafana Cloud stack with the ClickHouse data source.
- Sentry projects for mobile, web, API and worker. OpenTelemetry exporter to Grafana Cloud.
- Docker Compose for local work: Supabase local stack, Redis, API, worker.

### F-3 Database foundation (weeks 1–3)
- Migrations `0001`–`0010` from DB_SCHEMA §16, with RLS in its own reviewable file.
- The new-user trigger, partition creation through `pg_cron`, and the seed file.
- SQLAlchemy models plus a CI drift check against the migrations.
- RLS tests: for every user table, user A can't read or write user B's rows.

### F-4 API skeleton (weeks 2–3)
- FastAPI app with JWT verification through JWKS, the "query as the user" transaction setup (DB_SCHEMA §12), RFC 7807 errors, cursor pagination, idempotency keys, rate limits in Redis.
- `structlog` JSON logs and OpenTelemetry auto-instrumentation, so the trace ID flows from the app through the API to the database and the AI provider.
- `GET /v1/config` (variants, flags, min version, free limits, pricing), `GET /v1/me`, `GET /v1/me/summary`.
- OpenAPI → `packages/api-client` generation, with a CI check that it compiles.
- `arq` worker with queues and cron registration.

### F-5 Design system in code (weeks 1–4)
- `DESIGN.md` written first (Sunny Subjects tokens, components, the Agnes illustration style guide, Night Colour dark mode).
- `packages/tokens`: one source of tokens compiled to TypeScript, CSS variables and the React Native theme.
- `packages/ui`: buttons, cards, subject tiles, progress rings, chips, sheets, the tab bar, toasts, empty states, the streak pill, Plus Jakarta Sans and Noto Sans Devanagari.
- A Storybook-style gallery screen in the app, used for design review.
- Accessibility checks: touch target sizes, contrast tests on tokens, screen-reader labels.

### F-6 Content schema and publish pipeline (weeks 2–5)
- `packages/content-schema`: JSON Schemas, TypeScript types and Pydantic models for every card type (PRD §5.2), questions, mnemonics, blueprints and sims.
- CI validation for `content/`: schema, links, media references, coverage report.
- The `content-publish` worker job (TRD §7.2): metadata into Postgres, bundles per topic × mode × locale, math pre-rendered to SVG, media resized, content-hashed upload to R2, manifests, delta patches, CDN purge.
- Seed pack builder per app variant (TRD §3.2).
- A small **fixture course** (one chapter, written by hand as test data, not real content) to exercise every card type.

### F-7 Mobile app shell (weeks 2–6)
- Expo Router app with the five tabs, the variant config (`APP_VARIANT`) and EAS build profiles.
- Supabase anonymous sign-in at first launch, MMKV session storage.
- On-device SQLite with migrations and every table from DB_SCHEMA §15, the outbox, and the sync client (`POST /v1/sync/events`, `GET /v1/sync/state`).
- The server sync handler: idempotent apply for progress, reviews, XP, activity days, streak, plant and pet.
- Onboarding: language, goal, exam, exam date, daily goal, pick and name the pet, plant the seed, first lesson, notification ask.
- Content download manager: manifest, bundles, patches, LRU cache, pinning, seed pack on first launch.
- Sentry with trace propagation, and the analytics client with batching.
- The web build of the same app (decision D1) deployed to `app.` on Cloudflare.

### F-8 Lesson player and memory core (weeks 3–6)
- `packages/lesson-player`: renderers for every card type, Deep Dive and Quick Revision flows, confidence tagging (Sure / 50:50 / Guess), lesson complete screen.
- FSRS on device with `ts-fsrs` and on the server with the same parameters. Review queue screen.
- Pet and plant engine (TRD §10) with Rive state machines. Placeholder Rive files until the final art is ready.
- Agnes adapters (`AgnesLLMProvider`, `AgnesImageProvider`) behind the AI gateway, once the docs are in.
- Deepgram adapter, and the Phase 0 Hindi check for TTS and STT (TRD §9.4, decision D3).
- Embedding provider evaluation (D2).

### F-9 Skills, dry run (weeks 2–6)
- The skills in `skills/` are already written (planning phase). In Phase 0 they are run end to end on the fixture course: `syllabus-mapper`, `exam-blueprint`, `lesson-author`, `question-author`, `visual-director`, `audio-maker` and `content-qa`.
- Fix whatever the dry run shows is unclear, and align `skills/_shared/content-format.md` with the JSON Schemas from F-6.

**Phase 0 exit criteria**
- [ ] A guest completes onboarding and a fixture lesson on a 3 GB RAM Android phone, offline after the first launch.
- [ ] Reviews scheduled offline sync correctly when the device reconnects, with no duplicates after forced retries.
- [ ] The plant grows on consecutive days and droops after a missed day in a simulated timezone test.
- [ ] One trace in Grafana spans app → API → Postgres → Agnes.
- [ ] Every RLS test passes. The content pipeline publishes the fixture course to R2 and the app reads it.
- [ ] Phase 0 decisions D1–D6 in TRD §18 are closed.

---

## 4. Phase 1 · MVP (weeks 7–18)

**Goal:** public launch of the all-exams app, Smriti JEE and Smriti NEET on Android and iOS, the web app and the Astro site, with Pro at ₹99/month and the ₹1 first month.

### M-1 Content production for JEE Main, NEET and classes 11–12 (weeks 7–18, continuous)
- Run `syllabus-mapper` on the official JEE Main and NEET UG syllabi and the NCERT 11–12 books for Physics, Chemistry, Maths and Biology. Output: the concept graph, exam tags and depth levels, and a coverage checklist.
- Run `exam-blueprint` for JEE Main and NEET from the latest official notifications, and record `source_url` and `verified_at`.
- Run `lesson-author`, `question-author`, `pyq-ingest`, `mnemonic-maker` and `visual-director` chapter by chapter, with `content-qa` and human review on every pull request.
- The coverage dashboard must reach 100% for a subject before it ships (PRD §14).

### M-2 Skills, second dry run (weeks 7–10)
- Run `pyq-ingest`, `mnemonic-maker`, `sim-builder`, `model-3d-sourcer` and `anim-maker` on the first real chapter, and wire in the owner-listed `anatomy` and `colorfigures` skills (`skills/README.md`).

### M-3 Learn tab complete (weeks 7–12)
- Home with today's plan, subject map, chapter and topic screens, revision and cheat sheets, formula and shortcut vaults, storybook reader, YouTube video lessons.
- Technique library and "Make it stick" (the mnemonic forge) through the AI gateway.
- Bookmarks, highlights, "report an error" on every card.
- Daily plan generator in the worker.

### M-4 Labs (weeks 8–16)
- `sim-bridge` protocol package and the WebView and iframe hosts (TRD §7.3).
- The shared sim kit for own sims, then the first 20 Physics, Chemistry and Biology sims (built with `sim-builder` or adapted from PhET with attribution).
- 3D viewer (glTF with LODs), 360° viewer with gyroscope and drag fallback, interactive periodic table, fun experiments.

### M-5 Practice and mocks (weeks 9–16)
- Practice hub, concept drills, PYQ bank, daily challenge with its leaderboard, weak-spot drills.
- The generic mock engine driven by blueprints: section timers, lock and switch rules, palette states, language toggle, calculator where allowed, autosave, server-enforced deadline, auto-submit.
- Scoring with negative and partial marking from `content.question_keys`.
- Mock report: score, rank and percentile, time analysis, concept heat map, confidence analysis, mistake types, next steps (DB_SCHEMA `learn.mock_reports`).
- Load test with k6 on autosave and submit.

### M-6 AI tutor chat (weeks 10–15)
- Tutor sessions with SSE streaming, the tool set (TRD §9.2), hints-first policy, moderation on input and output, age rules.
- `generate_image` with the image index search first, then Agnes (TRD §9.3).
- Doubt from photo, "Explain as a story".
- Quotas from `ai.usage_daily` and free-tier limits from flags.
- A tutor eval set (English, Hindi, Hinglish; JEE and NEET questions) that runs in CI on every prompt or model-tier change.

### M-7 Accounts and payments (weeks 10–16)
- Login sheet (phone OTP through the DLT SMS hook, Google, Apple, email), identity linking for guests, the merge job.
- Guardian consent flow for under-18s, with legal review.
- RevenueCat products per variant with the ₹1 intro offer. Razorpay Subscriptions with UPI Autopay on web.
- Webhooks with HMAC verification and replay protection, entitlement recompute, the paywall and manage-plan screens.
- Data export and account deletion endpoints (DPDP).

### M-8 Engagement (weeks 12–16)
- Local daily reminder and "streak at risk", rescheduled on each open.
- Expo Push from the worker with the rules engine (caps, quiet hours, pet voice templates).
- Streak freezes, daily and weekly quests, badges, the card album.
- In-app update prompts (soft and forced) from `/config`.

### M-9 Web surfaces (weeks 11–17)
- Astro site: exam, subject, chapter and topic pages from the published index, free cheat sheets and PYQ explanations, English and Hindi with `hreflang`, schema.org markup, React islands (mini quiz, periodic table, try a lesson).
- Web app polish for desktop widths.

### M-10 Launch readiness (weeks 15–18)
- Store listings per variant (keywords from PRD §12), screenshots, privacy labels, content rating.
- Maestro end-to-end flows on mobile and Playwright on web, run in CI.
- Performance budgets checked against TRD §15 on a low-end Android device.
- Grafana dashboards for retention, funnels, lesson drop-off, AI cost and API health. Alerts and an on-call rota.
- Closed beta with 200–500 students for 2 weeks, then staged rollout.

**Phase 1 exit criteria**
- [ ] JEE Main and NEET coverage dashboards at 100% for every subject in both languages.
- [ ] Mocks match the official pattern for each blueprint, checked by a person against the latest notification.
- [ ] Crash-free sessions above 99.5% in the beta. API p95 under 300 ms for non-AI routes. Tutor time to first token under 1.5 s.
- [ ] Purchase, renewal, cancellation and refund tested on all three platforms in sandbox and with one real ₹1 purchase each.
- [ ] Legal sign-off on privacy, terms and the consent flow.

---

## 5. Phase 2 · Growth (weeks 19–32)

| Epic | Scope |
|---|---|
| G-1 New exam apps | Smriti UPSC (Prelims GS and CSAT) and Smriti SSC (CGL Tier 1) variants. Content through the same skills. Classes 9–10. |
| G-2 Voice tutor | Gemini Live ephemeral tokens, tool relay, transcripts, fair-use limits, Hindi and Hinglish checks (TRD §9.4) |
| G-3 Feynman tutor | Explain-back mode in text and voice, scored against `content.concepts.key_points` |
| G-4 Social | Friends, duo streaks, squads, weekly leagues with Sunday rollover, duels over Supabase Realtime, nudges and cheers, shared decks |
| G-5 Widgets | iOS WidgetKit and Android widgets showing streak, plant, pet and today's plan |
| G-6 Memory palaces | Builder and walk-through, illustrated rooms first, 360° rooms next |
| G-7 Study tools | Smart Cornell notepad with AI fill, mind-map builder, transcript-to-flashcards for YouTube lessons, audio mnemonics through Deepgram |
| G-8 Learning-science jobs | Predictive weak-area alerts, sleep review scheduling, interleaved practice builder, metacognitive dashboard with calibration (TRD §9.6) |
| G-9 PDF export | Topic sets to an illustrated revision book through Playwright, with correct Devanagari shaping |
| G-10 Security hardening | Play Integrity and App Attest on sensitive endpoints, anti-cheat on XP and duels |
| G-11 Data | IRT calibration of questions from ClickHouse, per-user FSRS optimisation, predicted rank |

**Phase 2 exit criteria:** UPSC and SSC apps live with 100% coverage. Voice tutor quality approved in Hindi and English. Day-30 retention and Pro conversion tracked against PRD §2.3 targets.

---

## 6. Phase 3 · Scale (week 33 onward)

- JEE Advanced depth (L5 concepts, the newer question types, partial marking) and its blueprint process each year.
- More government exams: banking, railways, defence, state services, each as a variant config plus blueprints.
- Live all-India mocks with scheduled windows, Realtime fan-out and rank publishing.
- Classes 1–8 with the under-10 experience (story, song and play, gentle pet states) and parent mode.
- More languages: add locale keys to content and UI catalogues, and fonts if needed.
- Family plan and the yearly plan.

---

## 7. Cross-cutting work that never stops

- **Exam pattern watch:** before each exam cycle, re-check every blueprint against the official notification and record `verified_at`.
- **Content quality loop:** "report an error" reports, `content-qa` reruns on changed concepts, and delta patches to fix cards without a full download.
- **Cost watch:** AI cost per active user, R2 operation counts, push volume, in the Grafana cost dashboard.
- **Privacy:** consent records, retention jobs (tutor messages after 180 days, guests after 90 idle days), and a yearly data-protection review.

---

## 8. Definition of done (every pull request)

- Tests for the change, and CI green: lint, typecheck, unit tests, content checks.
- New screens follow `DESIGN.md`, work in English and Hindi, pass the accessibility checklist and the reduced-motion mode, and have a Night Colour check.
- New API routes have OpenAPI docs, rate limits, ownership checks, RLS coverage and tracing.
- New events are added to the typed catalogue in `packages/analytics`.
- No secrets in code, no personal data in logs, and no model identifiers hard-coded (they come from config).

---

## 9. Main risks to the schedule

| Risk | Effect | Mitigation |
|---|---|---|
| Agnes API details arrive late | F-8, M-6 and every illustration slip | Build the gateway interfaces first and test with a stub provider |
| DLT registration delays | Phone OTP is late | Google, Apple and email login ship first. Guests keep working. |
| Content volume for two exams in 12 weeks | Launch slips | Start M-1 in week 7 with the skills from F-9. Ship subjects as they reach 100% coverage. |
| Store review for ₹1 intro offers and per-exam apps | Launch slips | Submit early TestFlight and internal-track builds. Keep each variant's listing and content clearly distinct. |
| Hindi speech quality | Voice features feel weak in Hindi | The Phase 0 check, with a Hindi-only speech fallback behind the same interface |
