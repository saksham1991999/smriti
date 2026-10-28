# Smriti — UI/UX Flow

Status: Draft v0.1, 28 Oct 2026.

- **Chosen direction:** "Sunny Subjects". Light, simple and colourful. Every subject has its own colour, and cards carry big illustrations.
- **Dark mode:** follows the "Night Colour" direction.
- **Reference mockups:** [Smriti Mobile Directions canvas](https://claude.ai/artifact/BQF48w6kC4bv6PtJhHFzzZ), boards 7 and 10.
- **Related docs:**
  - `APP_FLOW.md` covers navigation and logic.
  - `DESIGN.md` covers tokens and components.
  - This document covers how each screen looks, moves and feels.

---

## 1. Principles

1. **Simple first.** Each screen has one main action. Everything else is secondary. No decorative styles: no clay, no glass gimmicks, no fake paper.
2. **Colour means something.** Each subject owns a colour, used the same way everywhere: its card tint, its progress bar, its lesson header, its icons.
3. **Illustration on every screen.** Every key screen has at least one large illustration: the pet, the plant, a subject object, or the lesson's own visual. Illustrations explain or reward. They are never filler.
4. **The pet is the voice.** System messages, tips and nudges come from the cat or dog in short, warm lines, for example "Halfway there!" instead of "50% complete".
5. **Fast on cheap phones.** Flat colours, soft shadows and PNG/WebP illustrations. Heavy effects (blur, 3D) only appear inside labs.
6. **Thumb-friendly.** Primary actions sit in the bottom third of the screen, touch targets are at least 48 px, and the bottom tab bar is always visible on main screens.
7. **Bilingual by design.** Every layout must fit Hindi strings, which run about 20–30% longer, without truncation.

## 2. Visual language summary
`DESIGN.md` is the source of truth. This is the short version.

| Token | Value | Use |
|---|---|---|
| Background | `#F6F7FB` | App background |
| Surface | `#FFFFFF` | Cards, sheets, tab bar |
| Ink | `#151A2D` | Primary text |
| Ink muted | `#4A5470` | Secondary text. Contrast ≥ 4.5:1 on white and on tints. |
| Primary | `#3557E8` | Main buttons, links, the active tab |
| Streak gold | `#F5A300` on `#FFF1B8` | Streak, plant, gems |
| Success | `#2FB463` | Correct answers, done states |
| Error | `#E5484D` | Wrong answers. Always paired with an icon, never colour alone. |
| Physics | tint `#E7EEFF` / strong `#3557E8` | |
| Chemistry | tint `#F1E9FF` / strong `#7B4DDB` | |
| Biology | tint `#E2F6EA` / strong `#1F9D55` | |
| Maths | tint `#FFEBDC` / strong `#E8590C` | |
| History / Social science | tint `#FFF1D6` / strong `#B7791F` | |
| Polity / Economy | tint `#E3F4F8` / strong `#0E7C93` | |
| English / Reasoning | tint `#FFE4EC` / strong `#C2255C` | |

- **Type:** Plus Jakarta Sans for Latin text (800 for headings, 600–700 for UI, 500 for body) and Noto Sans Devanagari for Hindi.
  - Scale: 30 / 22 / 18 / 16 / 14 / 12.
- **Shape:** cards 20–24 px radius, buttons 20 px radius (pill-like), chips fully round.
- **Depth:** one soft shadow level for cards (`0 2px 10px rgba(21,26,45,.06)`) and a coloured glow for primary CTAs (`0 10px 24px` in the primary colour at 35%).
- **Illustrations:** soft 3D, rounded, colourful objects and characters, lit from the top-left, on transparent backgrounds. Agnes AI generates them from the style guide in `DESIGN.md`.
  - The canvas uses Microsoft Fluent 3D emoji (MIT licence) as stand-ins. They can also be shipped for small icons.
- **Per-exam accent:**
  - The all-exams app uses Primary blue.
  - Each exam app can swap the primary colour: JEE indigo `#3557E8`, NEET green `#1F9D55`, UPSC teal `#0E7C93`, SSC coral `#E8590C`.
  - Subject colours stay the same in every app.

## 3. Motion, sound and haptics

| Moment | Motion | Sound | Haptic |
|---|---|---|---|
| Tap a button | Scale to 0.97, then back in 120 ms | none | light |
| Correct answer | Option turns green, a check pops in with a spring, and the pet does a small hop | soft "ding" | success |
| Wrong answer | Option shakes (2 × 6 px), turns red with an ✕ icon, then the hint card slides up | soft "bonk" | warning |
| Lesson complete | Confetti burst for 1.2 s, the pet's celebration loop, and XP counting up | short jingle | success |
| Streak +1 | Plant grows a leaf (Rive state change) and the flame counter flips | chime | medium |
| Pet mood change | Rive state-machine blend over 400 ms | optional purr or bark | none |
| Page transitions | Native stack push (iOS) and shared-axis X (Android). Lesson cards slide horizontally. | none | none |
| Pull to refresh | The pet peeks down from the top | none | light |

- **Reduced motion:** confetti, shakes and parallax are replaced by fades, and Rive animations switch to their static poses.
- **Sounds:** off by default when the phone is in silent mode. There's a separate toggle for sound and for haptics.
- **Gyroscope:** used only in 360° scenes, 3D models and a light tilt on the home hero illustration (at most 6°). Always paired with a drag fallback and a "Recenter" button.
- **Animation formats:**
  - Rive for the pet and plant: one state machine each, with inputs `mood`, `energy`, `stage` and `health`.
  - Lottie for confetti and small UI flourishes.
  - Reanimated for UI motion.

## 4. Screen-by-screen

### 4.1 Splash and update prompt
- **Splash:** brand colour background, the logo, and the pet waving (Rive). It shows for under 1 s, or for as long as the config loads.
- **Soft update:** a bottom sheet. Pet line: "I learned new tricks! Update for the best experience." Buttons: [Update] [Later].
- **Forced update:** a full screen with a single [Update] button. Shown only when the app is below the minimum version.

### 4.2 Onboarding (about 90 seconds in total)
Each step is one screen:
- a big illustration in the top half
- a short question
- big tappable cards
- a primary button pinned to the bottom
- a progress bar at the top
- "Skip" where it makes sense

1. **Welcome.** Both pets wave. Title: "Learn anything. Remember everything." Buttons: [Get started] and "I already have an account".
2. **Language.** Two large cards, "English" and "हिन्दी", each with a greeting illustration. This sets the UI and content language, and the student can change it later.
3. **Goal.** A grid of exam cards with icons: JEE, NEET, UPSC, SSC, Banking, Railways, School (class 1–12), and "Just curious". Multi-select is allowed. *Skipped in per-exam apps.*
4. **When is your exam?** A month and year wheel, or "Not sure yet". Shows "Your exam is in 186 days" with a calendar illustration.
5. **Where are you now?** Three cards: "Just starting", "Know the basics", "Revising". Then an optional 5-question placement quiz in the same lesson player.
6. **Daily goal.** A slider with stops at 5 / 10 / 20 / 30 min. Each stop shows a different plant size ("Casual → Intense").
7. **Pick your buddy.** Cat or dog, each on a large card that bounces when tapped. Then a naming field with suggestions (Miso, Bruno, Laddoo, Chiku).
8. **Plant your seed.** The student taps to plant. The pet waters it, the seed sprouts, and the screen says "Study daily and it grows. Miss days and it gets thirsty."
9. **First lesson.** A 2-minute lesson in the goal's subject, which ends with streak day 1 and a celebration.
10. **Reminders.** The pet asks "Can I remind you at 7 PM?" with a time picker, then the system permission prompt. If the student says no, they can still continue.

**No login anywhere in onboarding.** The student lands on Home as a guest.

### 4.3 Home (Learn tab)
Top to bottom (see board "7 · Home"):
1. **Header.** Pet avatar in a coloured circle, a greeting with the name, then streak 🔥 and gem pills on the right. Tapping the pet opens the Pet room.
2. **Streak card.** Gold tint with the plant illustration on the right. One line about today's state, for example "One lesson waters it today" or "Watered! See you tomorrow", plus progress toward the daily goal.
3. **Continue card.** In the subject's strong colour, with the topic name, mode and percentage, a [Resume] button, and the subject illustration overlapping the edge.
4. **Review due.** Shown only when cards are due: "24 cards · 5 min".
5. **Subjects grid.** A 2 × N grid of tinted cards, each with an illustration, name, percentage and chapter count. The exam switcher chip sits above the grid in the all-exams app.
6. **Bottom tabs (five):** Learn (this Home screen) · Labs · Practice (mocks and PYQs) · Friends · Me. They match `APP_FLOW.md`. Subjects and chapters open from Home, so there's no separate "Learn" tab beyond Home.

**States:**
- **New user:** a "Start here" card in place of Continue.
- **Streak at risk** (after 8 PM, goal not met): the streak card turns warm orange and the pet looks worried.
- **Plant thirsty or dry:** the plant illustration changes, and the copy turns gentle and encouraging.
- **Offline:** a slim banner reads "Offline. Downloaded lessons still work."

### 4.4 Subject map and chapter
- **Subject map.** A header in the subject's colour with the subject illustration, then the chapter list as cards with a progress ring, chapter illustration, "high-yield" chip and PYQ count. Filters: All · In progress · Not started · Weak.
- **Chapter.** A topic list with done, next and locked states (see board "7 · Topic"), chapter cheat-sheet and formula-sheet buttons, and a chapter test.

### 4.5 Topic card
- A coloured header with a large illustration, the topic title, the exam relevance chip, and a back button.
- **Mode choice:** two big cards.
  - **Deep dive** (selected by default for new topics) shows its duration and contents.
  - **Quick revision** (the default once the topic is learned) shows its duration and contents.
- A subtopic checklist with times.
- A memory-trick card (gold) and a YouTube video card (red play icon). The video opens the YouTube app or an in-app player.
- A pinned primary CTA: "Start deep dive" or "Start quick revision".

### 4.6 Lesson player
- **Top bar:** close (✕), a segmented progress bar, and a "3 of 8" counter.
- **Body:** a single card per screen. The student moves forward with [Continue] or by swiping. Card types and their layouts:
  - **Story / explainer:** a large illustration (about 40% of the height), a heading of up to 2 lines, and body text of at most 3 short paragraphs. Key terms are highlighted in the subject tint, and tapping one opens a definition.
  - **Formula:** rendered with KaTeX in a tinted box. Each symbol is tappable to see its meaning and units, and "Add to formula vault" saves it.
  - **Interactive or sim:** the sim is full width and keeps a 4:3 or 1:1 aspect ratio. Controls sit below it, never on top. There's an "Expand" button for full screen.
  - **3D or 360°:** opens full screen with drag and gyroscope, labels as pins, and [Recenter] and [Close] buttons.
  - **Derivation:** steps reveal one at a time, with "Why?" chips on each step.
  - **Question:**
    - The stem sits at the top. Options are full-width cards, or a 2 × 2 grid when they're short. A numerical question gets a keypad.
    - A confidence row (Sure / 50:50 / Guess) sits under the options.
    - [Check] is pinned at the bottom.
    - The result appears in a bottom sheet: green "Correct!" with an explanation link, or red with a hint and [Try again].
  - **Memory hook:** a gold card with the mnemonic in big type and an optional illustration. Buttons: [Make my own] (AI) and [Add to deck].
  - **Role play:** a chat layout with the character's avatar, suggested replies as chips, and a microphone button.
- **Floating tutor button** (bottom right, above the CTA): opens the AI tutor sheet at 60% height, which the student can expand.
- **Exit confirmation:** a sheet that says "Your progress is saved."

### 4.7 Lesson complete
- A big pet celebration illustration with confetti.
- Three stat tiles: XP, accuracy and time.
- A plant update line, for example "Your plant grew a leaf".
- [Continue] (primary) and [Share] (secondary).
- Every 5th lesson, a gentle Pro upsell card for free users, shown below the buttons and never blocking them.

### 4.8 Review (spaced repetition)
- A card stack with the front showing first. Tap to flip. The back shows the answer and an illustration.
- Four rating buttons with next-interval labels (Again / Hard / Good / Easy), coloured red, amber, green and indigo, and labelled with text.
- A progress bar at the top. The pet comments at 50% and at the end.
- An end screen shows how many cards were remembered and when the next review is due.

### 4.9 Labs tab
- A hub grid of lab cards with illustrations, filterable by subject. Featured at the top: Periodic table, Virtual titration, Circuit builder, Optics bench, Human body 3D.
- **Lab screen:** the scene is full width at the top, then the tasks list ("1. Fill the burette…"). Readings appear as stat chips. Buttons: [Record reading] and [Ask tutor].
- **Periodic table:** a horizontally scrollable grid coloured by block or family. Tapping an element opens a sheet with an illustration, properties, uses, a mnemonic and a 3D atom view.

### 4.10 Practice and mocks
- **Practice hub:** a weak-spots card (from analytics), concept drills, a PYQ bank (filter by year and topic), and the daily challenge.
- **Mock lobby:** cards for upcoming live mocks, full mocks, sectional mocks and PYQ papers. Each card shows duration, questions and marking. History is shown below.
- **Instructions:** these replicate the official instructions screen (NTA or SSC style), with a language select and an "I have read the instructions" checkbox.
- **Mock runner:**
  - It is deliberately **plainer** than the rest of the app, so students practise in an interface that looks like the real exam.
  - Header: exam name and a large timer. Below it, section tabs.
  - The question area takes most of the screen.
  - The palette opens as a sheet with exam-standard colours plus shapes (answered, not answered, marked, answered and marked, not visited).
  - Buttons at the bottom: [Mark for review & next] [Clear] [Save & next].
  - Mascots and confetti never appear inside the runner.
- **Report:** see board "10 · Mock report", restyled in light mode.
  - Score ring, percentile and rank.
  - Subject bars in subject colours.
  - Time analysis tiles: right but slow, fast and wrong, lucky guesses.
  - A time-per-question strip chart, then concept heat map, confidence breakdown and solutions.
  - A "Fix next" card that leads to a drill.

### 4.11 AI tutor
- **Chat sheet:** the pet avatar answers. Messages support KaTeX, images (Agnes) and "Save as flashcard".
- The input row has a text field, a camera button (photo doubt) and a microphone button (voice).
- **Voice mode:** a full-screen pet illustration that animates while speaking, live captions, a big mic button and [End].
- **Limits:** free users see "3 of 5 free questions left today". At the limit, a soft paywall appears.

### 4.12 Friends
- A league card (tier illustration, rank, time left), friends' streaks in a row (pet avatars), the duo partner card, and squads.
- **Duel:** pick a friend or random opponent, then a 3-2-1 countdown, then 10 quick questions side by side, then a result with both pets.

### 4.13 Me
- A profile header: avatar and pet, then stats (streak, XP, lessons, accuracy).
- **Pet room:** see board "9 · Pet and plant", restyled in Sunny colours. It shows mood and plant health meters, the plant journey timeline, care actions, and accessories (gems).
- Badges and the card album, downloads, PDF export, subscription, settings, and parent mode.

### 4.14 Login sheet (whenever triggered)
- A bottom sheet with the pet holding the plant, and the line "Save Miso and your plant forever."
- Buttons: [Continue with phone] (OTP), [Continue with Google] and, on iOS, [Continue with Apple]. "Email instead" is a link.
- **OTP screen:** 6 boxes with auto-read on Android. "Resend in 0:30".
- **After login:** "Welcome back! Your 12-day streak is safe." Then the student returns to where they were.

### 4.15 Paywall
- A full-screen sheet. At the top, the pet holds a gold ₹1 tag.
- **Headline:** "Try Pro for ₹1 for your first month." Then "₹99/month after. Cancel anytime."
- A 4–5 row benefit list with illustrations: all deep dives, unlimited mocks, voice tutor, PDF books, offline.
- **Plan card:** monthly, with yearly added later.
- [Start for ₹1], with platform-specific fine print: UPI Autopay on web, store billing in apps.
- "Maybe later" is always visible. There are no dark patterns and no fake timers.

### 4.16 Notifications and widgets
- **Push copy** always comes from the pet, in the student's language, and is at most 60 characters. Examples:
  - "Miso saved you a seat. 5-min lesson?"
  - "Your plant is thirsty."
  - "Riya challenged you!"
- **Rich notification:** the pet image as the large icon.
- **Widgets:**
  - **Small (plant):** the plant illustration plus the streak number.
  - **Medium (pet + today):** pet mood, today's progress ring and a [Review] deep link.
  - **Large (plan):** the exam countdown plus 3 plan items.
  - All widgets use the subject and brand colours and render in light or dark mode.

## 5. Empty, error and edge states

| State | Treatment |
|---|---|
| No internet on a non-downloaded lesson | Sleeping-pet illustration, "This lesson needs internet", and [Download for later] when back online |
| Server error | Pet holding a wrench, "Something broke on our side", [Try again]. Logs the trace ID. |
| No reviews due | Pet relaxing, "All caught up! Next review in 3 h" |
| Plant dormant (long break) | A gentle illustration of the plant resting. "Welcome back! Let's wake your plant up: 3 short days." Never shows a dead plant. |
| Pet unwell (long break) | Pet resting in a basket with a blanket, never shown in distress. A "Nurse back to health" quest. |
| Search with no results | "Couldn't find that. Ask the tutor instead?" |
| Guest hits a social feature | Login sheet with the reason shown |

## 6. Dark mode
- Based on Night Colour. Background `#11131C`, surfaces `#1B1E2B`.
- Subject colours shift to their brighter "strong" values for fills, with dark ink on them.
- Illustrations stay the same. Their bright colours work on dark.
- The mode follows the system by default, with a manual override in settings.

## 7. Accessibility checklist
- Text contrast ≥ 4.5:1, including muted text on tinted cards. Check every subject tint.
- Status is never shown by colour alone. Correct, wrong and marked each carry an icon or shape.
- Dynamic type up to 200% without clipping. Cards grow, and grids switch to one column.
- Screen-reader labels on every illustration (or `importantForAccessibility="no"` when decorative), and on the pet's lines.
- Captions on all audio and video, and transcripts for the voice tutor.
- Reduced-motion and reduced-sound settings are respected.
- Focus order follows the visual order. The mock runner is fully operable with a hardware keyboard on tablets.
