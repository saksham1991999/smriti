# AGENTS.md

Instructions for coding agents (and people) working in this repository. Read this first, then the doc for the area you're changing.

## What this is

Smriti is a gamified, illustrated learning platform for Indian learners: class 1–12, JEE Main and Advanced, NEET, UPSC, SSC and other government exams. One backend and one templated app are published as several store apps, one per exam plus an all-exams app. "Smriti" is a working name, and brand strings live in config.

| Read | For |
|---|---|
| `docs/PRD.md` | What we're building and why |
| `docs/APP_FLOW.md` | Screens, navigation, journeys |
| `docs/UX_FLOW.md` | How each screen looks and behaves |
| `DESIGN.md` + `packages/tokens/tokens.json` | Colours, type, components, illustration style, motion |
| `docs/TRD.md` | Architecture and technology choices |
| `docs/DB_SCHEMA.md` | Postgres, ClickHouse and on-device SQLite schemas, RLS |
| `docs/IMPLEMENTATION_PLAN.md` | Phases, epics and exit criteria |
| `skills/README.md` | How content, visuals, sims, 3D and animation are produced |

## Status

Planning phase. The docs, design tokens and content skills exist. Application code starts with Phase 0 (`docs/IMPLEMENTATION_PLAN.md` §3). Where this file describes folders or commands that don't exist yet, build them as described.

## Repository map (target)

```
apps/api        FastAPI service (Python 3.12, uv)
apps/worker     Jobs and cron (arq): publish, roll-ups, AI, media, notifications, PDF
apps/mobile     Expo app for iOS and Android (one build per exam variant)
apps/web        React (Vite) web app, its own screens on the shared packages
apps/site       Astro marketing and SEO site
packages/       config (variants, flags), tokens, ui-native, ui-web, app-core,
                api-client, content-schema, lesson-core, lesson-player-native,
                lesson-player-web, sim-bridge, i18n, analytics
content/        Source content (JSON), written by agents through skills, validated in CI
sims/           Self-contained simulation bundles, one folder each
supabase/       SQL migrations, RLS, seed
skills/         Agent skills for content, visuals, sims, 3D, animation and QA
infra/          Railway, Cloudflare, EAS, GitHub Actions
docs/           The planning docs above
```

## Fixed technology choices

Don't swap these without the owner's approval:

- FastAPI on Railway. Supabase for auth and Postgres. Astro for the marketing site. React Native (Expo) for the mobile apps, and a separate React (Vite) web app. Cloudflare for web hosting. Cloudflare R2 behind the CDN for files.
- **Agnes AI** for LLM calls and **all** image generation. **Gemini Live** for the realtime voice tutor. **Deepgram** for text-to-speech and speech-to-text.
- **ClickHouse** as the analytics event store, with Grafana dashboards.
- On-device SQLite with an action queue, on-device FSRS, versioned content packages with delta patches, and a seed pack in the app.

## Rules that always apply

1. **Never write study content by hand in code or docs.** Lessons, questions, mnemonics and every other piece of learning content are produced by running the skills in `skills/`, written to `content/` as JSON, and checked by `content-qa` and a reviewer.
2. **Never draw illustrations yourself.** No hand-made SVG art, no CSS drawings, no code-generated pictures standing in for illustrations. Every illustration comes from Agnes AI through `skills/visual-director`. Icons come from the Phosphor set. Diagrams that must be interactive are built as sims (`skills/sim-builder`), not drawn as static art.
3. **Never invent facts, numbers or exam patterns.** Every exam pattern cites its official notification (`exam-blueprint`). Every PYQ cites its paper. Every statistic shown to students comes from real data.
4. **No model identifiers in code.** Model choices come from config (`AI_TIER_*_MODEL`). Call AI through the gateway in `apps/api/ai/`, never a provider SDK directly from a feature.
5. **No secrets in the repo.** Names go in `.env.example`, values in Railway, Cloudflare and EAS secrets.
6. **No personal data in logs**, and no free text typed by students in analytics events.
7. **Everything ships in English and Hindi.** UI strings go in `packages/i18n` catalogues. Content fields are `{ "en": ..., "hi": ... }`. No text baked into images.
8. **Respect children's data rules (DPDP).** No ad IDs or behavioural tracking for minors. Social features only after guardian consent for under-18s.
9. **Accessibility is part of done.** Contrast from tokens only, labels on every icon and illustration, never colour alone, reduced motion respected.
10. **Licences are checked before any third-party asset is used.** Record the licence and attribution in the asset's metadata. Avoid non-commercial (NC) licences.

## Conventions

- **TypeScript:** strict mode, no `any` in shared packages. React components are function components. State: TanStack Query for server data, Zustand for UI state.
- **Web and mobile parity:** business logic goes in `app-core` or `lesson-core`, never in a screen, so both apps share it. A feature added to one platform updates `docs/PARITY.md`.
- **Python:** 3.12, Ruff (lint and format), mypy strict, Pydantic v2. Async SQLAlchemy 2. Business logic lives in services, not in route handlers.
- **Database:** every change is a new SQL migration in `supabase/migrations/`. Every user table has RLS (see `docs/DB_SCHEMA.md` §12). Never edit an applied migration.
- **API:** REST under `/v1`, Pydantic models are the OpenAPI source, and `packages/api-client` is regenerated from them. Mutations that touch progress or money take an idempotency key.
- **Styling:** tokens only. No raw hex values in components. Subject colours come from `subjectMap`.
- **Observability:** use the shared logger (`structlog` on the server) and keep the trace context. New analytics events are added to the typed catalogue in `packages/analytics` first.
- **Tests:** pytest for Python, Vitest for packages, Jest and React Native Testing Library for components, Maestro for mobile flows, Playwright for web. Add RLS tests for new tables.
- **Commits:** imperative mood, one logical change per commit. Pull requests describe what changed, why, and how it was tested, with screenshots for UI changes.

## Commands (to be created in Phase 0)

| Task | Command |
|---|---|
| Install | `pnpm install` and `uv sync` |
| Run everything locally | `docker compose up` then `pnpm dev` |
| Lint and typecheck | `pnpm lint && pnpm typecheck` and `uv run ruff check && uv run mypy` |
| Tests | `pnpm test` and `uv run pytest` |
| Validate content | `pnpm content:check` (schema, links, coverage) |
| Build a variant | `APP_VARIANT=jee eas build --profile preview` |
| New migration | `supabase migration new <name>` |

## Producing content

Content work follows `skills/README.md`. In short:

1. `syllabus-mapper` builds the concept graph and the exam map from the official syllabus.
2. `exam-blueprint` encodes the exam pattern from the official notification.
3. `lesson-author`, `question-author`, `pyq-ingest` and `mnemonic-maker` write content chapter by chapter.
4. `visual-director`, `anim-maker`, `sim-builder` and `model-3d-sourcer` produce the media those files request.
5. `content-qa` checks everything, and a person reviews the pull request.
6. On merge, the publish job builds bundles, patches and manifests (TRD §7.2).

A subject ships only when its coverage report is at 100% for the exam (PRD §14).
