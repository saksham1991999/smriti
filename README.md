# Smriti

A gamified, illustrated learning platform for Indian learners, from class 1–12 through JEE, NEET, UPSC, SSC and other government exams. "Smriti" is the working name.

The platform is built around four things:

- every topic comes as a **deep dive** and a **quick revision**
- each subject is taught in its own way: labs and simulations, 3D, role play, derivations
- memory science is built in: spaced repetition, mnemonics, memory palaces
- a pet mascot (cat or dog) and a streak plant bring students back every day

It's freemium. The free part works without login, and Pro is ₹99/month with the first month for ₹1.

## Status
This repo is in the planning phase. The docs, design tokens and content skills are here. Application code starts with Phase 0 of the implementation plan.

| Doc | What it covers |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Product requirements: scope, exams, learning design, gamification, monetisation, phases |
| [`docs/APP_FLOW.md`](docs/APP_FLOW.md) | Screens, navigation and the main user journeys (diagrams) |
| [`docs/UX_FLOW.md`](docs/UX_FLOW.md) | Screen-by-screen UI/UX in the chosen "Sunny Subjects" direction |
| [`docs/TRD.md`](docs/TRD.md) | Technical requirements: architecture, stack, AI, sync, payments, observability |
| [`docs/DB_SCHEMA.md`](docs/DB_SCHEMA.md) | Postgres, ClickHouse and on-device SQLite schemas, RLS, retention |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Phased build plan with epics, exit criteria and owner setup items |
| [`AGENTS.md`](AGENTS.md) | Rules and conventions for coding agents working in this repo |
| [`DESIGN.md`](DESIGN.md) + [`tokens.json`](packages/tokens/tokens.json) | Design system: colours, type, components, Agnes illustration style, motion, logo brief |
| [`skills/`](skills/README.md) | Content-generation skills for coding agents |

Design mockups: [Smriti Mobile Directions canvas](https://claude.ai/artifact/BQF48w6kC4bv6PtJhHFzzZ). The chosen direction is board 7, "Sunny Subjects".

## Planned stack
| Layer | Technology |
|---|---|
| Backend API | FastAPI on Railway |
| Auth and database | Supabase (Postgres, Auth) |
| Marketing site | Astro on Cloudflare |
| Web app | React (Vite) on Cloudflare, a separate app sharing the logic packages |
| Mobile apps | React Native (Expo), one codebase with a build variant for each exam |
| Assets | Cloudflare R2 behind Cloudflare CDN |
| AI | Agnes AI (LLM and images), Gemini Live (realtime voice), Deepgram (speech) |
| Analytics | ClickHouse event store, Grafana dashboards |
