# Smriti build progress

Last updated 2026-10-31. Branch `claude/project-thread-vnixsy`. Screen-by-screen status for iOS, Android and web is in `docs/PARITY.md`; this file is the summary of what is done and everything that is left.

## Where the build stands

- The whole workspace passes typecheck, lint and tests (75 of 75 turbo tasks). The API has 544 passing tests, the worker 23. Content check: 543 files, 0 errors.
- Web and mobile both run the full journey from guest to Pro against the real local API: onboarding, a lesson, streak, sign-in prompt, Google link (dev auth), paywall, fake payment, Pro.
- Nothing is deployed. Every real account (Supabase, Railway, Cloudflare, Google, Apple, stores, payment providers) still has to be created by the owner (see `docs/DEPLOY.md`).
- No content is released. `content/releases.json` is empty, so a production publish builds nothing until the owner releases a chapter.

## Completed

### Planning and design
- PRD, TRD, APP_FLOW, UX_FLOW, DB_SCHEMA, IMPLEMENTATION_PLAN, SCREENS, per-area flow and UX docs.
- AGENTS.md, DESIGN.md, design tokens (WCAG AA checked), "Sunny Subjects" UI, HTML mocks for every main screen.
- Logo "Sprout and spark" with app icons, favicons and lockups.
- Content skills in `skills/`: syllabus-mapper, exam-blueprint, lesson-author, question-author, pyq-ingest, mnemonic-maker, visual-director, anim-maker, sim-builder, model-3d-sourcer, audio-maker, content-qa.

### Backend (apps/api, FastAPI)
- Auth: dev auth locally, Supabase token shape, guest (anonymous) accounts, Google link with merge, Sign in with Apple token revocation on account deletion.
- Sync: offline-first outbox protocol, contract v1.7 (`docs/contracts/sync.md`: test-out, chapter reset, placement marks), shared test vectors with app-core.
- Learning: lessons and progress, streak with freezes, plant and pet, XP, quests, shop, FSRS spaced repetition, comeback plans, insights (calibration, weak areas, sleep review), memory palaces synced across devices.
- Practice: drills by concept, chapter and difficulty, PYQ practice, weak spots, daily challenge, free quota, answer checking shared with lesson-core.
- Mocks: built from official blueprints, server timers, section locking, autosave, negative and partial marking, reports with percentiles from real attempts only, live mock rooms and leaderboards.
- AI: tutor chat with streaming, retrieval over published content (full-text search), guardrails and minors' rules, photo doubts with similar questions, Feynman explain-back, role play, voice tutor seam (Gemini Live), speech endpoints. Model names come only from config.
- Accounts and safety: guardian consent (DPDP) with notice version from config, consent cancel, parent linking for existing teens, managed child accounts, Parent mode, time limits and time requests.
- Money: Razorpay (web) and RevenueCat (mobile) behind a billing interface with a fake, ₹99/month and ₹1 first month, grace, cancel, refunds, family plan seam, child pay links ("Send to my parent").
- Social: friends, invites, leagues, Duos, squads, duels, shared decks, preset cheers only.
- Notifications: push tokens, Expo push sender, quiet hours, daily caps, minors' rules, weekly parent email.
- Analytics: event intake with server-side age and consent policy, ClickHouse store (local file in dev), readiness summary for the progress screen.
- Exports: PDF formula sheets and progress reports (WeasyPrint, Hindi fonts).
- 33 SQL migrations with row-level security and RLS tests for every user table.

### Worker (apps/worker, arq)
- Content publish, media generation through Agnes, notifications, PDF, league and duo roll-ups, duel sweep, squad quests, deck moderation, parent digest, retention, FSRS optimiser job (reports unavailable without its library).

### Web app (apps/web, React + Vite)
- Four tabs, English and Hindi, Night Colour, offline support with a service worker, code-split routes under the 350 KB budget.
- Onboarding, guest mode, sign-in prompt, Google link and merge, guardian consent, Parent mode with a separate grown-up session.
- Home, Learn (subject, chapter, topic), lesson player, memory review, decks, focus mode, comeback, insights, memory palaces, Labs with real sims, practice drills, mixed drill, mocks and reports, live mock room, readiness cards, tutor, Feynman, voice screen, Me, pet room, shop, quests, streak check-in, paywall and Pro, notifications and push, settings, teen link requests.
- Playwright end-to-end tests on a fake API and on the real API, axe accessibility checks, screenshots in both languages and themes.

### Mobile app (apps/mobile, Expo SDK 57)
- One codebase built per exam (JEE, NEET, UPSC, SSC, all), SQLite storage, background sync, secure token storage, local notifications, home screen widget data.
- Onboarding, guest mode, Google and Apple sign-in seams, paywall with RevenueCat seam.
- Home, Learn with subject map and chapter actions (test-out, reset, downloads), lesson player, review with Undo, Labs with real sims and full screen, practice and mocks, practice history and progress, share card, tutor.
- Little learner mode (three tabs, stories, songs, play), Parent mode, social, Feynman, voice, memory palaces, insights, live mocks.
- Jest tests including the full guest-to-Pro journey, Maestro flows written (not run, no simulator here), iOS and Android exports build.

### Shared packages
- app-core (all business rules for both apps), lesson-core, content-schema, config and flags, i18n catalogues (EN and HI), analytics catalogue, tokens, ui-web and ui-native component sets, lesson players for web and native (lessons, stories, songs, play), api-client, sim-bridge.

### Content (written through the skills, all awaiting a person's review)
- Exam data: exam files, blueprints from official notices, syllabus graph, exam maps, coverage reports.
- Chapters at 100% coverage for their exams:
  - Physics: Current Electricity, Units and Measurement, Motion in a Straight Line, Motion in a Plane, Laws of Motion, Work Energy and Power, Systems of Particles and Rotational Motion.
  - Chemistry: Chemical Bonding and Molecular Structure.
  - Maths: Sets, Relations and Functions (class 11 intro and class 12).
  - Biology: Cell the Unit of Life, Biomolecules, Cell Cycle and Cell Division.
  - Class 1 maths: "Mango Treat" (numbers 1 to 9) with a storybook, a chant and play activities.
- One official PYQ paper: JEE Main 2026, 2 April Shift 1, checked against NTA's final key.
- Agnes images for every slice, with provenance logged.
- Six sims: Ohm's law circuit, simple pendulum, convex lens bench, acid-base titration, motion graphs, projectile launcher (the last two await review).

### Deploy and operations
- Dockerfiles for API and worker, Railway config with a release migrator, Cloudflare Workers config for web, site and CDN, R2 layout, security headers, app links (AASA and assetlinks).
- GitHub Actions: CI (lint, types, tests on Postgres and Redis, content check, e2e) and deploy workflows (staging on main, production on tag with approval).
- Sentry on API, worker and web with personal data scrubbed. `pnpm env:check` keeps `.env.example` honest.
- `docs/DEPLOY.md` first-deploy runbook, `docs/LOCAL_DEV.md`, `docs/SUPABASE_SPIKE.md`.
- Release gate (`content/releases.json`) so only reviewed, 100%-covered chapters reach production.

## In progress now
- Web: social screens, parent-side "Link a teen", managed children, photo doubts, role play, palace sync on the shared store, the remaining streak check-in variants.
- Mobile: photo doubts, readiness cards, role play, analytics intake, Apple re-auth on deletion, mobile Sentry.
- Mobile still has to send the v1.6 and v1.7 events (test-out, chapter reset, placement) from its check screens.
- Lesson narration audio and pet reactions in the players.
- Marketing site: Hindi home is at about 2.0 s LCP on a phone after the font subset (other Hindi pages are under 2.0 s); confirm on a quiet machine or in CI.
- Content: Gravitation next. Sims requested: friction on an incline, collision track, flywheel and cord (PhET is non-commercial, so we build our own).
- An independent end-to-end verification run, written up in `docs/E2E_REPORT.md`.

## Left to do

### Needs the owner
- Final brand name and domain (`packages/config/brand.json`), then create every account in `docs/DEPLOY.md`: Supabase, Railway, Cloudflare and R2, Google OAuth, Apple developer and Sign in with Apple, Play Console, App Store Connect, EAS, Razorpay, RevenueCat, Resend, ClickHouse, Sentry, Gemini, Deepgram, Agnes (key in the environment).
- Pick the narration voices. Deepgram Flux has Hindi and Indian-accent English voices; samples are in `/mnt/project-files/smriti/voice-samples/flux/`.
- Review and approve content and images, then release chapters in `content/releases.json`.
- Approve the class 1 images (under-10 rule), and have someone build the six Rive tracing guides.
- Confirm the proposed values for XP, duels, voice limits, Feynman, anti-cheat, live mocks, link-request expiry, role-play turn caps and the other flags marked "proposed" in `packages/config/src/flags.ts`.
- Say whether a memory review (not only a lesson) should confirm a "Find my level" placement mark.
- Confirm the little-learner play rules (five play kinds, try again then hint then guided answer, one star per round).
- Family plan seats and price, nickname and squad word lists, mascot names, the Hindi app name.
- Embedding provider for tutor search (full-text search works until then).
- A policy for exact technical figures in PYQs (sims, Agnes, or licensed scans).
- The official URL of the NEET UG 2026 re-exam question paper (the answer keys are recorded).
- Legal text for privacy, terms and children's data pages.
- Supabase checks in `docs/SUPABASE_SPIKE.md` against a real project.
- A designer to smooth the logo SVG before store submission.

### Product work still open
- MEM-19 mnemonic forge (the spec needs a matching rule per technique).
- Palace extras: drag canvas, spot notes, "Put them back", room art (needs Agnes images).
- Voice tutor realtime transport on mobile, native audio recording and playback, native glyph mask for tracing.
- Social extras: QR codes, username setup, week results, activity feed, leaderboards, Duo detail.
- Live mock reminders and calendar on mobile; Feynman follow-up questions.
- Insights heat map and filters; progress cards for subject mastery and trend.
- Parent PIN screens on web; "Send a cheer".
- More art from Agnes: palace rooms, league crests, a few scene illustrations.
- Native widgets compiled and tested on devices; Maestro flows run on a simulator.

### Content still to write
- Every remaining chapter for every exam (JEE Main is about 9% covered, NEET about 7 to 10% per subject; UPSC, SSC and classes 1 to 12 have barely started). A subject ships only at 100% coverage.
- More official PYQ papers, starting with NEET once its paper URL is known.
- Narration audio for every lesson once voices are chosen.
- Sims requested by lessons (motion graphs so far).

### Before launch
- First real deploy to staging, then production, following `docs/DEPLOY.md`.
- Device testing on iOS and Android, store listings, app review.
- Load test and a security review.
