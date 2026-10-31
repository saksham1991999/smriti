# Practice and mocks: screen specs

Status: Draft v0.1, 29 Oct 2026. Owner: practice agent. Logic, branches and data are in `docs/flows/practice.md` (cited below as "flow §n"). Tokens and components are from `DESIGN.md` and `packages/tokens/tokens.json`.

Placeholders:
- `{duration_min}`, `{section_timer_min}`, `{marking.correct}`, `{marking.wrong}`, `{attempt_any}`, `{languages}` and every other blueprint value are read from the blueprint at run time. None is written into the app.
- `{free.practice_questions_per_day}` and other `{flag}` values come from `GET /v1/config`.
- `{pet_name}` is the student's pet's name. `{topic_title}`, `{question_stem}`, `{concept_name}` are content. Copy tables never contain study content.

---

## Screen index

| ID | Screen | Platform notes | Priority | Phase |
|---|---|---|---|---|
| PRC-01 | Practice hub | All | P0 | 1 |
| PRC-02 | Weak spots | All | P1 | 1 |
| PRC-03 | Drill setup | Sheet on phone, dialog on web | P0 | 1 |
| PRC-04 | Practice runner | All | P0 | 1 |
| PRC-05 | Answer and solution sheet | Sheet on phone, right panel on web | P0 | 1 |
| PRC-06 | Drill summary | All | P0 | 1 |
| PRC-07 | PYQ bank | All | P0 | 1 |
| PRC-08 | PYQ filters | Sheet on phone, side panel on web | P1 | 1 |
| PRC-09 | Chapter PYQs | All | P1 | 1 |
| PRC-10 | PYQ paper | All | P1 | 1 |
| PRC-11 | Daily challenge | All | P0 | 1 |
| PRC-12 | Challenge result and leaderboard | All | P0 | 1 |
| PRC-13 | Share card | Mobile and web (Web Share API or download) | P1 | 1 |
| PRC-14 | Analytics dashboard | All | P0 | 1 |
| PRC-15 | Subject analytics | All | P1 | 1 |
| PRC-16 | Practice history | All | P2 | 1 |
| PRC-17 | Free limit sheet | All | P1 | 1 |
| PRC-18 | PYQ source sheet | All | P1 | 1 |
| MOCK-01 | Mock lobby | All | P0 | 1 |
| MOCK-02 | Mock detail | All | P1 | 1 |
| MOCK-03 | Live mock room | All | P1 | 3 |
| MOCK-04 | Pre-flight check | All | P1 | 1 |
| MOCK-05 | General instructions | All | P0 | 1 |
| MOCK-06 | Paper instructions and declaration | All | P0 | 1 |
| MOCK-07 | Mock runner (phone) | Phone app and phone-width web | P0 | 1 |
| MOCK-08 | Mock runner (CBT layout) | Tablet app and web at ≥ 600 px wide and ≥ 480 px tall | P0 | 1 |
| MOCK-09 | Question palette (and OMR sheet) | Sheet on phone, fixed panel in MOCK-08 | P0 | 1 |
| MOCK-10 | Calculator | Sheet on phone, floating window in MOCK-08 | P1 | 1 |
| MOCK-11 | Rough-work pad | Full-screen overlay on phone, side panel in MOCK-08 | P1 | 1 |
| MOCK-12 | Question paper view | All | P2 | 1 |
| MOCK-13 | Section change | All | P1 | 1 |
| MOCK-14 | Paused and resume | All | P1 | 1 |
| MOCK-15 | Leave mock | All | P2 | 1 |
| MOCK-16 | Submit confirmation | All | P0 | 1 |
| MOCK-17 | Time up | All | P1 | 1 |
| MOCK-18 | Submitted | All | P1 | 1 |
| MOCK-19 | Mock report | All | P0 | 1 |
| MOCK-20 | Time analysis | All | P1 | 1 |
| MOCK-21 | Concept and confidence analysis | All | P1 | 1 |
| MOCK-22 | Solutions review | All | P0 | 1 |
| MOCK-23 | Compare attempts | All | P2 | 1 |
| MOCK-24 | Live mock leaderboard | All | P1 | 3 |
| MOCK-25 | Mock history | All | P2 | 1 |
| MOCK-26 | Custom mock builder | All, Pro | P2 | 2 |

## Shared rules for this area

**Two looks.**
- **Practice look** (PRC screens, MOCK-01 to MOCK-03, MOCK-19 to MOCK-26): the normal Sunny Subjects style. Subject colours from `subjectMap`, illustrations, pet lines, the tab bar on main screens.
- **Runner look** (MOCK-04 to MOCK-18): plain and exam-like (UX_FLOW §4.10, DESIGN.md §2.4, §9). Light by default even when the app is in dark mode, unless the student switched "Dark mode in mock tests" on (SET-07 appearance). Only neutral tokens (`bg`, `surface`, `surfaceSunken`, `line`, `ink`, `inkMuted`), the palette colours of the exam's interface profile (`mockPalette.*` for `generic`), `warning*` and `error*` for the timer, and one action colour. No pet, plant, gems, subject tints, illustrations, confetti, sounds or celebratory haptics. No tab bar and no floating tutor button. No push notifications, NTF-04 banners or NTF-05 toasts appear while the runner is open (R24); they are held until the attempt ends.
- **Action colour in the runner.** The runner always uses the all-exams `primary` (`examAccent.all`) for its main button, in every app variant. The NEET accent is green and the SSC accent is orange, which would clash with the palette's green "answered" and red "not answered" states.

**Components new to this area** are specified with props and states in the appendix "Proposed components" at the end of this file (to add to DESIGN.md §5, built in `ui-native` and `ui-web`).

**Upsell and limits (R15, R25, research X1, X8).**
- No Pro sheet or paywall ever opens on its own anywhere in Practice. PAY-01 opens only when the student taps a Pro chip, a "Pro" link or a Pro action.
- Free limits are shown before a session starts (limit meter, sized drills), never discovered in the middle of one. A drill or PYQ session started on the free tier is sized to the questions left today, so it always ends normally.
- PRC-17 (free limit sheet) is always dismissible: swipe down, back, tap outside or [Not now]. It never blocks reviews, lessons, solutions or the analytics dashboard.
- Under-13s (the `10_12` age band) never see a price. Pro links and Pro chips become [Ask a grown-up], which opens SET-13 parent gate and then PAY-01 for the parent. Little learners (class 1–5) have no Practice tab (R14) and reach none of these screens.

**Identity on leaderboards (R31 amended).** On PRC-12 and MOCK-24, students under 18 appear to others only after guardian consent, and then only as the pet avatar and an auto-generated nickname from the fixed word list, never a typed name or pet name. Adults appear with their display name. A student always sees their own row as "You". No free-text messages between students anywhere.

**Tutor button.** The floating tutor button (AI-01) shows on Practice-look screens. It is hidden on MOCK-04 to MOCK-18, on PRC-11 before submit, and on PRC-04 until the student has tapped [Check] on the current question. From solutions it opens AI-02 with `context_ref = question:{question_id}`.

**Streak and daily goal.** The streak icon is Phosphor `Plant` (fill) in `streak` gold, never a flame (R28). A streak day comes from one lesson, 10 reviews, one mock section (R1) or the daily challenge (R23). A drill alone adds to the daily goal ring, not the streak.

**Phase.** Each block's last line gives its priority and phase (R8). Phase 1 unless stated.

**Pet lines** (Practice look only) use the DESIGN.md Pet line component and the student's pet. EN and HI lines below are written for the pet speaking in the first person.

**Copy conventions.** "PYQ" stays as "PYQ" in Hindi because students use it; "Mock" is "मॉक". Hindi runner labels below are defaults for the `generic` interface profile. When an exam's interface profile encodes the official wording (flow §6.5), the runner uses that wording instead.

---

## Practice

### PRC-01 · Practice hub
**Purpose:** Show the student the single best next practice action and every way into practice. **Main action:** start the top suggested practice (resume a mock, play today's challenge, or drill a weak spot, in that order of precedence).
**Entry → exits:** Tab bar Practice, web sidebar, deep link `smriti.app/practice`, ME-01 stats, HOME-05 search → MOCK-14 (resume card), PRC-11, PRC-12, PRC-02, PRC-03, PRC-07, MOCK-01, PRC-14, PRC-16, MOCK-02 (suggested mock), PRC-17, HOME-04 exam switcher sheet, AI-01 / AI-02 tutor (floating button), AI-16 photo capture or AI-07 Pro teaser ("Snap a doubt" row), PAY-01 paywall (Pro link, trigger `practice_limit`), SET-13 parent gate (under-13 [Ask a grown-up]).
**Layout (top to bottom):**
1. Top bar, 56 px: "Practice" in `title`, the exam switcher Chip on the right (all-exams app, or a variant with two profiles shows a two-option segmented control under the bar instead). Search icon (HOME-05 global search).
2. Resume card (when `mock_local` or the server has an in-progress attempt, research A30): `surface` card, radius `card`, `line` border, a `Timer` icon, "{mock_title}", "{time_left} left · {answered} of {total} answered", a caption "Started on {device_label}" when it began on another device, Button secondary 40 [Resume]. Takes precedence over everything below.
3. Pet line (40 px avatar + bubble), one line chosen by state (see Copy).
4. Daily challenge card: hero card, radius `cardLarge`, `primaryTint` background, illustration on the right overlapping the edge, title "Today's challenge", sub-line "1 question · everyone in {exam_short} gets the same one", Button primary 40 [Play] or, if played, the result glyph + "Solved in {m:ss}" / "Not this time" and [See result].
5. Weak spots card: `surface`, heading "Your weak spots", up to 3 rows. Each row: subject colour dot (subject `strong`) + subject name in `caption` `subject.text`, concept or topic name in `label`, reason Chip (status tint), Button ghost [Drill]. Footer link "See all ({n})".
6. Entry tiles, 2 × 2 grid, 12 px gaps, each tile 1:1-ish (min 148 px tall), `surface`, radius `card`, illustration top-right, title in `heading`, one caption line:
   - Concept drill: "Pick topics, set your pace"
   - PYQ bank: "{paper_count} papers · {pyq_count} questions" (real counts from the manifest)
   - Mock tests: "Next: {next_mock_title}" or "Full, sectional, PYQ papers"
   - Analytics: "Readiness {readiness}%" or "Answer a few to unlock"
7. Suggested mock card (when the lobby has a mock the student hasn't taken): `surface`, mock title, "{duration_min} min · {question_count} questions · {marking_summary}", [View].
8. "Snap a doubt" row: `surface` row, Phosphor `Camera` icon, "Snap a doubt", caption "Photo of a question, step-by-step help". Opens AI-16 for Pro, AI-07 Pro teaser for free (13+). Hidden for under-13s.
9. Recent: section heading "Recent", up to 5 rows (drill, PYQ paper, mock report, challenge), each with type icon, title, meta "{answered} answered · {accuracy}%", relative time. Link "See all" → PRC-16.
10. Limit meter (guest and free only): "Practice today", Progress bar, "{used} of {free.practice_questions_per_day}", and a ghost link "Unlimited with Pro" ([Ask a grown-up] for under-13s). Chapter tests from LRN-06 count toward the same meter.
11. Tab bar (82 px), Practice active. Floating tutor button (AI-01) above it on the right.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Practice | अभ्यास |
| Resume card | {time_left} left · {answered} of {total} answered | {time_left} बचे · {total} में से {answered} उत्तर दिए |
| Resume button | Resume | जारी रखें |
| Pet line, challenge not played | Today's challenge is waiting. One question, one minute. | आज का चैलेंज इंतज़ार कर रहा है। एक सवाल, एक मिनट। |
| Pet line, weak spots found | I found a few spots to fix. Want to start with {concept_name}? | मुझे कुछ कमज़ोर हिस्से मिले हैं। {concept_name} से शुरू करें? |
| Pet line, new student | Let's warm up with a short drill. | आइए, एक छोटी ड्रिल से शुरुआत करें। |
| Pet line, cap reached | That's today's free practice. Reviews are still open! | आज का फ़्री अभ्यास पूरा हुआ। रिव्यू अब भी खुले हैं! |
| Challenge title | Today's challenge | आज का चैलेंज |
| Challenge sub-line | 1 question · everyone in {exam_short} gets the same one | 1 सवाल · {exam_short} में सबको एक ही सवाल |
| Play | Play | खेलें |
| Played, correct | Solved in {m:ss} | {m:ss} में हल किया |
| Played, wrong | Not this time | इस बार नहीं |
| See result | See result | नतीजा देखें |
| Weak spots heading | Your weak spots | आपके कमज़ोर हिस्से |
| Drill | Drill | ड्रिल करें |
| See all | See all ({n}) | सभी देखें ({n}) |
| Tile: Concept drill | Concept drill | कॉन्सेप्ट ड्रिल |
| Tile caption | Pick topics, set your pace | टॉपिक चुनें, अपनी रफ़्तार तय करें |
| Tile: PYQ bank | PYQ bank | PYQ बैंक |
| Tile caption | {paper_count} papers · {pyq_count} questions | {paper_count} पेपर · {pyq_count} सवाल |
| Tile: Mock tests | Mock tests | मॉक टेस्ट |
| Tile: Analytics | Analytics | विश्लेषण |
| Analytics caption, no data | Answer a few to unlock | कुछ सवाल हल करें, फिर दिखेगा |
| Tile: Tutor | Tutor | ट्यूटर |
| Tile caption, tutor | Ask {pet_name} about any doubt | {pet_name} से कोई भी सवाल पूछें |
| Recent | Recent | हाल का अभ्यास |
| Limit meter | Practice today: {used} of {limit} | आज का अभ्यास: {limit} में से {used} |
| Pro link | Unlimited with Pro | Pro में असीमित |
| Ask a grown-up (under 13) | Ask a grown-up | किसी बड़े से पूछें |
| Snap a doubt | Snap a doubt | सवाल की फ़ोटो लें |
| Snap caption | Photo of a question, step-by-step help | सवाल की फ़ोटो, क़दम-दर-क़दम मदद |
| Started on | Started on {device_label} | {device_label} पर शुरू किया |
| Meter full | Done for today. Resets at midnight. | आज के लिए पूरा। आधी रात को फिर से शुरू। |
| Offline banner | Offline. Downloaded drills and mocks still work. | ऑफ़लाइन हैं। डाउनलोड की गई ड्रिल और मॉक चलते रहेंगे। |

**Illustration slots:**
- Daily challenge card: `sunny-object`, 1:1, a glowing puzzle piece on a small pedestal, no numbers or letters. Alt intent: decorative (the card text says what it is).
- Entry tiles: `sunny-object`, 1:1 each. Drill: a target with an arrow in the centre. PYQ bank: a neat stack of old exam papers tied with a ribbon (no writing). Mock tests: a desk with an answer sheet and a pencil (blank sheet). Analytics: a rising bar-chart object (no axis labels). Decorative.
- Pet line avatar: `pet-cat` / `pet-dog`, 1:1, mood from the pet engine. Alt intent: "{pet_name}".
- Empty recent: `empty-state`, 4:3, the pet stretching before a run. Alt intent: "{pet_name} warming up".

**States:**
- Default: as above.
- Loading: skeleton blocks for cards 4–8 (no shimmer in reduced motion). Renders from cache first, so skeletons appear only on first ever open.
- Empty (new student, no answers): weak spots card shows "Answer {n} more questions and I'll find your weak spots." with [Start a mixed drill] (or [Start a drill] in Phase 1). Recent shows the empty-state illustration and "Your practice shows up here."
- Error: weak spots and recent show inline "Couldn't load this. [Try again]". Tiles still work.
- Offline: slim offline banner under the top bar. Challenge card shows "Needs internet" in `inkMuted` and a `WifiSlash` icon, no [Play]. Weak spots show the cached list with "Updated {time}".
- Guest and free: limit meter visible. Pro: limit meter hidden.
- Cap reached: limit meter full, its label changes to "Done for today. Resets at midnight." Drill tile still opens PRC-03, which shows the cap up front with [Review cards] and a dismissible PRC-17. No sheet opens by itself.
- Minor 13–17: unchanged.
- Under 13 (`10_12` age band): no prices. "Unlimited with Pro" becomes [Ask a grown-up] → SET-13. "Snap a doubt" row hidden.
- Little learner (class 1–5): not reachable. There is no Practice tab (R14); practice for them lives inside lessons and HOME-06.
- Signed in on another device: the resume card says where the attempt started (research A30).
- Dark mode: Night Colour tokens. Challenge card uses dark `primaryTint`. Illustrations unchanged.

**Interaction and motion:** Pull to refresh (the pet peeks down, UX_FLOW §3). Cards press to 0.97 over `fast`. Tile illustrations get the light gyro tilt only on Home, not here. Navigation is a native stack push. Haptic: light on taps.
**Accessibility:** Focus order follows the layout. Each tile is one button with label "{title}. {caption}". Reason chips are read with the row: "{concept_name}, {subject}, low accuracy. Drill". The limit meter has `accessibilityRole="progressbar"` with value text. Dynamic type 200%: the 2 × 2 grid becomes one column; the challenge illustration moves above the text.
**Analytics:** `practice_hub_viewed`, `weak_spots_viewed` (from "See all"), `drill_setup_opened {source: hub}`, `daily_challenge_viewed`, `mock_lobby_viewed`, `analytics_viewed`, `paywall_cta_tapped {trigger: practice_limit}` is PAY's event when the Pro link opens PAY-01.
**Web (≥ 600 px):** Sidebar replaces the tab bar. Two columns: left (resume, challenge, weak spots), right (entry tiles as a 2 × 2 grid, suggested mock, recent). Limit meter sits at the bottom of the left column. Max content width 1120 px.
**Mock priority:** P0 · Phase 1

### PRC-02 · Weak spots
**Purpose:** List every weak spot with its reason so the student can drill the most valuable one. **Main action:** [Drill all top {n}] (a mixed drill over the listed concepts).
**Entry → exits:** PRC-01, HOME-01 weak-area card, PRC-14, MEM-25 metacognitive dashboard, MEM-26 "Sure but wrong" list → PRC-03 (prefilled with a concept list), LRN-03 topic card (via "Open lesson"), MEM-03 review session (via "Review cards"), back. The NTF-01 `weak_area` push deep-links to the review queue (`/review?topic`), not here.
**Layout (top to bottom):**
1. Top bar: back, "Weak spots", info icon (opens a sheet explaining the reasons).
2. Filter chips row: All, by subject (one chip per subject with its colour dot), and reason chips (Low accuracy, Fading, Missed in a mock, Overconfident).
3. Pet line: one encouraging line.
4. List grouped by subject. Group header: subject name in `heading`, subject `strong` 4 px bar on the left edge. Each row (min 72 px): concept or topic name in `label`, reason Chip, a meta line in `caption` ("{accuracy}% over {attempts} answers" or "{cards_due} cards fading in 3 days" or "Missed in {mock_title}"), and a kebab with "Open lesson", "Review cards", "Drill". Tapping the row opens PRC-03 prefilled.
5. Sticky bottom bar: Button primary 56 [Drill all top {n}].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Weak spots | कमज़ोर हिस्से |
| Pet line | Small fixes add up. Pick one and I'll cheer you on. | छोटे सुधार मिलकर बड़ा फ़र्क लाते हैं। एक चुनिए, मैं साथ हूँ। |
| Reason: low accuracy | Low accuracy | कम सटीकता |
| Reason: fading | Fading | याद धुंधली हो रही है |
| Reason: missed in mock | Missed in a mock | मॉक में छूटा |
| Reason: overconfident | Sure but wrong | पक्का कहा, पर गलत |
| Meta: accuracy | {accuracy}% over {attempts} answers | {attempts} उत्तरों में {accuracy}% सही |
| Meta: fading | {cards_due} cards fading in 3 days | 3 दिन में {cards_due} कार्ड भूल सकते हैं |
| Meta: mock | Missed in {mock_title} | {mock_title} में छूटा |
| Open lesson | Open lesson | लेसन खोलें |
| Review cards | Review cards | कार्ड रिव्यू करें |
| Drill all | Drill all top {n} | ऊपर के {n} की ड्रिल करें |
| Info sheet title | How we find weak spots | कमज़ोर हिस्से कैसे मिलते हैं |
| Info: body | We look at your answers, your reviews and your mocks. Nothing is guessed. | हम आपके उत्तर, रिव्यू और मॉक देखते हैं। कुछ भी अंदाज़े से नहीं। |
| Empty | Answer {n} more questions and I'll find your weak spots. | {n} और सवाल हल कीजिए, फिर आपके कमज़ोर हिस्से यहाँ दिखेंगे। |

**Illustration slots:** Empty state: `empty-state`, 4:3, the pet with a magnifying glass looking at a small plant. Alt intent: "{pet_name} looking for weak spots". Pet line avatar as in PRC-01.
**States:**
- Default: list.
- Loading: 5 skeleton rows.
- Empty: illustration, the empty line, [Start a drill].
- No match for a filter: "Nothing here for this filter." [Clear filters].
- Error: "Couldn't load weak spots. [Try again]".
- Offline: cached list with "Updated {time}". "Fading" rows still come from the device's FSRS schedule, so they stay fresh offline.
- Guest and free: unchanged. Drilling counts toward the cap.
- Little learner: not reachable (R14).
- Dark mode: tokens.

**Interaction and motion:** Filter chips toggle with `fast`. Swipe left on a row reveals [Review cards] on mobile. List items settle with spring `gentle` on first load (fade only in reduced motion).
**Accessibility:** Each row reads "{concept}, {subject}. {reason}. {meta}." The kebab has label "More actions for {concept}". The swipe action is also in the kebab, so no gesture is required.
**Analytics:** `weak_spots_viewed {count, reasons[]}`, `drill_setup_opened {source: weak_spot}`.
**Web (≥ 600 px):** Two panes: the list left, and on the right a preview of the selected weak spot (its concept summary title, the last 5 attempts as result glyphs, buttons Drill / Review / Open lesson). Keyboard: arrow keys move through rows, Enter opens drill setup.
**Mock priority:** P1 · Phase 1

### PRC-03 · Drill setup
**Purpose:** Let the student set up a drill in a few taps, with good defaults already chosen. **Main action:** [Start drill].
**Entry → exits:** PRC-01, PRC-02, PRC-06 ("Drill again"), PRC-15, LRN-03 topic card, LRN-06 chapter test entry sheet (chapter mode), LES-08 lesson complete, AI-02 tutor `start_practice`, AI-19 "Similar questions", MEM-26 [Practise these], HOME-02 plan item, MOCK-19 Fix next → PRC-04, PRC-17 (if the cap is already reached, dismissible), close.

**Input contract** (shared with Learn, Memory and Tutor; flow §5.3): `concepts[]` (one or more concept IDs), or `topic_id`, or `chapter_id` (chapter-test mode), or `question_ids[]` (a fixed set, such as AI-19 similar questions), plus `source` and optional `count`. With `question_ids[]` the set is fixed: no adaptive picking, difficulty control hidden.
**Layout (top to bottom):**
1. Sheet (60% height, expandable to full), grabber, title "Concept drill".
2. Scope row: a summary of what will be drilled ("{topic_title}" or "{n} concepts" or "Mixed: {subject_a} + {subject_b}"), with [Change] opening a picker (subject → chapter → topic, multi-select checkboxes, search field).
3. "Questions" segmented control: 5 · 10 · 20.
4. "Difficulty" segmented control: Adaptive (default, with a `Sparkle` icon) · Easy · Medium · Hard. Caption under it explains Adaptive.
5. "Timing" segmented control: Untimed · Timed. When Timed, a caption shows "{total_time} for {n} questions" (sum of `ideal_time_s`).
6. "Show answers" segmented control: After each question · At the end.
7. Availability line in `caption`: "{available} questions ready offline" or "Downloads {size} first".
8. Limit meter for guest and free ("{remaining} free questions left today").
9. Button primary 56 [Start drill], pinned at the bottom.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Concept drill | कॉन्सेप्ट ड्रिल |
| Scope: topic | {topic_title} | {topic_title} |
| Scope: concepts | {n} concepts | {n} कॉन्सेप्ट |
| Scope: mixed | Mixed: {subject_a} + {subject_b} | मिला-जुला: {subject_a} + {subject_b} |
| Change | Change | बदलें |
| Questions | Questions | सवाल |
| Difficulty | Difficulty | कठिनाई |
| Adaptive | Adaptive | अपने-आप |
| Adaptive caption | Gets harder when you're right, easier when you slip. | सही होने पर कठिन, चूकने पर आसान होती जाती है। |
| Easy / Medium / Hard | Easy / Medium / Hard | आसान / मध्यम / कठिन |
| Timing | Timing | समय |
| Untimed / Timed | Untimed / Timed | बिना समय / समय के साथ |
| Timed caption | {total_time} for {n} questions | {n} सवालों के लिए {total_time} |
| Show answers | Show answers | उत्तर दिखाएँ |
| After each / At the end | After each question / At the end | हर सवाल के बाद / आख़िर में |
| Ready offline | {available} questions ready offline | {available} सवाल ऑफ़लाइन तैयार |
| Download first | Downloads {size} first | पहले {size} डाउनलोड होगा |
| Free left | {remaining} free questions left today | आज {remaining} फ़्री सवाल बचे हैं |
| Start | Start drill | ड्रिल शुरू करें |
| Not enough offline | Only {available} questions are on this phone. Start with these? | इस फ़ोन में सिर्फ़ {available} सवाल हैं। इन्हीं से शुरू करें? |
| Sized to free | {remaining} free questions left today, so this drill has {remaining}. | आज {remaining} फ़्री सवाल बचे हैं, इसलिए यह ड्रिल {remaining} सवालों की है। |
| Chapter test title | Chapter test | चैप्टर टेस्ट |
| Similar scope | Similar questions ({n}) | मिलते-जुलते सवाल ({n}) |
| Cap reached | Today's free questions are done. Reviews are still open. | आज के फ़्री सवाल पूरे हुए। रिव्यू अब भी खुले हैं। |
| Why link | Why? | क्यों? |
| Mixed title | Mixed drill | मिला-जुला ड्रिल |
| Mixed caption | Questions take turns between the parts you've learned. | आपके सीखे हुए हिस्सों से सवाल बारी-बारी से आते हैं। |
| Mixed set up | Set up a mixed drill | मिला-जुला ड्रिल बनाएँ |
| Mix by | Mix across | किनमें मिलाएँ |
| Mix chapter | Chapters | अध्याय |
| Mix subject | Subjects | विषय |
| Mix topic | Topics | टॉपिक |
| Mixed online | A mixed drill needs internet to start. | मिला-जुला ड्रिल शुरू करने के लिए इंटरनेट चाहिए। |
| Mixed variety | Learn a little more first: this mix needs at least {needed} parts you've learned. Try another mix. | पहले थोड़ा और सीखें: मिलाने के लिए कम से कम {needed} सीखे हुए हिस्से चाहिए। दूसरा मिश्रण आज़माएँ। |
| Mixed off | Mixed practice isn't open yet. | मिला-जुला अभ्यास अभी शुरू नहीं हुआ है। |
| Mixed failed | The drill didn't start. Try again. | ड्रिल शुरू नहीं हुई। फिर कोशिश करें। |

**Illustration slots:** None. The sheet is a form; the hub tile already shows the drill illustration.
**States:**
- Default: prefilled from the entry point (flow §5.3).
- Loading: the availability line shows a small spinner while the local pool is counted.
- Not enough questions: if the scope has fewer questions than chosen, the count options above it are disabled with caption "{available} questions in this topic".
- Offline with missing bundles: availability line "Only {available} questions are on this phone" and the start button label becomes "Start with {available}".
- Error (download failed): inline "Download failed. [Try again]".
- Guest and free: limit meter. If `remaining` < chosen count, the count control shows the remaining number as the drill size, with caption "{remaining} free questions left today, so this drill has {remaining}." The drill is sized before it starts and never stops mid-way (research X1). Cap already reached: [Start drill] is replaced by [Review cards] and a link "Why?" that opens PRC-17.
- Chapter-test mode (from LRN-06): title "Chapter test", scope fixed to the chapter, count from lesson-core, the same free meter. A shortened test when the free count is low, as LRN-06 shows.
- Fixed set (`question_ids[]`, from AI-19): scope row "Similar questions ({n})", difficulty and count controls hidden.
- Pro: no meter.
- Little learner: not reachable (R14).
- Phase 1: Mixed scope hidden (`practice.mixed_enabled`).
- Dark mode: sheet on `surface` dark.

**Interaction and motion:** Sheet opens with `slow` and standard easing. Segmented controls change with `fast`. Choices are remembered per device. Haptic light on segment change.
**Accessibility:** Each segmented control is a radio group with its heading as the group label. The Adaptive caption is linked as the description. Focus starts on the scope row. Dynamic type: segmented controls wrap to two rows rather than truncating.
**Analytics:** `drill_setup_opened {source}` (`hub`, `weak_spot`, `summary`, `lesson`, `chapter_test`, `tutor`, `similar_questions`, `metacog`, `plan`, `mock_report`), `drill_started {scope, concept_count, question_count, difficulty_mode, timed, feedback_mode}`.
**Web (≥ 600 px):** A centred dialog, 560 px wide, with the scope picker as a two-level list inside it. Enter starts the drill.
**Mock priority:** P0 · Phase 1

### PRC-04 · Practice runner
**Purpose:** Run a practice session (concept drill, weak-spot drill, mixed drill, PYQ topic practice or PYQ paper question by question) one question at a time. **Main action:** [Check].
**Entry → exits:** PRC-03, PRC-09, PRC-10, HOME-05 search (opens a PYQ at that question), PRC-05 (after each answer), PRC-06 (end), AI-02 tutor chat sheet (after Check), SET-24 report content, exit sheet → back to where the drill started.
**Layout (top to bottom):**
1. Top bar: close ✕, the segmented progress bar (one segment per question, DESIGN.md Progress), counter "{i} of {n}", the clock (count-down in Timed mode, quiet count-up in Untimed), and the language toggle "EN | हिं" when the question has both languages (always allowed in practice, research A28; the choice is remembered per exam).
2. Meta row: subject colour dot and topic name in `caption` `subject.text`; difficulty Chip (Easy / Medium / Hard); for PYQs, the Citation chip "{exam_short} {year} · {session_label}" opening PRC-18.
3. Question card: the stem (KaTeX SVG, figures from media with overlaid labels), max width 720. Paragraph questions pin the passage in a collapsible panel above the child question.
4. Answer area by type: Option cards (full width, radius 16; 2 × 2 grid for short options), multi-select with checkboxes, Numeric keypad for numerical and integer, drag rows for match and order types.
5. Confidence row (Sure · 50:50 · Guess, R21, the same chips as lessons and reviews), optional.
6. Button primary 56 [Check], pinned. Disabled until an answer exists.
7. Floating tutor button (AI-01) above [Check] on the right, shown only after Check on the current question.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Counter | {i} of {n} | {n} में से {i} |
| Check | Check | जाँचें |
| Sure / 50:50 / Guess | Sure / 50:50 / Guess | पक्का / 50:50 / अंदाज़ा |
| Confidence hint | How sure are you? | आपको कितना यक़ीन है? |
| Numeric placeholder | Type your answer | अपना उत्तर लिखें |
| Exit title | Leave this drill? | ड्रिल छोड़ें? |
| Exit body | Your answers so far are saved. | अब तक के उत्तर सेव हैं। |
| Exit: leave | Leave | छोड़ें |
| Exit: keep going | Keep going | जारी रखें |
| Time up (timed) | Time's up. Finish this one, then see your summary. | समय पूरा। यह सवाल पूरा कीजिए, फिर सारांश देखिए। |
| At-the-end mode, next | Next | अगला |
| Paragraph toggle | Show passage / Hide passage | अनुच्छेद दिखाएँ / छिपाएँ |
| Not loaded | This question didn't load. | यह सवाल लोड नहीं हुआ। |
| Retry | Try again | फिर कोशिश करें |
| Skip | Skip | छोड़ दें |
| Language toggle | EN \| हिं | EN \| हिं |
| Language toggle label | Question language | सवाल की भाषा |

**Illustration slots:** None of our own. Question figures come from the question's media requests (`sunny-diagram`) and are content, with their own alt text.
**States:**
- Default: as above.
- Loading: question card skeleton, under 100 ms target from local bundles.
- At-the-end mode: [Check] becomes [Next]; no feedback; the last question shows [Finish].
- Answered (after each): PRC-05 slides up; the chosen option shows correct or wrong styling (Option card states).
- Timed, low time: the clock switches to the Timer warning state at 20% of the session time left (a UI rule, not an exam value).
- Error (media missing): "This question didn't load" with [Try again] and [Skip]. Skipped questions don't count toward the cap.
- Offline: no change (questions come from bundles). The tutor button shows "Needs internet" when tapped.
- Guest and free: the session was sized to the free count before it started (PRC-03), so it ends on PRC-06 like any drill. No limit sheet appears mid-session. A PYQ opened from HOME-05 search counts as one question.
- Chapter test (`context = chapter_test`, from LRN-06): the counter reads "Chapter test · {i} of {n}"; the session ends on PRC-06 chapter-test variant.
- Before Check: no tutor button. After Check: the tutor button appears and [Ask why] sits in PRC-05.
- Little learner: not reachable (R14).
- Dark mode: tokens; KaTeX SVGs use `ink` from the dark set.

**Interaction and motion:** Swipe is off (no accidental skips). Correct: green, check pops with spring `pop`, soft ding, success haptic. Wrong: 2 × 6 px shake, red with ✕, warning haptic (UX_FLOW §3). Card transition slides horizontally in `base`. Reduced motion: fades, no shake.
**Accessibility:** The stem is read first, then options as "Option A, {text}". Options are radio buttons (checkboxes for multi). Results are announced ("Correct" or "Not correct, the answer is C"). The keypad keys have labels ("minus", "decimal point"). Hardware keyboard: 1–4 or A–D select options, Enter checks. Timer is announced only at "1 minute left" in Timed mode.
**Analytics:** `answer_submitted {question_id, context, session_id, is_correct, time_ms, confidence, difficulty_shown, attempt_no}` (`context` includes `chapter_test`), `drill_completed`, `pyq_citation_opened`, `question_language_switched {from, to}`.
**Web (≥ 600 px):** Question column capped at 720 px and centred. PRC-05 opens as a right panel (400 px) instead of a sheet. Arrow keys move between answered questions in at-the-end review. The tutor opens as a right panel.
**Mock priority:** P0 · Phase 1

### PRC-05 · Answer and solution sheet
**Purpose:** Show whether the answer was right and teach the idea in plain words first. **Main action:** [Next].
**Entry → exits:** PRC-04 (after Check), PRC-06 rows, PRC-12 "See solution", PRC-09 rows → PRC-04 (next), AI-02 tutor chat sheet ([Ask why], `context_ref = question:{question_id}`), LRN-03 topic card ("Learn this topic"), "Add to my cards" (adds to the student's deck in MEM-07, with a toast), SET-24 report content, PRC-18 (citation). MOCK-22 has its own layout and uses [Ask tutor].
**Layout (top to bottom):**
1. Sheet at 40% height, expandable to full (grabber).
2. Result header: icon (check in `success` / cross in `error`) + "Correct!" or "Not quite", `heading`. For wrong answers: "Answer: {correct_option_label}" in `label`.
3. Time line in `caption`: "You took {m:ss} · target {m:ss}".
4. [Try again] secondary button, first wrong attempt on MCQ types in "after each" mode only.
5. Mistake tag chips (wrong answers only): Concept · Calculation · Misread · Silly mistake · Ran out of time. Single select, optional.
6. Solution sections as expandable rows, first one open: "In plain words" (`solution.feynman`), "Step by step" (`solution.steps`, KaTeX), "Shortcut" (only if present, with its "when it fails" line), "Common traps" (each trap linked to the option it explains; the student's chosen wrong option is highlighted).
7. For PYQs: Citation chip and any key-status chip ("Dropped in the final key", "Answer changed in the final key").
8. Action row: [Ask why] (ghost, `ChatCircle` icon), [Learn this topic] (ghost, `BookOpen` icon, opens LRN-03), [Add to my cards] (ghost), kebab with "Report a problem".
9. Button primary 56 [Next] (or [See summary] on the last question), pinned.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Correct | Correct! | सही! |
| Wrong | Not quite | सही नहीं |
| Answer line | Answer: {correct_option_label} | उत्तर: {correct_option_label} |
| Time line | You took {m:ss} · target {m:ss} | आपने {m:ss} लिए · लक्ष्य {m:ss} |
| Try again | Try again | फिर कोशिश करें |
| Mistake prompt | What went wrong? (optional) | क्या गड़बड़ हुई? (वैकल्पिक) |
| Concept | Concept | कॉन्सेप्ट |
| Calculation | Calculation | गणना |
| Misread | Misread | गलत पढ़ा |
| Silly | Silly mistake | छोटी-सी भूल |
| Time | Ran out of time | समय कम पड़ा |
| In plain words | In plain words | आसान शब्दों में |
| Step by step | Step by step | चरण दर चरण |
| Shortcut | Shortcut | शॉर्टकट |
| Shortcut fails | When it doesn't work | यह कब काम नहीं करता |
| Common traps | Common traps | आम गलतियाँ |
| Your pick | You picked this | आपने यह चुना |
| Ask why | Ask why | क्यों? पूछें |
| Learn this topic | Learn this topic | यह टॉपिक सीखें |
| Add to cards | Add to my cards | मेरे कार्ड में जोड़ें |
| Added toast | Added. It'll come back in your reviews. | जुड़ गया। यह आपके रिव्यू में वापस आएगा। |
| Report | Report a problem | समस्या बताएँ |
| Next | Next | अगला |
| See summary | See summary | सारांश देखें |
| Dropped chip | Dropped in the final key | फ़ाइनल की में हटाया गया |
| Changed chip | Answer changed in the final key | फ़ाइनल की में उत्तर बदला गया |
| Pet line, correct streak of 3 | Three in a row! | लगातार तीन! |
| Pet line, wrong | Good try. The plain-words part helps most. | अच्छी कोशिश। आसान शब्दों वाला हिस्सा सबसे ज़्यादा मदद करेगा। |

**Illustration slots:** Solution media from the question's own requests (content). Pet line avatar (small, 32 px) on the result header in Practice only; never in MOCK-22.
**States:**
- Correct: `successTint` header strip, check icon.
- Wrong: `errorTint` header strip, cross icon, mistake chips shown.
- Partially correct (multi-select with partial marking in practice): `warningTint`, "Partly right", the missed and extra options marked with icons.
- Loading solution media: placeholders keep their size.
- Offline: [Ask why] disabled with caption "Needs internet". Solutions are in the bundle, so they work.
- Guest: [Add to my cards] works (local deck). [Ask why] follows AI's guest rules (AI-07 teaser after the free taste).
- Under 13: [Ask why] shown only if the tutor is on for them (AI rules); no price on any teaser.
- Little learner: not reachable (R14).
- Dark mode: tints from the dark set.

**Interaction and motion:** Sheet rises in `slow`. Expandable rows open in `base`. Mistake chip tap: light haptic, chip fills. Swipe down collapses to 40%. Reduced motion: no slide, fade only.
**Accessibility:** Focus moves to the result header when the sheet opens, and the result is announced. Expandable rows are buttons with expanded state. Chips are a radio group "What went wrong". Trap rows say which option they explain.
**Analytics:** `solution_viewed {question_id, context, sections_opened[]}`, `mistake_tagged {question_id, context, mistake_type}`, `card_added {source: practice}`, `tutor_opened {context_ref}` (AI's event).
**Web (≥ 600 px):** A right panel (400 px), not a sheet, so the question stays visible. Keyboard: Enter for Next, T for Try again (shown as a hint).
**Mock priority:** P0 · Phase 1

### PRC-06 · Drill summary
**Purpose:** Show what the drill achieved and the one best next step. **Main action:** the first "Next step" button.
**Entry → exits:** PRC-04 → PRC-03 ("Drill again"), PRC-05 (question rows), MEM-03 review session, LRN-03 topic card, LRN-02 chapter (chapter-test variant), PRC-01 (Done) or back to where the session began.
**Layout (top to bottom):**
1. Top bar: close ✕.
2. Illustration (pet, mood from the result), 40% width on phone, centred.
3. Title in `display`: "Drill done!".
4. Three Stat tiles in a row: Accuracy "{correct}/{answered}", Time "{m:ss}", XP "+{xp}".
5. Daily goal line: the daily goal ring mini variant, "{minutes} of {goal} min today" or, when this drill met it, "Daily goal done." Drills add to the ring, not the streak (R1), so no plant line here.
6. "Mastery" section: one row per concept with before → after bars in the subject `strong`, and a change label "+{delta}%". If not synced yet: "Updating…" in `inkMuted`.
7. "Next steps" section: up to 3 rows, each a Button secondary 56: "Drill {concept_name} again", "Review {n} cards", "Open the lesson".
8. "Questions" list (collapsed in "after each" mode, open in "at the end" mode): result glyph, number, "{m:ss}", difficulty chip; tapping opens PRC-05.
9. Button primary 56 [Done], pinned.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Drill done! | ड्रिल पूरी! |
| Accuracy tile | Accuracy | सटीकता |
| Time tile | Time | समय |
| XP tile | XP | XP |
| Goal line | {minutes} of {goal} min today | आज {goal} में से {minutes} मिनट |
| Goal done | Daily goal done. | आज का लक्ष्य पूरा। |
| Chapter test title | Chapter test done | चैप्टर टेस्ट पूरा |
| Topics learned | {n} topics marked as learned | {n} टॉपिक सीखे हुए माने गए |
| Back to chapter | Back to the chapter | चैप्टर पर लौटें |
| Mastery | Mastery | महारत |
| Updating | Updating… | अपडेट हो रहा है… |
| Next steps | Next steps | आगे क्या करें |
| Drill again | Drill {concept_name} again | {concept_name} की फिर से ड्रिल करें |
| Review cards | Review {n} cards | {n} कार्ड रिव्यू करें |
| Open lesson | Open the lesson | लेसन खोलें |
| Questions | Questions | सवाल |
| Done | Done | हो गया |
| Pet line, high accuracy | You were on fire today. | आज तो कमाल कर दिया। |
| Pet line, low accuracy | Tricky set. Let's go over the plain-words bits. | मुश्किल सेट था। आसान शब्दों वाले हिस्से फिर से देख लें। |
| Partial (closed early) | You answered {answered} of {n}. Saved. | आपने {n} में से {answered} किए। सेव हो गया। |

**Illustration slots:** `pet-cat` / `pet-dog`, 1:1, pose by accuracy band: proud (high), happy (middle), thinking (low). Never sad. Alt intent: "{pet_name} looking {mood}".
**States:**
- Default.
- Closed early: the partial line under the title; stats cover answered questions only.
- Last free questions used: the line "That was today's free practice." and a ghost link "Unlimited with Pro" ([Ask a grown-up] for under-13s). Inline only, no sheet.
- Chapter-test variant (from LRN-06): title "Chapter test done", a row per topic with its result, the line "{n} topics marked as learned" for topics passed under lesson-core's rule, and [Back to the chapter] → LRN-02 as the first next step.
- Offline: mastery rows show "Updates when you're online".
- Little learner: not reachable (R14).
- Dark mode: tokens.

**Interaction and motion:** Stat numbers count up over `emphasis` (instant in reduced motion). Mastery bars fill with spring `gentle`. The pet plays `celebrate` if accuracy is in the top band, else `hop`. No confetti here (confetti is for lesson complete). Success haptic once.
**Accessibility:** Title announced on open. Stat tiles read as "Accuracy, 8 of 10". Mastery rows read "{concept}, from {before}% to {after}%". Star icons have a text equivalent.
**Analytics:** `drill_completed {session_id, answered, correct, duration_ms, ended_by}`, `drill_setup_opened {source: summary}`.
**Web (≥ 600 px):** Content capped at 720 px. Stats and next steps side by side.
**Mock priority:** P0 · Phase 1

### PRC-07 · PYQ bank
**Purpose:** Let the student find past exam questions by topic or by paper, every one tied to its official paper. **Main action:** open a chapter (topic view) or a paper (paper view).
**Entry → exits:** PRC-01 tile, deep link `smriti.app/pyq`, Astro PYQ pages → PRC-09, PRC-10, PRC-08, PRC-18, back.
**Layout (top to bottom):**
1. Top bar: back, "PYQ bank", filter icon with a count badge of active filters.
2. Segmented control (full width): "By topic" · "By paper".
3. Active filter chips row (removable), shown only when filters are set.
4. **By topic:** subject chips row (subject colour dot + name; selected chip uses subject tint and `subject.text`). Then chapter rows (min 72 px): chapter name in `label`; caption "{pyq_count} PYQs · {first_year}–{last_year}"; a small progress bar in subject `strong` "{solved} solved"; chevron.
5. **By paper:** year group headers in `heading` ("{year}"). Paper rows: "{exam_short} {year} · {session_label}" in `label`; caption "{question_count} questions · held {held_on}"; source caption "Source: {source_host}" with a `SealCheck` icon; status on the right: "Not started", "In progress", or "{score}/{max}" from the last mock attempt; chevron.
6. Footer note in `caption`: "Questions and answer keys from official papers. Solutions are ours."

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | PYQ bank | PYQ बैंक |
| By topic | By topic | टॉपिक से |
| By paper | By paper | पेपर से |
| Chapter caption | {pyq_count} PYQs · {first_year}–{last_year} | {pyq_count} PYQ · {first_year}–{last_year} |
| Solved | {solved} solved | {solved} हल किए |
| Paper row | {exam_short} {year} · {session_label} | {exam_short} {year} · {session_label} |
| Paper caption | {question_count} questions · held {held_on} | {question_count} सवाल · {held_on} को हुआ |
| Source | Source: {source_host} | स्रोत: {source_host} |
| Not started | Not started | शुरू नहीं किया |
| In progress | In progress | चल रहा है |
| Footer | Questions and answer keys from official papers. Solutions are ours. | सवाल और उत्तर-कुंजी आधिकारिक पेपरों से। हल हमारे अपने हैं। |
| Empty, no PYQs yet | No past papers added for {exam_short} yet. | {exam_short} के पिछले पेपर अभी जोड़े नहीं गए हैं। |
| Filter empty | No PYQs match these filters. | इन फ़िल्टरों से कोई PYQ नहीं मिला। |
| Clear filters | Clear filters | फ़िल्टर हटाएँ |
| Pro lock (paper) | Pro | Pro |

**Illustration slots:** Empty state: `empty-state`, 4:3, the pet sitting on a tidy stack of blank papers, waiting. Alt intent: "{pet_name} waiting by a stack of papers".
**States:**
- Default: last-used view and subject remembered.
- Loading: skeleton rows.
- Empty (no PYQs ingested for this exam): empty state. This is normal before `pyq-ingest` runs, so the text is plain and factual.
- Filter empty: line + [Clear filters].
- Error: inline retry.
- Offline: lists come from the manifest; rows for chapters and papers not downloaded show a `CloudArrowDown` icon and open with "Download {size} to practise offline".
- Guest and free: all rows visible and every PYQ is viewable within the daily question count (R25). One paper per exam (`free.pyq_papers_free`) can also be taken as a timed mock; other papers show a Pro Chip on the "Take as mock" action (inside PRC-10), not on the row, so browsing is never blocked. Pinning a chapter or paper for offline use is Pro (PAY-01 trigger `offline_download`, managed in ME-21).
- Pro: no chips.
- `pyq_count` is null for a chapter: the caption shows "{n} questions added" instead of a PYQ count and year range (flow §5.4).
- Little learner: not reachable.
- Dark mode: tokens.

**Interaction and motion:** Segmented switch cross-fades the list in `base`. Subject chips scroll horizontally and snap. Pull to refresh.
**Accessibility:** The segmented control is a tab list. Paper rows read "{exam} {year}, {session}. {n} questions. Held {date}. Source {host}. {status}." The `SealCheck` icon is labelled "official source".
**Analytics:** `pyq_bank_viewed {view}`, `pyq_filter_applied`, `pyq_paper_opened`.
**Web (≥ 600 px):** Two panes: the list on the left (360 px), and PRC-09 or PRC-10 on the right. The segmented control and filters sit above the list. Filters open as a side panel instead of a sheet.
**Mock priority:** P0 · Phase 1

### PRC-08 · PYQ filters
**Purpose:** Narrow the PYQ bank by exam, year, shift, subject, chapter, difficulty, type and status. **Main action:** [Show {n} questions].
**Entry → exits:** PRC-07, PRC-09 → back to the caller with filters applied.
**Layout (top to bottom):**
1. Sheet (full height on phone), title "Filters", [Reset] ghost on the right.
2. Exam (only in the all-exams app or a two-profile variant): single-select chips.
3. Year: multi-select chips, newest first, plus "Last {n} years" quick chips built from the years that exist.
4. Shift or session: multi-select chips from the `session_label` values of the selected years.
5. Subject: multi-select chips with subject colour dots.
6. Chapter: a searchable checklist, filtered by the chosen subjects.
7. Difficulty: Easy · Medium · Hard (multi). Caption "Based on how students did" when calibrated, else "Our authors' estimate".
8. Question type: chips for the types present (for example "Single correct", "Numerical").
9. Status: Not tried · Wrong · Correct.
10. Button primary 56 [Show {n} questions], pinned, with a live count.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Filters | फ़िल्टर |
| Reset | Reset | रीसेट |
| Exam | Exam | परीक्षा |
| Year | Year | वर्ष |
| Last n years | Last {n} years | पिछले {n} वर्ष |
| Shift | Shift or session | शिफ़्ट या सत्र |
| Subject | Subject | विषय |
| Chapter | Chapter | अध्याय |
| Search chapters | Search chapters | अध्याय खोजें |
| Difficulty | Difficulty | कठिनाई |
| Calibrated caption | Based on how students did | छात्रों के प्रदर्शन के आधार पर |
| Estimate caption | Our authors' estimate | हमारे लेखकों का अनुमान |
| Question type | Question type | सवाल का प्रकार |
| Single correct | Single correct | एक सही उत्तर |
| Multiple correct | Multiple correct | एक से ज़्यादा सही |
| Numerical | Numerical | संख्यात्मक |
| Status | Status | स्थिति |
| Not tried / Wrong / Correct | Not tried / Wrong / Correct | नहीं किए / गलत / सही |
| Show | Show {n} questions | {n} सवाल दिखाएँ |
| None | No questions match. Try fewer filters. | कोई सवाल नहीं मिला। कम फ़िल्टर लगाकर देखें। |

**Illustration slots:** None.
**States:**
- Default: current filters preselected.
- Count loading: the button shows a spinner and keeps its width.
- Zero results: the button is disabled with the "None" line above it.
- Offline: counts come from the local index of downloaded chapters, with caption "Counting downloaded papers only".
- Little learner: not reachable.
- Dark mode: tokens.

**Interaction and motion:** Chips toggle with `fast` and a light haptic. The count updates after 300 ms of no changes.
**Accessibility:** Each group is a labelled checkbox group (radio group for Exam). The live count is announced politely after changes. Reset asks nothing (it's undoable by reopening).
**Analytics:** `pyq_filter_applied {filter_keys[], result_count}`.
**Web (≥ 600 px):** A side panel (360 px) that pushes the list. Filters apply live without a button; the URL search params update.
**Mock priority:** P1 · Phase 1

### PRC-09 · Chapter PYQs
**Purpose:** List every PYQ for one chapter, with its paper, so the student can practise them. **Main action:** [Practise all {n}].
**Entry → exits:** PRC-07 (topic view), LRN-02 chapter "PYQs" → PRC-04 (context `pyq`), PRC-08, PRC-18, back.
**Layout (top to bottom):**
1. Header: subject tint background, back, chapter name in `title`, caption "{n} PYQs from {paper_count} papers".
2. Sort and filter row: sort Chip ("Newest first" or "By concept") and the filter icon.
3. Concept groups (when sorted by concept): concept name in `heading` with "{count} PYQs" (real count).
4. Question cards: Citation chip at the top; stem preview (first 2 lines, KaTeX, fades out); chips for type and difficulty; status icon on the right (not tried: none; correct: check; wrong: cross), with text labels for screen readers.
5. Sticky bottom bar: Button primary 56 [Practise all {n}], and a secondary [Only the ones I got wrong] when any exist.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Subtitle | {n} PYQs from {paper_count} papers | {paper_count} पेपरों से {n} PYQ |
| Newest first | Newest first | नए पहले |
| By concept | By concept | कॉन्सेप्ट के हिसाब से |
| Group count | {count} PYQs | {count} PYQ |
| Practise all | Practise all {n} | सभी {n} का अभ्यास करें |
| Only wrong | Only the ones I got wrong | सिर्फ़ जो गलत हुए |
| Free note | Each PYQ counts toward today's free practice. | हर PYQ आज के फ़्री अभ्यास में गिना जाएगा। |
| Practise remaining | Practise {remaining} now | अभी {remaining} का अभ्यास करें |
| Empty | No PYQs for this chapter yet. | इस अध्याय के PYQ अभी नहीं हैं। |

**Illustration slots:** Header: `sunny-object`, 1:1, the chapter's existing art (reused from LRN, not new). Decorative.
**States:**
- Default, loading (skeleton cards), empty, error.
- Offline and not downloaded: a banner "Download this chapter ({size}) to practise offline" with [Download]. A one-off download for the current session is free; keeping it pinned for offline use is Pro (PAY-01 trigger `offline_download`, ME-21).
- Guest and free: the free note under the header. [Practise all {n}] starts a session sized to the free questions left today (shown on the button as "Practise {remaining} now"), so nothing stops mid-way.
- Little learner: not reachable.
- Dark mode: header uses the dark tint.

**Interaction and motion:** Tapping a card opens PRC-04 at that question, with the rest of the list queued after it. Sort change cross-fades.
**Accessibility:** Cards read "{exam} {year}, {session}. {type}. {difficulty}. {status}. Question starts: {first words}". Status uses icons plus labels.
**Analytics:** `pyq_bank_viewed {view: topic}`, `drill_started {scope: chapter, source: pyq}`, `pyq_citation_opened`.
**Web (≥ 600 px):** Right pane of PRC-07. The question list shows 3 lines of stem. Each card has an expand control that shows the full stem in place. Nothing is shown on hover only.
**Mock priority:** P1 · Phase 1

### PRC-10 · PYQ paper
**Purpose:** Show one official past paper with its source, and let the student practise it question by question or take it as a timed mock. **Main action:** [Take as a timed mock].
**Entry → exits:** PRC-07 (paper view), deep link `smriti.app/pyq/{paperId}`, Astro paper pages, ENT-06 shared link landing → MOCK-04 (timed mock), PRC-04 (question by question), PRC-18 (source), MOCK-19 (past attempt report), PAY-01 paywall (Pro chip on a timed paper, trigger `mock_limit`), back.
**Layout (top to bottom):**
1. Header: back, title "{exam_name} {year}", subtitle "{session_label} · held {held_on}".
2. Source card (`surface`, `line` border): `SealCheck` icon, "Official paper from {conducting_body}", the source host as a link, "Answer key: {key_status}" (Final key / Provisional key), "Added {retrieved}". Tapping opens PRC-18.
3. Pattern summary (from the blueprint effective on `held_on`): Stat tiles for "{duration_min} min", "{question_count} questions", "{max_marks} marks"; a sections list with counts; the marking line in plain words ("+{marking.correct} for right, {marking.wrong} for wrong").
4. Status chips if any questions were dropped or changed: "{n} questions dropped in the final key".
5. Two action buttons: Button primary 56 [Take as a timed mock], Button secondary 56 [Practise question by question].
6. Past attempts list: date, "{score}/{max}", "{percentile} percentile" when shown, chevron to MOCK-19.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Subtitle | {session_label} · held {held_on} | {session_label} · {held_on} को हुआ |
| Source line | Official paper from {conducting_body} | {conducting_body} का आधिकारिक पेपर |
| Answer key line | Answer key: {key_status} | उत्तर-कुंजी: {key_status} |
| Final key | Final key | फ़ाइनल की |
| Provisional key | Provisional key | प्रोविज़नल की |
| Added | Added {retrieved} | {retrieved} को जोड़ा गया |
| Duration tile | {duration_min} min | {duration_min} मिनट |
| Questions tile | {question_count} questions | {question_count} सवाल |
| Marks tile | {max_marks} marks | {max_marks} अंक |
| Marking line | +{marking.correct} for right, {marking.wrong} for wrong | सही पर +{marking.correct}, गलत पर {marking.wrong} |
| Dropped | {n} questions dropped in the final key | फ़ाइनल की में {n} सवाल हटाए गए |
| Take as mock | Take as a timed mock | टाइम वाला मॉक दें |
| Practise | Practise question by question | एक-एक सवाल का अभ्यास करें |
| Past attempts | Your attempts | आपके प्रयास |
| Pro chip | Pro | Pro |
| Locked line | Timed PYQ papers are part of Pro. You can still practise each question. | टाइम वाले PYQ पेपर Pro में हैं। हर सवाल का अभ्यास अब भी खुला है। |
| No blueprint | We're still checking this year's pattern. Practise question by question for now. | इस साल का पैटर्न हम अभी जाँच रहे हैं। तब तक एक-एक सवाल का अभ्यास करें। |

**Illustration slots:** None. The source card is the visual focus.
**States:**
- Default.
- Loading: skeleton.
- No blueprint linked for `held_on` (flow §12.3 gap): [Take as a timed mock] hidden; the "No blueprint" line shows.
- Offline: the paper index is cached if downloaded; else "Download paper ({size})" replaces both buttons.
- Guest and free: one paper per exam can be taken as a timed mock for free (`free.pyq_papers_free`, R25). For other papers the mock button carries a Pro Chip and opens PAY-01 only when tapped (trigger `mock_limit`); the locked line shows. Practising question by question is open and counts toward the daily question count.
- Under 13: the Pro Chip becomes [Ask a grown-up] → SET-13. No price shown.
- Pro: both open.
- Mock in progress elsewhere: the mock button opens MOCK-14 for that attempt first.
- Dark mode: tokens.

**Interaction and motion:** Standard stack push. Source link opens the in-app browser.
**Accessibility:** The source card is one button "Official paper from {body}. Answer key {status}. Opens source details." Stat tiles read label and value.
**Analytics:** `pyq_paper_opened {paper_id, action}`, `pyq_citation_opened`, PAY's `paywall_viewed {trigger: mock_limit}` when the Pro chip is tapped.
**Web (≥ 600 px):** Right pane of PRC-07, with the two actions side by side.
**Mock priority:** P1 · Phase 1

### PRC-11 · Daily challenge
**Purpose:** Give every student of an exam the same one question each day, timed for a fair leaderboard. **Main action:** [Start] then [Submit].
**Entry → exits:** PRC-01, HOME-01, HOME-02, NTF-01 `challenge_ready` (folded into the daily reminder for minors), home-screen widget (Phase 2), deep link `smriti.app/challenge` → PRC-12, PRC-03 (offline alternative), back.
**Layout (top to bottom):**
1. Top bar: close ✕, "Today's challenge", date "{date}".
2. **Before start:** illustration (pet holding a puzzle piece), title "One question. Everyone gets the same one.", rules list (one try, fastest correct answers rank highest, ranks show once enough players join, it counts as today's streak day, a new one at 00:00 IST), players today "{count} players so far", Button primary 56 [Start]. No tutor button on this screen until after submit.
3. **Playing:** a count-up clock (Timer component, `ink`, never warning colours: there is no limit), meta row (subject dot, topic name in `caption`), question card, answer area as in PRC-04, Confidence row, Button primary 56 [Submit].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Today's challenge | आज का चैलेंज |
| Headline | One question. Everyone gets the same one. | एक सवाल। सबके लिए एक जैसा। |
| Rule 1 | You get one try. | सिर्फ़ एक मौका है। |
| Rule 2 | Right answers rank first, then the fastest. | पहले सही उत्तर, फिर सबसे तेज़। |
| Rule 3 | Ranks show once {min_players} players have played. | {min_players} खिलाड़ी खेल लें, तब रैंक दिखेंगी। |
| Rule 4 | Playing counts as today's streak day. | खेलने से आज की स्ट्रीक का दिन गिना जाएगा। |
| Rule 5 | A new challenge every day at 00:00 IST. | हर दिन रात 12 बजे (IST) नया चैलेंज। |
| Players | {count} players so far | अब तक {count} खिलाड़ी |
| Start | Start | शुरू करें |
| Submit | Submit | सबमिट करें |
| Pet line | I'll keep the clock. You do the thinking. | घड़ी पर मेरी नज़र है, सोचना आपका काम। |
| Offline | Today's challenge needs internet. | आज के चैलेंज के लिए इंटरनेट चाहिए। |
| Offline action | Do a quick drill instead | उसकी जगह एक छोटी ड्रिल करें |
| Not published | No challenge today yet. Check back soon. | आज का चैलेंज अभी नहीं आया। थोड़ी देर में देखें। |
| Resume note | Your clock started at {time}. | आपकी घड़ी {time} पर शुरू हुई थी। |

**Illustration slots:** Before start: `pet-cat` / `pet-dog`, 1:1, the pet holding a glowing puzzle piece, curious mood. Alt intent: "{pet_name} holding today's puzzle". None while playing.
**States:**
- Before start, playing (above).
- Already played: opens PRC-12 directly.
- Left after start and came back: playing state, clock continues from the server start, the resume note shows.
- Not published yet for today: the "Not published" line, no button.
- Offline: illustration of the sleeping pet (`empty-state`), the offline line, [Do a quick drill instead] → PRC-03.
- Error on submit: the answer is kept, "Couldn't send. [Try again]". The clock stops at the first submit tap so a retry isn't penalised.
- Guest: plays normally; ranks shown privately on PRC-12.
- Minor without consent: plays normally.
- Tutor: the floating button (AI-01) is hidden from open to submit, so the answer is the student's own.
- Day boundary: the challenge rolls at 00:00 IST for everyone (R23). A student who opens it before 00:00 IST and submits after still gets the challenge they opened; the streak day it counts for is the student's local date at submit (R23).
- Little learner: not reachable (R14).
- Dark mode: tokens.

**Interaction and motion:** [Start] press: the illustration slides up and the question fades in (`slow`). Submit: light haptic, then PRC-12. The pet never appears during the question (it would distract), only before and after.
**Accessibility:** Rules are a list. The count-up clock is not announced (no limit). Everything else as PRC-04.
**Analytics:** `daily_challenge_viewed {state}`, `daily_challenge_started`, `daily_challenge_submitted {is_correct, time_ms, confidence}`.
**Web (≥ 600 px):** A centred 720 px column. The rules sit beside the illustration. Keyboard as PRC-04.
**Mock priority:** P0 · Phase 1

### PRC-12 · Challenge result and leaderboard
**Purpose:** Show the result, the solution and today's ranking, and tie it to the streak. **Main action:** [See solution] when wrong, [Share] when right.
**Entry → exits:** PRC-11, PRC-01 card → PRC-05 (solution), PRC-13 (share), AUTH-01 soft sheet (guest link, reason `leaderboard`), AUTH-18 guardian consent (teen "Ask a parent"), SET-13 parent gate (under-13 "Ask a grown-up"), SOC-04 add friends (Friends tab empty, Phase 2), SOC-07 friend profile (tap a friend row, Phase 2), PRC-01 (Done).
**Layout (top to bottom):**
1. Top bar: close ✕.
2. Result block: pet illustration by result; title "Solved!" or "Not this time"; Stat tiles "Time {m:ss}", "Rank #{rank}" (or "Rank soon"), "{pct}% got it right" (when the threshold is met).
3. Streak line: Streak card mini variant with the Phosphor `Plant` (fill) icon in `streak` gold and "Your plant got its water today." (the challenge qualifies a streak day, R23), plus the daily goal ring mini variant "+{xp} XP toward today's goal" or "Today's goal is done."
4. Button secondary 56 [See solution].
5. Leaderboard: tabs "All-India" · "Friends" (Friends tab is Phase 2, with SOC). Top 10 Leaderboard rows, then the student's own row pinned. Adults show their display name; under-18s show only the pet avatar and an auto-generated nickname (R31 amended). Under the threshold: "{count} players so far. Ranks appear at {min_players}."
6. Next challenge line in `caption`: "Next challenge in {hh:mm}".
7. Button primary 56 [Share] and ghost [Done].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Solved | Solved! | हल कर दिया! |
| Not this time | Not this time | इस बार नहीं |
| Time tile | Time | समय |
| Rank tile | Rank #{rank} | रैंक #{rank} |
| Rank soon | Rank soon | रैंक जल्द |
| Percent right | {pct}% got it right | {pct}% ने सही किया |
| Streak line | Your plant got its water today. | आज आपके पौधे को पानी मिल गया। |
| Goal done | +{xp} XP. Today's goal is done. | +{xp} XP. आज का लक्ष्य पूरा। |
| Goal progress | +{xp} XP toward today's goal | आज के लक्ष्य की ओर +{xp} XP |
| See solution | See solution | हल देखें |
| All-India | All-India | अखिल भारत |
| Friends | Friends | दोस्त |
| Threshold | {count} players so far. Ranks appear at {min_players}. | अब तक {count} खिलाड़ी। {min_players} होने पर रैंक दिखेंगी। |
| You | You | आप |
| Guest private rank | You'd be #{rank}. Sign in to appear on the leaderboard. | आपकी रैंक #{rank} होती। लीडरबोर्ड पर आने के लिए साइन इन करें। |
| Minor private | Only you can see your row. | आपकी पंक्ति सिर्फ़ आपको दिखती है। |
| Minor listed note | Others see a nickname and your pet, never your name. | दूसरों को आपका नाम नहीं, सिर्फ़ एक निकनेम और आपका पेट दिखता है। |
| Ask a parent | Ask a parent | माता-पिता से पूछें |
| Next | Next challenge in {hh:mm} | अगला चैलेंज {hh:mm} में |
| Share | Share | शेयर करें |
| Done | Done | हो गया |
| Pet line, right | Quick thinking! See you tomorrow. | तेज़ दिमाग! कल फिर मुलाक़ात। |
| Pet line, wrong | Tricky one. The solution makes it click. | मुश्किल था। हल देखते ही समझ आ जाएगा। |
| Friends empty | Add friends to see them here. | यहाँ देखने के लिए दोस्त जोड़ें। |

**Illustration slots:** `pet-cat` / `pet-dog`, 1:1. Right: proud pose. Wrong: thinking pose (never sad). Alt intent: "{pet_name} {pose}".
**States:**
- Right, wrong (above).
- Ranks below threshold: rank tile shows "Rank soon"; the threshold line replaces the list; "{pct}% got it right" hidden.
- Ranks pending (results computing): spinner in the rank tile for up to a few seconds, then "Rank soon".
- Guest: own row is not on the public list; the private rank line with a link "Sign in" (opens AUTH-01 soft sheet with reason `leaderboard`). Friends tab hidden.
- Minor (13–17) without guardian consent (`social` scope): the student's own row shows "You" and is visible only to them; the minor private line and a ghost [Ask a parent] → AUTH-18. Friends tab hidden.
- Under 13 without the scope: the same, with [Ask a grown-up] → SET-13 parent gate, then SET-17 consents.
- Minor with consent: listed to others by the pet avatar and an auto-generated nickname only (R31 amended); the minor listed note shows once under the list. The typed pet name never appears on a public list.
- Little learner: not reachable (R14).
- Tutor button: shown again after submit; [See solution] → PRC-05 has [Ask why].
- Offline after submit (rare: submit succeeded, then lost signal): cached result, leaderboard "Needs internet".
- Dark mode: tokens.

**Interaction and motion:** Right: the pet plays `celebrate`, check pops with spring `pop`, success haptic, soft ding. The streak plant plays its small watered animation once (UX_FLOW §3). Short Lottie confetti (`celebrate`, 1200 ms) only when right and only if the daily goal completes with it. Wrong: no shake (the result is already known), the pet plays `think`. Reduced motion: static poses, no confetti.
**Accessibility:** The result title is announced. Leaderboard rows read "Rank {n}, {name}, {time}", where `{name}` is the display name or nickname shown. The pinned own row is reachable last in focus order with label "Your rank". Tabs are a tab list.
**Analytics:** `daily_challenge_viewed {state: played}`, `daily_challenge_shared` (from Share), `solution_viewed {context: daily}`.
**Web (≥ 600 px):** Two columns: the result, streak line and actions on the left; the leaderboard on the right.
**Mock priority:** P0 · Phase 1

### PRC-13 · Share card
**Purpose:** Let the student share a picture of today's result that holds no personal or free text. **Main action:** [Share].
**Entry → exits:** PRC-12 → OS share sheet (mobile), Web Share API or [Download image] (web), back to PRC-12.
**Layout (top to bottom):**
1. Sheet at 60%, title "Share your result".
2. The card preview, 4:5, radius `cardLarge`, rendered from UI components on the device: the app mark (favicon-size mark, DESIGN.md §12), "{exam_short} daily challenge", the date, a large check or cross icon with "Solved" / "Not this time", "Time {m:ss}", "Top {pct}%" (only when ranks are public and the band is meaningful), the streak `Plant` (fill) icon with "{streak} day streak", and the pet illustration. Background: `primaryTint`.
3. Toggle "Show my streak" (on by default).
4. Button primary 56 [Share] (mobile) or [Share] / [Download image] (web).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Share your result | अपना नतीजा शेयर करें |
| Card label | {exam_short} daily challenge | {exam_short} डेली चैलेंज |
| Solved | Solved | हल किया |
| Not this time | Not this time | इस बार नहीं |
| Time | Time {m:ss} | समय {m:ss} |
| Top band | Top {pct}% | टॉप {pct}% |
| Streak | {streak} day streak | {streak} दिन की स्ट्रीक |
| Show streak | Show my streak | मेरी स्ट्रीक दिखाएँ |
| Share | Share | शेयर करें |
| Download | Download image | इमेज डाउनलोड करें |
| Footer on card | Play today's challenge on Smriti | आज का चैलेंज Smriti पर खेलें |
| Preview alt | Your result card: {result}, time {m:ss} | आपका नतीजा कार्ड: {result}, समय {m:ss} |
| Failed | Couldn't open sharing. Try again. | शेयर नहीं खुल सका। फिर से कोशिश करें। |

**Illustration slots:** `pet-cat` / `pet-dog`, 1:1, transparent, the pet in its result pose (same asset as PRC-12). The card composites this image with UI text in the student's language; nothing is baked into the illustration. Alt intent for the preview: "Your result card: {solved or not}, time {m:ss}".
**States:**
- Default.
- No rank band: the "Top" line is left out (never "Top 100%").
- Minor (any band below 18): no name on the card (adults also get no name by default; there is no name field at all). Share is allowed because the card holds no personal data and nothing is sent through Smriti.
- Little learner: not reachable.
- Dark mode: the card always renders in the light palette so it reads well in chat apps.

**Interaction and motion:** The preview scales in with spring `gentle`. The toggle re-renders the card instantly.
**Accessibility:** The preview has the alt text above. The toggle has a label. The share sheet is the OS one.
**Analytics:** `daily_challenge_shared {challenge_id, share_target}`. No image, no text, no recipient data is logged.
**Web (≥ 600 px):** A dialog 480 px wide. Web Share API where available, else Download image.
**Mock priority:** P1 · Phase 1

### PRC-14 · Analytics dashboard
**Purpose:** Show the student, from real data only, how ready they are and where to practise next. **Main action:** tap a card to drill into it; the readiness card's [Practise weak spots].
**Entry → exits:** PRC-01 tile, ME-01 stats, MOCK-19 ("See all analytics") → PRC-15 (subject), PRC-02 (weak spots), PRC-03 (drill from a chapter dot), MEM-25 metacognitive dashboard (calibration card), MOCK-25 (trend card), back.
**Layout (top to bottom):**
1. Top bar: back (or tab root on web), "Your progress", exam chip (all-exams app).
2. Period chips: 7 days · 30 days · All time. Updated line in `caption`: "Updated {time}".
3. **Readiness card** (`surface`, radius `cardLarge`): Score ring "{readiness}%", "Readiness for {exam_short}", caption "Based on {practised} of {total} concepts", info icon (opens the "How this is worked out" sheet), Button secondary 40 [Practise weak spots].
4. **Subject mastery card:** one row per subject: name, Progress bar in subject `strong`, "{mastery}%", change chip "+{delta}" / "−{delta}" with an arrow icon, chevron to PRC-15.
5. **Accuracy vs speed card:** a quadrant chart (x: average time vs target, y: accuracy), one dot per chapter in its subject colour, quadrant labels "Fast and right", "Slow and right", "Fast and wrong", "Slow and wrong". [View as list] link.
6. **Time per question card:** three Stat tiles: "Avg {m:ss} vs target {m:ss}", "Right but slow: {n}", "Fast and wrong: {n}".
7. **Confidence card:** three horizontal bars "Sure {pct}% right", "50:50 {pct}% right", "Guess {pct}% right", a line "Lucky guesses: {n}", link "Open memory dashboard" → MEM-25.
8. **Mistake types card:** bars for the student's own tags (Concept, Calculation, Misread, Silly, Time).
9. **Trend card:** a line chart of mock scores as % of max (dots labelled with the mock's short name), and a second line for weekly practice accuracy. Legend with line style (solid vs dashed), not colour alone.
10. **Syllabus covered card:** Progress bar "{covered}% of the syllabus touched".

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Your progress | आपकी प्रगति |
| 7 days / 30 days / All time | 7 days / 30 days / All time | 7 दिन / 30 दिन / अब तक |
| Updated | Updated {time} | {time} को अपडेट |
| Readiness label | Readiness for {exam_short} | {exam_short} के लिए तैयारी |
| Readiness basis | Based on {practised} of {total} concepts | {total} में से {practised} कॉन्सेप्ट के आधार पर |
| Practise weak spots | Practise weak spots | कमज़ोर हिस्सों का अभ्यास करें |
| How sheet title | How this is worked out | यह कैसे निकाला जाता है |
| How sheet body | Your mastery of each concept, weighted by how much it counts in {exam_short}. It's not a predicted score. | हर कॉन्सेप्ट पर आपकी महारत, इस हिसाब से कि {exam_short} में वह कितना मायने रखता है। यह अनुमानित स्कोर नहीं है। |
| Weights note (no weightage yet) | All concepts count equally until we've analysed enough past papers. | जब तक पर्याप्त पिछले पेपरों का विश्लेषण नहीं होता, सभी कॉन्सेप्ट बराबर गिने जाते हैं। |
| Subject mastery | Subject mastery | विषयवार महारत |
| Accuracy vs speed | Accuracy vs speed | सटीकता और रफ़्तार |
| Fast and right | Fast and right | तेज़ और सही |
| Slow and right | Slow and right | धीमे पर सही |
| Fast and wrong | Fast and wrong | तेज़ पर गलत |
| Slow and wrong | Slow and wrong | धीमे और गलत |
| View as list | View as list | सूची में देखें |
| Time per question | Time per question | हर सवाल पर समय |
| Avg vs target | Avg {m:ss} vs target {m:ss} | औसत {m:ss}, लक्ष्य {m:ss} |
| Right but slow | Right but slow: {n} | सही पर धीमे: {n} |
| Fast and wrong count | Fast and wrong: {n} | तेज़ पर गलत: {n} |
| Confidence | How sure vs how right | यक़ीन बनाम सही उत्तर |
| Sure line | Sure: {pct}% right | पक्का: {pct}% सही |
| Fifty line | 50:50: {pct}% right | 50:50: {pct}% सही |
| Guess line | Guess: {pct}% right | अंदाज़ा: {pct}% सही |
| Lucky | Lucky guesses: {n} | किस्मत से सही: {n} |
| Memory link | Open memory dashboard | मेमोरी डैशबोर्ड खोलें |
| Mistake types | Your mistake types | आपकी गलतियों के प्रकार |
| Trend | Trend | रुझान |
| Mock scores | Mock scores | मॉक स्कोर |
| Weekly accuracy | Weekly accuracy | साप्ताहिक सटीकता |
| Covered | {covered}% of the syllabus touched | सिलेबस का {covered}% छुआ |
| Card empty | Answer {n} more {subject} questions to see this. | इसे देखने के लिए {subject} के {n} और सवाल हल करें। |
| Card empty, mocks | Take {n} more mocks to see a trend. | रुझान देखने के लिए {n} और मॉक दें। |
| Card empty, confidence | Tap Sure, 50:50 or Guess on {n} more answers to see this. | इसे देखने के लिए {n} और उत्तरों पर पक्का, 50:50 या अंदाज़ा चुनें। |
| Pending sync | {n} answers will count when you're online. | ऑनलाइन होने पर {n} उत्तर जुड़ जाएँगे। |
| Pet line, empty dashboard | Practise a little and I'll draw your progress here. | थोड़ा अभ्यास कीजिए, फिर आपकी प्रगति यहाँ दिखेगी। |

**Illustration slots:** Whole-dashboard empty state: `empty-state`, 4:3, the pet holding a blank clipboard next to a sprouting plant. Alt intent: "{pet_name} ready to track your progress". Cards themselves have no illustrations (charts are the visual).
**States:**
- Default: every card with enough data.
- Per-card empty: the card keeps its title and shows the card empty line with the exact count and a small [Practise] button. No faded fake chart behind it.
- Whole dashboard empty (new student): the empty illustration, pet line, [Start a drill].
- Loading: card skeletons with fixed heights.
- Error: per card "Couldn't load. [Try again]".
- Offline: cached data with "Updated {time}" and the pending sync line. Period chips other than the cached one are disabled.
- Guest and free: every card is free (R25, R19). No Pro chip on this screen. The calibration card links to MEM-25, which is also free.
- Minor: unchanged.
- Little learner: not reachable (R14). Parents see progress in SET-14 parent dashboard (Phase 3).
- Dark mode: chart colours from the proposed `dataViz` tokens (flow §12.3) with dark variants; subject colours use dark `strong`.

**Interaction and motion:** Cards are buttons. Chart dots are tappable (a callout with "{chapter}, {accuracy}% right, {m:ss} avg" and [Drill]). Bars and the ring fill with spring `gentle` once per open. Reduced motion: no fill animation.
**Accessibility:** Every chart has a "View as list" or a data table equivalent, reachable by screen readers. The ring reads "Readiness {n} percent, based on {practised} of {total} concepts". Change chips use arrows plus sign plus text ("up 4"). Trend lines differ in dash style and point shape. Muted text on cards meets 4.5:1.
**Analytics:** `analytics_viewed {period, cards_with_data}`, `analytics_card_opened {card}`.
**Web (≥ 600 px):** A 2-column card grid (3 columns at ≥ 1024): readiness and subject mastery full width on top, then the rest. Charts gain axis tick labels. Hover shows the same callout as tap; nothing is hover-only.
**Mock priority:** P0 · Phase 1

### PRC-15 · Subject analytics
**Purpose:** Break one subject down by chapter and concept so the student can drill the exact gap. **Main action:** [Drill] on the weakest chapter.
**Entry → exits:** PRC-14 subject row → PRC-03 (chapter or concept prefilled), LRN-02 chapter, back.
**Layout (top to bottom):**
1. Header in the subject tint: back, subject name in `title`, "{mastery}% mastery · {practised} of {total} concepts".
2. Period chips (same as PRC-14).
3. Chapter list sorted weakest first (toggle "Syllabus order"): chapter name, Progress bar in subject `strong`, "{accuracy}% right · avg {m:ss}", a tiny 7-cell heat strip of its topics (Heat map cells), and a [Drill] ghost button.
4. Expanding a chapter shows its topics and concepts with accuracy, attempts and the confidence split.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Header line | {mastery}% mastery · {practised} of {total} concepts | {mastery}% महारत · {total} में से {practised} कॉन्सेप्ट |
| Weakest first | Weakest first | कमज़ोर पहले |
| Syllabus order | Syllabus order | सिलेबस के क्रम में |
| Chapter meta | {accuracy}% right · avg {m:ss} | {accuracy}% सही · औसत {m:ss} |
| Concept meta | {correct} of {attempts} right | {attempts} में से {correct} सही |
| Too few | Too few answers yet | अभी बहुत कम उत्तर |
| Drill | Drill | ड्रिल करें |
| Open chapter | Open chapter | अध्याय खोलें |

**Illustration slots:** Header: `sunny-object` subject illustration reused from LRN. Decorative.
**States:** Default; loading; chapters below `{analytics.min_answers_per_chapter}` show "Too few answers yet" and a hatched heat cell; offline (cached); dark mode (dark tint header). Guest, free and Pro identical.
**Interaction and motion:** Rows expand with `base`. Drill opens PRC-03 as a sheet over this screen.
**Accessibility:** Heat strip cells have text values; hatched cells read "not enough data". Expand state announced.
**Analytics:** `analytics_card_opened {card: subject}`, `drill_setup_opened {source: analytics}`.
**Web (≥ 600 px):** Chapters on the left, the selected chapter's concept table on the right with sortable columns (accuracy, attempts, average time, confidence).
**Mock priority:** P1 · Phase 1

### PRC-16 · Practice history
**Purpose:** List every past practice session so the student can revisit questions they got wrong. **Main action:** open a session.
**Entry → exits:** PRC-01 "See all" → PRC-06 (past session summary, read-only), MOCK-19 (mock rows), PRC-12 (challenge rows), back.
**Layout (top to bottom):**
1. Top bar: back, "Practice history".
2. Type chips: All · Drills · PYQs · Daily challenge · Mocks.
3. Grouped by day ("Today", "Yesterday", dates). Rows: type icon, title, "{answered} answered · {accuracy}%", time of day, chevron.
4. Infinite scroll with cursor pagination.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Practice history | अभ्यास का इतिहास |
| All / Drills / PYQs / Daily challenge / Mocks | All / Drills / PYQs / Daily challenge / Mocks | सभी / ड्रिल / PYQ / डेली चैलेंज / मॉक |
| Today / Yesterday | Today / Yesterday | आज / कल |
| Row meta | {answered} answered · {accuracy}% | {answered} किए · {accuracy}% |
| Empty | Nothing here yet. Your sessions will show up here. | अभी कुछ नहीं। आपके सत्र यहाँ दिखेंगे। |
| Guest footer | Sign in to keep your history on every device. | हर डिवाइस पर इतिहास रखने के लिए साइन इन करें। |

**Illustration slots:** Empty: `empty-state`, 4:3, the pet flipping through an empty notebook. Alt intent: "{pet_name} with an empty notebook".
**States:** Default, loading, empty, error, offline (local sessions only, "Older sessions need internet"), guest (footer link to AUTH-01, reason `save_progress`), dark mode.
**Interaction and motion:** Standard list. Pull to refresh.
**Accessibility:** Rows read type, title, meta, time. Day headers are headings.
**Analytics:** `screen_view {screen: PRC-16}` (product default), plus `pyq_paper_opened` or `mock_report_viewed` when a row is opened.
**Web (≥ 600 px):** List left, the selected session summary right.
**Mock priority:** P2 · Phase 1

### PRC-17 · Free limit sheet
**Purpose:** Tell a guest or free student plainly that a free limit is reached, and offer fair choices. It opens only when the student taps something capped, never by itself and never mid-session (research X1, X8). **Main action:** the free alternative ([Do my reviews] or [Start the next lesson]); [Try Pro for ₹1] sits beside it.
**Entry → exits:** PRC-01 limit meter, PRC-03 "Why?" link (daily question count used), MOCK-01 / MOCK-02 (weekly sectional mock used, locked mock), MOCK-19 (locked report section), PRC-10 → PAY-01 paywall (trigger `practice_limit`, `mock_limit` or `analytics_lock`, then back to the exact place), SET-13 parent gate (under 13), MEM-03 review session, LRN-02 (next lesson), close (back to where the student was).
**Layout (top to bottom):**
1. Sheet at 60%, grabber.
2. Illustration: the pet with the plant, relaxed.
3. Title by limit (see Copy), `title`.
4. One line of explanation with the reset time: "Resets at midnight" or "Your next free sectional mock opens on {weekday}".
5. Benefit line: "Pro: unlimited practice, every mock and full reports."
6. Button primary 56 with the free alternative: [Do my reviews] (if any are due) or [Start the next lesson].
7. Button secondary 56 [Try Pro for ₹1]. Fine print in `caption`: "₹99/month after the first month. Cancel anytime." (PAY-01 shows the full trial timeline, R33.)
8. Ghost button [Not now]. Swipe down, back and tapping outside also close it.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title, daily cap | That's today's {limit} free questions | आज के {limit} फ़्री सवाल पूरे हुए |
| Title, sectional mock | You've used this week's free sectional mock | इस हफ़्ते का फ़्री सेक्शनल मॉक हो गया |
| Title, locked mock | This mock is part of Pro | यह मॉक Pro में है |
| Title, report section | Full report is part of Pro | पूरी रिपोर्ट Pro में है |
| Resets midnight | Resets at midnight. | आधी रात को फिर से शुरू। |
| Next sectional | Your next free sectional mock opens on {weekday}. | आपका अगला फ़्री सेक्शनल मॉक {weekday} को खुलेगा। |
| Benefit | Pro: unlimited practice, every mock and full reports. | Pro: असीमित अभ्यास, सभी मॉक और पूरी रिपोर्ट। |
| Try Pro | Try Pro for ₹1 | ₹1 में Pro आज़माएँ |
| Fine print | ₹99/month after the first month. Cancel anytime. | पहले महीने के बाद ₹99/महीना। कभी भी रद्द करें। |
| Reviews | Do my reviews | मेरे रिव्यू करें |
| Next lesson | Start the next lesson | अगला लेसन शुरू करें |
| Not now | Not now | अभी नहीं |
| Ask a grown-up | Ask a grown-up | किसी बड़े से पूछें |
| Pet line | Rest is part of learning too. | आराम भी पढ़ाई का हिस्सा है। |

**Illustration slots:** `empty-state`, 4:3, the pet sitting calmly beside the streak plant. Alt intent: "{pet_name} resting beside your plant".
**States:**
- Variant by limit (daily cap, sectional, locked mock, report section).
- Already used the ₹1 offer on this account (PAY knows): the button reads "Get Pro, ₹99/month" and the fine print changes (PAY owns the exact string).
- Guest: [Try Pro for ₹1] goes PAY-01 first, whose [Start for ₹1] opens AUTH-02 (reason `start_trial`, hard), then checkout.
- Minor 13–17: under-18 purchases follow PAY's rules (PAY owns them).
- Under 13: no price, no fine print, no benefit line with money. [Try Pro for ₹1] becomes [Ask a grown-up] → SET-13 → PAY-01 for the parent.
- Little learner: not reachable (R14).
- Offline: [Try Pro] disabled with "Needs internet"; the free alternative stays.
- Dark mode: tokens.

**Interaction and motion:** Sheet rises in `slow`. No countdowns, no flashing, no fake urgency (DESIGN.md §11, UX_FLOW §4.15, R33). Always dismissible: swipe, back, tap outside, [Not now]. Shown at most once per limit per day unless the student taps the capped thing again.
**Accessibility:** Focus starts on the title. All three choices are equal-size touch targets; the ghost one is still 48 px tall.
**Analytics:** `free_limit_hit {limit_key, used, limit}`, `free_limit_action {limit_key, action}`, PAY's `paywall_viewed {trigger}` when [Try Pro] is tapped.
**Web (≥ 600 px):** A 480 px dialog.
**Mock priority:** P1 · Phase 1

### PRC-18 · PYQ source sheet
**Purpose:** Show exactly where a past question comes from, so every PYQ can be checked. **Main action:** [Open official source].
**Entry → exits:** Citation chip on PRC-04, PRC-05, PRC-09, PRC-10, MOCK-22 → in-app browser (official URL), PRC-10 ("See the whole paper"), close.
**Layout (top to bottom):**
1. Sheet at 40%, title "Where this question is from".
2. Rows: Exam "{exam_name}", Year "{year}", Session "{session_label}", Held on "{held_on}", Question number "{number}", Source "{conducting_body}" with the host.
3. Answer key status row: "Final key", "Provisional key", "Dropped in the final key" or "Answer changed in the final key", each with its icon.
4. Note in `caption`: "The question is as set in the paper. The solution is written by Smriti."
5. Button primary 56 [Open official source], Button ghost [See the whole paper].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Where this question is from | यह सवाल कहाँ से है |
| Exam | Exam | परीक्षा |
| Year | Year | वर्ष |
| Session | Session | सत्र |
| Held on | Held on | परीक्षा की तारीख़ |
| Question number | Question number | प्रश्न संख्या |
| Source | Source | स्रोत |
| Key status | Answer key | उत्तर-कुंजी |
| Note | The question is as set in the paper. The solution is written by Smriti. | सवाल वैसा ही है जैसा पेपर में था। हल Smriti ने लिखा है। |
| Open source | Open official source | आधिकारिक स्रोत खोलें |
| Whole paper | See the whole paper | पूरा पेपर देखें |

**Illustration slots:** None.
**States:** Default; source URL unreachable offline ("Needs internet" on the button); dark mode. If a paper has no `source_url` (should not pass `content-qa`), the PYQ is not shown at all.
**Interaction and motion:** Sheet `slow`. The link opens the in-app browser (SFSafariViewController / Custom Tabs).
**Accessibility:** Rows are a description list. The link button says where it goes ("Open {host}").
**Analytics:** `pyq_citation_opened {paper_id}`.
**Web (≥ 600 px):** A popover anchored to the chip (400 px), closing on Escape.
**Mock priority:** P1 · Phase 1

---

## Mocks

### MOCK-01 · Mock lobby
**Purpose:** Show every mock the student can take for their exam, with the facts that matter, and their history. **Main action:** open the recommended mock.
**Entry → exits:** PRC-01 tile, HOME-02 plan, LRN-06 chapter test entry sheet (timed chapter mock), deep link `smriti.app/mock/{mockId}` (via MOCK-02) → MOCK-02, MOCK-03 (live, Phase 3), MOCK-26 (custom, Phase 2), MOCK-25 (history), MOCK-19 (a past report), MOCK-14 (resume card), PRC-17 (dismissible), PAY-01 paywall (Pro chip tapped, trigger `mock_limit`), SET-13 parent gate (under 13), back.
**Layout (top to bottom):**
1. Top bar: back (tab root on web), "Mock tests", exam chip (all-exams app) or a paper-profile segmented control (for example "Main · Advanced" in Smriti JEE).
2. Resume card if a mock is in progress (as PRC-01 item 2).
3. Type chips (scrollable): For you · Live · Full · Sectional · Chapter · PYQ papers · Custom. Chips for types with no published mocks are hidden.
4. **Live strip** (when any live mock is scheduled): horizontally scrolling cards, each with "Live" status Chip, title, date and time window, "{registered} registered" (real count), and [Register] / [Registered] / [Join now].
5. **Mock cards** for the selected chip: `surface`, radius `card`, `line` border. Each card: title in `heading`; a fact row with icons: `Timer` "{duration_min} min", `ListNumbers` "{question_count} Qs", `Scales` "{marking_summary}" ("+{marking.correct} / −{marking.wrong}", built from the blueprint; never a hard-coded pattern); sections caption "{section_titles}"; a status on the right: "Free", "Pro" Chip, "Attempted · {score}/{max}", or "In progress"; [Start] or [View].
6. Free usage line (guest and free): "Free this week: {used} of {free.sectional_mocks_per_week} sectional mock".
7. **History** section: the last 3 attempts with title, date, "{score}/{max}", percentile when shown, chevron. "See all" → MOCK-25. A `caption` under the heading for signed-in students: "Your mocks are the same on every device you sign in to." (research A30).
8. Custom mock card at the end of "For you" (Pro badge for free users): "Build a mock from your weak spots" → MOCK-26.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Mock tests | मॉक टेस्ट |
| For you | For you | आपके लिए |
| Live | Live | लाइव |
| Full | Full | फ़ुल |
| Sectional | Sectional | सेक्शनल |
| Chapter | Chapter | अध्याय |
| PYQ papers | PYQ papers | PYQ पेपर |
| Custom | Custom | कस्टम |
| Duration fact | {duration_min} min | {duration_min} मिनट |
| Questions fact | {question_count} Qs | {question_count} सवाल |
| Live window | {date} · {start_time}–{end_time} | {date} · {start_time}–{end_time} |
| Registered count | {registered} registered | {registered} ने रजिस्टर किया |
| Register | Register | रजिस्टर करें |
| Registered | Registered | रजिस्टर्ड |
| Join now | Join now | अभी जुड़ें |
| Free chip | Free | फ़्री |
| Attempted | Attempted · {score}/{max} | दिया · {score}/{max} |
| In progress | In progress | चल रहा है |
| Start | Start | शुरू करें |
| View | View | देखें |
| Free usage | Free this week: {used} of {limit} sectional mock | इस हफ़्ते फ़्री: {limit} में से {used} सेक्शनल मॉक |
| History | Your mocks | आपके मॉक |
| See all | See all | सभी देखें |
| Sync line | Your mocks are the same on every device you sign in to. | जिस भी डिवाइस पर साइन इन करें, आपके मॉक वहाँ एक जैसे दिखेंगे। |
| Guest sync line | Sign in to see your mocks on every device. | हर डिवाइस पर अपने मॉक देखने के लिए साइन इन करें। |
| Custom card | Build a mock from your weak spots | अपने कमज़ोर हिस्सों से मॉक बनाएँ |
| Empty | Mocks for {exam_short} are on their way. | {exam_short} के मॉक जल्द आ रहे हैं। |
| Pet line | Real exam feel, no pressure. Pick one when you're ready. | असली परीक्षा जैसा, बिना दबाव। तैयार हों तो एक चुनें। |

**Illustration slots:**
- Lobby header: `sunny-scene`, 3:2, cropped to a 16:5 band, a calm exam hall desk with a clock-free wall, an answer sheet and a pencil, soft tint background. No text. Alt intent: decorative.
- Empty state: `empty-state`, 4:3, the pet sharpening a pencil. Alt intent: "{pet_name} getting ready for mocks".
- Mock cards: no illustrations (facts are the content).

**States:**
- Default ("For you" shows the recommended mock first: the next unattempted full mock, or a sectional mock for the weakest section).
- Loading: card skeletons.
- Empty (no published mocks for this profile): empty state. Normal for a school profile without blueprints.
- Error: inline retry.
- Offline: only mocks with a downloaded paper show [Start]; others show "Needs internet to download". Live strip hidden.
- Guest and free: one sectional mock a week (`free.sectional_mocks_per_week`) and the sample full mock (`content.mocks.is_free`) show "Free" (R25). The usage line shows before starting, so the limit is never a surprise. Tapping a sectional mock after the weekly one is used opens PRC-17 (dismissible). Live cards show a Pro Chip; [Register] opens PAY-01 (trigger `mock_limit`).
- Guest: the history caption is the guest sync line with a "Sign in" link → AUTH-01 (reason `save_progress`).
- Under 13: Pro Chips read "Ask a grown-up" and open SET-13. No prices.
- Pro: no chips except "Live".
- Minor: unchanged. Registered counts are aggregates only.
- Little learner: not reachable.
- Phase 1: live strip hidden (`live.enabled` false, live mocks are Phase 3). Custom card hidden until Phase 2. Chapter chip shows only if chapter mocks exist.
- Dark mode: Practice look in dark tokens (the lobby is not the runner).

**Interaction and motion:** Chips filter with a cross-fade (`base`). Live strip snaps per card. Pull to refresh.
**Accessibility:** Cards read "{title}. {duration} minutes, {n} questions, marking {plus} for right, {minus} for wrong. {status}." Icon facts always have text. Chips are a tab list.
**Analytics:** `mock_lobby_viewed {tab}`, `mock_detail_viewed`, `live_mock_registered`, PAY's `paywall_viewed {trigger: mock_limit}`.
**Web (≥ 600 px):** Cards in a 2-column grid (3 at ≥ 1024). History in a right rail at ≥ 1024. The live strip becomes a row of up to 3 cards.
**Mock priority:** P0 · Phase 1

### MOCK-02 · Mock detail
**Purpose:** Show the exact pattern of one mock, from its blueprint, before the student commits. **Main action:** [Start mock].
**Entry → exits:** MOCK-01, deep link `smriti.app/mock/{mockId}`, ENT-06 shared link landing, HOME-02 plan, LRN-06 chapter test entry sheet, PRC-01 suggested mock → MOCK-04, MOCK-19 (past attempt), MOCK-23 (compare), MOCK-14 (if in progress), PRC-17 / PAY-01 paywall (locked, trigger `mock_limit`), in-app browser (official instructions), back.
**Layout (top to bottom):**
1. Header: back, title in `title`, kind Chip (Full / Sectional / Chapter / PYQ paper / Custom).
2. Fact tiles (Stat tiles, 3 across): "{duration_min} min", "{question_count} questions", "{max_marks} marks".
3. **Sections** table: one row per section: title, "{question_count} Qs", the timer rule ("{section_timer_min} min, locked" or "Shared time"), attempt rule ("Answer any {attempt_any}") when present.
4. **Marking** card: one row per question type present: type name, "+{correct}", "{wrong}", "{unattempted}", and a plain-words line for partial marking when the blueprint has it ("Part marks when you pick only correct options").
5. **Rules** list: section navigation in plain words ("You can move between sections freely" or "Sections open one after another and lock when time ends"), languages "{languages}", calculator ("On-screen calculator: {basic or scientific}" or "No calculator"), whether marked answers are evaluated.
6. Source line in `caption`: "Pattern from {source.title} ({source.published}). Checked {verified_at}." Under it, the "Practise like the real exam" link to the official instructions (`blueprint.source.url`, research A27), opening the in-app browser.
7. Qualifying note when the paper is qualifying: "Qualifying paper: {qualifying.rule}".
8. Your attempts: rows with date and score, [Compare] when 2 or more.
9. Button primary 56 [Start mock] (or [Resume] / [Unlock with Pro]), pinned.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Sections | Sections | सेक्शन |
| Section timer locked | {section_timer_min} min, then it locks | {section_timer_min} मिनट, फिर बंद |
| Shared time | Shared time | साझा समय |
| Attempt any | Answer any {attempt_any} | कोई भी {attempt_any} हल करें |
| Marking | Marking | अंक योजना |
| Right / Wrong / Left blank | Right / Wrong / Left blank | सही / गलत / खाली छोड़ा |
| Partial | Part marks when you pick only correct options | सिर्फ़ सही विकल्प चुनने पर आंशिक अंक |
| Rules | Rules | नियम |
| Free navigation | You can move between sections freely. | सेक्शन बदलने की पूरी छूट है। |
| Locked navigation | Sections open one after another and lock when their time ends. | सेक्शन एक के बाद एक खुलते हैं और समय ख़त्म होने पर बंद हो जाते हैं। |
| Languages | Languages: {languages} | भाषाएँ: {languages} |
| Calculator basic | On-screen calculator: basic | ऑन-स्क्रीन कैलकुलेटर: बेसिक |
| Calculator scientific | On-screen calculator: scientific | ऑन-स्क्रीन कैलकुलेटर: साइंटिफ़िक |
| No calculator | No calculator | कैलकुलेटर नहीं |
| Marked evaluated | Answers marked for review are counted. | रिव्यू के लिए मार्क किए उत्तर भी गिने जाते हैं। |
| Marked not evaluated | Answers marked for review are not counted. | रिव्यू के लिए मार्क किए उत्तर नहीं गिने जाते। |
| Source | Pattern from {source_title} ({source_published}). Checked {verified_at}. | पैटर्न {source_title} ({source_published}) से। {verified_at} को जाँचा गया। |
| Qualifying | Qualifying paper: {qualifying_rule} | क्वालिफ़ाइंग पेपर: {qualifying_rule} |
| Official link | Practise like the real exam: read the official instructions | असली परीक्षा जैसा अभ्यास: आधिकारिक निर्देश पढ़ें |
| Re-attempt note | You've taken this mock. Your first attempt is the one that counts for rank. | यह मॉक पहले दिया जा चुका है। रैंक के लिए पहला प्रयास ही गिना जाता है। |
| Your attempts | Your attempts | आपके प्रयास |
| Compare | Compare | तुलना करें |
| Start mock | Start mock | मॉक शुरू करें |
| Resume | Resume | जारी रखें |
| Unlock | Unlock with Pro | Pro से खोलें |

**Illustration slots:** None. This screen is a fact sheet.
**States:**
- Default.
- Loading: skeleton.
- Locked (free or guest): the start button reads "Unlock with Pro" and opens the PAY-01 paywall when tapped (trigger `mock_limit`); or, for a used weekly sectional, opens PRC-17. Under 13: "Ask a grown-up" → SET-13.
- In progress: [Resume] opens MOCK-14.
- Already attempted: re-attempts are allowed (flow §6.10); the re-attempt note shows above the start button. Percentile and rank use the first attempt only (R26).
- Blueprint field missing (should be blocked by `content-qa`): the mock is not listed; if reached by an old deep link, "This mock is being updated" with [Back to mocks].
- Retired blueprint: "This mock uses an older pattern ({effective_from})" warning chip, still startable for practice.
- Offline: [Start mock] works if the paper is downloaded; else "Needs internet to download".
- Little learner: not reachable.
- Dark mode: Practice look.

**Interaction and motion:** Standard. The sections table rows expand to show question types per section.
**Accessibility:** The sections and marking tables are real tables with headers. Signs are read as "plus 4", "minus 1".
**Analytics:** `mock_detail_viewed {mock_id, kind, locked}`, `mock_official_instructions_opened {mock_id}`, PAY's `paywall_viewed {trigger: mock_limit}`.
**Web (≥ 600 px):** Two columns: facts, sections and marking on the left; rules, source, attempts and the start button on the right (sticky).
**Mock priority:** P1 · Phase 1

### MOCK-03 · Live mock room
**Purpose:** Get the student registered, reminded and into a scheduled all-India mock on time. **Main action:** [Register], later [Start now].
**Entry → exits:** MOCK-01 live strip, NTF-01 `mock_reminder` push, deep link → MOCK-04 (when the window is open), MOCK-24 (after results), PAY-01 paywall (free, trigger `mock_limit`), AUTH-02 (guest, via PAY-01), back.
**Layout (top to bottom):**
1. Header: back, "Live" Chip, title.
2. Window card: date, "{start_time}–{end_time}", a countdown to the window start (or to its close while open), "{registered} registered".
3. Facts and marking summary (as MOCK-02, condensed), with "See full pattern" → MOCK-02.
4. How it works list: start any time in the window; full time if you start by {latest_full_start}; ranks at {results_at}.
5. Reminder toggle "Remind me {reminder_lead} before" and [Add to calendar].
6. Button primary 56: [Register] → [Registered ✓] (disabled) → [Start now] when the window opens.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Live chip | Live | लाइव |
| Window | {date} · {start_time}–{end_time} | {date} · {start_time}–{end_time} |
| Starts in | Starts in {hh:mm:ss} | {hh:mm:ss} में शुरू |
| Closes in | Window closes in {hh:mm} | विंडो {hh:mm} में बंद होगी |
| How it works 1 | Start any time while the window is open. | विंडो खुली रहने तक कभी भी शुरू करें। |
| How it works 2 | Start by {latest_full_start} to get the full {duration_min} minutes. | पूरे {duration_min} मिनट के लिए {latest_full_start} तक शुरू करें। |
| How it works 3 | Ranks and percentiles come out at {results_at}. | रैंक और पर्सेंटाइल {results_at} पर आएँगे। |
| Late start | You'll have {remaining} min. The window closes at {end_time}. | आपके पास {remaining} मिनट होंगे। विंडो {end_time} पर बंद होगी। |
| Remind me | Remind me {reminder_lead} before | {reminder_lead} पहले याद दिलाएँ |
| Calendar | Add to calendar | कैलेंडर में जोड़ें |
| Register | Register | रजिस्टर करें |
| Registered | Registered | रजिस्टर्ड |
| Start now | Start now | अभी शुरू करें |
| Closed | This live mock has ended. Results at {results_at}. | यह लाइव मॉक ख़त्म हो गया। नतीजे {results_at} पर। |
| Taken | You've taken this one. Your rank comes at {results_at}. | यह मॉक आपने दे दिया है। आपकी रैंक {results_at} पर आएगी। |
| Needs internet | Live mocks need internet to start. | लाइव मॉक शुरू करने के लिए इंटरनेट चाहिए। |
| Not found | We couldn't find this live mock. | यह लाइव मॉक नहीं मिला। |
| Back practice | Back to Practice | अभ्यास पर वापस जाएँ |
| Register failed | Registration didn't go through. Try again. | रजिस्टर नहीं हो पाया। फिर कोशिश करें। |
| See leaderboard | See leaderboard | लीडरबोर्ड देखें |
| Unlock | Unlock with Pro | Pro से अनलॉक करें |
| Time to start | Time left to start | शुरू होने में बाकी समय |
| Registrations | {n} registered | {n} रजिस्टर्ड |
| How title | How it works | यह कैसे चलता है |
| Reminder set | We'll remind you {reminder_lead} before it starts. | शुरू होने से {reminder_lead} पहले हम याद दिलाएँगे। |
| Minutes | {n, plural, one {# minute} other {# minutes}} | {n} मिनट |
| Unregister | Cancel registration | रजिस्ट्रेशन रद्द करें |

**Illustration slots:** `sunny-scene`, 3:2 band, many small desks in a bright hall seen from above, students of different regions, calm mood. No text or clocks with numbers. Alt intent: "Students across India taking the same mock".
**States:**
- Scheduled (not registered, registered), open, open-late (late start line shown before Start), taken (waiting for results), closed (results out: [See leaderboard] → MOCK-24).
- Free or guest: [Register] reads "Unlock with Pro" and opens the PAY-01 paywall.
- Offline: countdown keeps running from the last server offset; Start disabled with the needs-internet line (the start signal and paper key come from the server).
- Minor: unchanged; on the leaderboard under-18s show only the pet avatar and an auto-generated nickname (R31 amended), as PRC-12.
- Under 13: [Register] reads "Ask a grown-up" → SET-13; no price.
- Dark mode: Practice look.

**Interaction and motion:** Countdown updates every second with tabular figures (no animation). Register: success haptic, the button morphs to Registered with `base`.
**Accessibility:** The countdown is not live-announced; a "Time to start" text is available on focus. Calendar add uses the OS dialog.
**Analytics:** `live_mock_registered {mock_id}`, `mock_detail_viewed {kind: live}`.
**Web (≥ 600 px):** Two columns: window card and how it works left, facts right. Calendar add downloads an `.ics` file.
**Mock priority:** P1 · Phase 3

### MOCK-04 · Pre-flight check
**Purpose:** Make sure the paper is on the device and the phone is ready before any time starts. **Main action:** [Continue to instructions].
**Entry → exits:** MOCK-02, MOCK-03, PRC-10 → MOCK-05, MOCK-14 (another mock in progress), back.
**Layout (top to bottom):**
1. Top bar: back, "Get ready". From here to MOCK-18 the runner look applies.
2. Checklist (each row: icon, label, status on the right, and a fix action when needed):
   - Paper downloaded: progress bar "{downloaded} of {size}", then a check "Ready offline".
   - Storage: "Enough space" or "Free {size} to continue" with [Manage storage] → ME-21 Downloads and storage. The one-off download of this paper is free for every tier; pinning papers for later is Pro (ME-21).
   - Battery: "{battery}%" with "Plug in if you can" under the low threshold.
   - Internet (live only): "Connected" or "Needed to start".
   - Other mock: "No other mock open" or "Finish or leave {mock_title} first".
3. **Exam-day mode** row (not for live mocks, which are always strict): a switch with a caption "No pausing. Full screen. A reporting countdown like the real exam." When on: a Do Not Disturb hint with [Open settings].
4. **Extra time** row, only when the blueprint encodes accommodations (flow §11): "I need extra time" switch with the notified rule in a caption.
5. Button primary 56 [Continue to instructions], enabled when the paper is ready and nothing blocks.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Get ready | तैयार हो जाइए |
| Paper | Paper | पेपर |
| Downloading | {downloaded} of {size} | {size} में से {downloaded} |
| Ready offline | Ready offline | ऑफ़लाइन तैयार |
| Storage ok | Enough space | पर्याप्त जगह है |
| Storage low | Free {size} to continue | आगे बढ़ने के लिए {size} जगह खाली करें |
| Manage storage | Manage storage | स्टोरेज देखें |
| Battery | Battery {battery}% | बैटरी {battery}% |
| Plug in | Plug in if you can | हो सके तो चार्जिंग पर लगाएँ |
| Internet ok | Connected | कनेक्टेड |
| Internet needed | Needed to start | शुरू करने के लिए ज़रूरी |
| Other mock | Finish or leave {mock_title} first | पहले {mock_title} पूरा करें या छोड़ें |
| Exam-day mode | Exam-day mode | परीक्षा-दिवस मोड |
| Exam-day caption | No pausing. Full screen. A reporting countdown like the real exam. | रुकना नहीं। फ़ुल स्क्रीन। असली परीक्षा जैसी रिपोर्टिंग उलटी गिनती। |
| DND hint | Turn on Do Not Disturb so calls and messages don't break your focus. | कॉल और मैसेज से ध्यान न भटके, इसके लिए 'डू नॉट डिस्टर्ब' चालू करें। |
| Open settings | Open settings | सेटिंग्स खोलें |
| Extra time | I need extra time | मुझे अतिरिक्त समय चाहिए |
| Continue | Continue to instructions | निर्देशों पर जाएँ |
| Download failed | Download stopped. [Try again] | डाउनलोड रुक गया। [फिर कोशिश करें] |

**Illustration slots:** None (runner look).
**States:**
- Downloading, ready, blocked (storage, other mock, live offline), download error.
- Paper already downloaded: the paper row is checked instantly.
- Exam-day mode on: the switch is on, DND hint visible.
- Guest and free: no change here (limits were checked on MOCK-02).
- Minor: unchanged.
- Dark mode: light runner look unless "Dark mode in mock tests" is on.

**Interaction and motion:** Rows tick with a simple check fade (`base`). No celebratory motion.
**Accessibility:** The checklist is a list with each status read after its label. Blocking rows are announced when they appear.
**Analytics:** `mock_preflight_done {mock_id, downloaded_bytes, exam_day_mode, battery_low}`.
**Web (≥ 600 px):** A centred 640 px card. Battery uses the Battery Status API only where available; otherwise the row is hidden. Exam-day mode requests Fullscreen when the student taps Continue (it needs a user gesture).
**Mock priority:** P1 · Phase 1

### MOCK-05 · General instructions
**Purpose:** Show the exam's general instructions and the palette legend, as the official instructions page does, before any time is used. **Main action:** [Next].
**Entry → exits:** MOCK-04 → MOCK-06, back (to MOCK-04).
**Layout (top to bottom):**
1. Header bar (`surfaceSunken`, 56 px): "{exam_name} practice mock" in `label`, "Instructions" in `heading`, and on the right "View in: {language}" select (instruction language only, from `blueprint.languages`). Under the bar, a one-line "Practise like the real exam" link to the official instructions (research A27).
2. Exam-day mode only: a reporting countdown strip "Paper opens in {mm:ss}".
3. Scrollable instructions body on `surface`, max 760 px: the blueprint's `instructions.{lang}` rendered as numbered paragraphs (`body`).
4. **Palette legend** block, generated from the exam's interface profile (blueprint `interface_profile`: which states exist, their labels and their colours, research A27). Each row is a Mock palette cell with a sample number and its shape, plus its meaning. The `mockPalette` tokens are used only for the `generic` profile or when a profile leaves colours unset. Shapes are always kept, so the state never rests on colour alone. Nothing about states or marking is hard-coded in the app.
5. Footer in `caption`: "Practice interface. Smriti is not affiliated with {conducting_body}."
6. Bottom bar: Button secondary [Back], Button primary 56 [Next].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Header | {exam_name} practice mock | {exam_name} प्रैक्टिस मॉक |
| Instructions | Instructions | निर्देश |
| View in | View in: {language} | भाषा: {language} |
| Paper opens | Paper opens in {mm:ss} | पेपर {mm:ss} में खुलेगा |
| Legend: not visited | You have not visited the question yet. | आपने यह सवाल अभी देखा नहीं है। |
| Legend: not answered | You have not answered the question. | आपने इस सवाल का उत्तर नहीं दिया है। |
| Legend: answered | You have answered the question. | आपने इस सवाल का उत्तर दे दिया है। |
| Legend: marked | You have not answered, but marked it for review. | उत्तर नहीं दिया, पर रिव्यू के लिए मार्क किया है। |
| Legend: answered and marked | You have answered and marked it for review. | उत्तर दिया और रिव्यू के लिए मार्क भी किया है। |
| Legend note, evaluated | Answered and marked questions will be evaluated. | उत्तर दिए और मार्क किए सवाल जाँचे जाएँगे। |
| Legend note, not evaluated | Answered and marked questions will not be evaluated. | उत्तर दिए और मार्क किए सवाल नहीं जाँचे जाएँगे। |
| Official link | Practise like the real exam: read the official instructions | असली परीक्षा जैसा अभ्यास: आधिकारिक निर्देश पढ़ें |
| Not affiliated | Practice interface. Smriti is not affiliated with {conducting_body}. | प्रैक्टिस इंटरफ़ेस। Smriti का {conducting_body} से कोई संबंध नहीं है। |
| Back | Back | पीछे |
| Next | Next | आगे |

**Illustration slots:** None. No logos of exam bodies anywhere.
**States:**
- Default.
- Exam-day mode: countdown strip; when it reaches zero, a banner "Paper is open. Tick the declaration to begin." and the timer starts per flow §6.4.
- Instruction language switched: the body re-renders; the scroll position resets to top.
- Text missing in the chosen language (blocked by `content-qa`): falls back to the other language with a note.
- Offline: works (instructions are in the paper download). The official link shows "Needs internet".
- Interface profile with fewer states (for example no "answered and marked"): the legend shows only the states the profile lists, and the evaluated note follows `marked_answer_evaluated`.
- Dark mode: light by default; dark only if "Dark mode in mock tests" (SET-07) is on.

**Interaction and motion:** None beyond scrolling and the select. [Next] is enabled immediately (some real interfaces require scrolling; we don't force it).
**Accessibility:** Instructions are a real ordered list. Legend rows read "{shape} {colour} cell: {meaning}" so the shape is described in words. The select has a label. Keyboard: Tab order header → body → legend → buttons.
**Analytics:** `mock_instructions_viewed {mock_id, page: 1, instruction_language}`.
**Web (≥ 600 px):** The official-style layout: header bar across the top, instructions in a bordered scroll box, a candidate panel on the right with the student's initials (never a pet avatar or mascot, R24) and the display name for adults, otherwise "Candidate", and the buttons bottom right.
**Mock priority:** P0 · Phase 1

### MOCK-06 · Paper instructions and declaration
**Purpose:** Set the default question language, confirm the paper's own rules, and take the declaration that starts the timer. **Main action:** [I am ready to begin].
**Entry → exits:** MOCK-05 → MOCK-07 or MOCK-08 (timer starts), back to MOCK-05.
**Layout (top to bottom):**
1. Header bar as MOCK-05, with "Other important instructions".
2. Paper rules (generated from the blueprint): sections and counts, section timers and navigation in plain words, attempt rules, marking per type, calculator, and how numerical answers are entered.
3. **Default question language** select: "Choose your default language" with options from `blueprint.languages`, defaulting to the last language this student chose for this exam (remembered per exam, research A28), else the app language. Caption "You can switch a single question's language during the paper." when `language_switch = per_question`; caption "The language stays the same for the whole paper." when `language_switch = fixed`.
4. **Declaration** card (`surfaceSunken`, radius `md`): a 24 px checkbox (48 px hit area) with "I have read and understood the instructions. I agree to follow them." Tapping the text toggles the box.
5. Bottom bar: Button secondary [Previous], Button primary 56 [I am ready to begin], disabled until the box is ticked and a language is chosen.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Other important instructions | अन्य ज़रूरी निर्देश |
| Sections line | {section_title}: {question_count} questions | {section_title}: {question_count} सवाल |
| Section timer line | {section_title} has its own {section_timer_min} minutes. It locks when time ends. | {section_title} के लिए अलग से {section_timer_min} मिनट हैं। समय ख़त्म होने पर यह बंद हो जाएगा। |
| Attempt any line | In {section_title}, only {attempt_any} answers count. | {section_title} में सिर्फ़ {attempt_any} उत्तर गिने जाएँगे। |
| Marking line | {type}: +{correct} for right, {wrong} for wrong, {unattempted} if left blank | {type}: सही पर +{correct}, गलत पर {wrong}, खाली छोड़ने पर {unattempted} |
| Numerical entry | Type numerical answers with the on-screen keypad. | संख्यात्मक उत्तर ऑन-स्क्रीन कीपैड से लिखें। |
| Language label | Choose your default language | अपनी डिफ़ॉल्ट भाषा चुनें |
| Language caption | You can switch a single question's language during the paper. | पेपर के दौरान किसी एक सवाल की भाषा बदली जा सकती है। |
| Language fixed caption | The language stays the same for the whole paper. | पूरे पेपर में भाषा एक ही रहेगी। |
| Declaration | I have read and understood the instructions. I agree to follow them. | मैंने निर्देश पढ़ और समझ लिए हैं। मैं इनका पालन करने के लिए सहमत हूँ। |
| Previous | Previous | पिछला |
| Begin | I am ready to begin | मैं शुरू करने के लिए तैयार हूँ |
| Tick first | Tick the declaration to begin. | शुरू करने के लिए घोषणा पर टिक करें। |
| Live, waiting | The paper opens at {start_time}. | पेपर {start_time} पर खुलेगा। |

**Illustration slots:** None.
**States:**
- Default (box unticked, begin disabled).
- Ticked: begin enabled.
- Exam-day mode: the countdown strip from MOCK-05 continues; at zero with the box ticked, the paper opens on its own; unticked, the strip turns `warningText` "Paper is open. Time is running." and time starts (flow §6.4).
- Live, before window: begin disabled with the waiting line; at `window_start` it enables.
- Free limit: no attempt is created and no count is used until [I am ready to begin] is tapped.
- Offline: works for downloaded non-live papers. The attempt is created locally (flow §6.2).
- Dark mode: as MOCK-05.

**Interaction and motion:** Checkbox toggles with a `fast` fill. Begin press: the screen cross-fades into the runner (`slow`), the timer appears already counting.
**Accessibility:** The checkbox and its label are one control. Begin's disabled state explains why ("Tick the declaration to begin"). Language select is labelled and announced with its options.
**Analytics:** `mock_instructions_viewed {page: 2}`, `mock_started {attempt_id, mock_id, kind, blueprint_id, time_policy, language, layout, interface}`.
**Web (≥ 600 px):** Same official-style layout as MOCK-05, the declaration above the buttons at the bottom of the scroll box. Space toggles the checkbox, Enter begins.
**Mock priority:** P0 · Phase 1

### MOCK-07 · Mock runner (phone)
**Purpose:** Let the student answer the paper on a phone exactly as the blueprint's rules require, with nothing else on screen. **Main action:** [Save & next].
**Entry → exits:** MOCK-06, MOCK-14 (resume) → MOCK-09, MOCK-10, MOCK-11, MOCK-12, MOCK-13 (section ends), MOCK-15 (back gesture or menu), MOCK-16 (Submit), MOCK-17 (time up).
**Layout (top to bottom):**
1. **Header** (`surface`, `line` bottom border, 56 px): menu icon (opens: Question paper, Instructions, Pause in practice policy, Leave mock); the Timer component centred ("{hh:mm:ss}", plus the sectional timer under it when the section has one); on the right the palette button (`SquaresFour` icon with "{answered}/{total}") and Submit (text button).
2. **Section tabs** row (scrollable), one tab per section, count badge "{answered}/{total}", lock icons on locked sections.
3. **Question header** (`surfaceSunken`, 44 px): "Question {n}" in `label`; question type in `caption` ("Single correct", "Numerical"); marking "+{marking.correct} / {marking.wrong}" (from the blueprint for this question's type); language toggle ("English ▾" / "हिन्दी ▾") only when the blueprint's `language_switch` is `per_question` in full and sectional mocks (research A28), and always in chapter mocks (practice, not a paper replica); tools: calculator (if allowed), rough work (`PencilLine`).
4. **Question area** (`surface`, scrolls): the stem, figures, then the answer area: option rows with a radio (or checkbox) and the option label "(A)", or the Numeric keypad and its answer field, or match and matrix grids. No cards with shadows; plain rows with `line` dividers, selected row with a 2 px `primary` border and a filled radio.
5. Optional confidence row, collapsed behind "How sure?" (hidden in Exam-day mode).
6. **Bottom bar** (`surface`, top `line` border, safe area): [Mark for review & next] (secondary), [Clear response] (ghost), [Save & next] (primary, all-exams blue). Above it, a slim row with [‹ Previous] and [Next ›] text buttons.

OMR mode (blueprint `mode = pen_paper`): the question header drops the palette states; the answer area shows OMR bubble rows ("(1) (2) (3) (4)" circles) under the stem; the bottom bar becomes [‹ Previous] [Clear] [Next ›]; the palette button opens the OMR sheet (MOCK-09 OMR variant); an optional private flag icon sits in the question header (hidden in Exam-day mode).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Question n | Question {n} | प्रश्न {n} |
| Single correct | Single correct | एक सही उत्तर |
| Multiple correct | One or more correct | एक या अधिक सही |
| Numerical | Numerical answer | संख्यात्मक उत्तर |
| Marking | +{correct} / {wrong} | +{correct} / {wrong} |
| Mark for review & next | Mark for review & next | रिव्यू के लिए मार्क करें और आगे |
| Clear response | Clear response | उत्तर हटाएँ |
| Save & next | Save & next | सेव करें और आगे |
| Previous / Next | Previous / Next | पिछला / अगला |
| Submit | Submit | सबमिट |
| Menu: question paper | Question paper | प्रश्न पत्र |
| Menu: instructions | Instructions | निर्देश |
| Menu: pause | Pause | रोकें |
| Menu: leave | Leave mock | मॉक छोड़ें |
| How sure | How sure? | कितना यक़ीन? |
| Answer field | Your answer | आपका उत्तर |
| Attempt counter | Answered {n} of {attempt_any} that count | गिने जाने वाले {attempt_any} में से {n} किए |
| Over attempt | Only {attempt_any} answers count in this section. Clear one to answer this. | इस सेक्शन में सिर्फ़ {attempt_any} उत्तर गिने जाते हैं। इसे करने के लिए कोई एक हटाएँ। |
| Unsaved tip (practice policy, once) | Not saved yet. Tap Save & next to keep your answer. | अभी सेव नहीं हुआ। उत्तर रखने के लिए 'सेव करें और आगे' दबाएँ। |
| Language missing | Not available in {language} | {language} में उपलब्ध नहीं |
| Offline banner | Offline. Your answers are saved on this phone. | ऑफ़लाइन हैं। आपके उत्तर इस फ़ोन में सेव हैं। |
| Battery banner | Battery low. Plug in if you can. Your answers are saved. | बैटरी कम है। हो सके तो चार्ज करें। आपके उत्तर सेव हैं। |
| Time warning | {minutes} min left | {minutes} मिनट बचे |
| Section time warning | {minutes} min left in {section_title} | {section_title} में {minutes} मिनट बचे |
| Away toast (strict) | The timer kept running while you were away ({m} min). | आपके दूर रहने पर भी टाइमर चलता रहा ({m} मिनट)। |
| Question load error | This question didn't load. | यह सवाल लोड नहीं हुआ। |
| OMR clear | Clear | मिटाएँ |
| OMR change (exam-day) | Real OMR sheets can't be changed. Change anyway? | असली OMR शीट में बदलाव नहीं होता। फिर भी बदलें? |

**Illustration slots:** None. Question figures are content.
**States:**
- Default.
- Answer selected but not saved: the selected row shows its selection; the palette still shows the previous state until saved (profile `save_requires_explicit_action`). Generic profile keeps the selection when moving away.
- Section locked: tabs of closed sections show a lock and open read-only palette views.
- Timer warning: Timer warning state + one-line banner under the header for 5 s.
- Offline: slim banner under the section tabs (`surfaceSunken`, `WifiSlash` icon), dismissible, comes back on each new offline period.
- Low battery: banner as above; autosave interval shortens.
- Practice policy, paused: the screen is covered by MOCK-14.
- Strict policy back from background: the away toast.
- Over attempt: inline message in the question header when the rule is `block`.
- Question failed to load: the error line with [Try again]; options still answerable if they loaded.
- OMR mode: as described in the layout.
- Language: the toggle is hidden when the blueprint sets `language_switch = fixed`; the default language came from MOCK-06.
- Signed in on two devices: if the attempt is opened on another device, this one shows MOCK-14's takeover state (flow §6.9).
- Guest, free, Pro, minor: no change inside the runner.
- Little learner: never reaches the runner.
- Dark mode: only when "Dark mode in mock tests" is on; uses dark neutrals and `mockPalette.dark` (flow §12.3).

**Interaction and motion:** No decorative motion. Question change: instant swap (no slide), so it feels like the real CBT. Horizontal swipe is off (accidental moves cost marks). Buttons scale 0.97 on press. Haptics: light on save and mark only; no sound. The screen stays awake. The Android back gesture opens MOCK-15.
**Accessibility:** Focus order: timer, section tabs, question header, stem, options, confidence, bottom bar. Timer is announced at warnings and section changes only; a "Read time left" action on the timer. Options are radios or checkboxes with the option label. Save results are announced ("Answer saved, question {n+1}"). Dynamic type up to 200%: the bottom bar stacks into two rows and the header timer stays visible. With a hardware keyboard on phones: same shortcuts as MOCK-08 (unless Exam-day mode).
**Analytics:** `mock_answer`, `mock_palette_visit {from: next|prev}`, `mock_language_switched`, `mock_tool_opened`, `mock_section_changed`, `mock_paused`, `mock_interrupted`.
**Web (≥ 600 px):** Uses MOCK-08 instead. Phone-width web uses this layout.
**Mock priority:** P0 · Phase 1

### MOCK-08 · Mock runner (CBT layout)
**Purpose:** Give tablet and web users a computer-based-test screen that mirrors the official one, with full keyboard support. **Main action:** [Save & next].
**Entry → exits:** MOCK-06, MOCK-14 → MOCK-10 (floating), MOCK-11 (side panel), MOCK-12, MOCK-13, MOCK-15, MOCK-16, MOCK-17. The palette (MOCK-09) is part of this screen.
**Layout (top to bottom):**
1. **Top bar** (`surfaceSunken`, 56 px): "{exam_name} practice mock" on the left; tools: "Question paper", "Instructions", calculator (if allowed), rough work; on the right the Timer ("Time left {hh:mm:ss}") and the sectional timer.
2. **Section tabs** row below, full width, with counts and lock icons, and the per-question language select at the far right ("View in: English ▾"), shown only when the blueprint's `language_switch` allows it (research A28).
3. **Main area, two columns:**
   - **Left (question panel, flexible, min 560 px):** question header ("Question {n}", type, marking "+{correct} / {wrong}"), the stem and figures, answer area (option rows with radios, or the Numeric keypad below the answer field, or grids). Optional confidence row at the bottom of the panel.
   - **Right (candidate and palette panel, 320 px fixed):** candidate block (initials in a neutral circle, never a pet avatar, R24; display name or "Candidate"); legend counts with the shapes of the states the interface profile lists ("{n} Answered", "{n} Not answered", ...); the section's palette grid (MOCK-09 content) in 5 or 6 columns of 40 × 40 cells with 8 px gaps; section name heading above the grid.
4. **Bottom bar** across the left column: [Save & next] (primary), [Save & mark for review], [Clear response], [Mark for review & next], then [‹ Back] [Next ›]; [Submit] at the bottom of the right panel. Below 1200 px window width, [‹ Back] and [Next ›] become icon-only buttons (`CaretLeft`, `CaretRight`, 48 px targets) with the accessible names "Previous question" and "Next question" and a tooltip, so the four action buttons keep their full labels on one row.
5. Keyboard shortcut hint line in `caption` under the bottom bar (hidden in Exam-day mode): "1–4 choose · N save & next · M mark & next · C clear · ← → move · P palette".

Portrait tablets (≥ 600 wide, taller than wide): the palette panel moves below the question as a collapsible drawer, open by default at ≥ 900 px height.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Header | {exam_name} practice mock | {exam_name} प्रैक्टिस मॉक |
| Time left | Time left {hh:mm:ss} | बचा समय {hh:mm:ss} |
| Candidate | Candidate | उम्मीदवार |
| Save & next | Save & next | सेव करें और आगे |
| Save & mark | Save & mark for review | सेव करें और रिव्यू के लिए मार्क करें |
| Clear response | Clear response | उत्तर हटाएँ |
| Mark & next | Mark for review & next | रिव्यू के लिए मार्क करें और आगे |
| Back / Next | Back / Next | पीछे / आगे |
| Back / Next, icon-only (a11y) | Previous question / Next question | पिछला सवाल / अगला सवाल |
| Submit | Submit | सबमिट |
| Legend counts | {n} Answered · {n} Not answered · {n} Not visited · {n} Marked · {n} Answered and marked | {n} उत्तर दिए · {n} उत्तर नहीं दिए · {n} नहीं देखे · {n} मार्क किए · {n} उत्तर दिए और मार्क किए |
| Shortcut hint | 1–4 choose · N save & next · M mark & next · C clear · ← → move · P palette | 1–4 चुनें · N सेव और आगे · M मार्क और आगे · C हटाएँ · ← → आगे-पीछे · P पैलेट |
| View in | View in: {language} | भाषा: {language} |
| Other tab | This mock is open in another tab. | यह मॉक दूसरे टैब में खुला है। |
| Use here | Use it here | यहाँ इस्तेमाल करें |
| Fullscreen left (exam-day) | You left full screen. [Go back to full screen] | फ़ुल स्क्रीन बंद हो गई। [फ़ुल स्क्रीन पर लौटें] |
| Shortcuts off (exam-day) | Mouse only, like the real exam. | सिर्फ़ माउस, असली परीक्षा की तरह। |

**Illustration slots:** None.
**States:**
- All MOCK-07 states apply (offline, battery, warnings, locked sections, over attempt, load error, OMR mode).
- OMR mode on tablet and web: left column is the booklet page; the right panel shows the OMR sheet (bubble rows) instead of the CBT palette.
- Exam-day mode: shortcuts off; full screen requested; leaving full screen shows the notice bar (nothing is logged beyond a count in the attempt's local state).
- Another tab opened (web): the second tab shows "This mock is open in another tab" with [Use it here]; using it makes the first tab read-only.
- Window narrower than 600 or shorter than 480 (resized): switches to MOCK-07 without losing state.
- Dark mode: as MOCK-07.

**Interaction and motion:** No decorative motion. Clicking a palette cell jumps instantly. Keyboard: 1–4 (or A–D) select options, Space toggles in multi-select, digits and "." "-" Backspace type into numerical fields, N save & next (UX_FLOW §4.17), M mark for review & next, Shift+N save & mark for review, C clear, ← → previous and next without saving, P focuses the palette, Esc closes tools. Shortcuts never fire while focus is in a text field (rough-work notes). Tab order follows the layout.
**Accessibility:** Full keyboard operation (UX_FLOW §7). The palette grid is a grid role with arrow-key navigation; each cell reads "Question {n}, {state}". Focus rings use 2 px `primary` with a 2 px offset. Zoom to 200% switches to MOCK-07 when the layout no longer fits.
**Analytics:** As MOCK-07, with `layout: cbt`, plus `mock_palette_visit {from: palette}`.
**Web (≥ 600 px):** This is the web and tablet layout. Desktop ≥ 1024: the question panel caps its text at 760 px for line length; the right panel stays 320 px.
**Mock priority:** P0 · Phase 1

### MOCK-09 · Question palette (and OMR sheet)
**Purpose:** Show the state of every question with colour and shape, and jump to any question the rules allow. **Main action:** tap a question cell.
**Entry → exits:** MOCK-07 palette button (sheet), part of MOCK-08 (fixed panel) → the chosen question in MOCK-07 / MOCK-08, MOCK-16 (Submit at the bottom of the sheet).
**Layout (top to bottom):**
1. Sheet at 60%, expandable to full, grabber; title "Questions" and the Timer (small) on the right.
2. Section selector (tabs) when sections are free to switch; locked sections show a lock and a read-only grid.
3. Legend: one row per state that the exam's interface profile lists (five in NTA-style CBTs), or a compact 2-column legend, each with the Mock palette cell shape and its count ("{n}"). Labels and colours come from the interface profile (research A27); `mockPalette` is the `generic` default.
4. The grid: Mock palette cells, 40 × 40 visual inside a 48 × 48 hit area, 6 columns on phones (5 at 200% type), question numbers in `label` with the text colour the profile gives each state (`mockPalette.*.text` for `generic`). The current question has a 2 px `ink` outer ring.
5. Filter chips (optional, phones): All · Not answered · Marked · Not visited.
6. Button secondary 56 [Submit] at the bottom.

OMR variant: rows "{n}" followed by OMR bubble rows; filled bubbles show the chosen option; flagged questions show a small flag icon at the row end. No five-state legend; the legend reads "Filled" and "Blank".

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Questions | प्रश्न |
| Not visited | Not visited | नहीं देखे |
| Not answered | Not answered | उत्तर नहीं दिए |
| Answered | Answered | उत्तर दिए |
| Marked | Marked for review | रिव्यू के लिए मार्क |
| Answered and marked | Answered and marked for review | उत्तर दिए और रिव्यू के लिए मार्क |
| Filter all | All | सभी |
| Section locked | This section is closed. | यह सेक्शन बंद है। |
| Section not open yet | This section opens after {section_title}. | यह सेक्शन {section_title} के बाद खुलेगा। |
| OMR filled | Filled | भरे हुए |
| OMR blank | Blank | ख़ाली |
| Submit | Submit | सबमिट |

**Illustration slots:** None.
**States:**
- Default (current section).
- Locked section: grid greyed (`inkDisabled` numbers, cells keep their shapes), with the locked line; cells not tappable.
- Not-yet-open section (locked in order): placeholder grid with the not-open line.
- Filtered: only matching cells, with their real numbers.
- OMR variant.
- Dark mode: `mockPalette.dark` once added; until then the palette stays on light cells even in dark mode (contrast is guaranteed only for the light set).

**Interaction and motion:** Tapping a cell jumps and closes the sheet (phone). Instant, no animation. Long-press a cell on phones previews the first line of the question (optional, P2).
**Accessibility:** Each cell: "Question {n}, {state}". Shapes carry the state for colour-blind users (DESIGN.md §2.4): square, pentagon down, pentagon up, circle, circle with tick. The current question is announced as "current". Legend counts are live-updated text. Grid role with arrow keys on keyboards.
**Analytics:** `mock_tool_opened {tool: palette}`, `mock_palette_visit {from: palette}`.
**Web (≥ 600 px):** Fixed right panel inside MOCK-08 (no sheet). Filter chips hidden (the full legend with counts is always visible).
**Mock priority:** P0 · Phase 1

### MOCK-10 · Calculator
**Purpose:** Give the on-screen calculator the exam allows, and only when it allows one. **Main action:** calculate, then close.
**Entry → exits:** MOCK-07 / MOCK-08 question header or top bar (only when `blueprint.calculator` is `basic` or `scientific`) → back to the same question.
**Layout (top to bottom):**
1. Phone: sheet at 60% with grabber. Tablet and web: a floating window (320 × 440 basic, 420 × 480 scientific), draggable by its title bar, always on top, never covering the timer.
2. Title bar: "Calculator", [Close].
3. Display: two lines, the expression in `caption` and the result in `title`, tabular figures, right-aligned, `surfaceSunken`.
4. Keys (48 × 48 min, `surfaceRaised` with `line` border, `label` text):
   - Basic: 0–9, decimal, +, −, ×, ÷, =, %, √, ±, 1/x, MC, MR, MS, M+, M−, C, CE, backspace.
   - Scientific adds: sin, cos, tan and inverses, log, ln, xʸ, x², eˣ, 10ˣ, π, e, brackets, n!, a Deg/Rad toggle.
5. The exact key set per exam comes from the interface profile when encoded (flow §6.5); the lists above are the generic defaults.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Calculator | कैलकुलेटर |
| Close | Close | बंद करें |
| Deg / Rad | Deg / Rad | डिग्री / रेडियन |
| Error | Can't calculate that | यह गणना नहीं हो सकती |
| Memory set | M | M |

**Illustration slots:** None.
**States:** Default; error (division by zero, domain error) shows the error line in the display; memory indicator "M" when memory holds a value; dark mode (runner rule). Memory and display clear when the mock is submitted. The calculator keeps its value across questions within an attempt, like a real one.
**Interaction and motion:** Keys press 0.97 with a light haptic. No sounds. Web: the physical keyboard types into the calculator while it has focus (digits, operators, Enter, Backspace, Esc closes), unless the interface profile disables it.
**Accessibility:** Every key has a spoken label ("square root", "memory recall"). The display is a live region announcing results. The window can be moved by keyboard (Alt+arrows) on web.
**Analytics:** `mock_tool_opened {tool: calculator}`. No values or expressions are ever logged.
**Web (≥ 600 px):** Floating window as above.
**Mock priority:** P1 · Phase 1

### MOCK-11 · Rough-work pad
**Purpose:** Give space to work things out, private to the device. **Main action:** draw or type, then close.
**Entry → exits:** MOCK-07 / MOCK-08 rough-work tool → back to the question. Later shown in MOCK-22 on the same device.
**Layout (top to bottom):**
1. Phone: full-screen overlay with a compact header that keeps the Timer visible. Tablet and web: a resizable side panel (360 px default) to the right of the question panel, pushing the palette into a drawer while open.
2. Header: "Rough work · Q{n}", page switcher ("This question" · "Free page"), [Close].
3. Tool row: Pen, Highlighter, Eraser, Undo, Redo, Clear page, Type (switches to a text area).
4. Canvas on `surface` with a faint `line` grid (8 px squares at 12% opacity). Finger, stylus and mouse input. Palm rejection on tablets with a stylus.
5. Text mode: a plain text area, `body` font.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Rough work · Q{n} | रफ़ काम · प्र.{n} |
| This question | This question | यह सवाल |
| Free page | Free page | ख़ाली पन्ना |
| Pen / Highlighter / Eraser | Pen / Highlighter / Eraser | पेन / हाइलाइटर / रबर |
| Undo / Redo | Undo / Redo | पहले जैसा / फिर से |
| Clear page | Clear page | पन्ना साफ़ करें |
| Clear confirm | Clear this page? | यह पन्ना साफ़ करें? |
| Type | Type | टाइप करें |
| Private note | Only on this device. Never uploaded. | सिर्फ़ इस डिवाइस पर। कभी अपलोड नहीं होता। |
| Close | Close | बंद करें |

**Illustration slots:** None.
**States:** Empty page; with strokes; text mode; storage full (strokes kept in memory for this session, with a caption "Can't save rough work. Free some space."); dark mode (runner rule; ink colour switches to `ink` dark). Exam-day mode: unchanged (real exams give rough sheets).
**Interaction and motion:** Drawing is direct, 60 fps, no smoothing animation. Two-finger pan and pinch zoom on the canvas. Opening and closing: instant on phone, `base` slide for the side panel (none in reduced motion).
**Accessibility:** The canvas is labelled "Rough work drawing area"; text mode is the accessible alternative and is offered first to screen-reader users. Tool buttons have labels and pressed states.
**Analytics:** `mock_tool_opened {tool: rough_work}` only. Strokes and text never leave the device and are never logged (AGENTS.md rule 6).
**Web (≥ 600 px):** Side panel as above. Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo; shortcuts of the runner are off while the text area has focus.
**Mock priority:** P1 · Phase 1

### MOCK-12 · Question paper view
**Purpose:** Let the student scan all questions of the open section at once, as the official "Question paper" button does. **Main action:** jump to a question.
**Entry → exits:** MOCK-07 menu, MOCK-08 top bar → the chosen question, close.
**Layout (top to bottom):**
1. Full-screen overlay (phone) or a large modal (tablet and web, 80% of the window) with the Timer visible in its header.
2. Section tabs (open sections only).
3. A scrolling list of every question in the section: "Question {n}" and the full stem (options collapsed under "Show options"), each with its palette shape and state at the left.
4. [Close] at the top right.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Question paper | प्रश्न पत्र |
| Show options | Show options | विकल्प दिखाएँ |
| Go to question | Go to question {n} | प्रश्न {n} पर जाएँ |
| Close | Close | बंद करें |

**Illustration slots:** None.
**States:** Default; locked sections not shown; long papers render progressively (virtualised list); dark mode per runner rule. Opening a question here counts as a visit (it moves "not visited" to "not answered", as in the CBT) only when the student jumps to it, not when they scroll past it.
**Interaction and motion:** Instant jumps. Scroll position is kept per section while the attempt lasts.
**Accessibility:** Each item is a heading plus the stem text; "Go to question {n}" buttons. Shapes described in words.
**Analytics:** `mock_tool_opened {tool: question_paper}`, `mock_palette_visit {from: paper_view}`.
**Web (≥ 600 px):** Modal as above.
**Mock priority:** P2 · Phase 1

### MOCK-13 · Section change
**Purpose:** Tell the student plainly that a section's time ended and the next section has opened. **Main action:** none needed; it continues on its own.
**Entry → exits:** MOCK-07 / MOCK-08 when a sectional timer reaches zero (locked or timed navigation) or the student submits a section early (if the blueprint allows) → the next section's first question; MOCK-17 after the last section.
**Layout (top to bottom):**
1. Full-screen modal on `surface` (runner look), centred card max 480 px.
2. `Lock` icon (32 px, `ink`), title "{section_title} is closed".
3. Line: "Your answers in it are saved. {next_section_title} is open now."
4. Summary row for the closed section: "{answered} answered · {marked} marked · {not_answered} not answered".
5. Progress text "Continuing in {s}…" and Button primary [Start {next_section_title}].

Early submit variant (blueprint `early_section_submit` true): a confirm first, "Submit {section_title} and move on? You can't come back to it." with [Go back] and [Submit section].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | {section_title} is closed | {section_title} बंद हो गया |
| Line | Your answers in it are saved. {next_section_title} is open now. | इसके उत्तर सेव हैं। अब {next_section_title} खुला है। |
| Summary | {answered} answered · {marked} marked · {not_answered} not answered | {answered} उत्तर दिए · {marked} मार्क किए · {not_answered} उत्तर नहीं दिए |
| Continuing | Continuing in {s}… | {s} सेकंड में अगला सेक्शन… |
| Start next | Start {next_section_title} | {next_section_title} शुरू करें |
| Early confirm | Submit {section_title} and move on? You can't come back to it. | {section_title} सबमिट करके आगे बढ़ें? इस पर वापस आना संभव नहीं होगा। |
| Go back | Go back | वापस जाएँ |
| Submit section | Submit section | सेक्शन सबमिट करें |

**Illustration slots:** None.
**States:** Time-ended; early submit confirm; offline (no change, all local); dark mode per runner rule. The next section's timer starts when this modal closes, either on the button or after the countdown (`{mock.section_transition_s}` owner flag; the 3-second minimum display in flow §6.8 applies).
**Interaction and motion:** Appears instantly (no animation in the runner). Medium haptic once. No sound.
**Accessibility:** Announced as an alert with the title and line. Focus moves to the start button. The auto-continue countdown is announced once, not every second.
**Analytics:** `mock_section_changed {section_code, reason}`.
**Web (≥ 600 px):** Same centred modal over the CBT layout.
**Mock priority:** P1 · Phase 1

### MOCK-14 · Paused and resume
**Purpose:** Bring the student safely back into a mock after a pause, a call, a crash or a switch of device, with the time shown honestly. **Main action:** [Resume].
**Entry → exits:** MOCK-07 / MOCK-08 menu Pause (practice policy), app returning from background (practice policy), ENT-01 splash after a crash or kill, PRC-01 / MOCK-01 resume card, another device's takeover → MOCK-07 / MOCK-08 at the last question, MOCK-17 (deadline passed under strict or live), MOCK-15 (Leave).
**Layout (top to bottom):**
1. Full screen, runner look. The question area is hidden.
2. `PauseCircle` (paused) or `ArrowCounterClockwise` (resume after crash) icon, 32 px.
3. Title: "Mock paused" or "Pick up where you left off".
4. Facts: "{mock_title}", "Time left: {hh:mm:ss}", "{answered} of {total} answered", "Last saved {time}".
5. Strict or live note when relevant: "The timer kept running while you were away."
6. Takeover note when relevant: "Started on {device_label}. Continue here?" with the line "Your answers saved at {time} come with you." (`{device_label}` is "your phone", "your tablet" or "your laptop", never a device name or model; research A30).
7. Button primary 56 [Resume], Button ghost [Leave mock].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Paused | Mock paused | मॉक रुका हुआ है |
| Resume after crash | Pick up where you left off | जहाँ छोड़ा था, वहीं से शुरू करें |
| Time left | Time left: {hh:mm:ss} | बचा समय: {hh:mm:ss} |
| Answered | {answered} of {total} answered | {total} में से {answered} उत्तर दिए |
| Last saved | Last saved {time} | आख़िरी बार {time} पर सेव हुआ |
| Strict note | The timer kept running while you were away. | आपके दूर रहने पर भी टाइमर चलता रहा। |
| Takeover | Started on {device_label}. Continue here? | {device_label} पर शुरू किया था। यहाँ जारी रखें? |
| Takeover line | Your answers saved at {time} come with you. | {time} तक सेव हुए आपके उत्तर यहाँ भी मिलेंगे। |
| Device: phone / tablet / laptop | your phone / your tablet / your laptop | आपके फ़ोन / आपके टैबलेट / आपके लैपटॉप |
| Continue here | Continue here | यहाँ जारी रखें |
| Read-only (old device) | You continued this mock on another device. | आपने यह मॉक दूसरे डिवाइस पर जारी रखा। |
| Resume | Resume | जारी रखें |
| Leave | Leave mock | मॉक छोड़ें |
| Paused count | Paused {count} times so far | अब तक {count} बार रुका |

**Illustration slots:** None.
**States:**
- Manual pause (practice): title "Mock paused", paused count line.
- Background return (practice): same, without the count increasing for very short gaps under `{mock.pause_ignore_s}` (owner flag), so a notification glance doesn't count as a pause.
- Crash or kill: "Pick up where you left off".
- Strict or live, deadline not passed: strict note, remaining time from the deadline.
- Strict or live, deadline passed: skip this screen, go to MOCK-17.
- Device takeover: takeover note and [Continue here] instead of [Resume]. The old device shows the read-only line with [See the mock] (opens MOCK-18 once submitted).
- Local data missing (app reinstalled): the server copy is loaded (needs internet); offline shows "Connect to the internet to resume this mock."
- Dark mode: runner rule.

**Interaction and motion:** None decorative. Resume: the question appears instantly and the timer continues.
**Accessibility:** Title announced on open; facts are plain text; focus on [Resume].
**Analytics:** `mock_paused {reason}`, `mock_resumed {paused_ms}`, `mock_interrupted {kind}`.
**Web (≥ 600 px):** Same content centred in a 560 px card over the hidden CBT layout. A tab closed and reopened lands here.
**Mock priority:** P1 · Phase 1

### MOCK-15 · Leave mock
**Purpose:** Prevent leaving a mock by accident, and make the choices clear. **Main action:** [Keep going].
**Entry → exits:** Android back, iOS swipe-back (disabled in the runner, so only the menu), MOCK-07 / MOCK-08 menu, MOCK-14 → back to the runner, MOCK-01 (leave and keep for later, practice policy), MOCK-16 (submit now), discard → MOCK-01.
**Layout (top to bottom):**
1. Sheet at 40% (phone) or a dialog (web).
2. Title "Leave this mock?".
3. Explanation by policy: practice "Your answers and time are saved. You can come back to it." / strict and live "The timer keeps running. Come back before it ends." Signed-in students also see the leave sync note (research A30); guests' attempts stay on this device.
4. Buttons: primary [Keep going], secondary [Submit now], ghost [Leave for now] (practice only), destructive text button [Discard this attempt] with a confirm.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Leave this mock? | मॉक छोड़ें? |
| Practice line | Your answers and time are saved. You can come back to it. | आपके उत्तर और समय सेव हैं। बाद में यहीं से जारी रखा जा सकता है। |
| Strict line | The timer keeps running. Come back before it ends. | टाइमर चलता रहेगा। समय ख़त्म होने से पहले लौट आइए। |
| Keep going | Keep going | जारी रखें |
| Submit now | Submit now | अभी सबमिट करें |
| Leave for now | Leave for now | अभी के लिए छोड़ें |
| Discard | Discard this attempt | यह प्रयास हटा दें |
| Discard confirm | Discard? Your answers in this attempt will be deleted. | हटाएँ? इस प्रयास के आपके उत्तर मिट जाएँगे। |
| Discard free note | This still counts as this week's free sectional mock. | यह फिर भी इस हफ़्ते का फ़्री सेक्शनल मॉक गिना जाएगा। |
| Leave sync note | Saved to your account. You can continue on any device you sign in to. | आपके अकाउंट में सेव है। साइन इन करके किसी भी डिवाइस पर जारी रखा जा सकता है। |

**Illustration slots:** None.
**States:** Practice, strict, live (no discard for live: a live attempt can only be submitted or left to auto-submit), free user discard note (when the refund grace doesn't apply, flow §4.1), dark mode per runner rule.
**Interaction and motion:** Sheet `slow`. No haptics except warning haptic on the discard confirm.
**Accessibility:** Focus on [Keep going]. The destructive action is last in focus order and needs a confirm.
**Analytics:** `mock_paused {reason: manual}` when leaving for now; `mock_submit_opened` when Submit now; a `mock_submitted` never fires for discards (status becomes `abandoned`, a learning event `mock_abandoned {attempt_id}` is logged).
**Web (≥ 600 px):** A 480 px dialog. Closing the browser tab shows the browser's own "Leave site?" prompt while a mock is open.
**Mock priority:** P2 · Phase 1

### MOCK-16 · Submit confirmation
**Purpose:** Show the attempt summary per section, as the official exam does, before the final submit. **Main action:** [Submit].
**Entry → exits:** MOCK-07 / MOCK-08 Submit, MOCK-09 Submit, MOCK-15 Submit now → MOCK-18, back to the runner ([Go back]).
**Layout (top to bottom):**
1. Full-screen modal, runner look, title "Submit your answers?", the Timer still running in the header.
2. Summary table, one row per section and a total row. Columns: Section · Questions · then one column per palette state the interface profile lists, in its order and with its labels (for example Answered · Not answered · Marked for review · Answered and marked · Not visited, when the profile has all five). Column headers carry the palette shapes. On phones (below 600 px) the state columns use shape-only headers (the palette cell shape with no text, each with its full label as the accessible name) and a legend row under the table maps each shape to its label, so the table fits without scrolling; if it still doesn't fit, it scrolls horizontally with the section column frozen.
3. Evaluation note: "Answered and marked questions will be evaluated." or "...will not be evaluated." (from the interface profile).
4. Locked-section note when relevant: "{section_title} is already closed."
5. Warning line when not visited or not answered counts are above zero: "{n} questions have no answer."
6. Buttons: secondary [Go back], primary 56 [Submit].
7. Second confirm (dialog): "Are you sure? You can't change answers after this." [No] [Yes, submit].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Submit your answers? | अपने उत्तर सबमिट करें? |
| Section | Section | सेक्शन |
| Questions | Questions | प्रश्न |
| Answered | Answered | उत्तर दिए |
| Not answered | Not answered | उत्तर नहीं दिए |
| Marked | Marked for review | रिव्यू के लिए मार्क |
| Answered and marked | Answered and marked | उत्तर दिए और मार्क |
| Not visited | Not visited | नहीं देखे |
| Total | Total | कुल |
| Evaluated note | Answered and marked questions will be evaluated. | उत्तर दिए और मार्क किए सवाल जाँचे जाएँगे। |
| Not evaluated note | Answered and marked questions will not be evaluated. | उत्तर दिए और मार्क किए सवाल नहीं जाँचे जाएँगे। |
| Locked note | {section_title} is already closed. | {section_title} पहले ही बंद हो चुका है। |
| No answer warning | {n} questions have no answer. | {n} सवालों का कोई उत्तर नहीं है। |
| Go back | Go back | वापस जाएँ |
| Submit | Submit | सबमिट करें |
| Confirm | Are you sure? You can't change answers after this. | पक्का सबमिट करें? इसके बाद उत्तर बदले नहीं जा सकते। |
| No / Yes | No / Yes, submit | नहीं / हाँ, सबमिट करें |

**Illustration slots:** None.
**States:** Default; all answered (no warning line); locked sections; time runs out while this is open (goes straight to MOCK-17 with the same answers); offline (submit works, see MOCK-18); OMR mode (columns: Filled, Blank, Flagged); dark mode per runner rule.
**Interaction and motion:** No motion. The two-step confirm matches common CBT practice and prevents accidental submits.
**Accessibility:** A real table with header cells; shapes in headers have text. The confirm dialog traps focus and defaults to [No].
**Analytics:** `mock_submit_opened {answered, marked, not_visited}`, `mock_submitted {auto: false, offline}`.
**Web (≥ 600 px):** A centred modal, max 900 px, table without scrolling. Enter does not submit (avoids accidents); the buttons must be clicked or focused and activated.
**Mock priority:** P0 · Phase 1

### MOCK-17 · Time up
**Purpose:** Tell the student the time is over and the answers were submitted for them. **Main action:** [See my report].
**Entry → exits:** MOCK-07 / MOCK-08 at zero, MOCK-13 after the last section, MOCK-14 when a strict or live deadline passed while away → MOCK-18.
**Layout (top to bottom):**
1. Full-screen modal, runner look, `Timer` icon.
2. Title "Time's up".
3. Line "Your answers were submitted." with the answered count "{answered} of {total} answered".
4. Line when away: "Time ran out while you were away. We submitted the answers saved before the end."
5. Button primary 56 [See my report].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Time's up | समय समाप्त |
| Line | Your answers were submitted. | आपके उत्तर सबमिट हो गए। |
| Count | {answered} of {total} answered | {total} में से {answered} उत्तर दिए |
| Away | Time ran out while you were away. We submitted the answers saved before the end. | आपके दूर रहते समय ख़त्म हो गया। समय से पहले सेव हुए उत्तर सबमिट कर दिए गए। |
| See report | See my report | मेरी रिपोर्ट देखें |

**Illustration slots:** None.
**States:** Normal time up; away time up; offline (button leads to MOCK-18 offline state); dark mode per runner rule. Not dismissable by back or swipe.
**Interaction and motion:** Appears instantly. Medium haptic once.
**Accessibility:** Announced as an alert. Focus on the button.
**Analytics:** `mock_submitted {auto: true, offline}`.
**Web (≥ 600 px):** Centred modal. Leaves full screen if Exam-day mode had entered it.
**Mock priority:** P1 · Phase 1

### MOCK-18 · Submitted
**Purpose:** Bridge from submitting to the report, honestly, whether online or offline. **Main action:** wait, then open the report automatically.
**Entry → exits:** MOCK-16, MOCK-17 → MOCK-19 (when ready), MOCK-01 / PRC-01 ([Done] while offline), local notification "Your mock report is ready" → MOCK-19 (NTF-01 `report_ready`, a local exam alert that the student caused, outside the daily reminder volume of R34).
**Layout (top to bottom):**
1. Full screen. This is the last runner-look screen: plain, no pet.
2. `CheckCircle` icon in `successText`, title "Submitted".
3. Online: a spinner line "Working out your score…" (scoring usually takes seconds).
4. Offline: "Your answers are safe on this phone. Your report will be ready when you're back online." and a [Done] button. A local notification is scheduled for when the outbox sends.
5. Live mocks: "Your score is ready now. Ranks come out at {results_at}." and [See my score].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Submitted | सबमिट हो गया |
| Scoring | Working out your score… | आपका स्कोर निकाला जा रहा है… |
| Offline | Your answers are safe on this phone. Your report will be ready when you're back online. | आपके उत्तर इस फ़ोन में सुरक्षित हैं। ऑनलाइन होते ही आपकी रिपोर्ट तैयार हो जाएगी। |
| Done | Done | हो गया |
| Live | Your score is ready now. Ranks come out at {results_at}. | आपका स्कोर तैयार है। रैंक {results_at} पर आएँगी। |
| See score | See my score | मेरा स्कोर देखें |
| Slow | This is taking longer than usual. We'll notify you when it's ready. | आज थोड़ा ज़्यादा समय लग रहा है। तैयार होते ही हम बताएँगे। |
| Report ready (notification) | Your mock report is ready. | आपकी मॉक रिपोर्ट तैयार है। |

**Illustration slots:** None.
**States:** Online scoring; slow scoring (after `{mock.report_wait_s}`, show the slow line and [Done]); offline; live; error (submit rejected for a reason other than network, for example the deadline: "We couldn't submit late answers. Answers saved before {deadline} were submitted."); dark mode per runner rule.
**Interaction and motion:** Spinner only (static "…" in reduced motion). Auto-advance to MOCK-19 when ready.
**Accessibility:** Status text is a live region. Focus on the title, then [Done] when present.
**Analytics:** `mock_submitted` (already sent), `mock_report_viewed` once MOCK-19 opens.
**Web (≥ 600 px):** Centred card. The web app needs the tab open or the PWA installed to get the "ready" notification; otherwise the report shows on next visit in MOCK-25 with a "New" chip.
**Mock priority:** P1 · Phase 1

### MOCK-19 · Mock report
**Purpose:** Show how the mock went, from real scores, and turn the biggest losses into a drill. **Main action:** [Fix next] (start the drill for the top lost concepts).
**Entry → exits:** MOCK-18, MOCK-25, MOCK-02, PRC-10, PRC-01 recent, report-ready local notification (NTF-01 `report_ready`) → MOCK-20, MOCK-21, MOCK-22, MOCK-23, MOCK-24 (Phase 3), PRC-03 (Fix next), PRC-14 ("See all analytics"), PRC-17 / PAY-01 paywall (locked sections, trigger `analytics_lock`), SET-13 (under 13), MEM-03 review session (cards added to the queue), SOC-15 duel setup ("Challenge a friend", Phase 2), back.
**Layout (top to bottom):**
1. Header: back, "{mock_title}", "Attempt {n} · {date}", kebab (Retake, Share score: P2).
2. **Three lead tiles** (research A29, free for everyone): Score "{score} / {max_score}" (Score ring), Accuracy "{accuracy}%" ("{correct} of {attempted} right"), and Time lost on wrong answers "{m} min" (time spent on questions answered wrong). The report is time-focused from the first screen.
3. **Score block** (`surface`, radius `cardLarge`): Stat tiles "Percentile {percentile}" and "Rank {rank} of {ranked_count}" when the `mock.min_attempts_for_percentile` threshold is met and this is the first attempt (R26), else one tile with the threshold line or the first-attempt line. No predicted rank (R26). Lines below: "{correct} right · {wrong} wrong · {skipped} skipped", "Time used {h:mm} of {duration}". Qualifying line when the paper is qualifying: "Qualifying mark: {qualifying_rule}. You {met or did not meet} it." Pause line under practice policy: "Paused {count} times · {minutes} min". Streak line when this mock completed a section: the `Plant` (fill) icon and "Your plant got its water today." (R1).
4. **Sections and subjects card:** one bar per subject (subject `strong`) or section (neutral `ink` bars for non-subject sections like "Section B"), each with "{marks}/{max}" and "{accuracy}% right". Negative marks shown as a bar to the left of zero with a minus label.
5. **Time analysis tiles** (3 across): "Right but slow {n}", "Fast and wrong {n}", "Lucky guesses {n}", and a fourth "Time on skipped {m} min". Tap → MOCK-20.
6. **Time per question strip:** the Time strip component across all questions, sections separated by gaps and labelled; a dashed line for the target time; tap a bar → MOCK-22 at that question.
7. **Concept heat map preview:** the top 8 chapters as Heat map cells; [See all] → MOCK-21.
8. **Confidence card:** three rows Sure / 50:50 / Guess (R21) with "{correct} of {n} right" (only if the student used the confidence row; else hidden).
9. **Fix next card** (`primaryTint`): pet line, up to `{report.fix_next_count}` rows "{concept_name} · lost {marks} marks", Button primary 56 [Fix next: {n}-question drill] (PRC-03 with `concepts[]`, `source: mock_report`), and a confirmation line "{n} cards added to your reviews" with [Undo]. The cards join the MEM-03 review queue (memory-labs request). On phones (below 600 px) the button is pinned as the bottom CTA for the whole scroll instead of sitting in the card, so the main action is always visible; the card keeps its rows and the confirmation line. When the report has no Fix next rows, nothing is pinned.
10. **Solutions** entry row: "Review solutions" with counts "{wrong} wrong · {skipped} skipped · {marked} marked" → MOCK-22.
11. **More:** rows for "Compare with past attempts" (MOCK-23, when there's a previous attempt), "Compare with the top 10%" (MOCK-23 top 10% scope, Pro, shown only above the threshold), "Leaderboard" (MOCK-24, live mocks, Phase 3), "Challenge a friend" (SOC-15, Phase 2, signed-in and consented), "See all analytics" (PRC-14).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Attempt line | Attempt {n} · {date} | प्रयास {n} · {date} |
| Score tile | Score | स्कोर |
| Accuracy tile | Accuracy | सटीकता |
| Accuracy meta | {correct} of {attempted} right | {attempted} में से {correct} सही |
| Time lost tile | Time lost on wrong answers | गलत उत्तरों पर गया समय |
| Time lost value | {m} min | {m} मिनट |
| First attempt line | Rank and percentile use your first attempt only. | रैंक और पर्सेंटाइल सिर्फ़ पहले प्रयास से निकलते हैं। |
| See first attempt | See first attempt | पहला प्रयास देखें |
| Streak line | Your plant got its water today. | आज आपके पौधे को पानी मिल गया। |
| Top 10% | Compare with the top 10% | टॉप 10% से तुलना करें |
| Challenge a friend | Challenge a friend | किसी दोस्त को चुनौती दें |
| Ask a grown-up | Ask a grown-up | किसी बड़े से पूछें |
| Score | {score} / {max_score} | {score} / {max_score} |
| Percentile | Percentile {percentile} | पर्सेंटाइल {percentile} |
| Rank | Rank {rank} of {ranked_count} | {ranked_count} में रैंक {rank} |
| Threshold | Rank and percentile appear once {min} students have taken this mock. {count} so far. | {min} छात्रों के मॉक देने पर रैंक और पर्सेंटाइल दिखेंगे। अब तक {count}। |
| Counts line | {correct} right · {wrong} wrong · {skipped} skipped | {correct} सही · {wrong} गलत · {skipped} छोड़े |
| Time used | Time used {used} of {duration} | {duration} में से {used} समय लगा |
| Qualifying met | Qualifying mark: {qualifying_rule}. You met it. | क्वालिफ़ाइंग अंक: {qualifying_rule}। आपने इसे पा लिया। |
| Qualifying not met | Qualifying mark: {qualifying_rule}. Not met this time. | क्वालिफ़ाइंग अंक: {qualifying_rule}। इस बार यह अंक नहीं मिला। |
| Paused line | Paused {count} times · {minutes} min | {count} बार रुका · {minutes} मिनट |
| Sections and subjects | Sections and subjects | सेक्शन और विषय |
| Section meta | {marks}/{max} · {accuracy}% right | {marks}/{max} · {accuracy}% सही |
| Right but slow | Right but slow | सही पर धीमे |
| Fast and wrong | Fast and wrong | तेज़ पर गलत |
| Lucky guesses | Lucky guesses | किस्मत से सही |
| Time on skipped | Time on skipped | छोड़े सवालों पर समय |
| Time strip title | Time on each question | हर सवाल पर लगा समय |
| Target line | Target time | लक्ष्य समय |
| Heat map title | Chapters at a glance | अध्याय एक नज़र में |
| Confidence title | How sure vs how right | यक़ीन बनाम सही उत्तर |
| Confidence row | {label}: {correct} of {n} right | {label}: {n} में से {correct} सही |
| Fix next title | Fix next | अब इसे सुधारें |
| Fix row | {concept_name} · lost {marks} marks | {concept_name} · {marks} अंक गए |
| Fix button | Fix next: {n}-question drill | सुधारें: {n} सवालों की ड्रिल |
| Cards added | {n} cards added to your reviews | आपके रिव्यू में {n} कार्ड जोड़े गए |
| Undo | Undo | वापस लें |
| Review solutions | Review solutions | हल देखें |
| Solutions counts | {wrong} wrong · {skipped} skipped · {marked} marked | {wrong} गलत · {skipped} छोड़े · {marked} मार्क किए |
| Compare | Compare with past attempts | पिछले प्रयासों से तुलना करें |
| Leaderboard | Leaderboard | लीडरबोर्ड |
| All analytics | See all analytics | पूरा विश्लेषण देखें |
| Pro lock title | Full report is part of Pro | पूरी रिपोर्ट Pro में है |
| Pro lock line | See your time analysis, chapter map and confidence. | अपना समय विश्लेषण, अध्याय मैप और आत्मविश्वास देखें। |
| Pet line, good | You've earned a break. Then let's fix {concept_name}. | आपने ब्रेक कमाया है। फिर {concept_name} को सुधारने की बारी। |
| Pet line, tough | Mocks are for finding gaps. We found a few to fix. | मॉक कमियाँ ढूँढने के लिए होते हैं। कुछ मिल गईं, अब इन्हें सुधारने की बारी। |
| Target source, cohort | Target time from {n} students | {n} छात्रों के आधार पर लक्ष्य समय |
| Target source, authors | Target time set by our authors | हमारे लेखकों द्वारा तय लक्ष्य समय |
| Not scored note | {n} questions didn't load and were not scored. | {n} सवाल लोड नहीं हुए और उनके अंक नहीं गिने गए। |

**Illustration slots:** Fix next card: `pet-cat` / `pet-dog`, 1:1, 48 px avatar in the Pet line, "thinking" or "proud" pose by result, never sad. Alt intent: "{pet_name}". No other illustrations; no confetti, no celebration, whatever the score.
**States:**
- Default (full report).
- Free or guest (R25): the three lead tiles, the score block, sections and subjects, solutions and the top Fix next row are open. Time analysis tiles, the time strip, heat map, confidence, more Fix next rows and the top 10% compare show their titles and a single locked row each ("Full report is part of Pro" + a "Pro" link that opens PAY-01 only when tapped, trigger `analytics_lock`); no blurred real data, no pop-up. The split lives in the flag `free.mock_report_sections`.
- Under 13: the locked rows read "Ask a grown-up" → SET-13. No price.
- Percentile below threshold: the threshold line replaces the two tiles.
- Re-attempt (attempt 2 or later): re-attempts are allowed and scored; the first attempt line and [See first attempt] replace the percentile and rank tiles (R26). Compare with past attempts is shown.
- Streak: the streak line shows only when this mock gave today's streak day.
- Live mock before `results_at`: "Ranks come out at {results_at}" tile.
- Negative score: the ring is empty, the number shows "−{n}"; no special colour (a fact, not a failure).
- No confidence data: confidence card hidden.
- Questions not scored (failed to load): the not-scored note.
- Offline: a report already downloaded is cached and fully viewable; else MOCK-18 offline state.
- Loading: skeletons with fixed heights.
- Error: "Couldn't load your report. [Try again]".
- Minor: rank shows to the student; on any public list under-18s appear only by the pet avatar and an auto-generated nickname (R31 amended). "Challenge a friend" needs the guardian `social` scope; without it the row is hidden.
- Dark mode: Practice look in dark tokens; chart colours from the proposed `dataViz` dark set.

**Interaction and motion:** The ring and bars fill once with spring `gentle` (static in reduced motion). The time strip scrolls horizontally with momentum; tap targets are at least 24 px wide per bar with a 48 px tall hit area. Fix next: success haptic when cards are added.
**Accessibility:** Score read as "{score} out of {max}". Bars read as "Physics, 52 of 100, 61 percent right". The time strip has a "View as table" alternative (question, result, time, target). Heat map cells read their values. Lucky guesses are explained in a tooltip-free info sheet. Never colour alone: correct and wrong glyphs under bars.
**Analytics:** `mock_report_viewed {attempt_id, has_percentile, locked_sections, attempt_no}`, `mock_report_section_opened`, `fix_next_started {concept_count}`, PAY's `paywall_viewed {trigger: analytics_lock}`.
**Web (≥ 600 px):** Two columns: score block, sections and Fix next on the left (sticky); time analysis, strip, heat map, confidence on the right. Desktop ≥ 1024 adds the solutions list as a third column (MOCK-22 preview).
**Mock priority:** P0 · Phase 1

### MOCK-20 · Time analysis
**Purpose:** Show where time went and which questions cost marks through speed. **Main action:** open a question from a bucket.
**Entry → exits:** MOCK-19 time tiles and strip → MOCK-22 (filtered), back.
**Layout (top to bottom):**
1. Header: back, "Time analysis".
2. Summary tiles: "Time used {h:mm} of {duration}", "Avg per question {m:ss}", "Longest {m:ss} on Q{n}".
3. Buckets as tabs: Right but slow · Fast and wrong · Lucky guesses · Time on skipped. Each tab lists questions: "Q{n}", subject dot, "{m:ss} vs target {m:ss}", result glyph, chevron.
4. **Attempt order** chart: a step line of "question answered" against time, with section boundaries, showing the order the student moved through the paper. Caption "You answered {first_section} first."
5. Per-section time table: section, time spent, share of total, accuracy.
6. Target source caption (cohort or authors, as MOCK-19).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Time analysis | समय विश्लेषण |
| Time used | Time used {used} of {duration} | {duration} में से {used} समय लगा |
| Avg | Avg per question {m:ss} | प्रति सवाल औसत {m:ss} |
| Longest | Longest {m:ss} on Q{n} | सबसे ज़्यादा {m:ss}, प्र.{n} पर |
| Row | {m:ss} vs target {m:ss} | {m:ss}, लक्ष्य {m:ss} |
| Attempt order | The order you answered in | आपने किस क्रम में उत्तर दिए |
| First section | You answered {first_section} first. | आपने पहले {first_section} हल किया। |
| Per section | Time per section | हर सेक्शन पर समय |
| Bucket empty | Nothing in this group. Nice. | इस समूह में कुछ नहीं। बढ़िया। |
| Lucky explainer | Right answers you marked as a guess. | वे सही उत्तर जिन्हें आपने अंदाज़ा बताया था। |

**Illustration slots:** None.
**States:** Default; empty bucket line; Pro only (R25): free students reach it only through the locked row on MOCK-19, which opens PAY-01 when tapped (trigger `analytics_lock`), never a pop-up; under 13: "Ask a grown-up" → SET-13; lucky guesses tab hidden when no confidence data; offline cached; dark mode.
**Interaction and motion:** Tabs switch instantly. Chart points are tappable (opens MOCK-22 at that question).
**Accessibility:** Charts have a table alternative. Tabs are a tab list with counts in their labels.
**Analytics:** `mock_report_section_opened {section: time}`, `mock_solutions_filtered {filter: slow|lucky}`.
**Web (≥ 600 px):** Buckets as a left list, the chart and section table on the right.
**Mock priority:** P1 · Phase 1

### MOCK-21 · Concept and confidence analysis
**Purpose:** Map marks won and lost onto the syllabus, and show how well confidence matched results. **Main action:** [Drill] on a weak chapter.
**Entry → exits:** MOCK-19 heat map and confidence card → PRC-03 (prefilled with `concepts[]`), MOCK-22 (filtered by chapter), MEM-25 metacognitive dashboard, MEM-26 "Sure but wrong" list, back.
**Layout (top to bottom):**
1. Header: back, "Concepts and confidence".
2. Segmented control: Chapters · Concepts.
3. **Heat map:** grouped by subject (subject name heading with its colour dot); one Heat map cell per chapter (or concept) with "{accuracy}%" inside; hatched cells for "1 question only"; legend for the scale with labelled stops ("0%", "50%", "100%").
4. Tapping a cell opens a bottom sheet: chapter name, "{correct} of {n} right · {marks} marks", the questions as chips "Q{n}" with result glyphs, [Drill] and [See these solutions].
5. **Confidence section:** three rows (Sure, 50:50, Guess) with "{correct} of {n} right" and a stacked bar (right vs wrong, with glyphs); a "Sure but wrong: {n}" callout linking to those questions and to MEM-26; link "See your calibration over time" → MEM-25.
6. **Mistake types** (if the student tagged any in MOCK-22): bar list.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Concepts and confidence | कॉन्सेप्ट और आत्मविश्वास |
| Chapters / Concepts | Chapters / Concepts | अध्याय / कॉन्सेप्ट |
| Cell meta | {correct} of {n} right · {marks} marks | {n} में से {correct} सही · {marks} अंक |
| One question | 1 question only | सिर्फ़ 1 सवाल |
| Drill | Drill | ड्रिल करें |
| See solutions | See these solutions | ये हल देखें |
| Confidence | How sure vs how right | यक़ीन बनाम सही उत्तर |
| Sure but wrong | Sure but wrong: {n} | पक्का कहा पर गलत: {n} |
| Calibration link | See your calibration over time | समय के साथ अपना तालमेल देखें |
| Mistake types | Your mistake types | आपकी गलतियों के प्रकार |
| No confidence | You didn't tag confidence in this mock. Try "How sure?" next time. | इस मॉक में आपने आत्मविश्वास नहीं बताया। अगली बार "कितना यक़ीन?" आज़माएँ। |

**Illustration slots:** None.
**States:** Default; no confidence data line; Pro only for free users (R25, locked inline on MOCK-19, trigger `analytics_lock`); the confidence chips are Sure / 50:50 / Guess everywhere (R21); offline cached; dark mode (heat scale dark variant). MEM-25 stays free (R19), so the calibration link works for everyone.
**Interaction and motion:** Cell tap opens the sheet in `slow`. Segmented switch cross-fades.
**Accessibility:** Each cell reads "{chapter}, {accuracy} percent, {n} questions". A list view toggle offers the same data sorted by accuracy. The scale is printed as numbers, not only colour.
**Analytics:** `mock_report_section_opened {section: concepts|confidence}`, `fix_next_started` (from Drill), `drill_setup_opened {source: fix_next}`.
**Web (≥ 600 px):** Heat map left; the selected cell's detail as a right panel instead of a sheet.
**Mock priority:** P1 · Phase 1

### MOCK-22 · Solutions review
**Purpose:** Go through every question with the student's answer, the right answer and a plain-words solution, filtered to what matters. **Main action:** [Next] through the filtered list.
**Entry → exits:** MOCK-19, MOCK-20, MOCK-21, MOCK-25 → AI-02 tutor chat sheet ([Ask tutor], opened with `context_ref = question:{question_id}`), LRN-03 topic card ("Learn this topic"), "Add to my cards" (adds to the student's deck in MEM-07, with a toast), PRC-03 ("Drill this concept", `concepts[]`), PRC-18 (PYQ citation), SET-24 report content, back.
**Layout (top to bottom):**
1. Header: back, "Solutions", filter chips row: All · Wrong · Skipped · Marked · Slow · Lucky guesses, each with a count.
2. Section tabs (as in the runner) and a compact palette strip of the filtered questions (cells show result glyphs: check, cross, dash), so the student can jump.
3. Question card: "Question {n}" with the section and marking; PYQ Citation chip if the mock is a PYQ paper; language toggle; the stem and options with: the student's answer marked "Your answer" (with icon), the correct answer marked "Correct answer" (with check), both in Option card states.
4. Facts row: "Time {m:ss} · target {m:ss}", "Visited {visits} times", "Changed answer {changes} times", "You said: {confidence}" (if tagged), marks "+{n}" / "−{n}" / "0".
5. Mistake tag chips (wrong answers): as PRC-05, saved to `mock_answers.mistake_type`.
6. Solution sections as PRC-05: In plain words, Step by step, Shortcut, Common traps.
7. "Your rough work" expandable row (only on the device that has it): a thumbnail of the question's rough-work page.
8. Actions: [Ask tutor] (AI-02 with `context_ref = question:{question_id}`, the tutor sees the question, the student's answer and the solution), [Learn this topic] (LRN-03), [Add to my cards], [Drill this concept], kebab "Report a problem".
9. Bottom bar: [‹ Previous] [Next ›] within the filter.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Solutions | हल |
| All / Wrong / Skipped / Marked / Slow / Lucky guesses | All / Wrong / Skipped / Marked / Slow / Lucky guesses | सभी / गलत / छोड़े / मार्क किए / धीमे / किस्मत से सही |
| Your answer | Your answer | आपका उत्तर |
| Correct answer | Correct answer | सही उत्तर |
| Time fact | Time {m:ss} · target {m:ss} | समय {m:ss} · लक्ष्य {m:ss} |
| Visits | Visited {visits} times | {visits} बार देखा |
| Changes | Changed answer {changes} times | {changes} बार उत्तर बदला |
| You said | You said: {confidence} | आपने कहा: {confidence} |
| Marks plus | +{n} marks | +{n} अंक |
| Marks minus | −{n} marks | −{n} अंक |
| Marks zero | 0 marks | 0 अंक |
| Partial | Part marks: +{n} | आंशिक अंक: +{n} |
| Your rough work | Your rough work | आपका रफ़ काम |
| Ask tutor | Ask tutor | ट्यूटर से पूछें |
| Learn this topic | Learn this topic | यह टॉपिक सीखें |
| Add to cards | Add to my cards | मेरे कार्ड में जोड़ें |
| Drill concept | Drill this concept | इस कॉन्सेप्ट की ड्रिल करें |
| Report | Report a problem | समस्या बताएँ |
| Filter empty | No questions in this filter. | इस फ़िल्टर में कोई सवाल नहीं। |
| Not scored | This question didn't load in your mock, so it wasn't scored. | आपके मॉक में यह सवाल लोड नहीं हुआ, इसलिए इसके अंक नहीं गिने गए। |
| Dropped | Dropped in the final key. Marks as per the official key. | फ़ाइनल की में हटाया गया। अंक आधिकारिक कुंजी के अनुसार। |

**Illustration slots:** Question and solution media are content. No pet here (the student is studying a serious result).
**States:**
- Default (filter "Wrong" preselected when coming from the report's solutions row; "All" otherwise).
- Filter empty line.
- Partial marking result: Partial line and per-option icons for chosen right, chosen wrong, and missed.
- PYQ dropped or changed questions: status chip and the dropped line.
- Not scored question: the not-scored line.
- Offline: solutions download with the report (`GET /v1/attempts/{id}/solutions`) and are cached; [Ask tutor] needs internet.
- Free and guest: solutions are open for every question (R25). Slow and Lucky filters are Pro (they depend on time and confidence analysis) and show a Pro Chip that opens PAY-01 only when tapped (trigger `analytics_lock`); "Ask a grown-up" for under-13s.
- Tutor: shown here (the mock is over). Under-13 and guest rules follow AI.
- No rough work on this device: the row is hidden.
- Dark mode: Practice look in dark tokens.

**Interaction and motion:** Swipe left and right moves within the filter on phones (this is review, not the runner). Expanding sections `base`. Mistake chip: light haptic.
**Accessibility:** "Your answer" and "Correct answer" are text labels with icons, not only colours. Marks read "plus 4 marks". Swipe has the bottom bar as its alternative. Focus moves to the question number on change.
**Analytics:** `mock_solutions_filtered {filter}`, `solution_viewed {context: mock}`, `mistake_tagged {context: mock}`, `drill_setup_opened {source: fix_next}`.
**Web (≥ 600 px):** Three panes at ≥ 1024: filters and the question list on the left, the question in the centre, the solution on the right. At 600–1023: list left, question and solution stacked right. Keyboard: ← → previous and next, 1–6 switch filters.
**Mock priority:** P0 · Phase 1

### MOCK-23 · Compare attempts
**Purpose:** Show progress across attempts of the same mock or the same paper pattern. **Main action:** open an attempt's report.
**Entry → exits:** MOCK-19 "Compare", MOCK-02 "Compare", MOCK-25 → MOCK-19 (a chosen attempt), back.
**Layout (top to bottom):**
1. Header: back, "Compare attempts", scope chips: "This mock" · "All {paper_pattern} mocks" (same blueprint paper) · "Top 10%" (research A29: the average of the top 10% of first attempts on this mock, an aggregate, never a named person; shown only above `mock.min_attempts_for_percentile`).
2. Trend chart: score as % of max per attempt, x = date, points labelled by attempt; target line none (no invented targets).
3. Table: rows per attempt (date, mock, score, % of max, accuracy, time used, percentile if shown); best value per column marked with a `Star` icon and "Best" text.
4. Section deltas: for the last two attempts, one row per section: "{section}: {before} → {after}" with an arrow icon and sign.
5. Insight lines built only from the numbers above (for example "Accuracy in {section} went from {a}% to {b}%"). No predictions.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Compare attempts | प्रयासों की तुलना |
| This mock | This mock | यह मॉक |
| All pattern | All {paper_pattern} mocks | सभी {paper_pattern} मॉक |
| Score pct | % of max | अधिकतम का % |
| Best | Best | सबसे अच्छा |
| Delta row | {section}: {before} → {after} | {section}: {before} → {after} |
| Insight accuracy | Accuracy in {section} went from {a}% to {b}%. | {section} में सटीकता {a}% से {b}% हुई। |
| Insight time | You finished {section} {m} min faster. | आपने {section} {m} मिनट जल्दी पूरा किया। |
| Too few | Take this mock again, or another {paper_pattern} mock, to compare. | तुलना के लिए यह मॉक फिर दें, या कोई और {paper_pattern} मॉक। |
| Top 10% | Top 10% | टॉप 10% |
| Top 10% row | Top 10% average | टॉप 10% का औसत |
| Top 10% too few | The top 10% shows once {min} students have taken this mock. | {min} छात्रों के मॉक देने पर टॉप 10% दिखेगा। |

**Illustration slots:** Too-few state: `empty-state`, 4:3, the pet holding two blank report cards side by side. Alt intent: "{pet_name} ready to compare".
**States:** Default; too few attempts; Top 10% below threshold (the too-few line, chip disabled); Pro only for free users (inline lock on MOCK-19, trigger `analytics_lock`, "Ask a grown-up" for under-13s); offline cached; dark mode.
**Interaction and motion:** Chart points tappable. Scope switch cross-fades.
**Accessibility:** Table is the primary view for screen readers; the chart is labelled as a summary of the table. "Best" is text plus icon.
**Analytics:** `mock_compare_viewed {attempt_count}`.
**Web (≥ 600 px):** Chart and table side by side at ≥ 1024.
**Mock priority:** P2 · Phase 1

### MOCK-24 · Live mock leaderboard
**Purpose:** Show all-India and friends' ranks for a live mock, fairly and with privacy rules. **Main action:** find your own position.
**Entry → exits:** MOCK-19 (live), MOCK-03 (closed) → SOC-07 friend profile (Friends tab, consented users, Phase 2), AUTH-01 soft sheet (guest link, reason `leaderboard`), AUTH-18 guardian consent (teen), SET-13 (under 13), back.
**Layout (top to bottom):**
1. Header: back, "{mock_title} leaderboard", "{ranked_count} ranked · results at {results_at}".
2. Tabs: All-India · Friends · My city (city only if the student set one; P2).
3. Top 3 block: three Leaderboard rows with larger avatars (pet avatars) and the rank in `title`.
4. List: Leaderboard rows 4 to 100, cursor pagination; each row: rank, avatar, name (adults: display name; under-18s: auto nickname with the pet avatar only, R31 amended), score, percentile.
5. Own row pinned at the bottom: "You · Rank {rank} · {score} · {percentile} percentile".
6. Footer caption: "Only first attempts made during the window are ranked."

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | {mock_title} leaderboard | {mock_title} लीडरबोर्ड |
| Meta | {ranked_count} ranked · results at {results_at} | {ranked_count} रैंक हुए · नतीजे {results_at} पर |
| All-India | All-India | अखिल भारत |
| Friends | Friends | दोस्त |
| My city | My city | मेरा शहर |
| Own row | You · Rank {rank} · {score} · {percentile} percentile | आप · रैंक {rank} · {score} · {percentile} पर्सेंटाइल |
| Footer | Only first attempts made during the window are ranked. | सिर्फ़ विंडो के दौरान दिए पहले प्रयास रैंक होते हैं। |
| Pending | Ranks come out at {results_at}. | रैंक {results_at} पर आएँगी। |
| Guest | Sign in to appear on the leaderboard. | लीडरबोर्ड पर दिखने के लिए साइन इन करें। |
| Minor private | Only you can see your row. | आपकी पंक्ति सिर्फ़ आपको दिखती है। |
| Minor listed note | Others see a nickname and your pet, never your name. | दूसरों को आपका नाम नहीं, सिर्फ़ एक निकनेम और आपका पेट दिखता है। |
| Ask a parent | Ask a parent | माता-पिता से पूछें |
| Not ranked | You took this after the window, so it isn't ranked. | आपने यह विंडो के बाद दिया, इसलिए रैंक नहीं हुई। |
| You | You | आप |
| Your rank a11y | Your rank: {rank}, score {score}, {percentile} percentile | आपकी रैंक: {rank}, स्कोर {score}, {percentile} पर्सेंटाइल |
| Too few | Too few people took this mock to rank it fairly. | निष्पक्ष रैंक देने के लिए बहुत कम लोगों ने यह मॉक दिया। |
| Top three | Top three | टॉप तीन |
| Row a11y | Rank {rank}, {name}, score {score}, {percentile} percentile | रैंक {rank}, {name}, स्कोर {score}, {percentile} पर्सेंटाइल |
| Percentile | {percentile} percentile | {percentile} पर्सेंटाइल |
| Col rank | Rank | रैंक |
| Col name | Name | नाम |
| Col score | Score | स्कोर |
| Col percentile | Percentile | पर्सेंटाइल |

**Illustration slots:** None beyond pet avatars (existing assets).
**States:** Pending (before `results_at`); published; guest (no own public row, sign-in link; live mocks are Pro, so guests normally only reach this from a shared link); minor without consent (private row line, [Ask a parent] → AUTH-18, or [Ask a grown-up] → SET-13 for under-13s); minor with consent (auto nickname and pet avatar only, R31 amended, with the minor listed note); not ranked (late attempt); offline cached; dark mode.
**Interaction and motion:** Scroll; the own row stays pinned. Tapping a friend opens SOC-07. Rows of non-friends are not tappable. No confetti for top ranks.
**Accessibility:** Rows read "Rank {n}, {name}, score {s}, {p} percentile". The pinned row is announced as "Your rank".
**Analytics:** `mock_leaderboard_viewed {mock_id, scope}`.
**Web (≥ 600 px):** Top 3 as a row of cards; the list in a table with sortable columns (rank only for live).
**Mock priority:** P1 · Phase 3

### MOCK-25 · Mock history
**Purpose:** List every mock attempt with its result. **Main action:** open a report.
**Entry → exits:** MOCK-01 "See all", ME-01 stats → MOCK-19, MOCK-23, MOCK-14 (in-progress row), back.
**Layout (top to bottom):**
1. Header: back, "Your mocks".
2. Kind chips: All · Full · Sectional · Chapter · PYQ papers · Live · Custom.
3. A small trend sparkline of score % across the filtered attempts (only with 2 or more).
4. Rows grouped by month: title, date, kind chip, "{score}/{max}", percentile when shown, status chips ("In progress", "Report pending", "New").
5. Sync caption for signed-in students: "Your mocks are the same on every device you sign in to." An attempt in progress on another device shows "In progress on {device_label}" (research A30).
6. Guest footer: "Sign in to keep your mock history on every device." (link to AUTH-01, reason `save_progress`).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Your mocks | आपके मॉक |
| All | All | सभी |
| In progress | In progress | चल रहा है |
| Report pending | Report pending | रिपोर्ट बाक़ी |
| New | New | नया |
| Empty | No mocks yet. Your first one is a good way to see where you stand. | अभी कोई मॉक नहीं। पहला मॉक बताएगा कि आप कहाँ हैं। |
| Find a mock | Find a mock | मॉक ढूँढें |
| Guest footer | Sign in to keep your mock history on every device. | हर डिवाइस पर मॉक इतिहास रखने के लिए साइन इन करें। |
| Sync line | Your mocks are the same on every device you sign in to. | जिस भी डिवाइस पर साइन इन करें, आपके मॉक वहाँ एक जैसे दिखेंगे। |
| In progress elsewhere | In progress on {device_label} | {device_label} पर चल रहा है |

**Illustration slots:** Empty: `empty-state`, 4:3, the pet sitting at a small desk with a blank answer sheet. Alt intent: "{pet_name} at an exam desk".
**States:** Default; empty; loading; error; offline (cached list; pending reports show "Report pending"); guest footer; dark mode.
**Interaction and motion:** Standard list. Pull to refresh.
**Accessibility:** Rows read title, date, score, status. Sparkline labelled "Trend: from {first}% to {last}%".
**Analytics:** `screen_view {screen: MOCK-25}`, `mock_report_viewed` on open.
**Web (≥ 600 px):** List left, the selected report's score block on the right with [Open report].
**Mock priority:** P2 · Phase 1

### MOCK-26 · Custom mock builder
**Purpose:** Build a timed mock from the student's own weak areas, in the exam's style (PRD §6.1). **Main action:** [Create mock].
**Entry → exits:** MOCK-01 custom card, PRC-02 ("Make a mock from these") → MOCK-02 (the generated mock's detail), PAY-01 paywall (free, tapped, trigger `mock_limit`), SET-13 (under 13), back.
**Layout (top to bottom):**
1. Header: back, "Custom mock", Pro Chip for free users.
2. Source: segmented control "My weak spots" (default) · "Pick chapters".
3. Chapter list (preselected from weak spots, with reason chips), multi-select.
4. Questions: segmented 15 · 30 · 45 (UI choices). Time follows the exam's own pace: {n} × ({blueprint duration_min} ÷ {blueprint question_count}), rounded up to the minute. Caption "{duration_min} min, marking as in {exam_short}".
5. Marking line: "Uses {exam_short} marking: +{marking.correct} / {marking.wrong}" (from the blueprint).
6. Availability caption: "{available} fresh questions available" (questions with `use` including `mock`, not seen before).
7. Button primary 56 [Create mock].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Custom mock | कस्टम मॉक |
| My weak spots | My weak spots | मेरे कमज़ोर हिस्से |
| Pick chapters | Pick chapters | अध्याय चुनें |
| Questions | Questions | सवाल |
| Duration caption | {duration_min} min, marking as in {exam_short} | {duration_min} मिनट, {exam_short} जैसी अंक योजना |
| Marking line | Uses {exam_short} marking: +{correct} / {wrong} | {exam_short} की अंक योजना: +{correct} / {wrong} |
| Available | {available} fresh questions available | {available} नए सवाल उपलब्ध |
| Too few | Not enough fresh questions for this. Pick more chapters or fewer questions. | इसके लिए पर्याप्त नए सवाल नहीं। ज़्यादा अध्याय या कम सवाल चुनें। |
| Create | Create mock | मॉक बनाएँ |
| Creating | Building your mock… | आपका मॉक बन रहा है… |

**Illustration slots:** None.
**States:** Default; too few questions (create disabled with the line); creating (`POST /v1/mocks/generate`); offline (disabled, "Needs internet to build a mock"); free and guest (Pro lock; the button reads "Unlock with Pro" and opens PAY-01 when tapped, "Ask a grown-up" → SET-13 for under-13s); dark mode.
**Interaction and motion:** Standard form. Create shows a spinner in the button (width kept).
**Accessibility:** Groups labelled; the availability caption is linked to the button's description.
**Analytics:** `custom_mock_created {concept_count, question_count, duration_min}`, PAY's `paywall_viewed {trigger: mock_limit}`.
**Web (≥ 600 px):** A 640 px centred form.
**Mock priority:** P2 · Phase 2

---

### WEB-06 · Web practice and mock messages
**Purpose:** Short messages on the web drill (PRC-03 to PRC-05) and mock screens (MOCK-01 to MOCK-22) now that the server runs every drill and mock attempt, and the "not stated" label for blueprint values the official notice leaves out (shown the same way on the marketing site).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Answer not saved | That answer didn't reach us. Check your connection and try again. | यह जवाब हम तक नहीं पहुँचा। इंटरनेट देखकर फिर से कोशिश करें। |
| Drill unavailable | This drill can't start right now. Try again in a moment. | यह ड्रिल अभी शुरू नहीं हो पा रही। थोड़ी देर में फिर से कोशिश करें। |
| Needs internet | Drills and mocks need the internet. | ड्रिल और मॉक के लिए इंटरनेट चाहिए। |
| Not stated | Not stated in the notice | सूचना में नहीं बताया गया |
| Mock start failed | This mock can't start right now. Try again in a moment. | यह मॉक अभी शुरू नहीं हो पा रहा। थोड़ी देर में फिर से कोशिश करें। |
| Mock save failed | Some answers aren't saved yet. We'll keep trying. | कुछ जवाब अभी सेव नहीं हुए। हम कोशिश करते रहेंगे। |
| Marks per question | +{correct} / {wrong} | +{correct} / {wrong} |
| Max marks | {max} marks | {max} अंक |
| Your mocks empty | Your finished mocks show up here. | आपके पूरे किए गए मॉक यहाँ दिखेंगे। |
| Language en | English | English |
| Language hi | हिन्दी | हिन्दी |
| Mock load failed | This mock didn't load. Check your connection and try again. | यह मॉक लोड नहीं हुआ। इंटरनेट देखकर फिर से कोशिश करें। |
| Try again | Try again | फिर से कोशिश करें |
| Score not stated | Score not worked out: the notice doesn't state the marks. | स्कोर नहीं निकाला गया: सूचना में अंक नहीं बताए गए। |
| Question of | Question {n} of {total} | प्रश्न {n} / {total} |

**Mock priority:** P1.

---

## Appendix: Proposed components

New components for this area, to add to DESIGN.md §5 and build in `ui-native` and `ui-web`. Props are named in TypeScript style; every visual value is a token. Every component has a dark variant from the dark token set, respects reduced motion and has an accessible name.

| Component | Props | States | Notes |
|---|---|---|---|
| **Timer** | `mode: 'countdown' \| 'countup'`, `endsAt` or `startedAt` (server-offset clock), `warnAtMs`, `finalAtMs`, `sectional?: { label, endsAt }`, `announce: 'warnings' \| 'none'`, `size: 'header' \| 'compact'` | default (`ink` on `surface`, Phosphor `Timer` bold), warning (`warningText` + `Warning` icon), final (`errorText` + `WarningOctagon`), paused (`PauseCircle`, frozen digits) | Tabular figures, `title` style. Warning and final thresholds come from the blueprint or the UI rule in PRC-04, never colour alone. Count-up mode (PRC-11) never uses warning colours. |
| **Section tabs** | `sections: { code, title, answered, total, state: 'open' \| 'locked' \| 'not_open' }[]`, `activeCode`, `onSelect`, `navigation: 'free' \| 'locked_in_order' \| 'free_within_timer'` | active (`ink` text, 3 px `primary` underline), inactive, locked (`inkDisabled` + `Lock`), not open yet (`inkDisabled`, no tap), focus ring | 40 px tall, scrollable, `label` text, count badge "{answered}/{total}". Tab list role; locked tabs announce "closed". |
| **Numeric keypad** | `value`, `onChange`, `allowDecimal`, `allowNegative`, `maxLength`, `format?: 'integer' \| 'decimal'` (from blueprint `numeric_input`), `hardwareKeys: boolean` | idle, typing, invalid (caption under the field, `errorText` + icon), disabled (time up, locked section) | 4 × 4 grid of 56 px keys on `surfaceSunken`: digits, decimal, minus, backspace, clear. Answer field above in `heading`, tabular figures. Keys labelled ("minus", "decimal point"). |
| **OMR bubble row** | `questionNo`, `options: string[]` (labels such as "1"–"4" or "A"–"D"), `selected?`, `flagged`, `onSelect`, `onClear`, `confirmChange: boolean` (Exam-day mode) | empty (`line` border), filled (`ink` fill, white letter), focused, flagged (small `Flag` icon at the row end), read-only (after submit) | 32 px circles in a 48 px hit area. Radio group per row, read "Question {n}, option {x}, filled". |
| **Score ring** | `score`, `max`, `label`, `size: 'lg' \| 'md'`, `animate: boolean` | positive (ring fills to score / max), zero, negative (ring empty, number shows "−{n}"), loading (empty ring, skeleton number) | The DESIGN.md progress ring, stroke 12, number in `display`. Read "{score} out of {max}". No special colour for negative scores. |
| **Heat map cell** | `value: number \| null`, `count`, `minCount` (flag `analytics.min_answers_per_chapter`), `label`, `onPress?` | filled (proposed `dataViz.sequential` step), too few (hatched pattern + "not enough data"), selected (2 px `ink` ring), disabled | 44 × 44 minimum, radius `xs`, percentage printed inside in `caption`. Never colour alone: the number is always printed. |
| **Time strip** | `items: { questionNo, sectionCode, timeMs, targetMs?, result: 'right' \| 'wrong' \| 'skipped' \| 'not_scored' }[]`, `onSelect`, `showTarget` | default, selected bar, no target (dashed line hidden, caption explains), table view (the accessible alternative) | Horizontal bar chart, one bar per question, height = time, result glyph under each bar (check, cross, dash). Scrolls horizontally; each bar at least 24 px wide with a 48 px tall hit area. Target source caption from MOCK-19. |
| **Leaderboard row** | `rank: number \| null`, `avatar: { kind: 'pet' \| 'initials', ref }`, `name` (already resolved by privacy rules: display name for adults, auto nickname for under-18s, "You" for self), `score`, `time?`, `percentile?`, `isSelf`, `pinned`, `tappable` (friends only) | default, self (`primaryTint`, pinned at the bottom), top 3 (larger avatar, rank in `title`), pending rank ("Rank soon"), not ranked | Rank in tabular `label`, 32 px pet avatar. The component never receives a real name or typed pet name for a minor, so it cannot show one (R31 amended). It is used only on leaderboards: the MOCK-08 candidate block is not a Leaderboard row and shows initials, never a pet avatar (R24). Read "Rank {n}, {name}, {score}". |
| **Citation chip** | `examShort`, `year`, `sessionLabel`, `keyStatus: 'final' \| 'provisional' \| 'dropped' \| 'changed'`, `onPress` (opens PRC-18) | default, dropped (`warningTint` + icon + "Dropped"), changed (`warningTint` + icon + "Answer changed"), pressed | A Chip with a `FileText` icon and "{exam_short} {year} · {session_label}". Read "From {exam} {year}, {session}. Opens source details." |
| **Limit meter** | `label`, `used`, `limit` (flag value), `resetsAt`, `proAction: 'pro_link' \| 'ask_grown_up' \| 'none'` | in range, last few (caption "{remaining} left today"), full ("Done for today. Resets at midnight."), hidden (Pro) | One-line row: label, Progress bar (8 px), "{used} of {limit}". Progress bar role with value text. Never animates attention (no pulse, no shake). The `ask_grown_up` action is used for under-13s. |

