# Smriti — UI/UX Flow

Status: Draft v0.2, 29 Oct 2026. Replaces v0.1 (28 Oct).

- **Chosen direction:** "Sunny Subjects". Light, simple and colourful. Every subject has its own colour, and cards carry big illustrations. Dark mode follows "Night Colour".
- **This doc** is the short version: principles, the visual summary, the patterns every screen shares, and where each area's specs live.
- **Screen specs:** every screen has a block in `docs/ux/<area>.md` with the same 12 headings: purpose and main action, entry and exits, layout, copy (EN + HI), states, interaction and motion, accessibility, analytics, web layout, illustration slots, phase and mock priority. The index of all 315 screens is [`SCREENS.md`](SCREENS.md).
- **Navigation and logic:** [`APP_FLOW.md`](APP_FLOW.md). **Tokens and components:** `DESIGN.md` and `packages/tokens/tokens.json`.
- **Visual mocks:** `design/mocks/` holds the P0 screens of every area, built into one gallery page by `cd tools/mocks && npm install && node build.mjs`. The illustrations in them are draft Agnes AI images.
- **Earlier direction boards:** [Smriti Mobile Directions canvas](https://claude.ai/artifact/BQF48w6kC4bv6PtJhHFzzZ).

---

## 1. Principles

1. **Simple first.** Each screen has one main action. Everything else is secondary. No decorative styles: no clay, no glass gimmicks, no fake paper.
2. **Colour means something.** Each subject owns a colour, used the same way everywhere: its card tint, progress bar, lesson header and icons. Gold is reserved for the streak, the plant, gems and the ₹1 offer tag.
3. **Illustration on every key screen.** The pet, the plant, a subject object or the lesson's own visual. Illustrations explain or reward, and are never filler. Every one comes from Agnes AI through `skills/visual-director`. Icons are Phosphor.
4. **The pet is the voice.** System messages, tips and nudges come from the cat or dog in short, warm lines. The pet never states a fact or a number it can't back up.
5. **Fast on cheap phones.** Flat colours, soft shadows and WebP illustrations. Heavy effects (blur, 3D) appear only inside labs.
6. **Thumb-friendly.** The main action sits in the bottom third, touch targets are at least 48 px, and the tab bar is always visible on main screens.
7. **Bilingual by design.** Every layout fits Hindi strings, which run 20–30% longer, without truncation. No text is baked into images.
8. **Honest by default.** No fake timers, anchors or "% off". Limits are shown up front. Locked items always open a preview. Deleting an account is never hidden.

## 2. Visual language summary

`DESIGN.md` and the tokens are the source of truth. This is the short version.

| Token | Light | Night Colour | Use |
|---|---|---|---|
| `bg` | `#F6F7FB` | `#11131C` | App background |
| `surface` | `#FFFFFF` | `#1B1E2B` | Cards, sheets, tab bar |
| `ink` | `#151A2D` | `#F3F4FA` | Primary text |
| `inkMuted` | `#4A5470` | `#A3A8BF` | Secondary text, at least 4.5:1 on white and on tints |
| `primary` | `#3557E8` | `#7B93FF` | Main buttons, links, the active tab, Pro chips |
| `streak` on `streakTint` | `#F5A300` on `#FFF1B8` | `#FFC53D` on `#3D3410` | Streak, plant, gems, the ₹1 tag only |
| `success` | `#2FB463` | `#4ADE80` | Correct, done |
| `error` | `#D6363C` | `#FF6B6B` | Wrong answers, destructive buttons. Always with an icon |
| `warning` | `#F08C00` | `#FF9F43` | Streak at risk, timer warnings. Always with an icon |

- **Subjects:** each has a `tint` and a `strong` value in `tokens.subject`, mapped by `subjectMap`. The mocks use the classes `.s-physics`, `.s-chemistry` and so on.
- **Exam accents:** the all-exams app uses `primary` blue. Each exam app swaps the primary colour from `tokens.examAccent`. Subject colours stay the same in every app. The mock runner keeps all-exams blue in every app.
- **Type:** Plus Jakarta Sans for Latin text and Noto Sans Devanagari for Hindi. The scale is in `tokens.type` (display, title, heading, body, label, caption).
- **Shape:** cards 20–24 px radius, buttons 20 px, sheets 28 px at the top, chips fully round.
- **Depth:** one soft card shadow and a coloured glow for the primary button.
- **Google and Apple buttons** follow each company's rules, with colours from `tokens.thirdParty`. This is the one documented exception to the tokens-only rule (DESIGN.md §5).

## 3. Patterns every screen shares

| Pattern | Rule | Where it is specified |
|---|---|---|
| **Hindi register** | आप everywhere; तुम only in little-learner (class 1–5) copy. Plain spoken Hindi with the loanwords students use (लेसन, मॉक टेस्ट, स्ट्रीक). Gender-neutral lines for the student, pets and friends, with ICU `select` where unavoidable | each `docs/ux/*.md` copy table |
| **Names of minors** | Under-18s appear to other students only after guardian consent, with the pet avatar and an auto-generated nickname ("Sunny Sprout 27" / "धूप अंकुर 27"). Friends added by invite link or QR see the pet name. A typed name is never public | `docs/flows/tutor-social.md`, `docs/flows/auth.md` §6.10 |
| **Pro chip and locks** | "Locked" only means Pro. A Pro chip on the item; tapping opens a preview or the LRN-05 sheet, never a dead end. Little learners see "Ask a grown-up" and never a price | `docs/ux/learn.md` §0.2, LRN-05 |
| **Upsell placement** | No Pro upsell on Home. At most one prompt per lesson complete. The inline Pro card every 5th lesson, 13+ only. No upsell inside reviews or mocks | `docs/flows/learn.md` §7.5, PAY-19 |
| **Login sheets** | Soft (AUTH-01, can say Later) or hard (AUTH-02, always has Back). Google first, Apple under it on iOS, then the trust line "We never call you or share your email." | `docs/ux/auth.md` §0.2 |
| **Save-state chip** | Shows whether progress is only on this phone, saving, saved to {email}, or saved but offline | AUTH-33 |
| **Tutor button** | Floats on main screens and in lessons. Hidden in the mock runner, during onboarding, and for little learners unless a parent turns it on | AI-01 |
| **Streak and plant** | The streak pill uses the `Plant` icon in gold, never a flame. Freeze slots sit on the streak card. The plant has five stages (seed, sprout, sapling, flowering, tree) and is never shown dead; a long break shows it "Resting" | HOME-01, ME-07, ME-10, ENT-08 |
| **Confidence and ratings** | Sure / 50:50 / Guess in lessons, reviews, drills and mocks where allowed. Review ratings are Again / Hard / Good / Easy, each with a label and the next interval | `docs/ux/memory-labs.md` P1 |
| **Mock runner** | Plain on purpose: light by default, all-exams blue, no mascots, confetti, tutor or pushes, a "not affiliated with {conducting_body}" footer, and no exam-body logos | `docs/ux/practice.md` MOCK-05 to MOCK-18 |
| **Reports** | One shared report sheet (SET-24) for content, tutor answers and community items. SOC-23 is for people and decks | SET-24, SOC-23 |
| **Notifications** | Push copy comes from the pet, in the student's language, at most 60 characters. Minors get only the reminder time they picked; friend pushes wait for that window | NTF-01 |
| **Empty and error states** | Illustration, one line, one action. Our-side errors show the pet with a wrench and a short code. Offline shows a slim banner, and downloaded content keeps working | each area's states section |

## 4. Areas

| Area | Main screens | Screen specs |
|---|---|---|
| Entry and onboarding | ENT-01 splash, ONB-01 welcome and language, ONB-02 goal, ONB-07 level, ONB-10 pick and name your buddy, ONB-12 plant your seed, ONB-14 first win, ONB-08 daily goal, ONB-15 reminder, ENT-08 streak check-in | [`ux/onboarding.md`](ux/onboarding.md) |
| Sign-in and accounts | AUTH-01 / AUTH-02 login sheets, AUTH-04 Google handoff, AUTH-06 saved, AUTH-08 merge, AUTH-12 sign out, AUTH-13 delete, AUTH-18 to AUTH-23 guardian consent, AUTH-24 to AUTH-28 parents and children, AUTH-29 web sign-in | [`ux/auth.md`](ux/auth.md) |
| Home, learning and lessons | HOME-01 Home, HOME-02 Today's plan, LRN-01 subject map, LRN-02 chapter, LRN-03 topic card, LES-01 lesson player, LES-08 lesson complete, LES-10 rapid cards | [`ux/learn.md`](ux/learn.md) |
| Memory tools and labs | MEM-01 memory hub, MEM-03 review session, MEM-02 comeback plan, MEM-14 palace builder, MEM-19 make it stick, MEM-25 how well I know it, LAB-01 Labs hub, LAB-04 sim player, LAB-08 3D viewer, LAB-13 periodic table | [`ux/memory-labs.md`](ux/memory-labs.md) |
| Practice and mock tests | PRC-01 Practice hub, PRC-04 practice runner, PRC-07 PYQ bank, PRC-11 daily challenge, PRC-14 analytics, MOCK-01 lobby, MOCK-07 / MOCK-08 runner, MOCK-09 palette, MOCK-19 report | [`ux/practice.md`](ux/practice.md) |
| AI tutor and friends | AI-02 tutor chat, AI-14 voice, AI-19 photo doubt, AI-21 role play, SOC-01 Friends, SOC-08 league, SOC-12 Duos, SOC-18 duel | [`ux/tutor-social.md`](ux/tutor-social.md) |
| Me, settings, Pro and notifications | ME-01 Me, ME-04 pet room, ME-07 plant garden, ME-17 shop, SET-01 settings, SET-02 account, PAY-01 paywall, PAY-12 manage plan, NTF-01 pushes, NTF-08 to NTF-10 widgets | [`ux/me-money.md`](ux/me-money.md) |

## 5. Motion, sound and haptics

| Moment | Motion | Sound | Haptic |
|---|---|---|---|
| Tap a button | Scale to 0.97, then back in 120 ms | none | light |
| Correct answer | Option turns green, a check pops in with a spring, the pet hops | soft "ding" | success |
| Wrong answer | Option shakes (2 × 6 px), turns red with a cross icon, the hint slides up | soft "bonk" | warning |
| Lesson complete | Confetti for 1.2 s, the pet's celebration, XP counting up | short jingle | success |
| Streak day counted | The plant grows a leaf (Rive state change) and the plant pill's number flips | chime | medium |
| Pet mood change | Rive blend over 400 ms | optional purr or bark | none |
| Page transitions | Native push on iOS, shared-axis X on Android. Lesson cards slide horizontally | none | none |

- **Reduced motion:** confetti, shakes and parallax become fades, and Rive animations switch to static poses. The setting applies everywhere, sims included.
- **Sound** is off when the phone is silent, with separate toggles for sound and haptics.
- **Gyroscope** only in 360° scenes, 3D models and a light tilt on the Home hero (at most 6°), always with a drag fallback and [Recenter].
- **Formats:** Rive for the pet and plant, Lottie for confetti and small flourishes, Reanimated for UI motion.

## 6. Web app

The web app (`apps/web`) is built from the same screen specs. Each spec block has a "Web" section. In general:

- **Under 600 px:** the mobile layouts with the bottom tab bar.
- **600 px and wider:** a left sidebar replaces the tabs, with the streak, plant and pet in a compact card at its top. Lists and details sit side by side.
- **Lessons:** the card column is capped at 720 px. The tutor opens as a right-hand panel. Arrow keys move between cards and Enter checks an answer.
- **Mock runner:** the official computer-based test layout, with the question on the left, the palette on the right, and the tabs and timer on top. Full keyboard support.
- **Sign-in:** Google One Tap first, then the AUTH-01 sheet, and AUTH-29 as the sign-in page.
- **Reminders:** Web Push where supported, otherwise an opt-in email reminder.

## 7. Dark mode

- Night Colour tokens (`tokens.color.dark`). Background `#11131C`, surfaces `#1B1E2B`.
- Subject colours use their brighter values for fills, with dark ink on them.
- Illustrations stay the same; their bright colours work on dark.
- The mode follows the system by default, with a manual override in SET-07, and a separate "Dark mode in mocks" toggle because the runner is light by default.

## 8. Accessibility checklist

- Text contrast at least 4.5:1, including muted text on tinted cards. Contrast comes from token pairs only.
- Status is never shown by colour alone. Correct, wrong, marked and locked each carry an icon, a shape or a word.
- Dynamic type up to 200% without clipping. Cards grow, and grids switch to one column.
- Screen-reader labels on every icon and illustration (or hidden when decorative), and on the pet's lines.
- Captions on all audio and video, and transcripts for the voice tutor.
- Reduced motion and reduced sound are respected.
- Focus order follows the visual order. The mock runner works fully from a hardware keyboard.
