# Learn screens: Home, subjects, topics and the lesson player

Status: Draft v0.3 (revision 1), 29 Oct 2026. Screen specs for the HOME, LRN and LES prefixes. The logic behind them (branches, data, gating, analytics) is in [`docs/flows/learn.md`](../flows/learn.md), which wins if the two disagree. Tokens and components come from `DESIGN.md` §2–§5 and §7 and `packages/tokens/tokens.json`. Placeholders such as `{topic_title}` stand for content that skills produce; this doc never contains study content. Numbers that are product settings appear as named flags (for example `home.review_hero_min_cards`), never as fixed values.

---

## 0. Conventions used in every block

### 0.1 Shared chrome

- **Top bar (main screens):** 56 tall on `bg`. Left: back (`CaretLeft`, 24), or on Home the exam chip (§HOME-01). Centre or left: the screen title in `title`. Right: search (`MagnifyingGlass`, 24) on every main screen (APP_FLOW §1), then one screen-specific action at most.
- **Floating tutor button (AI-01):** 56 round, `primary` fill, the pet's head (Rive, static pose in reduced motion) with the accessibility label "Ask {pet_name}". Sits 16 above the pinned CTA or the tab bar, right edge, 16 from the side. Opens AI-02 with the current screen as context. Hidden for little learners unless a parent turns it on in SET-14 (R14).
- **Tab bar:** DESIGN §5, Learn active. Phase 1 ships four tabs (Learn, Labs, Practice, Me; R46); the Friends tab joins in Phase 2 for the five-tab target (Learn, Labs, Practice, Friends, Me; R17). Three for little learners (Learn, Labs, Me; R14). Hidden inside the lesson player, the storybook, the video player, the Cornell editor and the mind map.
- **Pinned primary CTA:** Button primary, 56 tall, full width minus 20 per side, 16 above the safe area or tab bar, with `ctaGlow`.
- **Sheets:** Sheet component, radius `sheet` (28), grabber, `scrim`. Heights 40%, 60% or full.
- **Phase:** every block is Phase 1 unless its title line says otherwise (R8).

### 0.2 Shared status chips

| Chip | Look | Label EN | Label HI |
|---|---|---|---|
| Pro gate | `primaryTint` fill, `primary` text, `LockSimple` 16 | Pro | प्रो |
| Free today | `surfaceRaised` fill, 1 px `line` border, `ink` text, `Gift` 16 | Free today | आज मुफ़्त |
| Free | `surfaceRaised` fill, 1 px `line` border, `ink` text, `Gift` 16 | Free | मुफ़्त |
| Needs internet | `surfaceSunken` fill, `inkMuted` text, `CloudSlash` 16 | Needs internet | इंटरनेट चाहिए |
| Downloaded | `surfaceSunken` fill, `inkMuted` text, `DownloadSimple` 16 | Downloaded | डाउनलोड है |
| High-yield (only from real PYQ data, flow §11 C6) | `surfaceSunken` fill, `ink` text, `TrendUp` 16 | High-yield | अधिक महत्वपूर्ण |
| Tough one (flow §7.3 rule 7) | `surfaceSunken` fill, `ink` text, `Mountains` 16 | Tough one | मुश्किल सवाल |
| PYQ source (flow §7.3 rule 7) | `surfaceSunken` fill, `ink` text, `Exam` 16 | Asked in {exam_name} {year} | {exam_name} {year} में पूछा गया |

Every chip has its text label. No state is shown by colour or icon alone. Status colours (`success`, `error`, `warning`) keep their meaning (DESIGN §1). **Gold (`streak`, `streakTint`, `gem`) is reserved for the streak, the plant, gems and the ₹1 offer tag (R11).** Memory-trick cards use the subject tint with `Lightbulb`; the daily goal uses `primary`, because it is separate from the streak (R1, R23).

### 0.3 Topic and node states (used by the HOME-01 strip, LRN-02 and HOME-06)

| State | Visual | Icon | Label (screen reader and visible caption) EN / HI |
|---|---|---|---|
| Not started | `surface` node, `line` border 2 | number of the topic | Not started / शुरू नहीं |
| Next (recommended) | subject `strong` ring 3, gentle pulse once on appear | number | Next / अगला |
| In progress | subject `strong` ring showing % | `Play` | {percent}% done / {percent}% पूरा |
| Learned | subject `strong` fill, `onStrong` icon | `Check` | Learned / सीख लिया |
| Learned by a check (Test out or Find my level, not yet confirmed by a lesson or review) | Learned look with a 2 px `surface` inner ring | `Check` | Learned (checked) / सीख लिया (टेस्ट से) |
| Pro gate | Not-started look plus the Pro chip | `LockSimple` | Pro, preview free / प्रो, मुफ़्त झलक |
| Not on device (offline) | 60% opacity on the illustration only, text stays full contrast | `CloudSlash` | Needs internet / इंटरनेट चाहिए |
| **Review node** (A14; FSRS cards of the topic before it due today, within the daily cap) | 44 round, `primaryTint` fill, `primary` 2 px border, placed on the line right after its topic | `Cards` | Review {n} / {n} दोहराएँ |

A review node is not a topic. It disappears once its cards are done. At most `home.strip_max_review_nodes` sit in the HOME-01 strip; the rest fold into one "Review {n}" node at the end.

### 0.4 Hindi copy rules (R3)

- आप everywhere. तुम only in little-learner mode (class 1–5): HOME-06, the little-learner rows of other blocks, and the `u10` variant of LRN-05. Those rows are marked "little learner".
- No gendered verb endings for the student, the pet or friends. Use ने constructions ("आपने पूरा कर लिया!"), noun phrases ("आज का लक्ष्य पूरा!"), imperatives and subjunctives ("आगे बढ़ें", "शुरू करें"), and passives ("पढ़ा जा सकता है"). Where none fits, use ICU `select` on the student's chosen form.
- Keep loanwords students use: डीप डाइव, क्विक रिविज़न, स्ट्रीक, लेवल, मॉक टेस्ट, फ़्रीज़. PYQ stays "PYQ" in chips; long form "पिछले वर्षों के प्रश्न".
- Counts use ICU `plural` in both languages where the noun changes.
- Numbers use Western digits in both languages, as NCERT Hindi-medium books do in maths and science.
- Hindi line height is 1.15× the Latin value (DESIGN §3). Every container below is specified to grow, not truncate.

### 0.5 Pet lines

The Pet line component (DESIGN §5): 40 px pet avatar plus a bubble on `surface`, at most two lines. Lines are spoken by the screen reader. For little learners they are also read aloud by TTS when the screen opens (once).

---

## HOME

### HOME-01 · Home (Learn tab)
**Purpose:** Show the student the one next thing to do and give fast access to every subject. **Main action:** the hero card button ([Start], [Review], [Resume], [Start deep dive], [Do it now]).
**Entry → exits:** ENT-01 launch, ENT-08 streak check-in, ONB-14 / ONB-15 end of onboarding, tab tap, notifications, widgets → hero target (LES-01, LRN-03, LRN-07, MEM-03, MEM-02, PRC-11), strip topic node → LRN-03, strip review node → MEM-03 `?topic=`, strip [Cheat sheet] → LRN-08, "See chapter" → LRN-02, secondary row → LES-01 / MEM-03 / PRC-02, HOME-02, HOME-04 (exam chip), HOME-05, HOME-08 (Find my level card), LRN-01, Memory tile → MEM-01, Library tile → LRN-09, LRN-16, pet avatar → ME-04, plant → ME-07, streak pill and freeze slots → ME-10, gem pill → ME-17, revival card → ME-08, "Save your plant" → AUTH-01 (trigger `streak_day_2`), exam-passed card → ONB-06 (`edit` mode).

**Layout (top to bottom):**
1. **Header row** (56): left, the **exam chip** (A18; all-exams app, or a per-exam app with more than one exam profile): Chip on `surfaceRaised` with the exam's short name in `label` and `CaretDown` 16, opens HOME-04. In a per-exam app with one profile, the chip is absent and the pet avatar takes this slot. Right: **streak pill** (`streakTint` fill, Phosphor `Plant` fill 20 in `streak`, the day count in `label` tabular; R28), **gem pill** (`surfaceRaised`, `Diamond` fill 20 in `gem`, number tabular), then the search icon button. Tap targets 48 each.
2. **Greeting row** (48): pet avatar 40 in a `primaryTint` circle (Rive, idle mood) and the greeting in `heading` ("Hi, {name}", or "Hi there!" for guests with no name).
3. **Offline banner** (only offline): 36 tall, `surfaceSunken`, `CloudSlash` 20, one line in `caption` `inkMuted`. Not dismissible; disappears on reconnect with a 200 ms fade.
4. **Streak card** (DESIGN Streak card): `streakTint`, radius 20, padding 16. Left: one state line in `heading` (2 lines max, wraps), then the daily-goal progress bar 8 tall (`primary` fill on `track`) with "{done} of {goal} min today" in `caption`, then the **freeze slots** row (R28, A17): `streak.freeze_slots_max` small circles 28, a ready freeze is `Snowflake` fill 16 in `primary` on `surface`, an empty slot is a 2 px dashed `line` ring, followed by the text "{n} freezes ready" in `caption`. The slots and their text are one 48-tall button → ME-10. Right: plant illustration 96 × 96 (Rive `plant.riv`, current stage × health) overlapping the top edge by 12; tap → ME-07. At-risk state: `warningTint`, line in `ink`. Guest on streak day 2 after `auth.streak_prompt_hour`: a ghost link "Save your plant" under the slots.
5. **Hero card** (Continue card component, the only one on screen): radius 24, min height 168, fill = subject `strong` for lesson heroes, `primary` for review, daily challenge and streak-saver heroes. Contents: kicker in `caption` ("Up next", "Continue", "Review first", "Save your streak"), title in `title` (`onStrong`, up to 3 lines), meta line in `label` ("{subject_name} · {minutes} min" or "{count} today · {minutes} min"), progress bar 8 (when in progress), then the button: Button secondary-on-colour, 48 tall, `surface` fill with `ink` text, left-aligned, text + `ArrowRight`. Illustration 140 × 140 overlapping the right edge by 20 (topic art, else subject object; review and challenge heroes use the pet). The whole card is tappable; the button is the visible target.
6. **Path strip** (when the hero is a lesson, or for `start_here`): label row "Up next in {chapter_title}" in `label` + "{n} topics left" in `caption` `inkMuted`; on the right two ghost chips, [Cheat sheet] (`Note` 16, opens LRN-08 for the chapter; A16) and "See chapter" (LRN-02). Below, a horizontal scroll of topic nodes 56 round, 12 apart, joined by a 4 px `track` line that fills in subject `strong` up to the current node, with **review nodes** (§0.3) on the line after their topics. Each node has its short name under it in `caption` (2 lines, max width 88). Current node centred on first render. If the chapter has more topics than fit `home.strip_max_nodes`, the last node is "+{n}", which opens LRN-02.
7. **Secondary row** (at most one, flow §5.2): 56 tall list row on `surface`, radius 16, leading icon 24 and text in `label`, trailing `CaretRight`. Kinds: continue (`Play` in subject `text`), reviews below the hero threshold (`Cards` in `primary`), fading topic (`ArrowsClockwise` in `primary`, Phase 2), weak spot (`Target` in `primary`, opens PRC-02).
8. **Plan row:** list row "Today's plan" with a progress ring 24 (stroke 4, `primary`) and "{done} of {total} done" in `caption`. Opens HOME-02. When no reviews are due and the student has cards: second line "All caught up! Next review in {duration}".
9. **Find my level card** (R27; only for ONB-07 "Know the basics" or "Revising", until done or dismissed, and only if the current subject has a placement set): `surface` card, radius 20, `line` border 1, padding 16. `Gauge` 32 in `primary` on a `primaryTint` circle, title in `heading`, one line in `body`, [Start] secondary 40 and [Not now] ghost. [Start] → HOME-08.
10. **Exam-passed card** (rare, one-time): `surface` card, `CalendarCheck` 32, one line + [Set next goal] secondary + [Not now] ghost.
11. **Subjects section:** heading "Your subjects" in `heading`. Then a 2-column grid of Subject tiles (DESIGN Subject tile), 12 apart, tile min height 164: tint background, illustration 72 top-right overlapping, subject name `heading`, progress bar in `strong` (hidden at 0%), the subject's own next topic "Next: {topic_title}" in `caption` (2 lines; A14), "{n} chapters" `caption` `inkMuted`. Chips under the name when they apply: Free today, Needs internet.
12. **Memory and Library tiles** (R17): two half-width tiles side by side, `surface`, radius 16, min height 88. Memory: `Brain` 24 in `primary`, "Memory" `label`, "Decks, palaces and focus timer" `caption` → MEM-01. Library: `BookBookmark` 24 in `primary`, "Library" `label`, "Formulas, notes and saved cards" `caption` → LRN-09. At 200% text they stack.
13. Bottom padding so the last row clears the tutor button and the tab bar.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Greeting (morning / any) | Good morning, {name} · Hi, {name} | सुप्रभात, {name} · नमस्ते, {name} |
| Greeting, guest | Hi there! | नमस्ते! |
| Exam chip a11y | Exam: {exam_name}. Change exam | परीक्षा: {exam_name}। परीक्षा बदलें |
| Exam chip, Just curious | Exploring | एक्सप्लोर मोड |
| Streak pill a11y | Streak, {n} days | स्ट्रीक, {n} दिन |
| Gem pill a11y | {n} gems | {n} जेम्स |
| Offline banner | Offline. Downloaded lessons still work. | ऑफ़लाइन हैं। डाउनलोड किए गए पाठ चलते रहेंगे। |
| Streak card, not yet today | One lesson or 10 reviews waters it today | आज एक पाठ या 10 रिव्यू से इसे पानी मिलेगा |
| Streak card, watered | Watered! See you tomorrow | पानी मिल गया! कल फिर मुलाक़ात! |
| Streak card, at risk | Your plant is thirsty. One lesson or 10 reviews before bed? | आपका पौधा प्यासा है। सोने से पहले एक पाठ या 10 रिव्यू? |
| Streak card, rescue link | 2-minute rescue | 2 मिनट में पौधे को पानी |
| Streak card, droopy | A little droopy. One study day perks it up. | थोड़ा मुरझाया है। एक दिन की पढ़ाई से फिर खिल उठेगा। |
| Streak card, dry | It misses you. Two study days bring it back. | इसे आपकी याद आ रही है। दो दिन की पढ़ाई से यह फिर हरा होगा। |
| Streak card, wilted | Let's nurse it back: 3 short study days. | चलिए इसे फिर हरा करें: बस 3 छोटे दिन की पढ़ाई। |
| Streak card, rest day | Rest day. Your plant is resting too. | आराम का दिन। आपका पौधा भी आराम कर रहा है। |
| Streak card, incident | We had a problem on our side. Your streak is safe. | हमारी तरफ़ से गड़बड़ हुई थी। आपकी स्ट्रीक सुरक्षित है। |
| Freeze slots | {n, plural, one {# freeze ready} other {# freezes ready}} · No freezes ready · Get one | {n} फ़्रीज़ तैयार · कोई फ़्रीज़ तैयार नहीं · एक लें |
| Freeze slots a11y | Streak freezes: {n} of {max} ready. Opens your streak calendar | स्ट्रीक फ़्रीज़: {max} में से {n} तैयार। स्ट्रीक कैलेंडर खुलेगा |
| Revival card (dormant) | Welcome back! Let's wake your plant up: {days} short days. | फिर से स्वागत है! चलिए पौधे को जगाएँ: बस {days} छोटे दिन। |
| Daily goal | {done} of {goal} min today | आज {goal} में से {done} मिनट |
| Guest link (day 2) | Save your plant | अपना पौधा सेव करें |
| Hero, start here | Start here · [Start] | यहाँ से शुरू करें · [शुरू करें] |
| Hero, review | Review first · {count} today · {minutes} min · [Review] | पहले दोहराएँ · आज {count} · {minutes} मिनट · [दोहराएँ] |
| Hero, comeback plan | Comeback plan · day {d} of {n} · {count} today · [Review] | वापसी योजना · {n} में से दिन {d} · आज {count} · [दोहराएँ] |
| Hero, continue | Continue · {percent}% done · [Resume] | जारी रखें · {percent}% पूरा · [आगे पढ़ें] |
| Hero, next topic | Up next · [Start deep dive] / [Start quick revision] | अगला · [डीप डाइव शुरू करें] / [क्विक रिविज़न शुरू करें] |
| Hero, streak saver (reviews) | Save your streak · 10 reviews keep your plant happy · [Do it now] | अपनी स्ट्रीक बचाएँ · 10 रिव्यू से पौधा खुश रहेगा · [अभी करें] |
| Hero, streak saver (daily challenge) | Save your streak · Today's challenge · {minutes} min · [Do it now] | अपनी स्ट्रीक बचाएँ · आज का चैलेंज · {minutes} मिनट · [अभी करें] |
| Hero, streak saver (lesson) | Save your streak · Just {minutes} min keeps your plant happy · [Do it now] | अपनी स्ट्रीक बचाएँ · बस {minutes} मिनट में पौधा खुश रहेगा · [अभी करें] |
| Hero, goal met | Today's goal done! · Want one more? · [One more] | आज का लक्ष्य पूरा! · एक और करें? · [एक और] |
| Strip label | Up next in {chapter_title} · {n} topics left | {chapter_title} में आगे · {n} टॉपिक बाकी |
| Strip chips | Cheat sheet · See chapter | चीट शीट · अध्याय देखें |
| Review node | Review {n} | {n} दोहराएँ |
| Review node a11y | Review {n} cards from {topic_title} | {topic_title} के {n} कार्ड दोहराएँ |
| Secondary, continue | Or continue {topic_title} | या {topic_title} जारी रखें |
| Secondary, reviews | {count} today · {minutes} min | आज {count} · {minutes} मिनट |
| Secondary, fading (Phase 2) | {topic_title} is fading · {n} cards | {topic_title}: याद कमज़ोर हो रही है · {n} कार्ड |
| Secondary, weak spot | Practise {concept_name} | {concept_name} का अभ्यास करें |
| Plan row | Today's plan · {done} of {total} done | आज की योजना · {total} में से {done} पूरे |
| All caught up | All caught up! Next review in {duration} | सब दोहरा लिया! अगला रिव्यू {duration} में |
| Find my level card | Already know some of this? · Find your level in {count} quick questions. Nothing gets locked. · [Start] · [Not now] | इसमें से कुछ पहले से आता है? · {count} छोटे सवालों में अपना लेवल जानें। कुछ भी लॉक नहीं होगा। · [शुरू करें] · [अभी नहीं] |
| Subjects heading | Your subjects | आपके विषय |
| Tile next | Next: {topic_title} | अगला: {topic_title} |
| Tile meta | {n} chapters | {n} अध्याय |
| Memory tile | Memory · Decks, palaces and focus timer | मेमोरी · डेक, पैलेस और फ़ोकस टाइमर |
| Library tile | Library · Formulas, notes and saved cards | लाइब्रेरी · सूत्र, नोट्स और सेव किए कार्ड |
| Exam passed card | How did {exam_name} go? Set your next goal. · [Set next goal] · [Not now] | {exam_name} कैसा रहा? अपना अगला लक्ष्य चुनें। · [अगला लक्ष्य चुनें] · [अभी नहीं] |
| Pet line, new user (in the hero kicker area, optional) | Let's start with something short. | चलिए, कुछ छोटे से शुरू करें। |
| Pet line, at risk | One quick one and we're done for today! | बस एक छोटा-सा, और आज का काम पूरा! |
| Pull to refresh | (pet peeks, no text) | |

**Illustration slots:**
| Slot | Preset | Ratio / size | Shows | Alt intent |
|---|---|---|---|---|
| Greeting avatar | `pet-cat` / `pet-dog` via Rive | 1:1, 40 | The student's pet, mood from `game.pets` | "{pet_name}, looking {mood}" |
| Streak card plant | `plant-stage` via Rive | 1:1, 96 | Stage × health | "Your plant: {stage}, {health}" |
| Hero card, lesson | `sunny-object` (topic or chapter art), fallback subject object | 1:1, 140 | The topic's object | Decorative (title carries meaning) |
| Hero card, review or challenge | `pet-cat` / `pet-dog` via Rive, `curious` pose | 1:1, 140 | The pet holding a card | Decorative |
| Subject tiles | `sunny-object` per subject | 1:1, 72 | Subject object | Decorative |
| Path strip nodes | none (UI shapes and Phosphor icons) | | | |
| Revival card | `plant-stage` dormant | 1:1, 96 | Resting plant with one bud | "Your plant is resting" |

**States:**
- **Default:** as laid out.
- **Loading:** never a spinner. First paint from `profile_snapshot`. Parts that are not in the snapshot (for example the plan count on first ever launch) show a 16 tall `surfaceSunken` skeleton bar for at most 1 s, then hide if still unknown.
- **New user:** hero `start_here`, pet line shown, strip shows the suggested chapter with node 1 as Next, subject bars hidden, plan row "0 of {n} done".
- **Self-rated "Know the basics" or "Revising":** Find my level card under the plan row. After [Not now] it moves to LRN-01's overflow and HOME-02's footer.
- **Guest:** identical to signed in, plus the day-2 "Save your plant" link (flow §5.4). No login banner.
- **Streak at risk:** streak card `warningTint`, pet avatar in "thinking", hero `streak_saver` with `primary` fill, using the fastest qualifier (10 reviews, then the daily challenge, then finishing the bite in progress, then a quick revision). Copy is never guilt-tripping (X9).
- **Freezes:** slots as laid out; "No freezes ready · Get one" when empty. A freeze used overnight shows once as the state line "A freeze kept your streak safe." / "एक फ़्रीज़ ने आपकी स्ट्रीक बचा ली।".
- **Rest day:** rest-day line, no at-risk state, no streak-saver hero.
- **Incident freeze:** incident line; decay paused; no at-risk state.
- **Plant thirsty / dry / wilted:** plant art and the line change. Card stays `streakTint` (not warning) unless also at risk.
- **Rescue link:** when today is not yet a streak day and the card is in its at-risk state or the plant is droopy, dry or wilted, a ghost link "2-minute rescue" sits under the state line and opens `/review?set=rescue` (MEM-03 rescue mode, then MEM-32; memory-labs flow §5.13). Not shown when the plant is dormant, on a rest day or when no card is due or near due.
- **Plant dormant:** revival card replaces the streak card (tap → ME-08). Hero is the shortest free bite.
- **Review due:** hero `review` when today's capped count ≥ `home.review_hero_min_cards`, otherwise a secondary row. The count is always today's capped number (R22), never the backlog. Tap goes to MEM-03, or MEM-02 when the backlog rule or a comeback plan applies.
- **Comeback plan active:** comeback copy on the review hero or row.
- **No reviews due:** no review row; plan row second line "All caught up".
- **Offline:** banner; hero chooses on-device content only; tiles and nodes without local bundles show "Needs internet" chips. If nothing is on the device beyond the seed pack, the hero points at the seed chapter.
- **Error (summary failed):** no visible error; snapshot shown. On manual pull-to-refresh failure: Toast "Couldn't refresh. Showing saved data." / "रिफ़्रेश नहीं हुआ। सेव डेटा दिख रहा है।"
- **Free vs Pro:** free shows "Free today" chips; Pro shows nothing extra. No Pro banner or card on Home for anyone (R15).
- **All-exams app:** exam chip top left. **Per-exam app:** no chip, unless the variant has more than one profile. **"Just curious":** chip reads "Exploring"; grid shows the `curious` catalogue profile; no countdown anywhere.
- **Minor (13–17):** no change. No league chip on Home for anyone.
- **Little learner:** this screen is replaced by HOME-06.
- **Dark mode:** Night Colour tokens. Hero fill uses dark `strong` with dark ink (`onStrong`). Shadows replaced by `surfaceRaised`. Illustrations unchanged.

**Interaction and motion:**
- Tap feedback scale 0.97, `fast`, light haptic.
- Hero change (for example after finishing a review) cross-fades the card content over `base` with spring `gentle` height change. The card never jumps position.
- Path strip: horizontal swipe with momentum, snap to node. Current node does one gentle pulse (scale 1 → 1.06 → 1, `emphasis`) on first appearance per day. A finished review node shrinks out (`base`) and the line closes the gap.
- Streak +1 from a lesson: when Home reappears, the plant plays `water`, then `grow` if the stage changed; the pill number flips (`emphasis`). Medium haptic, chime (DESIGN §8).
- A freeze used: the slot's snowflake melts into the dashed ring once (`base`), static in reduced motion.
- Pull to refresh: the pet peeks from the top (UX_FLOW §3), light haptic.
- Hero illustration tilts with the gyroscope by at most 6° (DESIGN §7.3), off in reduced motion and on low-end devices.
- Reduced motion: no pulse, no tilt, plant and pet frozen on static poses, cross-fades only.

**Accessibility:**
- Focus order: exam chip → streak pill → gem pill → search → greeting → offline banner → streak card (state line, goal, freeze slots, plant) → hero → strip (one list, "Topic {n} of {total}, {title}, {state}" and review nodes as "Review {n} cards from {topic_title}") → strip chips → secondary row → plan row → Find my level card → subject tiles → Memory tile → Library tile.
- The hero card is one button with the label "{kicker}: {title}, {meta}. {button text}".
- Path nodes: each a button with name and state from §0.3; the joining line is decorative.
- Freeze slots say the count in words; a ready slot and an empty slot differ in shape (filled icon vs dashed ring), not only colour.
- At 200% text: the grid drops to one column, the hero illustration shrinks to 96 and moves below the title, the strip nodes keep 56 but captions wrap to 3 lines, the Memory and Library tiles stack.
- Streak card state is in words, not just warm colour.

**Analytics:** `home_viewed` (`hero_kind`, `freezes_ready`), `home_hero_tapped`, `home_secondary_tapped` (`kind`), `home_strip_node_tapped` (`node_kind`: topic, review), `chapter_header_cheat_sheet_tapped` (from the strip chip, `surface` = home), `home_subject_tapped`, `home_memory_tile_tapped`, `home_library_tile_tapped`, `home_offline_banner_shown`, `freeze_slots_tapped`, `find_level_card_shown`, `find_level_card_action`, `exam_switcher_opened`, `soft_login_triggered` (trigger `streak_day_2`; AUTH owns the sheet events).

**Web (≥ 600 px):** the left sidebar (UX_FLOW §4.17) holds the exam chip at its top, then the compact streak card (plant, freeze slots) and the pet, so the streak card leaves the main column. Main column max 1040: two columns. Left (min 420): hero, path strip, secondary row, plan card expanded inline (top 3 plan items, not just a row), Find my level card. Right: subjects grid in 2 columns (3 at ≥ 1280), Memory and Library tiles. Search becomes a search field in the top bar ("/" focuses it). Hover states on tiles: `surfaceRaised` + card shadow.

**Mock priority:** **P0** (default, new user, streak at risk with freeze slots, offline). Find my level card, guest day-2, rest day and dormant: P1.

---

### HOME-02 · Today's plan
**Purpose:** Show today's plan built from the exam date, due reviews and mastery, and let the student work through it. **Main action:** [Start] on the first unfinished item.
**Entry → exits:** HOME-01 plan row, widget "Plan", deep link `smriti.app/plan`, notifications → MEM-03 or MEM-02 (review item), LRN-03 / LES-01 (learn item), LRN-07 (revise item), PRC-03 (drill item), MOCK-02 (mock item), PRC-11 (daily challenge item), HOME-03, HOME-08 (footer link).

**Layout (top to bottom):**
1. Top bar: back, title "Today's plan", right: [Change plan] ghost (opens HOME-03).
2. **Countdown card:** `primaryTint`, radius 20, `CalendarBlank` 32 in `primary`, "{exam_name} in {days} days" in `heading` (only when a target date exists; hidden for "Not sure yet" and "Just curious"), and the daily-goal ring 56 (stroke 10, `primary`) with "{done}/{goal} min".
3. Pet line: one line about the plan ("Reviews first, then something new.").
4. **Plan list:** ordered items, each a 72 tall row on `surface`, radius 16, 8 apart: leading kind icon 32 in a tint circle (review `Cards` in `primary` on `primaryTint`; learn `BookOpen` and revise `Lightning` in subject `text` on subject tint; drill `Target`, mock `Timer` and daily challenge `CalendarStar`, each in `primary` on `primaryTint`), title `label`, meta `caption` ("{minutes} min · {subject_name}"), trailing either [Start] (Button secondary 40; the first unfinished item gets Button primary 40) or a `Check` in a `successTint` circle with "Done" caption.
5. Footer: when the plan was built on the device, `caption` `inkMuted` "Plan made on this device". For ONB-07 "Know the basics" or "Revising" students who have not done it: ghost link "Find my level" → HOME-08.
6. **Plan done state:** an Empty state block (pet celebrating, 160) with "Plan done! Extra is a bonus." and [Back to Home].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Today's plan | आज की योजना |
| Change | Change plan | योजना बदलें |
| Countdown | {exam_name} in {days} days | {exam_name} में {days} दिन बाकी |
| Item, reviews | Review {n} cards | {n} कार्ड दोहराएँ |
| Item, learn | Learn {topic_title} | {topic_title} सीखें |
| Item, revise | Revise {topic_title} | {topic_title} दोहराएँ |
| Item, drill | Drill: {concept_name} | अभ्यास: {concept_name} |
| Item, mock | Mock: {mock_title} | मॉक: {mock_title} |
| Item, daily challenge | Today's challenge | आज का चैलेंज |
| Meta | {minutes} min · {subject_name} | {minutes} मिनट · {subject_name} |
| Start / Done | Start · Done | शुरू करें · पूरा |
| Pet line | Reviews first, then something new. | पहले दोहराई, फिर कुछ नया। |
| Local plan | Plan made on this device | यह योजना इस डिवाइस पर बनी है |
| Find my level link | Find my level | अपना लेवल जानें |
| Done state | Plan done! Extra is a bonus. · [Back to Home] | योजना पूरी! अब जो करें, वह बोनस है। · [होम पर जाएँ] |

**Illustration slots:** Done state: `empty-state` preset, 4:3, the pet stretching happily next to the plant, alt "{pet_name} is happy, plan done". Item icons are Phosphor.

**States:**
- **Default / loading:** cached plan shows instantly; refreshed silently.
- **Offline:** local plan (flow §8), footer note. Drill, mock and challenge items need their bundles or the network; without them they show "Needs internet".
- **Empty (no plan yet, first minutes after onboarding):** list shows the onboarding-based local plan; never empty.
- **Error:** same as offline.
- **Free vs Pro:** no Pro items appear for free students; the generator swaps them (flow §8). Drill items count toward the free practice cap, which PRC-03 shows.
- **Guest:** same.
- **Little learner:** not shown; HOME-06 has no plan screen (the path is the plan).
- **Dark mode:** tints to dark tints.

**Interaction and motion:** finishing an item elsewhere and returning animates its check (`pop` spring) and moves the primary button to the next item (`base`). Rows are not reorderable here (HOME-03 handles changes).

**Accessibility:** each row is one button: "{title}, {meta}, {state}". The ring has a text equivalent. Focus starts on the first unfinished item.

**Analytics:** `plan_viewed`, `plan_item_started` (`item_kind`, `position`).

**Web (≥ 600 px):** rendered inline in Home's left column (top 3) with "See all" opening this as a right panel. Full page at < 600.

**Mock priority:** P1.

---

### HOME-03 · Change today's plan (sheet)
**Purpose:** Let the student fit the plan to the time they have or swap an item. **Main action:** [Update plan].
**Entry → exits:** HOME-02 [Change plan] → HOME-02.

**Layout (top to bottom):**
1. Sheet 60%, title "Change today's plan" `heading`.
2. "Time I have today": segmented control (track `surfaceSunken`) with the options from `plan.time_options` (minutes). Default = profile daily goal.
3. List of current items, each with a trailing [Swap] ghost (`ArrowsLeftRight`). Swap shows up to `plan.swap_alternatives_max` alternatives inline (radio rows), from the same plan generator.
4. Pinned [Update plan] primary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Change today's plan | आज की योजना बदलें |
| Time label | Time I have today | आज मेरे पास समय |
| Minutes | {n} min | {n} मिनट |
| Swap | Swap | बदलें |
| Update | Update plan | योजना अपडेट करें |
| Note | Your daily goal stays the same. | आपका रोज़ का लक्ष्य वही रहेगा। |

**Illustration slots:** none.

**States:** default; offline (changes apply to the local plan and sync as events); error (none visible); dark mode.

**Interaction and motion:** choosing a time reflows the list with `gentle` spring; items that drop out fade to 40% with a "Later" / "बाद में" caption. Light haptic on segment change.

**Accessibility:** segmented control is a radio group with "minutes" in each label. Swap alternatives announce "{n} options".

**Analytics:** `plan_changed` (`change_kind`: time, swap; `minutes`).

**Web (≥ 600 px):** a centred dialog 480 wide.

**Mock priority:** P2.

---

### HOME-04 · Exam switcher (sheet)
**Purpose:** Switch the exam that Home, search and the plan follow. **Main action:** tap an exam row.
**Entry → exits:** HOME-01 exam chip, PRC-01 and MOCK-01 (practice reuses this sheet) → the calling screen (re-rendered); [Add an exam] → ONB-02 → ONB-06 (`add` mode) → back here; "Manage exams" → ME-03.

**Layout (top to bottom):**
1. Sheet 60%, title "Your exams".
2. Rows (72): exam icon 40 (Phosphor, or `sunny-object` exam art), exam name `label`, "{days} days to go" `caption` (if date set), trailing radio check for the active one.
3. Note in `caption` `inkMuted`: "Switching keeps your progress on shared topics."
4. League note (Phase 2, only when the student is in a league; SOC-08 owns the rule): "Your league stays the same until Sunday."
5. [Add an exam] secondary, full width. Under it, "Manage exams" ghost → ME-03.
6. **"Just curious" variant:** one row "Exploring" checked, and [Pick an exam] primary in place of [Add an exam].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Your exams | आपकी परीक्षाएँ |
| Days | {days} days to go | {days} दिन बाकी |
| No date | Date not set | तारीख तय नहीं |
| Note | Switching keeps your progress on shared topics. | बदलने पर साझा टॉपिक की प्रगति बनी रहती है। |
| League note | Your league stays the same until Sunday. | आपकी लीग रविवार तक वही रहेगी। |
| Add | Add an exam | परीक्षा जोड़ें |
| Manage | Manage exams | परीक्षाएँ संभालें |
| Exploring row | Exploring | एक्सप्लोर मोड |
| Pick an exam | Pick an exam | परीक्षा चुनें |
| Toast after switch | Now showing {exam_name} | अब {exam_name} दिख रहा है |

**Illustration slots:** exam row art: `sunny-object` per exam category (optional; Phosphor fallback). Decorative.

**States:** default; offline (switch allowed, toast adds "Some lessons need internet" / "कुछ पाठों के लिए इंटरनेट चाहिए"); per-exam app with several profiles (only those, no [Add an exam]); Just curious; opened from PRC-01 or MOCK-01 (same sheet, closes back to that screen); dark mode.

**Interaction and motion:** tapping a row checks it (`pop`), closes the sheet after 200 ms, the calling screen cross-fades. Light haptic.

**Accessibility:** radio group "Your exams". Active exam announced first.

**Analytics:** `exam_switched` (`surface`: home, practice, mock), `exam_added`.

**Web (≥ 600 px):** a popover anchored to the chip, 360 wide.

**Mock priority:** P1.

---

### HOME-05 · Global search
**Purpose:** Find any topic, formula, PYQ, lab, element, deck or own note fast. **Main action:** tap a result.
**Entry → exits:** search icon on any main screen, "/" on web → LRN-03 (topic), LRN-10 (formula), PRC-07 at that question (PYQ; PRC-17 when the free daily cap is used), LAB-03 (lab), LAB-14 (element), MEM-08 (deck), MEM-17 (palace, Phase 2), LRN-13 (note, Phase 2), LES-01 (saved card in context), AI-02 with the query pre-filled (no results), back.

**Layout (top to bottom):**
1. Search field pinned at the top (input radius 16, `surfaceSunken`, 48 tall, `MagnifyingGlass` leading, clear `X` trailing), keyboard opens on entry. Cancel text button on the right.
2. Scope chips row (horizontal): All, Topics, Formulas, PYQs, Labs, Mine. Filter chips (`surfaceRaised`).
3. **Before typing:** "Recent" heading + up to `search.recent_max` recent rows (`ClockCounterClockwise` 20, text, trailing `X` to remove) and [Clear] ghost. Below: "Try" chips with the current chapter's topic names (from content, not suggestions about the student's weak spots).
4. **Results**, grouped in this order, each group with a heading and at most 3 rows plus "See all {n}":
   - Topics: row with subject-tint square 40 (`sunny-object` thumbnail), topic title with the matched part in `ink` 700, "{subject_name} · {chapter_title}" `caption`.
   - Formulas: row with a mini Formula box (KaTeX SVG, max height 40), name, chapter.
   - PYQs: row with "{exam_name} {year} · {session_label}" and the first line of the stem. No Pro chip (R25).
   - Labs and elements: lab rows with the lab thumbnail and name; element rows with the symbol in a 40 square on `surfaceSunken`, the element name and "Element {number}" `caption`.
   - Memory: deck rows (`Cards`, deck name, "{n} cards") and palace rows (`Buildings`, palace name; Phase 2).
   - Your notes and cards: row with `NotePencil` or `BookmarkSimple` icon, title.
5. Offline: caption above results "Showing results on this device".
6. **No results:** Empty state: pet "thinking" illustration 160, "Couldn't find that. Ask {pet_name} instead?", [Ask {pet_name}] primary, hint "Try a shorter word or check the spelling." in `caption`.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Placeholder | Search topics, formulas, PYQs, labs | टॉपिक, सूत्र, PYQ, लैब खोजें |
| Cancel | Cancel | रद्द करें |
| Scopes | All · Topics · Formulas · PYQs · Labs · Mine | सभी · टॉपिक · सूत्र · PYQ · लैब · मेरे |
| Recent / Clear | Recent · Clear | हाल की खोजें · मिटाएँ |
| Try | Try | आज़माएँ |
| Group headings | Topics · Formulas · Previous-year questions · Labs and elements · Memory · Your notes and cards | टॉपिक · सूत्र · पिछले वर्षों के प्रश्न · लैब और तत्व · मेमोरी · आपके नोट्स और कार्ड |
| Element meta | Element {number} | तत्व {number} |
| Deck meta | {n} cards | {n} कार्ड |
| See all | See all {n} | सभी {n} देखें |
| Offline | Showing results on this device | इस डिवाइस पर मौजूद नतीजे |
| No results | Couldn't find that. Ask {pet_name} instead? | यह नहीं मिला। {pet_name} से पूछें? |
| No results CTA | Ask {pet_name} | {pet_name} से पूछें |
| No results hint | Try a shorter word or check the spelling. | छोटा शब्द आज़माएँ या स्पेलिंग जाँचें। |
| Error | Search isn't working right now. Showing results on this device. | अभी खोज नहीं चल रही। इस डिवाइस के नतीजे दिख रहे हैं। |

**Illustration slots:** no-results: `empty-state`, 4:3, the pet looking through a magnifying glass at an empty book, alt "{pet_name} couldn't find it". Result thumbnails reuse existing topic and lab art.

**States:**
- **Default (empty query):** recent + try chips.
- **Loading:** results area shows 3 skeleton rows per group after 300 ms; local results appear first and server results merge in without reordering what is already under the finger.
- **Empty:** no-results block.
- **Error / offline:** local results with the caption. Offline search covers device content plus the student's decks, palaces, notes and bookmarks.
- **Guest:** same; "Mine" shows only device items.
- **Free vs Pro:** no chips. Opening a PYQ uses the free daily cap (R25); at the cap PRC-17 opens instead.
- **Phase 2 parts:** the palace rows and note rows appear only once MEM-17 and LRN-13 ship.
- **Little learner:** search is not shown (HOME-06 has no search).
- **Dark mode:** tokens swap.

**Interaction and motion:** debounce 250 ms. Results fade in (`base`). Enter on the keyboard opens the first result. Tapping a recent row fills and runs it. Removing a recent row slides it out (`base`).

**Accessibility:** field label "Search". Each group is a labelled region with its count announced ("Topics, 3 results"). The highlighted match is also bold, not only colour. Results reachable by keyboard on web (arrow keys move, Enter opens).

**Analytics:** `search_opened`, `search_performed` (query length only, never the query), `search_result_tapped` (`group`, `position`), `search_recent_tapped`, `search_recent_cleared`, `search_no_results_tutor_tapped`.

**Web (≥ 600 px):** a command-palette style overlay, 640 wide, centred at 15% from the top, with groups in one column; "/" opens, Escape closes.

**Mock priority:** **P0** (results with groups, no results).

---

### HOME-06 · Little learner Home (class 1–5) · Phase 3
**Purpose:** Give a young child one big, safe thing to tap, and give the parent a way in. **Main action:** [Play] on the current node.
**Entry → exits:** launch (after AUTH-25 "Who's learning?" picks the child), tab tap → LES-01 (little-learner variant) or LRN-11 (storybook); subject picture button → that subject's current unit path (same screen, re-rendered); "For grown-ups" (hold) → SET-13 → SET-14; time limit reached → SET-19; tutor button (only if the parent turned it on in SET-14) → AI-02 little-learner variant.

**Layout (top to bottom):**
1. Header 64: pet avatar 56 (tap = the pet does a `pet` trigger and says a line aloud), star counter pill (XP shown as stars, `Star` fill 20 in `primary`, tabular, on `primaryTint`), and a small "For grown-ups" text button top right (`caption`, `inkMuted`, `Lock` 16, 48 target, hold to open).
2. Pet line, larger: bubble text in `heading`, speaker button 48 to replay.
3. **Path:** a vertical, gently zig-zag path of big round nodes (88), at most 7 in view, joined by a dotted `track` path. Each node shows a `sunny-object` or `storybook` thumbnail, not a number. The current node is 112 with the pet sitting next to it and a giant [Play] primary button (64 tall, rounded `button`) directly under it. Done nodes have a `Star` badge. Upcoming nodes are full colour (nothing locked by order).
4. **Subject buttons** at the bottom, above the tab bar: 3–4 big circles (72) with subject object art and the name under each in `label`. The active subject has a 3 px `primary` ring and the word "Now" in the caption.
5. **Tab bar:** three tabs, Learn, Labs, Me (R14).
6. **No tutor button by default** (R14). When a parent turns it on in SET-14, the floating button appears at 64 with the same placement as §0.1.

**Copy (little learner, तुम):**
| Key | EN | HI |
|---|---|---|
| Pet greeting | Ready for an adventure? | चलो, एक नई सैर पर! |
| Pet after a node | Yay! One more? | वाह! एक और? |
| Play | Play | खेलो |
| Today's story label | Today's story | आज की कहानी |
| Stars a11y | {n} stars | {n} सितारे |
| Grown-ups | For grown-ups | बड़ों के लिए |
| Grown-ups a11y | For grown-ups, press and hold | बड़ों के लिए, दबाकर रखो |
| Subject now | Now | अभी |
| Needs internet | Ask a grown-up to connect to the internet. | इंटरनेट चालू करने के लिए किसी बड़े से कहो। |
| Pro node | Ask a grown-up | किसी बड़े से पूछो |

**Illustration slots:**
| Slot | Preset | Ratio | Shows | Alt intent |
|---|---|---|---|---|
| Path nodes | `storybook` or `sunny-object` | 1:1 | The story or activity's main object | "{activity_title}" |
| Pet beside node | `pet-cat` / `pet-dog` Rive, little-learner moods only | 1:1 | Pet waiting happily | "{pet_name} is waiting for you" |
| Subject buttons | `sunny-object` | 1:1 | Subject object | "{subject_name}" |
| Background | `sunny-scene`, soft tint, very low detail | 3:2 behind the path top | A gentle outdoor scene in the subject tint | Decorative |

**States:**
- **Default:** as laid out.
- **Loading:** path from snapshot; thumbnails fade in.
- **Offline:** nodes without bundles show a cloud icon and, when tapped, the pet says the "Needs internet" line aloud. No banner text wall.
- **Login:** little learners never see a login sheet. At the 3rd lesson LES-08 shows the "Ask a grown-up to save your stars" row (→ SET-13 → AUTH-24).
- **Free vs Pro:** nothing about money is shown to the child. A gated node shows a small `Lock` badge; tapping it plays "Ask a grown-up" aloud and opens LRN-05 (`u10` variant), whose button needs the parent gate.
- **Plant and pet:** only happy, excited, curious and sleepy; the plant never goes past droopy here (flow §5.6).
- **Time limit reached:** the current card finishes, then SET-19.
- **Tutor turned on by a parent:** button visible; it opens the chips-only AI-02 variant.
- **Dark mode:** supported, but the default for little learners is light unless the parent changes it.

**Interaction and motion:** the pet hops to the next node after a completed activity (`pop`, 400 ms). [Play] bounces once on appear. Every tap on a label speaks it (TTS cached). Sounds on by default unless the phone is silent. Reduced motion: no hops, pet static.

**Accessibility:** large targets (≥ 64 for main actions). Every node is labelled with its title and done state ("done, 3 stars"). Text is minimal; audio carries meaning; captions for spoken lines appear in the bubble. The parent gate is not reachable by a single tap (hold 2 s), and that is announced to screen readers.

**Analytics:** `home_viewed` (`is_little_learner` = true) only, plus learning events (flow §14).

**Web (≥ 600 px):** the path is centred, 560 wide, with subject buttons in a row below it; no sidebar for little learners, a top bar with the grown-ups button instead.

**Mock priority:** **P0** (for the Phase 3 mock set).

---

### HOME-07 · Retired

The little learner break screen moved to **SET-19 "Time's up"** (me+money), which owns the layout and copy. The ID HOME-07 is not reused. HOME-06 and LES-01 hand off to SET-19 when the SET-16 limit is reached (after the current card finishes).

---

### HOME-08 · Find my level (intro sheet)
**Purpose:** Offer a short, optional check that starts a confident student further along, without locking anything (R27). **Main action:** [Start].
**Entry → exits:** HOME-01 Find my level card, LRN-01 overflow "Find my level", HOME-02 footer link → LES-12 (`mode=check`, `kind=placement`) → LES-13; [Not now] → back.

**Layout (top to bottom):**
1. Sheet 60%. Pet line (pet `curious`): "Let's see where to start."
2. `Gauge` 40 in `primary` on a `primaryTint` circle, then the title "Find my level" in `heading`.
3. Body in `body`: "{count} quick questions · about {minutes} min." and, on a second line, "Nothing gets locked. You can redo it anytime." `{count}` is `learn.find_level_questions` (5 per R27).
4. **Subject row** (only when the exam has more than one subject with a placement set): "Subject" `label`, then single-select chips with the subject names; the current subject is preselected. Subjects without a placement set are not listed.
5. Last result line (redo only): `caption` `inkMuted` "Last time: start from {chapter_title}".
6. Buttons stacked: [Start] primary, [Not now] ghost.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Pet line | Let's see where to start. | चलिए देखें, कहाँ से शुरू करें। |
| Title | Find my level | अपना लेवल जानें |
| Body | {count} quick questions · about {minutes} min. | {count} छोटे सवाल · लगभग {minutes} मिनट। |
| Reassurance | Nothing gets locked. You can redo it anytime. | कुछ भी लॉक नहीं होगा। इसे कभी भी दोबारा किया जा सकता है। |
| Subject label | Subject | विषय |
| Last result | Last time: start from {chapter_title} | पिछली बार: {chapter_title} से शुरुआत |
| Start | Start | शुरू करें |
| Not now | Not now | अभी नहीं |

**Illustration slots:** none beyond the pet avatar.

**States:** default; redo (last result line; the result replaces placement marks that no lesson or review has confirmed since, flow §6.5); one subject (no subject row); offline (works when the placement set is on the device, which it is for the seed pack's subjects; else the [Start] button reads "Needs internet" and is disabled); guest (same; marks sync after sign-in); dark mode.

**Interaction and motion:** sheet `slow`; chip select `fast`, light haptic; [Start] fades the sheet into LES-12 (`base`).

**Accessibility:** focus on the title; the reassurance line is part of the sheet's description; the subject chips are a radio group "Subject".

**Analytics:** `find_level_card_action` (`start`, `dismiss`; `surface`: home, subject_map, plan), then `lesson_started` (`mode` = check) and `check_completed` from LES-12 and LES-13.

**Web (≥ 600 px):** centred dialog 440 wide.

**Mock priority:** P1.

---
## LRN

### LRN-01 · Subject map
**Purpose:** Show every chapter of a subject for the current exam, with progress, so the student can pick one. **Main action:** tap a chapter card.
**Entry → exits:** HOME-01 subject tile, HOME-05 → LRN-02, LRN-15 (overflow "Download subject"; free students see LRN-05 first), LRN-14 (overflow "Subject mind map", Phase 2), HOME-08 (overflow "Find my level", when the subject has a placement set), back.

**Layout (top to bottom):**
1. **Header block** in the subject tint (full bleed, 200 tall incl. status bar): back button, search icon, overflow `DotsThree` (Download subject, Subject mind map, Find my level). Subject name in `display` in subject `text`, "{done} of {total} chapters · {percent}%" in `label` `inkMuted`, progress bar 8 in subject `strong`. Subject illustration 160 overlapping the bottom-right edge by 24.
2. **Filter chips** (sticky under the header once it collapses): All, In progress, Not started, Weak. "Weak" only appears once the student has answered at least `learn.weak_filter_min_attempts` questions in the subject.
3. **Unit sections:** unit name in `heading` with "{n} chapters" `caption`. Then chapter cards, full width, 12 apart: `surface`, radius 20, card shadow, padding 16, min height 96. Left: chapter illustration 64 on the subject tint circle. Middle: chapter number in `caption` subject `text` ("Chapter {n}"), chapter name in `heading` (up to 3 lines), meta row of chips: Free / Free today / Pro (only one of these), High-yield (only from real data), "{n} PYQs" (only when `pyq_count` is known), Downloaded. Right: progress ring 44 (stroke 6, subject `strong`, % in `caption` inside).
4. The first 2 chapters of every subject (in the exam profile's chapter order) carry the Free chip for free students; other chapters carry Pro, except the rotating "Free today" chapter. Pro students see none of these chips.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Progress | {done} of {total} chapters · {percent}% | {total} में से {done} अध्याय · {percent}% |
| Filters | All · In progress · Not started · Weak | सभी · जारी · शुरू नहीं · कमज़ोर |
| Unit meta | {n} chapters | {n} अध्याय |
| Chapter kicker | Chapter {n} | अध्याय {n} |
| PYQ chip | {n} PYQs | {n} PYQ |
| Overflow | Download subject · Subject mind map · Find my level | पूरा विषय डाउनलोड करें · विषय का माइंड मैप · अपना लेवल जानें |
| Empty filter | Nothing here yet. Try "All". | अभी यहाँ कुछ नहीं। "सभी" देखें। |
| Weak filter empty | No weak chapters right now. Nice! | अभी कोई कमज़ोर अध्याय नहीं। बढ़िया! |
| Ring a11y | {percent}% done | {percent}% पूरा |

**Illustration slots:**
| Slot | Preset | Ratio | Shows | Alt |
|---|---|---|---|---|
| Header | `sunny-object` | 1:1, 160 | The subject's hero object | Decorative |
| Chapter card | `sunny-object` | 1:1, 64 | The chapter's object | Decorative (name carries meaning) |
| Empty filter | `empty-state` | 4:3, 160 | Pet peeking into an empty box | "Nothing here yet" |

**States:** default; loading (chapter list from the manifest on device, never blank); empty filter; offline (chapters without bundles show "Needs internet", still open LRN-02 because chapter metadata is in the manifest); guest (same); free vs Pro (chips as above); no placement set (no "Find my level" in the overflow); Phase 1 (no "Subject mind map" until LRN-14 ships in Phase 2); little learner (not used: HOME-06 subject buttons switch the path instead); dark mode (header uses dark tint, title in dark subject `text`).

**Interaction and motion:** header collapses on scroll to a 56 bar with the subject name, `base`; filter chips stick. Chip change cross-fades the list (`base`). Pull to refresh re-checks the manifest.

**Accessibility:** header title is the screen heading. Each chapter card is one button: "Chapter {n}, {name}, {percent}% done, {chips}". Filters are a radio group. At 200% text the illustration moves above the title and the ring sits under the meta.

**Analytics:** `subject_map_viewed`, `subject_filter_changed`, `find_level_card_action` (`start`, `surface` = subject_map).

**Web (≥ 600 px):** two-pane: subject list (all subjects, compact rows) on the left 320, chapter list on the right. Chapter cards in 2 columns at ≥ 1024. Selecting a chapter opens LRN-02 in the right pane, with the chapter list collapsing to the left pane (list → detail).

**Mock priority:** **P0**.

---

### LRN-02 · Chapter
**Purpose:** Show the chapter as an ordered path of topics with clear done, next, review and Pro states, plus the chapter tools. **Main action:** the pinned [Continue: {topic_title}] (or [Start: {topic_title}]).
**Entry → exits:** LRN-01, HOME-01 strip "See chapter" or "+n", HOME-05 → LRN-03, LRN-04 (via LRN-03), header card → LRN-08 (chapter cheat sheet; A16), LRN-08 (formula sheet view), review node → MEM-03 `?topic=`, Practise tool → PRC-03 (chapter prefilled), chapter test row → LRN-06, LRN-14 (Phase 2), LRN-15, long-press "Mark as learned" → LES-12 (one topic), overflow "Report a problem" → SET-24, back.

**Layout (top to bottom):**
1. Top bar: back, chapter name in `heading` (wraps to 2 lines), search, overflow (Download chapter, Reset chapter progress, Report a problem).
2. **Chapter header card** (one button, opens LRN-08; A16): subject tint, radius 24, padding 20: "Chapter {n} · {unit_name}" `caption`, chapter name `title`, "{done} of {total} topics · about {minutes} min left" `label`, progress bar 8, then a row with `Note` 20 and "Open cheat sheet" in `label` subject `text` with `CaretRight`. Chapter illustration 120 overlapping the top-right.
3. **Tools row** (horizontal scroll, square tool buttons 80 × 80, `surface`, radius 16, icon 32 + label): Formula sheet (`MathOperations`, only for chapters with formulas), Practise (`Target`, opens PRC-03 with this chapter), Chapter test (`Exam`, opens LRN-06), Mind map (`TreeStructure`, Phase 2), Download (`DownloadSimple`).
4. **Topic rail list:** a vertical rail (4 px line, `track`, filled in subject `strong` down to the furthest learned topic) at 32 from the left. Each topic row: node 44 on the rail (states §0.3), then a `surface` row card radius 16, min height 72: topic title `label` (3 lines max), meta `caption` "{minutes} min · {subtopic_count} parts", chips (Pro, Free today, Needs internet). The **Next** topic's row is expanded (min height 120) with its illustration 64 and an inline [Start] secondary button.
5. **Review rows** (A14): right after a learned topic that has cards due today, a compact row 56 on the rail with a review node (§0.3) and "Review {n} · {minutes} min" in `label`, trailing [Review] ghost → MEM-03 `?topic=`. It disappears when the cards are done.
6. **Chapter test row** at the end of the rail: `Exam` icon node 44, row "Chapter test" with the sub-line from the chapter's state, "Test out or practise" `caption`, and [Open] ghost → LRN-06. Always visible and never locked.
7. Pinned primary CTA: [Continue: {topic_title}] (in progress) or [Start: {topic_title}] (next). When every topic is learned it becomes [Practise this chapter] → LRN-06 (Practise preselected).

**Reset chapter progress (confirm sheet, X13):** Sheet 40%: title "Reset progress in {chapter_title}?", body "Topics go back to not started. Your review cards, XP and streak stay.", [Reset] destructive secondary, [Cancel] ghost. Topics learned by Test out or Find my level are cleared too.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Header kicker | Chapter {n} · {unit_name} | अध्याय {n} · {unit_name} |
| Progress | {done} of {total} topics · about {minutes} min left | {total} में से {done} टॉपिक · लगभग {minutes} मिनट बाकी |
| Header link | Open cheat sheet | चीट शीट खोलें |
| Tools | Formula sheet · Practise · Chapter test · Mind map · Download | सूत्र शीट · अभ्यास · अध्याय टेस्ट · माइंड मैप · डाउनलोड |
| Row meta | {minutes} min · {n} parts | {minutes} मिनट · {n} भाग |
| Next row button | Start | शुरू करें |
| Review row | Review {n} · {minutes} min · Review | {n} दोहराएँ · {minutes} मिनट · दोहराएँ |
| Test row | Chapter test · Test out or practise · Open | अध्याय टेस्ट · टेस्ट आउट या अभ्यास · खोलें |
| CTA continue | Continue: {topic_title} | जारी रखें: {topic_title} |
| CTA start | Start: {topic_title} | शुरू करें: {topic_title} |
| CTA all learned | Practise this chapter | इस अध्याय का अभ्यास करें |
| Chapter learned pet line | You learned the whole chapter! Practise it? | आपने पूरा अध्याय सीख लिया! अभ्यास करें? |
| Long-press actions | Quick revision · Download · Mark as learned | क्विक रिविज़न · डाउनलोड · सीख लिया मानें |
| Overflow | Download chapter · Reset chapter progress · Report a problem | अध्याय डाउनलोड करें · अध्याय की प्रगति रीसेट करें · समस्या बताएँ |
| Reset title | Reset progress in {chapter_title}? | {chapter_title} की प्रगति रीसेट करें? |
| Reset body | Topics go back to not started. Your review cards, XP and streak stay. | टॉपिक फिर से "शुरू नहीं" हो जाएँगे। आपके रिव्यू कार्ड, XP और स्ट्रीक बने रहेंगे। |
| Reset buttons | Reset · Cancel | रीसेट करें · रद्द करें |
| Reset toast | Progress reset | प्रगति रीसेट हो गई |

**Illustration slots:** chapter header: `sunny-object`, 1:1, 120, decorative. Next row: topic `sunny-object`, 1:1, 64, decorative. Chapter learned: `pet-*` proud pose 96 beside the pet line, alt "{pet_name} looks proud".

**States:**
- **Default:** as laid out.
- **Loading:** from the manifest; topic durations come from `bundles` metadata in the manifest.
- **Offline:** rows without local bundles show "Needs internet". The CTA still works if its topic is local; otherwise it shows LRN-16 on tap. Review rows work offline (cards are on the device).
- **Guest:** same.
- **Free vs Pro:** in a Pro chapter, every topic row shows the Pro chip and the CTA reads [Preview: {topic_title}]; Quick revision is still one tap away inside LRN-03. In a free or "Free today" chapter, no chips. Test out is free for everyone; Practise counts toward the free practice cap (PRC-03 shows it).
- **Learned by a check:** topic nodes use the "Learned (checked)" look until a lesson or review confirms them.
- **Minor / little learner:** little learners don't see this screen.
- **All learned:** rail fully filled, pet line, CTA [Practise this chapter].
- **Phase 1:** the Mind map tool is hidden until LRN-14 ships (Phase 2).
- **Dark mode:** rail track `track` dark, fill dark `strong`.

**Interaction and motion:** opening scrolls so the Next row is in the top third. When returning from a finished lesson, the rail fill animates down to the new node (`gentle`, 400 ms) and the node pops (`pop`). Long-press a row: quick actions sheet (Quick revision, Download, Mark as learned). "Mark as learned" opens LES-12 for that one topic (`kind=test_out`, `learn.test_out_questions_per_topic` questions), so learned means learned. Reset: rail empties with a `base` fade; Toast "Progress reset".

**Accessibility:** the rail is decorative; each row is a button "Topic {n} of {total}: {title}, {state}, {minutes} minutes"; review rows read "Review {n} cards from {topic_title}". The Next row is announced with "recommended". The header card is a button "Open {chapter_title} cheat sheet". Tools are buttons with visible labels. The CTA duplicates the Next row action for one-handed use. Reset is a two-step action with a clear destructive label.

**Analytics:** `chapter_viewed`, `chapter_header_cheat_sheet_tapped`, `topic_start_tapped` (from chapter), `chapter_review_row_tapped`, `chapter_test_opened`, `chapter_progress_reset`.

**Web (≥ 600 px):** right pane of the subject two-pane layout; tools become a row of secondary buttons with icons; the CTA is a primary button at the top-right of the header card instead of pinned. Hover on a row shows "Quick revision" and "Download" icon buttons inline.

**Mock priority:** **P0** (with a review row and a Pro row).

---

### LRN-03 · Topic card
**Purpose:** Let the student choose Deep dive or Quick revision for a topic and see what it covers. **Main action:** the pinned [Start deep dive] or [Start quick revision].
**Entry → exits:** LRN-02, HOME-01 hero or strip, HOME-05, deep link `/t/{topicSlug}` (via ENT-06), PRC-05 / MOCK-22 "Learn this topic", MOCK-19 "Fix next", AI-02 "Open lesson", LAB-03 / LAB-07 "Learn the theory" → LES-01 (Deep dive), LRN-07 (Quick revision), LRN-04, LRN-05, LRN-12, LRN-11, LRN-13 (Phase 2), LRN-15, LAB-03 (Lab chip), PRC-03 ("Practise this topic"), AI-10 or AI-07 ("Explain it back", Phase 2), AI-02 (tutor button), memory trick sheet, SET-24 (Report a problem), back.

**Layout (top to bottom):**
1. **Coloured header** (subject tint, 240 tall incl. status bar): back, overflow (Download, Take notes, Report a problem). Large topic illustration 200 centred-right, overlapping the bottom edge by 32. Topic title in `title` (up to 3 lines) and the exam relevance chip ("In {exam_name}") in `caption`, bottom-left. A "Learned" success chip if learned.
2. **Mode choice:** two big cards side by side (each min 156 × 148; stacked vertically at 200% text), radius 20, `surface`, 2 px `line` border; the selected one gets a 2 px subject `strong` border and a `CheckCircle` fill icon top-right.
   - **Deep dive:** `BookOpenText` 32, "Deep dive", "{minutes} min · {n} parts", contents line "Story, visuals, practice". In progress: progress bar 6 and "{percent}% done". Pro-gated: Pro chip and "Preview free".
   - **Quick revision:** `Lightning` 32, "Quick revision", "{minutes} min", "Cheat sheet + rapid cards". If done before: "Last revised {relative_date}".
3. **What you'll learn:** subtopic checklist. Each row: check circle (done = `success` fill with `Check`; not done = `line` ring), subtopic name `label`, "{minutes} min" `caption`, trailing `Play` icon button to start the Deep dive at that subtopic's bite.
4. **Memory trick card** (only when the topic has a memory hook; R11): subject tint, radius 20, `Lightbulb` 24 in subject `text`, "Memory trick" `caption`, the mnemonic text from content in `heading` (2 lines, "Show" expands), small `memory-hook` image 72 if present. Tap → a 60% sheet with the LES-01.15 layout.
5. **Practise and explain row** (only once the topic has any progress): two list rows on `surface`, radius 16. "Practise this topic" (`Target` 24, "{n} questions" `caption`) → PRC-03 prefilled with the topic. "Explain it back" (`ChatTeardropText` 24, Phase 2; shown once the topic is learned) → AI-10, or AI-07 for free students.
6. **Video card** (only when `content.videos` has the topic): `surface`, radius 20, thumbnail 16:9 from YouTube (loaded only online), red `YoutubeLogo` 24 play badge with a text label, title, "{minutes} min". Tap → LRN-12.
7. **More for this topic** row (only when present): Storybook (LRN-11), Lab (LAB-03), Notes (LRN-13, Phase 2). Chips with icons.
8. Pinned CTA: [Start deep dive] / [Resume deep dive] / [Start quick revision] / [Preview deep dive] following the selected mode. Secondary text link under it when Deep dive is gated: "Quick revision is free". The floating tutor button (AI-01) sits above it.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Exam chip | In {exam_name} | {exam_name} में शामिल |
| Learned chip | Learned | सीख लिया |
| Deep dive | Deep dive · {minutes} min · {n} parts · Story, visuals, practice | डीप डाइव · {minutes} मिनट · {n} भाग · कहानी, चित्र, अभ्यास |
| Quick revision | Quick revision · {minutes} min · Cheat sheet + rapid cards | क्विक रिविज़न · {minutes} मिनट · चीट शीट + तेज़ कार्ड |
| Last revised | Last revised {relative_date} | पिछली बार {relative_date} दोहराया |
| In progress | {percent}% done | {percent}% पूरा |
| Preview free | Preview free | मुफ़्त झलक |
| Section | What you'll learn | इसमें क्या सीखना है |
| Memory trick | Memory trick · Show | याद रखने की ट्रिक · दिखाएँ |
| Practise | Practise this topic · {n} questions | इस टॉपिक का अभ्यास करें · {n} सवाल |
| Explain back | Explain it back | अपने शब्दों में समझाएँ |
| Video | Watch the video · {minutes} min | वीडियो देखें · {minutes} मिनट |
| More | Storybook · Lab · Notes | कहानी की किताब · लैब · नोट्स |
| CTAs | Start deep dive · Resume deep dive · Start quick revision · Preview deep dive | डीप डाइव शुरू करें · डीप डाइव जारी रखें · क्विक रिविज़न शुरू करें · डीप डाइव की झलक देखें |
| Free link | Quick revision is free | क्विक रिविज़न मुफ़्त है |
| Not in exam (deep link) | This topic isn't in {exam_name}. You can still read it. | यह टॉपिक {exam_name} में नहीं है। फिर भी इसे पढ़ा जा सकता है। |
| Other app (deep link, per-exam app) | This topic is in Smriti {other_exam}. | यह टॉपिक Smriti {other_exam} में है। |

**Illustration slots:**
| Slot | Preset | Ratio | Shows | Alt |
|---|---|---|---|---|
| Header | `sunny-scene` cut to object or `sunny-object` | 1:1, 200 | The topic's key object or scene | "{topic_title}" short description from the media request alt |
| Memory trick | `memory-hook` | 1:1, 72 | The mnemonic's scene | from the mnemonic's media alt |
| Video thumbnail | YouTube thumbnail (not an illustration) | 16:9 | Video frame | "Video: {video_title}" |

**States:**
- **Default (new topic):** Deep dive selected.
- **Learned:** Quick revision selected (SET-10 can change this default); "Learned" chip; subtopics all checked; Explain it back row shown (Phase 2).
- **Learned by a check:** same as learned, with the "Learned (checked)" chip.
- **In progress:** Deep dive selected with progress; CTA "Resume deep dive".
- **Loading:** metadata from the manifest; subtopics from the graph bundle; video thumbnail lazy.
- **Offline:** video card shows "Needs internet"; if the lesson bundle is not local, CTA tap opens LRN-16. Practise works when the questions are local.
- **Guest:** same.
- **Free vs Pro:** gated Deep dive shows Pro + "Preview free"; selecting it changes the CTA to [Preview deep dive] and tapping opens LRN-05 the first time per topic (later taps go straight into the preview). Practise counts toward the free practice cap; Explain it back opens AI-07 for free students. Pro: no chips.
- **Minor / little learner:** little learners never see this screen; their node goes straight to the lesson.
- **Dark mode:** header dark tint; mode cards `surface` dark with `surfaceRaised` when selected.

**Interaction and motion:** switching mode: the selected border animates (`fast`), CTA text cross-fades (`base`), light haptic. Header illustration parallax on scroll (max 24 px, off in reduced motion). Subtopic `Play` starts the bite directly (the prerequisite check still applies).

**Accessibility:** mode cards are a radio group "Choose how to study". Each has the full description in its label. The memory trick text is real text (not in the image). Video card label includes the duration and "opens video".

**Analytics:** `topic_card_viewed`, `topic_mode_selected`, `topic_start_tapped`, `topic_practise_tapped`, `explain_back_tapped`, `pro_gate_shown` (when the gated mode is chosen).

**Web (≥ 600 px):** header and mode cards on the left (max 560), subtopics, memory trick, practise row and video on the right column. The CTA sits under the mode cards (not pinned). Keyboard: D selects Deep dive, Q Quick revision, Enter starts.

**Mock priority:** **P0** (default and Pro-gated).

---

### LRN-04 · "Learn this first?" prerequisite sheet
**Purpose:** Suggest, never force, an unlearned prerequisite topic. **Main action:** [Go to {prereq_topic_title}].
**Entry → exits:** LRN-03 start, HOME-01 hero start, LRN-02 row start → LRN-03 (prerequisite topic) or LES-01.

**Layout (top to bottom):**
1. Sheet 40%. Pet line (pet "curious"): "Quick tip before you start."
2. Title `heading`: "Learn {prereq_topic_title} first?"
3. Body `body`: "This topic builds on it. It takes about {minutes} min."
4. A compact row for the prerequisite topic (subject tint square 40, title, minutes).
5. Buttons stacked: [Go to it] primary, [Start anyway] secondary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Pet line | Quick tip before you start. | शुरू करने से पहले एक छोटी-सी सलाह। |
| Title | Learn {prereq_topic_title} first? | पहले {prereq_topic_title} पढ़ें? |
| Body | This topic builds on it. It takes about {minutes} min. | यह टॉपिक उसी पर आधारित है। उसमें लगभग {minutes} मिनट लगेंगे। |
| Primary | Go to it | वहाँ चलें |
| Secondary | Start anyway | फिर भी शुरू करें |

**Illustration slots:** none beyond the pet avatar.

**States:** default; multiple prerequisites (shows up to 2 rows, the primary button goes to the first); offline (prerequisite row shows "Needs internet" if not local, then the primary button becomes [Start anyway]); dark mode.

**Interaction and motion:** sheet `slow` slide-up; swipe down = Start anyway is **not** assumed: swipe down just closes and returns to the previous screen.

**Accessibility:** focus on the title; both buttons labelled with the topic names.

**Analytics:** `prereq_sheet_shown`, `prereq_sheet_action` (`go`, `anyway`, `dismiss`).

**Web (≥ 600 px):** centred dialog 440 wide.

**Mock priority:** P1.

---

### LRN-05 · Pro preview sheet (and "Ask a grown-up" variant)
**Purpose:** Explain a Pro item honestly and always offer a free way forward. **Main action:** [Preview free] where a preview exists, else [Try Pro for ₹1].
**Entry → exits:** LRN-03 gated Deep dive, LRN-02 gated row, LRN-01 / LRN-02 / LRN-03 / LRN-15 download (free student), LRN-13 AI fill (Phase 2), LRN-14 AI links (Phase 2), HOME-06 gated node (`u10`) → LES-01 (`mode=preview`), PAY-01 (trigger `deep_dive_lock`, `offline_download` or `ai_tools_lock`), LRN-07 (free alternative), SET-13 → PAY-01 (`u10` variant), PAY-01 → PAY-03 (`10_12` variant), back.

Not used for: "Make it stick" (MEM-19 has its own gate, `memory_lock`), PDF export (ME-22 has its own lock, `pdf_export`), PYQs (not Pro-gated, R25), tutor and practice limits (AI-06 and PRC-17).

**Layout (top to bottom):**
1. Sheet 60%. Small illustration 120 (the pet holding the gold ₹1 tag, the same art family as PAY-01).
2. Title `heading`, varies by gate (table below).
3. Body `body`, one or two lines.
4. Benefit row: 2–3 compact rows with Phosphor icons (`BookOpenText` "All deep dives", `DownloadSimple` "Offline downloads", `Sparkle` "AI tools").
5. Buttons stacked: first [Preview free] secondary (only for Deep dive), then [Try Pro for ₹1] primary, then the free alternative as a ghost button.
6. Fine print `caption` `inkMuted` from `/v1/config` pricing: "First month {trial_price}, then {monthly_price}/month. Cancel anytime." PAY-01 owns eligibility and the final strings.

**Variant: Ask a grown-up** (`age_band` `u10` or `10_12`; R15): no price, no benefit list. Title, body and one button [For grown-ups] (hold to open). `u10`: the button opens SET-13 (parent mode gate), then PAY-01 for the parent. `10_12`: the button opens PAY-01, whose minor flow runs PAY-03 (grown-up check) before any checkout. Ghost: [Do something else]. Copy for `u10` uses तुम (R3); for `10_12` it uses आप.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title, deep dive | Deep dives here are part of Pro | यहाँ के डीप डाइव प्रो में हैं |
| Body, deep dive | Try the first few cards free. Quick revision is always free. | पहले कुछ कार्ड मुफ़्त आज़माएँ। क्विक रिविज़न हमेशा मुफ़्त है। |
| Title, download | Offline downloads are part of Pro | ऑफ़लाइन डाउनलोड प्रो में है |
| Body, download | Lessons you open are still saved for a while, free. | आप जो पाठ खोलें, वे कुछ समय के लिए मुफ़्त में सेव रहते हैं। |
| Title, AI notes (Phase 2) | AI note filling is part of Pro | AI से नोट्स भरना प्रो में है |
| Title, AI mind map (Phase 2) | AI link suggestions are part of Pro | AI से जुड़ाव सुझाना प्रो में है |
| Benefits | All deep dives · Offline downloads · AI tools | सारे डीप डाइव · ऑफ़लाइन डाउनलोड · AI टूल |
| Preview | Preview free | मुफ़्त झलक देखें |
| Pro | Try Pro for ₹1 | ₹1 में प्रो आज़माएँ |
| Pro, trial used | See Pro | प्रो देखें |
| Alternatives | Do quick revision · Keep writing myself · Keep the map as it is · Not now | क्विक रिविज़न करें · खुद लिखना जारी रखें · मैप ऐसे ही रखें · अभी नहीं |
| Fine print | First month {trial_price}, then {monthly_price}/month. Cancel anytime. | पहला महीना {trial_price}, फिर {monthly_price}/महीना। कभी भी रद्द करें। |
| Fine print, trial used | {monthly_price}/month. Cancel anytime. | {monthly_price}/महीना। कभी भी रद्द करें। |
| Kid title (`10_12` / `u10`) | Ask a grown-up | किसी बड़े से पूछें / किसी बड़े से पूछो |
| Kid body | This one needs a grown-up's OK. | इसके लिए किसी बड़े की हाँ चाहिए। |
| Kid button | For grown-ups | बड़ों के लिए |
| Kid ghost (`10_12` / `u10`) | Do something else | कुछ और करें / कुछ और करो |

**Illustration slots:** `pet-cat` / `pet-dog`, 1:1, 120, the pet holding a blank gold tag (the price is overlaid by the app, never in the image), alt "{pet_name} holding the Pro offer". Kid variant: the pet waving, alt "{pet_name} waving".

**States:** default; Pro already (never shown); guest (same; PAY-01 asks for login before checkout); offline ([Try Pro for ₹1] disabled with "Needs internet"; preview still works if the bundle is local); trial already used (button "See Pro", fine print without the trial; PAY-01 owns eligibility); kid variants; dark mode.

**Interaction and motion:** sheet `slow`. No timers, no countdowns, no fake scarcity (UX_FLOW §4.15, X8). Dismiss by swipe or ghost button returns to the exact screen.

**Accessibility:** title focused first. Price text is real text. Kid hold-to-open announced ("For grown-ups, press and hold").

**Analytics:** `pro_gate_shown` (`gate`: deep_dive, download, ai_notes, ai_mind_map; `surface`), `pro_gate_action` (`preview`, `pro`, `alternative`, `dismiss`, `grown_up`).

**Web (≥ 600 px):** dialog 480 wide.

**Mock priority:** **P0** (deep dive variant), P1 (others and the kid variants).

---

### LRN-06 · Chapter test sheet
**Purpose:** Offer three honest ways to check a chapter: test out of it free, practise it, or take a timed chapter mock. **Main action:** the default choice's button.
**Entry → exits:** LRN-02 Chapter test tool, chapter test row or [Practise this chapter] CTA → LES-12 (`mode=check`, `kind=test_out`) → LES-13; PRC-03 (chapter prefilled, chapter mode) → PRC-04 → PRC-06; MOCK-02 (`kind = chapter`) → MOCK-19; back.

**Layout (top to bottom):**
1. Sheet 60% (grows to full at 200% text). `Exam` 40 in a subject-tint circle, title "Chapter test" `heading`, chapter name `caption`.
2. **Three choice cards** (radio cards, radius 20, `surface`, 2 px `line` border; the selected one 2 px subject `strong` border with `CheckCircle` fill). The default selection follows the chapter's state (flow §6.4): Test out when most topics are not yet learned, Practise when most are learned.
   - **Test out of this chapter:** `Rocket` 28, title, meta "{n} questions · about {minutes} min", line "Pass a topic to mark it learned. Nothing is marked failed.", the Free chip, and "Doesn't use your daily questions" in `caption`.
   - **Practise the chapter:** `Target` 28, title, meta "Choose how many in the next step", line "Questions from every topic, with full solutions." For free students: "{left} of today's free questions left" in `caption`.
   - **Timed chapter mock** (only when a published chapter mock exists): `Timer` 28, title, meta "{n} questions · {minutes} min", line "Exam conditions, with a report at the end."
3. Pinned primary button that follows the selection: [Start test out] / [Set up practice] / [See mock].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Chapter test | अध्याय टेस्ट |
| Test out | Test out of this chapter | इस अध्याय का टेस्ट आउट करें |
| Test out meta | {n} questions · about {minutes} min | {n} सवाल · लगभग {minutes} मिनट |
| Test out line | Pass a topic to mark it learned. Nothing is marked failed. | जो टॉपिक पास हो, वह "सीख लिया" हो जाएगा। कुछ भी फ़ेल नहीं माना जाएगा। |
| Test out quota | Doesn't use your daily questions | आपके रोज़ के सवालों में नहीं गिना जाएगा |
| Practise | Practise the chapter | अध्याय का अभ्यास करें |
| Practise meta | Choose how many in the next step | अगले कदम में संख्या चुनें |
| Practise line | Questions from every topic, with full solutions. | हर टॉपिक से सवाल, पूरे हल के साथ। |
| Practise quota (free) | {left} of today's free questions left | आज के मुफ़्त सवालों में से {left} बाकी |
| Mock | Timed chapter mock | समयबद्ध अध्याय मॉक |
| Mock meta | {n} questions · {minutes} min | {n} सवाल · {minutes} मिनट |
| Mock line | Exam conditions, with a report at the end. | परीक्षा जैसा माहौल, अंत में रिपोर्ट के साथ। |
| Buttons | Start test out · Set up practice · See mock | टेस्ट आउट शुरू करें · अभ्यास सेट करें · मॉक देखें |
| No questions | This chapter doesn't have enough questions to test out yet. | इस अध्याय में टेस्ट आउट के लिए अभी पर्याप्त सवाल नहीं हैं। |
| Free chip | Free | फ़्री |

**Illustration slots:** none.

**States:** default (choice preselected by chapter state); no mock (two cards); not enough questions for Test out (card disabled with the "No questions" line; topics with no questions are listed as "Not in this check" in LES-13); offline (Test out works when the chapter's bundles are local; Practise and Mock show "Needs internet" unless practice has the questions on the device); free practice cap used (Practise card shows "0 left" and its button opens PRC-17; Test out stays free); Pro (no quota lines); dark mode.

**Interaction and motion:** sheet `slow`; radio card select `fast` with light haptic; the pinned button text cross-fades (`base`).

**Accessibility:** the cards are a radio group "How do you want to check this chapter?"; each card's label includes its meta and the quota line. The Free chip is text.

**Analytics:** `chapter_test_opened` (`default_choice`), `chapter_test_choice` (`choice`: test_out, practise, mock).

**Web (≥ 600 px):** dialog 480 wide; cards stacked.

**Mock priority:** P1.

---

### LRN-07 · Quick revision sheet
**Purpose:** Give a one-screen recap of the topic before rapid cards. **Main action:** [Start rapid cards].
**Entry → exits:** LRN-03 Quick revision, HOME-01 hero, HOME-02 revise item, MEM-02 "Relearn with Quick Revision" (`source=comeback`) → LES-10, LRN-10 (tap a formula), ME-22 (overflow "Save as PDF", Phase 2), SET-24 (Report a problem), back (to MEM-02 when `source=comeback`).

**Layout (top to bottom):**
1. Top bar: close `X`, title "Quick revision", overflow (Save as PDF, Report a problem).
2. Header strip in the subject tint: topic title `heading`, "{n} cards · about {minutes} min". In the relearn variant, a "Relearn" chip (`ArrowsClockwise` 16, `primaryTint`, `primary` text) before the title.
3. **Cheat sheet body** (rendered from the `cheat_sheet_ref` card's `cheat_sheet@1`): sections in order: Key ideas (bullets in `body`, key terms in subject `text` 700), Key formulas (Formula boxes, each tappable → LRN-10, with a bookmark icon to save to the vault), the mini diagram (`sunny-diagram` image with label overlays in the student's language), Memory tricks (subject-tint cards with `Lightbulb`, as in LRN-03; R11), Common traps (rows with `Warning` 20 in `warningText`, "Mistake" then "Correct idea").
4. Pinned [Start rapid cards] primary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Quick revision | क्विक रिविज़न |
| Meta | {n} cards · about {minutes} min | {n} कार्ड · लगभग {minutes} मिनट |
| Relearn chip | Relearn | फिर से सीखें |
| Relearn pet line | These cards slipped a little. A quick recap brings them back. | इन कार्ड की याद थोड़ी कमज़ोर हुई है। छोटा-सा रिविज़न इसे फिर पक्का करेगा। |
| Sections | Key ideas · Key formulas · Memory tricks · Common traps | मुख्य बातें · मुख्य सूत्र · याद रखने की ट्रिक · आम गलतियाँ |
| Trap labels | Mistake · Correct idea | गलती · सही बात |
| Save formula a11y | Save {formula_name} to formula vault | {formula_name} को फ़ॉर्मूला वॉल्ट में सेव करें |
| Start | Start rapid cards | तेज़ कार्ड शुरू करें |

**Illustration slots:** mini diagram: `sunny-diagram`, 3:2, from the sheet's media request, labels overlaid at `label_anchors`, alt from the request. Memory trick images: `memory-hook`.

**States:** default; relearn (`source=comeback`: Relearn chip, pet line, rapid cards limited to the topic's very-low-recall cards plus the traps card; after LES-08 the student returns to MEM-02); loading (LES-11 skeleton); offline (works when the bundle is local, else LRN-16); guest; free and Pro identical (Quick revision is free); Phase 1 (Save as PDF hidden until ME-22 ships); little learner (not used); dark mode (formula SVGs use the dark ink variant built at publish).

**Interaction and motion:** vertical scroll; sections can collapse (tap heading). Pinch to zoom the diagram. Saving a formula: bookmark fills with `pop`, Toast "Saved to formula vault" / "फ़ॉर्मूला वॉल्ट में सेव हो गया".

**Accessibility:** sections are headings. Formula boxes carry the spoken form from KaTeX (MathML or `aria-label` produced at build) so screen readers read the maths. Diagram labels are real text. The Relearn chip is text.

**Analytics:** `cheat_sheet_viewed` (`scope` = topic, `surface` = quick_revision or relearn), `formula_saved`, `lesson_started` (when rapid cards start; `entry` = comeback for relearn).

**Web (≥ 600 px):** content column 720 centred; key formulas in a 2-column grid; CTA at the end of the content and in a sticky footer.

**Mock priority:** **P0** (default); relearn variant P1.

---

### LRN-08 · Cheat sheet viewer
**Purpose:** Read a topic or chapter cheat sheet, or a chapter's formula sheet, anytime. **Main action:** read; secondary [Save as PDF].
**Entry → exits:** LRN-02 header card (A16) and Formula sheet tool, HOME-01 strip [Cheat sheet], LRN-09, HOME-05 → LRN-10, LRN-03 ("Open topic"), ME-22 (Save as PDF, Phase 2; ME-22 shows its own Pro lock), SET-24 (Report a problem), back.

**Layout (top to bottom):**
1. Top bar: back, title "{chapter_title} cheat sheet" (or "Formula sheet"), overflow (Save as PDF, Download, Report a problem).
2. Segmented control when the chapter has both: Cheat sheet | Formula sheet.
3. The sheet, same section renderer as LRN-07 (Key ideas, Key formulas, diagram, Memory tricks, Common traps), grouped by topic with topic headings and a "Open topic" link per group.
4. Formula sheet view: only Formula boxes, grouped by topic, each with name, the box, and a one-line "When it works" from the formula's `conditions` (needs flow §11 G1).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Titles | {chapter_title} cheat sheet · Formula sheet | {chapter_title} चीट शीट · सूत्र शीट |
| Segments | Cheat sheet · Formula sheet | चीट शीट · सूत्र शीट |
| Open topic | Open topic | टॉपिक खोलें |
| PDF | Save as PDF | PDF में सेव करें |
| When it works | When it works | यह कब लागू होता है |

**Illustration slots:** per-topic mini diagrams (`sunny-diagram`), memory-trick images (`memory-hook`).

**States:** default; offline (works for local bundles; missing topics show a "Needs internet" row in place); Save as PDF (Phase 2: opens ME-22, which shows its own Pro lock to free students; hidden in Phase 1); free and Pro read the same sheets; dark mode.

**Interaction and motion:** pinch zoom on the whole sheet (1×–2.5×), double-tap to zoom a section. Scroll position remembered per sheet.

**Accessibility:** as LRN-07. Zoom does not break reflow at 200% text: text reflows, diagrams scale.

**Analytics:** `cheat_sheet_viewed` (`scope`: topic, chapter, formula_sheet), `chapter_header_cheat_sheet_tapped` (when opened from the LRN-02 header or the HOME-01 strip).

**Web (≥ 600 px):** two columns of sections at ≥ 1024; print-friendly CSS for the browser's print (the official PDF export stays Pro and server-rendered).

**Mock priority:** P1.

---

### LRN-09 · Library (formula vault, shortcut vault, saved, notes, mind maps) · Notes and Mind maps tabs: Phase 2
**Purpose:** One place for everything the student saved or wrote, plus every formula and shortcut in their exam. **Main action:** tap an item.
**Entry → exits:** HOME-01 Library tile, ME-01 (link) → LRN-10, LES-01 (saved card in context), LRN-13 (Phase 2), LRN-14 (Phase 2), back.

**Layout (top to bottom):**
1. Top bar: back, title "Library", search (searches inside the library only).
2. Tabs (scrollable): Formulas, Shortcuts, Saved, Notes, Mind maps.
3. **Formulas / Shortcuts tabs:** segmented Saved | All. Subject filter chips. Rows grouped by chapter: Formula box mini (KaTeX SVG, max height 48), name `label`, "{chapter_title}" `caption`, bookmark toggle 48. Shortcut rows: `Lightning` icon, the shortcut name, "Works for: {question_kind}" caption.
4. **Saved tab:** bookmarks and highlights as cards with the card title, a 2-line excerpt (highlighted range in subject tint), source "{topic_title}" and date.
5. **Notes tab:** list of Cornell notes: title, topic, updated date, "AI filled" chip when relevant. FAB-style [New note] secondary at the bottom.
6. **Mind maps tab:** chapter mind maps the student opened or edited, with a small preview tile (rendered from the map data, not an illustration).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Library | लाइब्रेरी |
| Tabs | Formulas · Shortcuts · Saved · Notes · Mind maps | सूत्र · शॉर्टकट · सेव किए · नोट्स · माइंड मैप |
| Segments | Saved · All | सेव किए · सभी |
| Search | Search your library | लाइब्रेरी में खोजें |
| Shortcut meta | Works for: {question_kind} | इनके लिए: {question_kind} |
| New note | New note | नया नोट |
| AI chip | AI filled | AI से भरा |
| Empty, formulas | Tap the bookmark on any formula to keep it here. | किसी भी सूत्र पर बुकमार्क दबाएँ, वह यहाँ आ जाएगा। |
| Empty, saved | Save any card from the ⋯ menu in a lesson. | पाठ में ⋯ मेनू से कोई भी कार्ड सेव करें। |
| Empty, notes | Notes you write show up here. | आपके लिखे नोट्स यहाँ दिखेंगे। |
| Empty, mind maps | Open a chapter's mind map to start. | शुरू करने के लिए किसी अध्याय का माइंड मैप खोलें। |

**Illustration slots:** empty states: `empty-state`, 4:3, pet with an open, empty notebook, alt "Nothing saved yet".

**States:** default; empty per tab; loading (local first); offline (everything saved works; "All" shows only formulas in local bundles plus a "Some chapters need internet" note); guest (local; synced after sign-in); free vs Pro (all free); Phase 1 (Notes and Mind maps tabs hidden until LRN-13 and LRN-14 ship); dark mode.

**Interaction and motion:** swipe between tabs. Swipe a saved row left to remove (with Undo toast). Bookmark toggle `pop`.

**Accessibility:** tabs are a tablist. Formula rows read the spoken maths plus the name. Removal has a button alternative (overflow on each row).

**Analytics:** `library_viewed` (`tab`), `formula_saved`, `bookmark_added`.

**Web (≥ 600 px):** two-pane: list left, detail (LRN-10 or note or map) right.

**Mock priority:** P1.

---

### LRN-10 · Formula or shortcut detail sheet
**Purpose:** Explain one formula or shortcut and link to where it was taught and practised. **Main action:** [Practise this].
**Entry → exits:** LRN-07, LRN-08, LRN-09, HOME-05, LES-01.3 → LES-01 (source card), PRC-03 (prefilled with the formula's concept), back.

**Layout (top to bottom):**
1. Sheet 60% (full on small phones). Formula name `heading`.
2. Large Formula box (subject tint, KaTeX SVG, symbols tappable).
3. "What each symbol means": rows "{symbol} · {meaning} · {unit}".
4. "When it works": conditions text.
5. Shortcut only: "When it fails" in a `warningTint` callout with `Warning` icon.
6. "Where you learned it": row with topic and [Open card].
7. Buttons: [Practise this] primary, bookmark toggle (Save / Saved) secondary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Symbols | What each symbol means | हर चिह्न का अर्थ |
| Unit | Unit | इकाई |
| Works | When it works | यह कब लागू होता है |
| Fails | When it fails | यह कब काम नहीं करता |
| Source | Where you learned it · Open card | आपने इसे कहाँ पढ़ा · कार्ड खोलें |
| Practise | Practise this | इसका अभ्यास करें |
| Save / Saved | Save to vault · Saved | वॉल्ट में सेव करें · सेव हो गया |

**Illustration slots:** none.

**States:** default; offline (practice works if questions are local); free (practice counts toward the daily question limit, PRC shows it); dark mode.

**Interaction and motion:** tapping a symbol in the box highlights its row (`base`) and scrolls to it.

**Accessibility:** box has the spoken form; symbol rows are a list; units spoken in full ("metres per second").

**Analytics:** `formula_symbol_opened`, `formula_saved`.

**Web (≥ 600 px):** right pane of LRN-09 or a dialog 520 wide.

**Mock priority:** P2.

---

### LRN-11 · Storybook reader · little learner use: Phase 3
**Purpose:** Read an illustrated storybook page by page, with optional narration. **Main action:** [Next] (or swipe).
**Entry → exits:** LRN-03 "Storybook", HOME-06 node, LES-01 (story card "Read the full story") → LES-08 (storybook counts as a lesson), back. AI-20 (generated story) reuses this layout through the shared `StorybookReader` component.

**Layout (top to bottom):**
1. Top bar (minimal): close `X`, "Page {n} of {total}", [Read to me] toggle (speaker icon + label).
2. Illustration, 3:2, full width, radius 20 (storybook preset).
3. Page text in `body` at 18/28 (20/30 for little learners), max 3 short paragraphs. The sentence being read is highlighted in the subject tint when narration timing is available.
4. Bottom: [Back] ghost and [Next] primary side by side (48 each). Last page: "The end!" with [Read again] and [Done].

**Copy:**
| Key | EN | HI |
|---|---|---|
| Page | Page {n} of {total} | पेज {n} / {total} |
| Read to me | Read to me | पढ़कर सुनाएँ (little learner, तुम: मुझे पढ़कर सुनाओ) |
| Back / Next | Back · Next | पीछे · आगे |
| End | The end! | समाप्त! |
| Again / Done | Read again · Done | फिर से पढ़ें · हो गया |

**Illustration slots:** each page: `storybook` preset, 3:2, from `storybook@1` page media requests, alt from the request.

**States:** default; loading (next page image preloaded); offline (works if bundled; else LRN-16); narration unavailable (toggle hidden); little learner (Phase 3; bigger text, narration on by default, pet avatar in the corner reacts at page turns); dark mode (page text on `surface`, illustrations unchanged).

**Interaction and motion:** horizontal swipe or tap the right/left third of the illustration to turn pages; page turn is a slide (`slow`), not a 3D curl (performance). Narration auto-advances only if "Read to me" is on and the student hasn't touched the screen for 2 s after audio ends.

**Accessibility:** each page is announced "Page {n} of {total}" then the text. Illustration alt text read before the text. Narration has captions (the page text itself). Reduced motion: page fades.

**Analytics:** `storybook_page_viewed`, `storybook_completed`, `narration_played`.

**Web (≥ 600 px):** spread layout: illustration left, text right, at ≥ 1024; arrow keys turn pages.

**Mock priority:** P1.

---

### LRN-12 · Video lesson · transcript flashcards: Phase 2
**Purpose:** Watch the topic's YouTube lesson with jumps to each concept. **Main action:** play.
**Entry → exits:** LRN-03 video card, LES-01.17 "Watch full video" → LRN-13 (take notes, Phase 2), MEM-08 (flashcards from the video, Phase 2), YouTube app ([Open in YouTube]), back.

**Layout (top to bottom):**
1. Top bar: back, title "Video lesson".
2. Player 16:9 full width (`react-native-youtube-iframe` / iframe), captions on by default in the student's language when the track exists.
3. Title `heading`, "{minutes} min · {channel_name}" `caption`.
4. "Jump to": list of concept timestamp chips (time in tabular + concept name), current one highlighted with a `Play` icon.
5. Row actions: [Take notes] (`NotePencil`), [Make flashcards] (`Cards`, Phase 2, only when published transcript cards exist; opens MEM-08 with the new deck), [Open in YouTube] (`ArrowSquareOut`).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Video lesson | वीडियो पाठ |
| Jump | Jump to | सीधे यहाँ जाएँ |
| Notes | Take notes | नोट्स लें |
| Flashcards | Make flashcards · Added {n} cards to your deck | फ़्लैशकार्ड बनाएँ · आपके डेक में {n} कार्ड जुड़े |
| Open | Open in YouTube | YouTube में खोलें |
| Offline | This video needs internet | इस वीडियो के लिए इंटरनेट चाहिए |

**Illustration slots:** none (video frame). Offline state uses `empty-state` sleeping pet.

**States:** default; loading (player poster); offline (empty state, [Open topic] instead); embed blocked or error ([Open in YouTube] becomes primary); Phase 1 (no Take notes or Make flashcards until LRN-13 and transcript decks ship); minor (privacy-enhanced embed, flow §12 Q5); dark mode.

**Interaction and motion:** tapping a chip seeks; the list follows playback. Landscape rotates the player to full screen. Watching past `learn.video_complete_pct` of the video counts as a lesson (LES-08 on exit).

**Accessibility:** player controls from YouTube plus our labelled buttons; captions default on; chips announce time and concept.

**Analytics:** `video_lesson_played`, `video_timestamp_tapped`, `note_created` (if notes taken).

**Web (≥ 600 px):** player left (max 720), chapters list right; notes open as a right panel (LRN-13) beside the video.

**Mock priority:** P2.

---

### LRN-13 · Cornell notepad · Phase 2
**Purpose:** Take notes in Cornell format (cues, notes, summary) and turn them into flashcards. **Main action:** write; then [Turn into flashcards].
**Entry → exits:** LRN-03 overflow "Take notes", LRN-09 Notes, LRN-12 → LRN-05 (AI fill, free; then PAY-01 `ai_tools_lock`), MEM-08 (after turning into flashcards), back.

**Layout (top to bottom):**
1. Top bar: back, note title (editable, `heading`), overflow (Delete, Link to topic).
2. Linked topic chip ("{topic_title}"), and a status caption "Saved on this device" / "Synced".
3. **Two columns** on phones ≥ 360 wide: left Cues column 32% width (`surfaceSunken`, radius 16), right Notes column (`surface`, radius 16, rich text: bold, bullet, highlight, inline maths via the math keypad). Under 360: cues collapse to a toggle row above the notes.
4. **Summary** box below, full width (`subject tint`), 3–5 lines.
5. Bottom bar: [Fill cues and summary with AI] (`Sparkle`, Pro chip for free students), [Turn into flashcards] secondary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Columns | Cues · Notes · Summary | संकेत · नोट्स · सारांश |
| Placeholders | Key questions or words · Write in your own words · Sum it up in 2–3 lines | मुख्य प्रश्न या शब्द · अपने शब्दों में लिखें · 2–3 पंक्तियों में सार लिखें |
| Status | Saved on this device · Synced | इस डिवाइस पर सेव · सिंक हो गया |
| AI fill | Fill cues and summary with AI | AI से संकेत और सारांश भरें |
| AI done | AI added {n} cues. Check them. | AI ने {n} संकेत जोड़े। एक बार जाँच लें। |
| Flashcards | Turn into flashcards · {n} cards made | फ़्लैशकार्ड बनाएँ · {n} कार्ड बने |
| Delete confirm | Delete this note? · Delete · Keep | यह नोट हटाएँ? · हटाएँ · रखें |

**Illustration slots:** none (a writing tool).

**States:** default; new (placeholders); AI filling (cue column shows shimmer rows; the student can keep typing in Notes); AI error (Toast "Couldn't fill right now. Try again later."); offline (fully editable, AI button disabled with "Needs internet"); guest (local only until sign-in); free vs Pro (AI gated); minor (AI fill passes the minor safety filters, AI owns); dark mode.

**Interaction and motion:** autosave every 2 s of idle and on leave. AI-added text is marked with a subtle `primaryTint` background until the student edits or accepts it. Undo for AI fill.

**Accessibility:** columns are labelled regions; the AI-added marking also has the "AI" label, not just colour. Keyboard shortcuts on web.

**Analytics:** `note_created`, `note_ai_fill_requested`, `note_to_flashcards`. Never note text.

**Web (≥ 600 px):** true three-zone Cornell layout at 720 wide; can sit beside a lesson or video as a right panel.

**Mock priority:** P2.

---

### LRN-14 · Mind map viewer · Phase 2
**Purpose:** See a chapter or subject as a map of topics and concepts, with mastery, and add own links and notes. **Main action:** tap a node to open it.
**Entry → exits:** LRN-02 tools, LRN-01 overflow, LRN-09 → LRN-03 (topic node), LES-01 (concept node, at its first teaching card), LRN-05 (AI links, free; then PAY-01 `ai_tools_lock`), back.

**Layout (top to bottom):**
1. Top bar: back, title "{chapter_title} mind map", segmented Map | List, overflow (Suggest links with AI, Reset view).
2. **Map view:** pan and zoom canvas on `bg`. Root node (chapter) in subject `strong` with `onStrong` text; topic nodes `surface` radius 16 with a mastery ring; concept nodes smaller pills. Edges: 2 px `line`; student-made links dashed in `primary`; AI-suggested links dashed in `inkMuted` with an "AI" tag until accepted.
3. **Legend** chip bottom-left: Learned (filled ring + `Check`), Learning (half ring), Not started (empty ring).
4. Floating buttons bottom-right: zoom in, zoom out, [Recenter].
5. **Node sheet** (tap a node, 40%): name, state, [Open], [Add a note], [Link to…].
6. **List view:** an indented outline of the same tree with state icons, the default for screen readers.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | {chapter_title} mind map | {chapter_title} माइंड मैप |
| Segments | Map · List | मैप · सूची |
| Legend | Learned · Learning · Not started | सीख लिया · सीखना जारी · शुरू नहीं |
| Node sheet | Open · Add a note · Link to… | खोलें · नोट जोड़ें · इससे जोड़ें… |
| AI | Suggest links with AI · Keep · Remove | AI से जुड़ाव सुझाएँ · रखें · हटाएँ |
| Recenter | Recenter | बीच में लाएँ |

**Illustration slots:** none (data UI, not an illustration).

**States:** default; loading (built on device from the graph, fast); offline (works); empty annotations; AI suggesting (dashed links appear one by one); free vs Pro (AI gated); dark mode (canvas `bg` dark).

**Interaction and motion:** pinch zoom 0.5×–3×, drag pan, double-tap zoom to a node. Link mode: tap source then target, a line follows the finger. Reduced motion: no animated edge drawing.

**Accessibility:** List view is always available and is announced first. Mastery uses ring shape and icon, never colour alone. Every node is focusable on web with arrow keys following the tree.

**Analytics:** `mind_map_viewed` (`origin`), `mind_map_node_opened`, `pro_gate_shown` (`gate` = ai_mind_map).

**Web (≥ 600 px):** canvas fills the main area; node sheet becomes a right panel; mouse wheel zoom.

**Mock priority:** P2.

---

### LRN-15 · Download for offline (sheet)
**Purpose:** Pin a chapter or subject on the device for offline study. **Main action:** [Download].
**Entry → exits:** LRN-02 tools or overflow, LRN-01 overflow, LRN-03 overflow, LRN-16 [Download for later], ME-21 → back. Free students get LRN-05 (download gate, then PAY-01 `offline_download`) instead of this sheet.

**Layout (top to bottom):**
1. Sheet 60%. Title "Download for offline".
2. Scope rows (radio): "This chapter · {size} MB · {n} lessons", "All of {subject_name} · {size} MB" (from the manifest sizes).
3. Options: Switch "Wi-Fi only" (on), Switch "Also download {other_language}" (off).
4. Storage bar: used vs limit, "Storage used {x} of {y}", link "Manage downloads" → ME-21.
5. [Download] primary.
6. **In progress** (same sheet, or the chapter screen's tool button shows a ring): progress bar, "Downloading… {percent}%", [Pause] ghost.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Download for offline | ऑफ़लाइन के लिए डाउनलोड |
| Scope | This chapter · {size} MB · {n} lessons · All of {subject_name} · {size} MB | यह अध्याय · {size} MB · {n} पाठ · पूरा {subject_name} · {size} MB |
| Wi-Fi | Wi-Fi only | सिर्फ़ Wi-Fi पर |
| Language | Also download {other_language} | {other_language} भी डाउनलोड करें |
| Storage | Storage used {x} of {y} · Manage downloads | {y} में से {x} इस्तेमाल · डाउनलोड संभालें |
| Button | Download | डाउनलोड करें |
| Progress | Downloading… {percent}% · Pause | डाउनलोड हो रहा है… {percent}% · रोकें |
| Done toast | Ready offline | ऑफ़लाइन तैयार |
| Waiting | Waiting for Wi-Fi | Wi-Fi का इंतज़ार |
| Paused | Download paused. We'll resume on Wi-Fi. | डाउनलोड रुका है। Wi-Fi मिलते ही फिर चलेगा। |
| No space | Not enough space. Free up {size} MB. | जगह कम है। {size} MB खाली करें। |
| Remove | Remove download | डाउनलोड हटाएँ |
| Removed toast | Download removed. Lessons you open stay for a while. | डाउनलोड हटा दिया। जो पाठ आप खोलेंगे, वे कुछ समय तक रहेंगे। |
| Downloaded chip | Downloaded | डाउनलोड हो गया |
| Built in | Already on this device | पहले से इस डिवाइस पर है |
| Failed | Couldn't download. Try again. | डाउनलोड नहीं हो सका। फिर से कोशिश करें। |
| Offline | Needs internet | इंटरनेट चाहिए |
| Language names | English · हिन्दी | English · हिन्दी |

**Illustration slots:** none.

**States:** default; already downloaded ("Downloaded" chip, button becomes [Remove download] destructive-ghost); in progress; waiting for Wi-Fi; no space; error (retry); offline (button disabled, "Needs internet"); free (LRN-05 instead of this sheet); Pro lapsed (rows show "Kept, not pinned" note); dark mode.

**Interaction and motion:** progress bar `gentle` fill; success haptic and toast on completion; downloads continue in the background (OS background task) and resume after app restart.

**Accessibility:** progress announced at 25% steps. Sizes spoken with units.

**Analytics:** `download_started`, `download_completed`, `download_failed`.

**Web (≥ 600 px):** dialog 480 wide; uses the service worker cache (TRD §4.2), with a note that the browser may clear storage unless the app is installed.

**Mock priority:** P1.

---

### LRN-16 · Needs internet (full-screen state)
**Purpose:** Explain kindly that this item isn't on the device and offer what does work. **Main action:** [Try again] (when back online) or [See downloaded lessons].
**Entry → exits:** any LRN or LES entry to content that is not local while offline → back, ME-21 ([See downloaded lessons]), LRN-15 (back online, Pro), "Save when online" (back online, free).

**Layout (top to bottom):**
1. Top bar with back.
2. `empty-state` illustration of the sleeping pet (60% width).
3. Title `heading`: "This lesson needs internet".
4. Line `body`: "Downloaded lessons still work."
5. Buttons: [See downloaded lessons] primary when offline; when connectivity returns, the screen auto-retries and, if it fails, shows [Try again] primary and [Download for later] secondary for Pro students; free students see [Save when online] secondary instead, which queues a normal cache fetch (not a pin) and shows a toast.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | This lesson needs internet | इस पाठ के लिए इंटरनेट चाहिए |
| Line | Downloaded lessons still work. | डाउनलोड किए गए पाठ चलते रहेंगे। |
| Pet line | I'll wait right here. | मैं यहीं हूँ। |
| Buttons | See downloaded lessons · Try again · Download for later | डाउनलोड किए पाठ देखें · फिर कोशिश करें · बाद के लिए डाउनलोड करें |
| Save when online (free) | Save when online · We'll save it when you're online | ऑनलाइन होने पर सेव करें · ऑनलाइन होते ही यह सेव हो जाएगा |

**Illustration slots:** `empty-state`, 4:3, pet napping on a closed book, alt "{pet_name} is napping".

**States:** offline; back online (auto-retry once, then buttons); free (Save when online); little learner (the pet says the HOME-06 "Needs internet" line aloud, in तुम); dark mode.

**Interaction and motion:** connectivity change triggers a fade to a loading state (LES-11) and opens the content.

**Accessibility:** title focused; status change announced ("Back online, loading").

**Analytics:** `screen_view` (`screen_id` = LRN-16, `source` = card type or screen), `save_when_online_tapped`.

**Web (≥ 600 px):** same, centred 480.

**Mock priority:** P1.

---

### LRN-17 · Song player · little learner: Phase 3 (proposed, R59)
**Purpose:** Sing a `song@1` rhyme or song along with the pet, with the words lit line by line and the actions to do. **Main action:** [Sing along].
**Entry → exits:** HOME-06 song node → LES-08 little learner variant (a finished song is a path node done), close → HOME-06.

**Layout (top to bottom):**
1. Top bar (minimal): close `X` (48 target).
2. Cover, 1:1 (`sunny-object` or `storybook`), 50% width, centred, from the song's `cover`.
3. Title in `title`.
4. Lyrics: one line per row in `heading` (20/30). The line being sung is in the subject `text` colour on the subject tint; the others in `inkMuted`. A line with an action shows the action icon (Phosphor, from the song's `actions[].icon`) and the cue beside it while it is sung.
5. Bottom: [Sing along] primary 64 (`Play`), which becomes [Pause] (`PauseCircle`) while singing. After the end: the pet line, [Sing again] secondary (`ArrowCounterClockwise`) and [Done] primary.

**Copy (little learner, तुम):**
| Key | EN | HI |
|---|---|---|
| Sing along | Sing along | साथ में गाओ |
| Pause | Pause | रुको |
| Sing again | Sing again | फिर से गाओ |
| Done | Done | हो गया |
| Do this | Do this: {cue} | ऐसा करो: {cue} |
| Song done | Yay! You sang it! | वाह! तुमने गा लिया! |
| Not ready | This song is coming soon. | यह गाना जल्दी आएगा। |
| Lyrics a11y | Words of the song | गाने के बोल |
| Now singing a11y | Now singing: {line} | अभी गा रहे हैं: {line} |

**Illustration slots:** cover from the song's `cover` request; alt from the request.

**States:** default; singing; paused; ended; audio not ready (lyrics shown, [Sing along] disabled, "Not ready" line); untimed lyrics (no moving highlight, all lines in `ink`); offline (works when the bundle and audio are on the device, else LRN-16); reduced motion (the highlight changes without a slide); dark mode.

**Accessibility:** lyrics are a list labelled "Words of the song"; the current line is announced politely as it changes; action icons carry the cue as their label; the audio has its transcript (the lyrics).

**Analytics:** `screen_view` (`screen_id` = LRN-17), `song_completed`.

---

### LRN-18 · Play activity · little learner: Phase 3 (proposed, R59)
**Purpose:** Play a `play@1` activity: one to six short rounds of tap, match, sort, drag or trace. No score, timer or fail state. **Main action:** the round itself, then [Next].
**Entry → exits:** HOME-06 play node → LES-08 little learner variant, close → HOME-06.

**Layout (top to bottom):**
1. Top bar: close `X`, round dots (one per round, the current one filled; never a number on screen).
2. Pet line with the round's prompt (read aloud once; speaker button 48 to hear it again).
3. The round, with targets of 64 or more:
   - **Tap:** a grid of picture tiles; tapping a right one marks it with a `Check` badge.
   - **Match:** two columns of picture tiles; tap one on the left, then its partner on the right.
   - **Sort:** the pictures in a row, the baskets below; tap a picture, then its basket.
   - **Drag:** the scene image with the places marked as soft circles; drag a picture onto its place, or tap a picture and then the place.
   - **Trace:** the letter in the app font, large and pale, on `surfaceSunken`; the child traces over it with a finger. [Start again] ghost and [All done] primary below.
4. Feedback band under the round: the activity's success line (`successTint`, `Check`) or its try-again line (`surfaceSunken`, `ArrowCounterClockwise`), never red. After the second wrong move the round's hint shows in the pet line; after that the right move glows (the "Show me" state).
5. After a round: the pet cheers with the success line and a [Next] primary 64 (`ArrowRight`). After the last round: "You got {n} stars!" and [Done].

**Copy (little learner, तुम):**
| Key | EN | HI |
|---|---|---|
| Round a11y | Game {n} of {total} | खेल {n} / {total} |
| Hear again | Hear again | फिर से सुनो |
| Next | Next | आगे |
| Done | Done | हो गया |
| Show me | Look here! | यहाँ देखो! |
| Tap help | Tap the pictures | तस्वीरों पर टैप करो |
| Match help | Tap a picture, then its partner | तस्वीर पर टैप करो, फिर उसकी जोड़ी पर |
| Move help | Tap a picture, then where it goes | तस्वीर पर टैप करो, फिर वहाँ जहाँ वह जाएगी |
| Trace help | Trace the letter with your finger | उँगली से अक्षर बनाओ |
| Start again | Start again | फिर से शुरू करो |
| All done | All done | बन गया |
| Picked a11y | {label}, picked | {label}, चुना गया |
| Placed a11y | {label}, done | {label}, हो गया |
| Place a11y | {label}, put it here | {label}, यहाँ रखो |
| Stars | You got {n} stars! | तुम्हें {n} सितारे मिले! |

**Illustration slots:** tiles, buckets and the scene from the activity's image requests (`sunny-object`, `sunny-scene`); alt from each request; never text inside images. The trace letter is the app font, not an image.

**States:** default; picked (a tile selected, waiting for its place); try again; hint; show me (guided); round won; activity done; media not ready (the label shows in a quiet tile); offline (works when the bundle is on the device, else LRN-16); reduced motion (no glow pulse or bounce, a static ring instead); dark mode.

**Accessibility:** every tile, basket and place is a button labelled with its spoken label; every drag has the tap-then-tap alternative; the trace has [All done] so it never depends on a gesture alone; feedback lines are announced politely; colour is never the only signal (a `Check` badge marks right moves).

**Analytics:** `screen_view` (`screen_id` = LRN-18), `play_round_completed`, `play_completed`.

---

## LES

### LES-01 · Lesson player
**Purpose:** Teach one bite of a topic as a sequence of cards, check understanding, and save it into memory. **Main action:** [Continue] on teaching cards, [Check] on question cards.
**Entry → exits:** LRN-03, HOME-01 hero, HOME-06 node, LRN-07 (via LES-10), deep link, AI-02 "Open lesson", ONB-13 (`mode=onboarding`) → LES-02, LES-03, LES-04, LES-05, LES-06, LES-07 → LES-08, LES-09, LES-11, LRN-16, AI-01 → AI-02 (tutor), AI-21 (role play, hosted in place), LAB-04 / LAB-08 / LAB-10 (inline and full screen), LAB-05 (fallback), MEM-19 (Make my own), PRC-18 (PYQ source), SET-24 (via LES-04), SET-19 (little learner time limit, after the current card). LES-12 and LES-14 use this same shell.

**Layout (top to bottom), shared by every card:**
1. **Top bar** (56, on `bg`): close `X` 48 (label "Close lesson") → segmented progress bar (DESIGN Progress, one segment per card in the current bite, 8 tall, radius 4, done segments in subject `strong`, current segment half-filled, rest `track`; gaps 3) → counter "{n} of {total}" in `caption` tabular → overflow `DotsThree` 48 (LES-04).
2. **Card area:** one card per screen, horizontally paged. The card sits on `surface`, radius 24, full width minus 16 per side, top 8 below the bar, and scrolls vertically inside itself if content is long (a soft fade at the bottom edge tells the student there's more). Content column max 720 on tablets and web.
3. **Card header** (most types): a type kicker in `caption` subject `text` with a Phosphor icon (for example `BookOpen` "Explainer", `Question` "Check"), a narration button `SpeakerHigh` 40 top-right when the card has `narration`, and the "?" demo icon (X19) on card types that have a first-time demo (LES-01.5, LES-01.11).
4. **Action area** pinned at the bottom: the primary button (56) plus at most one ghost button above it ("I don't know yet", "Skip", "Skip lab"). The floating tutor button (AI-01; opens AI-02 with the card as context) sits 16 above the primary button, right edge.
5. Tab bar hidden. Status bar follows the theme.

**Copy (shell):**
| Key | EN | HI |
|---|---|---|
| Close a11y | Close lesson | पाठ बंद करें |
| Counter | {n} of {total} | {total} में से {n} |
| Continue | Continue | आगे बढ़ें |
| Check | Check | जाँचें |
| Don't know | I don't know yet | अभी नहीं पता |
| Skip | Skip | छोड़ें |
| Tutor a11y | Ask {pet_name} about this card | इस कार्ड के बारे में {pet_name} से पूछें |
| Listen | Listen | सुनें |
| More below | More below | नीचे और है |
| Halfway pet line (shown once per bite in a Pet line toast) | Halfway there! | आधा रास्ता पूरा! |

**Illustration slots:** per card (sub-blocks below). The shell itself has none.

**States:**
- **Loading:** LES-11 (skeleton card in the subject tint) while the bundle opens; cards one ahead are prefetched.
- **Error:** LES-11 error state. A single card whose media failed shows its alt text in a `surfaceSunken` box with [Retry image] and the lesson continues.
- **Offline:** works for local bundles; online-only cards show an inline "Needs internet" card body with [Skip for now] (flow §7.9); skipped online-only cards are not misses.
- **Guest / signed in:** no difference.
- **Free preview:** the progress bar shows only the preview's segments (`free.deep_dive_preview_cards`) plus a final lock segment with `LockSimple`; reaching it opens LES-09.
- **Pro:** no difference.
- **Minor (13–17):** no difference in the player.
- **Little learner:** text sizes one step up (body 18/28), narration auto-plays, no confidence row, no counter (dots instead), no tutor button unless a parent turned it on in SET-14 (R14), at the SET-16 time limit the current card finishes and SET-19 opens, pet avatar stays at the top-right of every card and reacts (`hop` on correct, `think` on wrong). Feedback copy is gentler and uses तुम (LES-02). Phase 3.
- **Check and fix modes:** LES-12 and LES-14 change the top bar chip and the feedback; everything else is this shell.
- **Reduced motion:** horizontal slide becomes a 120 ms cross-fade; shakes become a static red border plus icon; confetti becomes a static badge.
- **Dark mode:** card `surface` dark, tints dark, formula SVGs dark-ink variants.

**Interaction and motion:**
- Swipe left = Continue (only when the card has no pending task); swipe right = previous card (read-only for answered questions). Card transition: horizontal slide, `slow`, easing `standard`, under 100 ms to first frame (TRD §15).
- Android back and iOS edge swipe open LES-05, never drop the lesson.
- The progress segment fills with spring `gentle` when a card is completed.
- Haptics and sounds per UX_FLOW §3 (correct: success + ding; wrong: warning + bonk).
- Long-press on any text selects it and shows "Highlight" and "Ask {pet_name}" actions.

**Accessibility:**
- Focus order per card: kicker → title → body → interactive content → ghost button → primary button → tutor button. Top bar is reachable with the screen reader's "first item" gesture.
- Every card announces "Card {n} of {total}, {type}" on arrival.
- Progress bar has a text equivalent ("Card 3 of 8").
- Dynamic type to 200%: card scrolls internally, illustrations cap at 30% of the viewport, buttons never overlap content.
- Swipe actions always have button equivalents.

**Analytics:** `lesson_started`, `lesson_card_viewed`, `card_skipped`, `tutor_opened` (`from` = card), `narration_played`, `first_time_demo_shown`, plus the per-card events below.

**Web (≥ 600 px):** card column 720 centred on `bg`; the tutor opens as a right panel (UX_FLOW §4.17); ← and → move between cards, Enter = primary action, 1–4 / A–D select options, Space toggles narration, Escape opens LES-05. Previous/Next arrow buttons appear beside the card on hover.

**Mock priority:** **P0** (shell with explainer, MCQ, numerical, sim; little learner variant P1 for the Phase 3 set).

The sub-blocks below give each card type's layout, states and interaction. Content fields are from `content-format.md` §7–8.

---

#### LES-01.1 · Story card (`story`)
- **Layout:** illustration top (`sunny-scene` or `storybook`, 3:2, up to 40% of the viewport, radius 20) or a comic strip (2–4 panels, each 3:2, swipeable inside the card with dots); `title` in `title` (2 lines); `body` in `body`, max 3 short paragraphs; narration button.
- **States:** image loading (tint placeholder with the alt text faintly in `inkMuted`); narration playing (button shows `Pause`, the current sentence is underlined in subject `strong`); offline image missing (alt box); comic last panel reached (Continue enabled; before that Continue reads "Next panel").
- **Interaction:** tap a panel to enlarge (full-screen viewer, pinch zoom). Narration never auto-plays except for little learners.
- **Accessibility:** image alt read before title; comic panels read in order with "Panel {n} of {total}".
- **Copy:** "Next panel" / "अगला पैनल".

#### LES-01.2 · Explainer card (`explainer`)
- **Layout:** illustration or diagram (`sunny-object`, `sunny-diagram`; diagrams get label overlays at `label_anchors` in the student's language, labels as pill chips with a 1 px leader line); `title` `heading`; `body` with `highlights[]` rendered as key terms (subject tint background, subject `text` 700, dotted underline); any `$$…$$` display maths renders as a Formula box (LES-01.3 look).
- **States:** as story; diagram labels toggle (eye icon "Labels on/off") for self-testing.
- **Interaction:** tap a key term → LES-03 (definition sheet). Pinch the diagram to zoom. Tap a label chip to hear it.
- **Accessibility:** key terms are buttons with "{term}, definition"; underline + weight, not colour alone. Diagram labels are real text in reading order.
- **Copy:** "Labels on" / "लेबल दिखाएँ", "Labels off" / "लेबल छिपाएँ".

#### LES-01.3 · Formula card / Formula box (`formula`, proposed; flow §11 G1)
- **Layout:** title `heading`; a Formula box (DESIGN): subject tint, radius 16, padding 20, KaTeX SVG centred at 1.3× body size, every symbol a tap target (min 32 × 32 hit area, expanded invisibly); under it a symbols table (symbol · meaning · unit) collapsed by default ("What do the symbols mean?"); `conditions` line; [Add to formula vault] secondary with `BookmarkSimple`.
- **States:** saved (button reads "In your vault" with a filled bookmark); symbol selected (symbol gets a `primary` 2 px ring and LES-03 symbol sheet opens); very wide formula (horizontal scroll inside the box with edge fades, never shrunk below 0.8×).
- **Interaction:** tap symbol → LES-03; save → `pop` + toast "Saved to formula vault".
- **Accessibility:** the box has the spoken form ("v equals u plus a t") from the build; each symbol button speaks its meaning.
- **Copy:** "What do the symbols mean?" / "चिह्नों का अर्थ क्या है?", "Add to formula vault" / "फ़ॉर्मूला वॉल्ट में जोड़ें", "In your vault" / "आपके वॉल्ट में है", "Tap a symbol to see what it means" / "किसी चिह्न पर टैप करें, उसका अर्थ दिखेगा".

#### LES-01.4 · Animation card (`animation`)
- **Layout:** `title`; animation area 1:1 or 4:3 (Rive or Lottie) on the subject tint, radius 20; controls under it (never on top): [Play/Pause], [Replay], scrubber for Rive timelines that support it; `caption` text; "Transcript" disclosure.
- **States:** autoplays once muted when the card appears (not for reduced motion); finished (Replay emphasised); reduced motion (shows a static poster plus a "Step through" control that moves frame-group by frame-group); failed load (poster + transcript).
- **Interaction:** tap the animation to pause/resume. Continue is always enabled.
- **Accessibility:** transcript expanded automatically for screen-reader users; animation view labelled with its caption.
- **Copy:** "Replay" / "फिर चलाएँ", "Transcript" / "लिखित रूप", "Step through" / "एक-एक करके देखें".

#### LES-01.5 · Interactive card (`interactive`)
Shared: `prompt` at the top in `heading`, the widget, then feedback inline (the widget's `feedback` text in a success or error tint row with icon) and [Check] when the widget needs checking. [Skip] ghost is available.

| Widget | Layout | Interaction | States | Accessibility |
|---|---|---|---|---|
| `drag_sort` | Items as 56 tall chips in a pool; 2–4 labelled bins below (tint headers) | Drag a chip into a bin (lift scale 1.04 + raised shadow); or tap chip, then tap bin | correct bin: chip turns `successTint` with `Check` after [Check]; wrong: `errorTint` + `X`, can retry once | Tap-to-select alternative; each chip announces its current bin |
| `slider` | A graph or diagram area driven by the value; a Slider (thumb 28, track 6) with value readout chip in tabular figures and units | Drag the thumb; the visual updates live (60 fps target) | target reached → success row; "Try to make {prompt_target}" guidance from `config` | Slider has min/max/step and the value spoken with units; +/- step buttons beside it |
| `graph` | Coordinate plane (UI-drawn axes, grid in `line`) with a draggable point or curve handle | Drag the handle; values shown in chips | as slider | Arrow buttons move the handle by one step; values spoken |
| `tap_reveal` | 2–6 tiles over parts of an image or as cards, each "Tap to reveal" | Tap to flip a tile (flip `base`) and show its text | all revealed → Continue enabled (no Check) | Each tile is a button "Hidden, tap to reveal"; revealed text read immediately |
| `label_diagram` | `sunny-diagram` image with empty anchor dots; a tray of label chips below | Drag a label onto a dot, or tap label then dot | after [Check]: correct labels lock in `successTint`; wrong ones bounce back to the tray with an `X` | Dots are buttons "Spot {n}"; tap-to-place alternative; labels are real text |
| `order_steps` | Vertical list of step cards with drag handles (`DotsSixVertical`) | Drag to reorder, or use up/down buttons on a selected card | after [Check]: correct positions get `Check` and a number; wrong ones show the correct position number | Up/down buttons; positions announced ("Step 2 of 5") |

- **First-time demo** (X19): the first time a student meets `drag_sort`, `label_diagram` or `order_steps`, the pet shows the short demo described in LES-01.11; the "?" icon replays it.
- **Copy:** "Drag to sort" / "खींचकर क्रम लगाएँ", "Move the slider" / "स्लाइडर खिसकाएँ", "Tap to reveal" / "टैप करके देखें", "Drop the labels" / "लेबल सही जगह रखें", "Put the steps in order" / "चरणों को क्रम में लगाएँ", "Nice, that's right!" / "बढ़िया, यह सही है!", "Not yet. Try once more." / "अभी नहीं। एक बार और कोशिश करें।".
- **Event:** `interactive_completed`.

#### LES-01.6 · Derivation card (`derivation`)
- **Layout:** `title`; steps as a vertical list. Each step: number badge 28 (subject tint), the step's `latex` in a Formula box (compact), the `say` text in `body` below; a "Why?" chip (`Question` icon) when the step has `why`. Only the first step shows at first; the rest are collapsed placeholders "Step {n}".
- **States:** steps revealed progressively; "Why?" expanded shows `why` in a `primaryTint` callout; all revealed → Continue enabled; [Show all steps] ghost reveals everything at once.
- **Interaction:** [Next step] (primary while steps remain, replaced by [Continue] at the end); each reveal slides the new step in (`base`) and scrolls it to the upper third.
- **Accessibility:** steps are a numbered list; each "Why?" is a disclosure button with expanded state.
- **Copy:** "Next step" / "अगला चरण", "Why?" / "क्यों?", "Show all steps" / "सारे चरण दिखाएँ", "Step {n}" / "चरण {n}".

#### LES-01.7 · Sim card (`sim`)
- **Layout:** `title` or the first task's prompt; the LAB-04 shell in inline mode, full width at 4:3 or 1:1 (from the sim's metadata), radius 20, `surfaceSunken` behind; [Expand] icon button (`CornersOut`) at the frame's top-right **outside** the canvas edge; the sim's own controls sit **below** the frame, never on top (UX_FLOW §4.6); tasks list: "Task {n} of {total}" with the task prompt, readings shown as stat chips ("{name}: {value} {unit}"), [Record reading] secondary; [Check task] primary when a task expects a measurement; [Skip task] ghost on every task; PhET or other attribution in `caption` when `origin` is not own.
- **States:** loading ("Setting up the lab…", tint skeleton, under 1.5 s target); ready; task correct (task row gets `Check`, next task appears); task wrong (error row with the tolerance hint from `tasks[].tolerance`, "Close, but outside the expected range"); task skipped (row shows "Skipped" with `ArrowBendDownRight`, never an error style; skipped tasks never count as wrong, flow §7.3 rule 11); all tasks done or skipped → `debrief` text appears in a summary box and Continue enables; failed to load or the device tier can't run it → the **LAB-05 fallback** inline (poster, the card's key idea, [Try again]); the card counts as seen with its tasks skipped; offline and not cached (Needs internet body, [Skip for now]); low power (sim gets `params.lowPower = true` on low-end devices).
- **Interaction:** [Expand] moves the same instance to full-screen LAB-04 (landscape allowed, no reload); [Close] returns to this card. Horizontal swipes inside the frame go to the sim, not the pager; the pager swipe works only on the card area outside the frame. When the student arrives here from LES-02 [Try it in the sim], the card opens in a sheet over the question and [Back to the question] returns.
- **Accessibility:** the sim's own controls are accessible (sim-builder rules); state changes announced through `state` messages; [Skip task] and [Skip lab] always available.
- **Copy:** "Setting up the lab…" / "लैब तैयार हो रही है…", "Expand" / "बड़ा करें", "Task {n} of {total}" / "काम {n} / {total}", "Record reading" / "रीडिंग दर्ज करें", "Check task" / "काम जाँचें", "Skip task" / "यह काम छोड़ें", "Skipped" / "छोड़ा गया", "Skip lab" / "लैब छोड़ें", "Reset" / "फिर से", "Close, but outside the expected range." / "करीब है, पर सही सीमा से बाहर।", "Simulation by {attribution}" / "सिमुलेशन: {attribution}", "Back to the question" / "सवाल पर वापस".
- **Event:** `sim_task_result` (`result`: correct, wrong, skipped).

#### LES-01.8 · 3D model card (`model3d`)
- **Layout:** `prompt` as title; the LAB-08 viewer inline (poster first: a pre-rendered still of the model, 4:3, with a `Cube` badge "3D"); tapping the poster loads the low-LOD model inline (drag to rotate only; pinch is left to the page scroll); [Expand] (`CornersOut`) outside the top-right edge opens full-screen LAB-08 with this card's `labels[]` as pins and the `exploded_view` toggle.
- **States:** poster; model downloading ("Loading 3D… {percent}%"); inline ready; explored (after an expand, the card shows "Explored" with a `Check`); failed or device tier too low → LAB-05 fallback inline (poster + the card's caption); offline not cached (Needs internet, [Skip for now]).
- **Interaction:** Continue is enabled without exploring (exploring is encouraged, not forced). Closing full-screen LAB-08 returns to this card at the same scroll position.
- **Accessibility:** poster alt; LAB-08 provides the label-list alternative.
- **Copy:** "Explore in 3D" / "3D में देखें", "Loading 3D… {percent}%" / "3D लोड हो रहा है… {percent}%", "Explored" / "देख लिया".
- **Event:** `model3d_opened` (`inline`, `expanded`).

#### LES-01.9 · 360° scene card (`pano360`)
- **Layout:** as LES-01.8 with the LAB-10 viewer inline: a 2:1 preview strip of the panorama that the student can drag (no gyroscope inline), a `GlobeHemisphereWest` badge "360°", hotspot count "{n} things to find"; [Expand] opens full-screen LAB-10 with `hotspots[]`, gyroscope and drag, [Recenter], [Close].
- **States:** as LES-01.8; after returning: "{found} of {n} found"; LAB-05 fallback when it can't load.
- **Interaction:** the preview strip pans slowly on its own only when the student hasn't touched it (off in reduced motion).
- **Copy:** "Look around" / "चारों ओर देखें", "{n} things to find" / "{n} चीज़ें खोजें", "{found} of {n} found" / "{n} में से {found} मिलीं".
- **Event:** `pano_opened` (`inline`, `expanded`).

#### LES-01.10 · Worked example card (`worked_example`)
- **Layout:** "Worked example" kicker; `problem` (text + optional media); a "Try it first" prompt with a small scratch area (optional: Cornell-style quick note field or a numeric keypad if `answer` is numeric); hint ladder: [Show a hint] reveals `hints[]` one at a time ("Hint {n} of {total}"); [Show solution] reveals `solution_steps[]` as a derivation-style list; then `answer` in a success-tint box; `shortcut` in a `primaryTint` box (`Lightning`); `common_trap` in a warning-tint box (`Warning`).
- **States:** unsolved → hints → solution; if the student entered an answer and it matches, the box shows "You got it!" first; solution shown without attempt is fine (no penalty, it's teaching).
- **Interaction:** Continue enables after the solution is revealed or after [Skip].
- **Accessibility:** hint and solution are disclosure buttons; boxes have text labels ("Shortcut", "Common trap"), not just colour.
- **Copy:** "Worked example" / "हल किया हुआ उदाहरण", "Try it first" / "पहले खुद कोशिश करें", "Show a hint" / "संकेत दिखाएँ", "Hint {n} of {total}" / "संकेत {n} / {total}", "Show solution" / "हल दिखाएँ", "Answer" / "उत्तर", "Shortcut" / "शॉर्टकट", "Common trap" / "आम गलती", "You got it!" / "आपने सही निकाला!".

#### LES-01.11 · Question card shell (`question`)
- **Layout:** the shared question renderer (flow §7.4; the same component PRC-04 uses). Kicker "Check your understanding" with `Question`; the **Tough one chip** (§0.2) right of the kicker when `showToughOne` applies (A20; `difficulty_estimate = hard`, or a linked PYQ, in which case the chip reads "Asked in {exam_name} {year}" and opens PRC-18); question-type hint in `caption` ("Choose one", "Choose all that apply"…); `stem` in `body` 600 (images from `media` with label overlays); the answer area (per type, LES-01.12 to .14); **Confidence row** (DESIGN): three segmented chips Sure / 50:50 / Guess, optional, no default; ghost [I don't know yet]; primary [Check], disabled until an answer exists (disabled style keeps 4.5:1 text on `surfaceSunken`). The "?" demo icon (`Question` 20 in a 40 target) sits in the card header for question types that have a first-time demo.
- **First-time demo** (X19): the first time a student meets `mcq_multi`, `numerical` / `integer` (keypad), `match_list`, `matrix_match` or `order_steps`, the pet shows a short demo over the answer area (Rive, under `learn.first_time_demo_max_s` seconds, [Skip demo] ghost). The "?" icon replays it.
- **States:** unanswered; answered (Check enabled); checking (local, under 100 ms, no spinner); after first wrong (the chosen option struck through and disabled for single-answer types; others stay); locked (after correct or second wrong; options show final marks); read-only when revisited; check mode (LES-12: one try, no confidence hint text beyond the chips, no "?" demo replay during the check).
- **Interaction:** Check → LES-02. Option shortcuts on web (1–4, A–D). The confidence choice can be changed until Check. Tapping a PYQ chip opens PRC-18 as a sheet and returns to the same card.
- **Accessibility:** stem is the card heading; the type hint is part of the group label ("Choose one, 4 options"); result marks use icons and text ("Correct answer", "Your answer"). The Tough one chip is read after the kicker ("Tough one" or "Asked in {exam_name} {year}, opens source").
- **Copy:** kicker "Check your understanding" / "अपनी समझ परखें", confidence label "How sure are you? (optional)" / "कितना भरोसा है? (वैकल्पिक)", chips "Sure" / "पक्का", "50:50" / "50:50", "Guess" / "अंदाज़ा", "Tough one" / "मुश्किल सवाल", "Asked in {exam_name} {year}" / "{exam_name} {year} में पूछा गया", "See how it works" / "देखें यह कैसे होता है" (demo icon label), "Skip demo" / "डेमो छोड़ें".
- **Events:** `tough_one_chip_tapped`, `first_time_demo_shown` (`card_type`), `first_time_demo_replayed`.

#### LES-01.12 · Choice questions (`mcq_single`, `mcq_multi`, `assertion_reason`, `statement_based`)
- **`mcq_single`:** Option cards (DESIGN): full width, `surface`, radius 16, `line` border, min height 56, option letter badge 28 (A–D) on the left, text in `body`; when all options are under ~20 characters and there are 4, a 2 × 2 grid. Selected: `primary` 2 px border + filled letter badge. After check: correct = `successTint` + `CheckCircle`; wrong = `errorTint` + `XCircle` + shake (2 × 6 px).
- **`mcq_multi`:** same cards with a checkbox square instead of the letter style; hint "Choose all that apply"; Check enabled after one selection; after check each option shows one of: correct and chosen (`Check`), correct but missed (`successTint` outline + "Missed" label), wrong and chosen (`X`). Partial result counts as wrong for the two-try rule but the feedback says "{n} of {total} right".
- **`assertion_reason`:** two labelled boxes above the options: "Assertion (A)" and "Reason (R)" in `surfaceSunken`, radius 16, each with its text; then the standard four options as mcq_single (option texts come from content in the exam's official wording).
- **`statement_based`:** numbered statements list ("Statement 1…") in a `surfaceSunken` box, then the question line in the official style, then options as mcq_single.
- **States / Interaction / Accessibility:** as the shell. Options are a radio group (single) or checkbox group (multi).
- **Copy:** "Choose one" / "एक चुनें", "Choose all that apply" / "जितने सही हों, सब चुनें", "Missed" / "छूट गया", "{n} of {total} right" / "{total} में से {n} सही", "Assertion (A)" / "अभिकथन (A)", "Reason (R)" / "कारण (R)", "Statement {n}" / "कथन {n}".

#### LES-01.13 · Input questions (`numerical`, `integer`, `fill_blank`)
- **`numerical` / `integer`:** answer field (input, radius 16, 56 tall, `title` size, tabular) with the unit as a suffix label when the question has one; a **custom keypad** sheet pinned at the bottom (replaces the system keyboard): digits 0–9 in a 3 × 4 grid, "." (hidden for `integer`), "−", "×10ⁿ" (shown only when the question's answer format allows scientific notation), backspace, and [Check] as the keypad's wide bottom key. Keys 56 tall, `surfaceRaised`, `label` 20.
- **After check:** field turns `successTint` with `Check`, or `errorTint` with `X`; wrong shows "Your answer: {value}" and on second try the correct value with the tolerance ("Accepted: {low} to {high}") in the solution sheet.
- **`fill_blank`:** the sentence with one or more inline blanks (underlined slot 80 min width, grows); tap a blank → either a chip bank below (when the content gives choices) or a text field; Hindi input uses the system keyboard in that case.
- **States:** empty; typing; invalid format ("Enter a number"); checked.
- **Accessibility:** keypad keys are buttons with spoken labels ("minus", "times ten to the power"); blanks are announced "Blank {n} of {total}, empty".
- **Copy:** "Enter your answer" / "अपना उत्तर लिखें", "Unit: {unit}" / "इकाई: {unit}", "Enter a number" / "कोई संख्या लिखें", "Your answer: {value}" / "आपका उत्तर: {value}", "Accepted: {low} to {high}" / "मान्य: {low} से {high}", "Fill the blank" / "खाली जगह भरें".

#### LES-01.14 · Arrange questions (`match_list`, `matrix_match`, `order_steps`, `paragraph`)
- **`match_list`:** two columns, List I (left, letters) and List II (right, numbers), as cards. Tap a left item, then a right item to pair them: a coloured connector line plus matching pair badge (shape + number, so not colour alone). The final answer is chosen from options (JEE/NEET style "A-2, B-4…") when the content is option-based; otherwise the pairs themselves are the answer.
- **`matrix_match`:** a grid with rows (P, Q, R, S) and columns (1–5); cells are 48 checkboxes; multiple ticks per row allowed. Horizontal scroll on narrow phones with sticky row labels.
- **`order_steps`:** as the interactive `order_steps` widget, but scored as a question with two tries.
- **`paragraph`:** a collapsible passage box at the top (max 40% height, scroll inside, "Read the passage"), then child questions one per card with "Question {n} of {total} from this passage"; the passage stays pinned (collapsible) on each child card.
- **States:** incomplete (Check disabled until every left item is paired, or every row has a tick); checked (correct pairs `Check`, wrong `X` with the correct partner shown on second try).
- **Accessibility:** pairing has a list alternative: each left item has a picker of right items. Matrix cells are labelled "{row} with {column}, checked".
- **Copy:** "Match each item" / "हर आइटम को मिलाएँ", "List I" / "सूची I", "List II" / "सूची II", "Read the passage" / "अनुच्छेद पढ़ें", "Question {n} of {total} from this passage" / "इस अनुच्छेद से प्रश्न {n} / {total}", "Tick all that match" / "जो-जो मेल खाते हैं, सब पर टिक करें".

#### LES-01.15 · Memory hook card (`memory_hook`)
- **Layout:** card body in the subject tint (R11; not gold), `Lightbulb` kicker "Memory trick" in subject `text`; the mnemonic `text` in `title` (large, wraps); optional `memory-hook` image 1:1 (max 40% height); "What it stands for" disclosure listing `decodes_to` in order as numbered rows; audio button [Play rhyme] when the mnemonic has `audio`; buttons: [Add to deck] secondary (free for everyone), [Make my own] secondary with `Sparkle`; a technique caption ("Acrostic", "Rhyme"…).
- **States:** added to deck ("In your deck" with `Check`; its review cards are scheduled at once); audio playing; [Make my own] for free students opens MEM-19, which shows its own gate (`memory_lock`); offline (Make my own disabled, "Needs internet"); little learner (image large, audio auto-plays once, no Make my own).
- **Interaction:** tap the mnemonic to expand "What it stands for". [Make my own] opens MEM-19 with this concept preselected and returns here.
- **Accessibility:** mnemonic is text; decode list read in order; image alt from the request.
- **Copy:** "Memory trick" / "याद रखने की ट्रिक", "What it stands for" / "इसका मतलब", "Play rhyme" / "तुकबंदी सुनें", "Add to deck" / "डेक में जोड़ें", "In your deck" / "आपके डेक में है", "Make my own" / "अपनी ट्रिक बनाएँ".

#### LES-01.16 · Role-play card (`roleplay`)
- **Layout:** LES keeps the top bar and the progress bar; AI-21 is hosted **in place** inside the card body (flow §7.8). Before the first message the card shows the character portrait (`roleplay-portrait`, 1:1, 160, circle crop) with name `heading` and era `caption`, the `opening_line` in a chat bubble, 2–3 `suggested_replies[]` as chips, the mic button and the goals checklist; AI-21 owns everything after that (chat, goals, its own turn cap and the summary). The AI disclosure line is always visible. [Continue] appears in the LES action area after the first exchange.
- **States:** before chat; chatting (AI-21); goals met ("{met} of {total} goals" with checks); AI-21's turn cap reached (AI-21's own copy; [Continue] stays); offline (opening line and chips still show, sending is disabled with "Needs internet", [Skip for now]); little learner (not used).
- **Interaction:** tapping a reply chip, the mic or typing starts the chat in place; no full-screen jump. Continue is enabled after the first exchange, or [Skip for now] at any time (role play is enrichment).
- **Accessibility:** portrait alt "{character_name}, illustrated portrait"; chips are buttons; the AI disclosure is visible text, not a tooltip. AI-21 owns the chat's live-region rules.
- **Copy:** "Chat with {character_name}" / "{character_name} से बात करें", "AI plays this role from history sources." / "यह भूमिका AI इतिहास के स्रोतों के आधार पर निभाता है।", "Find out: {goal}" / "पता करें: {goal}", "{met} of {total} goals" / "{total} में से {met} लक्ष्य", "Skip for now" / "अभी छोड़ें". AI-21 owns the rest.
- **Event:** `roleplay_started` (AI-21 owns the chat events).

#### LES-01.17 · Video card (`video`)
- **Layout:** `title` (from `content.videos`); YouTube player 16:9 inline, starting at `start_s` and stopping at `end_s`; concept chips from `concept_timestamps[]` under the player; [Watch full video] ghost → LRN-12.
- **States:** poster (online); playing; segment finished ("Done" check, Continue emphasised); offline (Needs internet, [Skip for now]); embed error ([Open in YouTube]).
- **Interaction:** no autoplay. Pager swipe is disabled over the player. Continue is enabled at any time.
- **Accessibility:** captions on by default; chips announce time and concept.
- **Copy:** "Watch {minutes} min" / "{minutes} मिनट देखें", "Watch full video" / "पूरा वीडियो देखें".
- **Event:** `video_card_played`.

#### LES-01.18 · Experiment card (`experiment`)
- **Layout:** `title`; `media` image (`sunny-scene`, 3:2); "You'll need" checklist from `materials[]` (tickable); "Steps" numbered list from `steps[]`; "Stay safe" callout in `warningTint` with `ShieldWarning` from `safety[]`, always visible above the steps; an adult-supervision chip when the content marks it; "Why it works" disclosure; [I tried it] secondary (optional, logs nothing beyond the tap).
- **States:** default; materials ticked; "I tried it" done (pet line "Science at home!").
- **Interaction:** Continue always enabled; the card can be saved (LES-04) to try later.
- **Accessibility:** safety callout is a labelled region read before the steps.
- **Copy:** "Try at home" / "घर पर करके देखें", "You'll need" / "आपको चाहिए", "Steps" / "चरण", "Stay safe" / "सावधानी", "Do this with an adult" / "किसी बड़े के साथ करें", "Why it works" / "यह क्यों होता है", "I tried it" / "मैंने करके देखा", pet "Science at home!" / "घर पर विज्ञान!".

#### LES-01.19 · Summary card (`summary`)
- **Layout:** "Key points" kicker with `ListChecks`; `points[]` as rows with a subject-coloured check bullet; optional `media`; a `caption` with `Cards` icon: "These go into your reviews."
- **States:** default; when it is the last card of a bite, the primary button reads [Finish] and leads to LES-07.
- **Interaction:** tap a point to bookmark it (small bookmark appears).
- **Accessibility:** list semantics.
- **Copy:** "Key points" / "मुख्य बातें", "These go into your reviews." / "ये आपके रिव्यू में आएँगी।", "Finish" / "पूरा करें".

#### LES-01.20 · Cheat sheet card (`cheat_sheet_ref`)
- **Layout:** inside a Quick revision this card is rendered as LRN-07 (the sheet in a scrollable body). Inside a Deep Dive (rare), it shows a compact preview with [Open cheat sheet] → LRN-08.
- **States, interaction, accessibility:** as LRN-07.

---

### LES-02 · Answer feedback sheet
**Purpose:** Tell the student right away whether they were right, and teach when they were not, by climbing the help ladder (A21). **Main action:** [Continue] (correct), [Try again] (first wrong), [Got it] (second wrong or "don't know").
**Entry → exits:** LES-01 [Check] or [I don't know yet], LES-14 → LES-01 (same or next card), LES-01.7 sim card in a sheet ([Try it in the sim]), AI-02 with the question as context ([Ask {pet_name} why]; AI-06 at the free limit).

**Layout (top to bottom):** a Sheet that slides up over the bottom of the card (the stem and options stay visible above it), auto height 30–60%:
1. **Correct:** `successTint` sheet top band with `CheckCircle` fill 32 in `success` and "Correct!" in `heading` (`successText`); a pet line (pet `hop`); XP chip "+{xp} XP" (`primaryTint`); "Why?" disclosure with the Feynman explanation (`solution.feynman`); [Continue] primary.
2. **Wrong, first try (rung 1, hint):** `errorTint` band with `XCircle` fill 32 and "Not quite" in `heading` (`errorText`); "Hint" box (`primaryTint`, `Lightbulb`) with the hint (flow §7.3 rule 5); [Try again] primary.
3. **Wrong, second try (rung 2, worked solution):** `errorTint` band with "Here's how it works"; then, scrollable: "In simple words" (Feynman text), "Step by step" (`solution.steps`, maths as Formula boxes), "Shortcut" (`primaryTint` box, when present), "Common trap" (`warningTint` box, the trap for the chosen option when present); a `caption` with `ArrowsClockwise`: "We'll bring this back in your review."; then the next rungs as secondary buttons in a row: **[Try it in the sim]** (rung 3, `Flask`, only when the bite has a sim card sharing a concept with the question) and **[Ask {pet_name} why]** (rung 4, the pet's head icon); [Got it] primary.
4. **"I don't know yet":** same as wrong-second but the band is `surfaceSunken` with `Info` and "No worries. Here's the idea.", no red, no shake.
5. **Second try correct:** `successTint` band, "Correct on the second try!", partial XP chip.
6. **Combo moment** (A19): after `learn.combo_streak_len` first-try correct answers in a row (once per lesson), the correct band adds a `primaryTint` chip "{n} in a row!" with `Lightning`, a short pet `celebrate` and a small burst; the chip stays for the rest of the sheet. Skippable by [Continue].
7. **Check mode** (LES-12): one try only. Correct or wrong band, then "In simple words" only, [Next] primary. No hint, no rungs, no XP chip (XP is shown on LES-13).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Correct | Correct! | सही! |
| Correct pet lines (rotate) | Nailed it! · You're on a roll! · That's the one! | बिल्कुल सही! · वाह, क्या बात है! · यही तो है! |
| Second try | Correct on the second try! | दूसरी बार में सही! |
| XP | +{xp} XP | +{xp} XP |
| Why | Why? | क्यों? |
| Not quite | Not quite | अभी सही नहीं |
| Hint | Hint | संकेत |
| Wrong pet line | Close! Look again. | करीब है! फिर से देखें। |
| Try again | Try again | फिर कोशिश करें |
| Explain head | Here's how it works | यह ऐसे होता है |
| Sections | In simple words · Step by step · Shortcut · Common trap | आसान शब्दों में · चरण दर चरण · शॉर्टकट · आम गलती |
| Review note | We'll bring this back in your review. | यह आपके रिव्यू में फिर आएगा। |
| Try in sim | Try it in the sim | सिम में करके देखें |
| Ask why | Ask {pet_name} why | {pet_name} से पूछें क्यों |
| Got it | Got it | समझ आ गया |
| Don't know head | No worries. Here's the idea. | कोई बात नहीं। यह रहा तरीका। |
| Generic hint | Think about {concept_name} again. | {concept_name} के बारे में फिर सोचें। |
| Combo | {n} in a row! | लगातार {n} सही! |
| Check mode next | Next | अगला |
| Little learner correct (तुम) | Yay! You did it! | वाह! तुमने कर दिखाया! |
| Little learner wrong (तुम) | Let's try again together! | चलो, साथ में फिर से कोशिश करें! |

`{n}` is `learn.combo_streak_len` (5 per A19).

**Illustration slots:** none (the pet avatar in the Pet line; maths as KaTeX SVG; question media stays above).

**States:** correct; second-try correct; wrong first; wrong second (with or without the sim rung); don't know; combo; check mode; offline (everything local; [Ask {pet_name} why] disabled with "Needs internet"); free tutor limit reached ([Ask {pet_name} why] opens AI-06; the rungs before it stay free and never use any quota); little learner (no XP chip, stars instead; wrong uses a `surfaceSunken` band with `ArrowCounterClockwise`, never "Not quite"; second wrong shows the answer with the pet explaining in one line, narration auto-plays; no [Ask {pet_name} why] unless the parent turned the tutor on); dark mode (tints dark).

**Interaction and motion:** correct: option check pops (`pop`), sheet slides `slow`, ding + success haptic. Wrong: option shakes 2 × 6 px, sheet slides, bonk + warning haptic. The sheet cannot be swiped away on wrong-first (the student must choose Try again) but can be on correct (= Continue). [Try it in the sim] opens the bite's sim card in a sheet and returns here. Combo: one burst under the `celebrate` duration, at most once per lesson. Reduced motion: no shake, fade instead of slide, the combo is a static chip.

**Accessibility:** result announced immediately as a live region ("Correct", "Not quite, hint: …"). Focus moves to the sheet's title, then the primary button. Colours always paired with icons and words. The rung buttons are in ladder order for focus.

**Analytics:** `answer_submitted` (each try), `answer_dont_know`, `hint_shown`, `solution_viewed`, `help_ladder_step` (`step`: hint, solution, sim, ask_why), `combo_shown`, `tutor_opened` (`from` = feedback).

**Web (≥ 600 px):** the sheet becomes an inline panel under the options within the 720 column (no overlay), Enter triggers the primary button.

**Mock priority:** **P0** (correct, wrong first, wrong second with the sim and Ask rungs); combo P1.

---

### LES-03 · Key term and symbol sheet
**Purpose:** Explain a highlighted term or a formula symbol without leaving the card. **Main action:** close; secondary [Add to deck].
**Entry → exits:** LES-01.2 key term, LES-01.3 symbol, LRN-10 symbol → back to the card; [Add to deck] adds a card to the topic deck (MEM-08 via the toast's [See deck]).

**Layout (top to bottom):** Sheet 40%: term (or symbol in KaTeX) in `title`; the definition from `highlights[]` (or symbol meaning + unit); English term in brackets for Hindi users on first use (content provides); [Hear it] (`SpeakerHigh`); [Add to deck] secondary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Hear | Hear it | सुनें |
| Add | Add to deck · Added | डेक में जोड़ें · जुड़ गया |
| Toast | Added to your deck · See deck | आपके डेक में जुड़ गया · डेक देखें |
| Unit | Unit: {unit} | इकाई: {unit} |

**Illustration slots:** none.

**States:** default; added; offline (Hear it uses cached TTS only; hidden if not cached); dark mode.

**Interaction and motion:** sheet `base`; tapping another term while open swaps the content.

**Accessibility:** sheet title is the term; focus returns to the same term on close.

**Analytics:** `key_term_opened`, `formula_symbol_opened`.

**Web (≥ 600 px):** a popover anchored to the term, 320 wide.

**Mock priority:** P1.

---

### LES-04 · Card menu
**Purpose:** Save, add to a deck, switch language, adjust reading, ask about the card, hear it as a story, or report an error on the current card. **Main action:** the chosen menu item.
**Entry → exits:** LES-01 overflow, LES-10 overflow → back to the card; "Ask about this card" → AI-02 (card as context); "Explain as a story" → AI-20; "Report a problem" → SET-24 (me+money owns the report form, with this card's id).

**Layout (top to bottom):**
1. Menu sheet (auto height): rows 56 with icons: Save card (`BookmarkSimple`), Add to deck (`Cards`), Ask about this card (the pet's head icon), Explain as a story (`BookOpen`), Switch to {other_language} (`Translate`), Text size (`TextAa`, opens a 3-step segmented control inline), Report a problem (`Flag`).
2. Report opens SET-24 as a sheet over the card; after sending, SET-24's thanks toast shows and the student is back on the same card.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Save | Save card · Saved | कार्ड सेव करें · सेव हो गया |
| Deck | Add to deck · In your deck | डेक में जोड़ें · आपके डेक में है |
| Ask | Ask about this card | इस कार्ड के बारे में पूछें |
| Story | Explain as a story | कहानी की तरह समझाएँ |
| Language | Switch to Hindi · Switch to English | हिन्दी में पढ़ें · English में पढ़ें |
| Text size | Text size · Small · Medium · Large | अक्षर का आकार · छोटा · मध्यम · बड़ा |
| Report | Report a problem | समस्या बताएँ |
| Language offline | Needs internet to switch | बदलने के लिए इंटरनेट चाहिए |

**Illustration slots:** none.

**States:** default; offline (language switch disabled unless that locale is downloaded; Ask and Story disabled with "Needs internet"; Report still opens SET-24, which queues in the outbox); free tutor limit reached (Ask opens AI-06); guest (all allowed); little learner (menu shows only Text size and "Tell a grown-up" (`Flag`), which needs the parent gate SET-13 before SET-24); check and fix modes (Save, Add to deck and Story hidden; Report kept); dark mode.

**Interaction and motion:** sheet `base`; language switch reloads the card in place with a cross-fade and keeps the position (same card id). Ask and Story open as overlays and return to the same card (flow §7.3 rule 13).

**Accessibility:** the menu is a list of buttons with visible labels; disabled rows say why.

**Analytics:** `bookmark_added`, `lesson_locale_switched`, `tutor_opened` (`from` = card_menu), `content_report_opened` (SET-24 owns the submit event).

**Web (≥ 600 px):** dropdown menu anchored to the overflow button; SET-24 opens as its own dialog.

**Mock priority:** P1.

---

### LES-05 · Exit confirm sheet
**Purpose:** Prevent accidental exits and reassure that progress is saved. **Main action:** [Keep going].
**Entry → exits:** LES-01 close, back gesture, Escape → LES-01 (stay) or the screen the lesson was opened from; onboarding variant [Finish later] → HOME-01 `start_here` (ONB-13 owns that hand-off).

**Layout (top to bottom):** Sheet 40%: pet avatar 56 with a Pet line ("Just {n} cards left!" when `learn.exit_nudge_cards_left` or fewer are left, else none); title "Leave the lesson?" `heading`; line "Your progress is saved." `body`; [Keep going] primary; [Exit] secondary.

**Variant: onboarding** (`mode=onboarding`; copy matches ONB-13): title "Your seed is waiting for its first drink", body with the cards-left count, [Keep going] primary, [Finish later] secondary.

**Variant: check** (LES-12): title "Stop the check?", line "Nothing is marked from an unfinished check. You can start again anytime.", [Keep going] primary, [Stop] secondary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Leave the lesson? | पाठ छोड़ना है? |
| Line | Your progress is saved. | आपकी प्रगति सेव है। |
| Pet line (few left) | {n, plural, one {Just # card left!} other {Just # cards left!}} | {n, plural, one {बस # कार्ड बाकी!} other {बस # कार्ड बाकी!}} |
| Keep going | Keep going | पढ़ते रहें |
| Exit | Exit | बाहर निकलें |
| Onboarding title | Your seed is waiting for its first drink | आपका बीज पहले पानी का इंतज़ार कर रहा है |
| Onboarding body | {cards_left, plural, one {Just # card left.} other {Just # cards left.}} | {cards_left, plural, one {बस # कार्ड बाकी है।} other {बस # कार्ड बाकी हैं।}} |
| Onboarding buttons | Keep going · Finish later | जारी रखें · बाद में पूरा करें |
| Check title | Stop the check? | टेस्ट रोकें? |
| Check line | Nothing is marked from an unfinished check. You can start again anytime. | अधूरे टेस्ट से कुछ भी मार्क नहीं होता। इसे कभी भी फिर से शुरू किया जा सकता है। |
| Check buttons | Keep going · Stop | जारी रखें · रोकें |
| Preview line | The preview ends after card {n}. | झलक कार्ड {n} के बाद खत्म होगी। |
| Little learner (तुम) | Keep playing · Go home | खेलते रहो · घर चलो |

**Illustration slots:** pet avatar only.

**States:** default; near the end (pet line); preview mode (line adds the preview line); onboarding; check; little learner (big buttons with icons: `Play` "Keep playing", `House` "Go home"); dark mode.

**Interaction and motion:** sheet `slow`; swipe down = Keep going. No guilt copy (X9).

**Accessibility:** focus on [Keep going]; Escape again on web = Exit.

**Analytics:** `lesson_exit_prompted` (`mode`), `lesson_exited`.

**Web (≥ 600 px):** dialog 400 wide.

**Mock priority:** P1.

---

### LES-06 · Resume and "lesson updated" notice
**Purpose:** Return the student to where they were, and tell them honestly if the lesson changed. **Main action:** [Resume].
**Entry → exits:** opening a topic with progress → LES-01 at the resume card or at the bite start.

**Layout (top to bottom):**
1. **Normal resume:** no sheet. LES-01 opens at the last card with a Toast "Picked up where you left off" and the action [Start over].
2. **Updated sheet** (bundle hash changed): Sheet 40%, `ArrowsClockwise` icon in `primaryTint`, title "This lesson was updated", line "We fixed or added a few cards.", [Resume] primary, [Start this bite again] secondary.
3. **Long gap sheet** (more than `learn.resume_restart_days` days): title "It's been a while. Start this bite again?", [Start bite again] primary, [Resume] secondary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Toast | Picked up where you left off | जहाँ छोड़ा था, वहीं से |
| Toast action | Start over | शुरू से |
| Updated title | This lesson was updated | यह पाठ अपडेट हुआ है |
| Updated line | We fixed or added a few cards. | कुछ कार्ड सुधारे या जोड़े गए हैं। |
| Long gap | It's been a while. Start this bite again? | काफ़ी दिन हो गए। यह हिस्सा फिर से शुरू करें? |
| Buttons | Resume · Start bite again · Start this bite again | आगे पढ़ें · फिर से शुरू करें · यह हिस्सा फिर से शुरू करें |

**Illustration slots:** none.

**States:** as above; offline with an old version (no updated sheet; the old version opens and the sheet shows next time online).

**Interaction and motion:** toast 4 s; sheet `slow`.

**Accessibility:** toast announced politely; its action reachable.

**Analytics:** `lesson_resumed` (`days_since`), `lesson_updated_notice_shown`.

**Web (≥ 600 px):** same, toast bottom-centre of the lesson column.

**Mock priority:** P2.

---

### LES-07 · Confidence check (end of a lesson)
**Purpose:** Ask how sure the student feels about the topic, to compare with how they did (metacognition, PRD §5.4). **Main action:** pick a rating (or [Skip]).
**Entry → exits:** last card of a bite or of rapid cards → LES-08; "See how well you judge" → MEM-25.

**Layout (top to bottom):** full card in the player (not a sheet): pet "thinking" 96; question "How sure does {topic_title} feel?" `heading`; a 5-step scale as 5 big chips in a row (each 56 tall, icon + word, from `Question` to `SealCheck`); [Skip] ghost; selecting a chip auto-continues after 300 ms. Under the scale, a `caption` link "See how well you judge" → MEM-25, shown only once memory-labs says MEM-25 has enough ratings to show.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Question | How sure does {topic_title} feel? | {topic_title} आपको कितना पक्का लगता है? |
| Scale | Lost · Shaky · Okay · Good · Rock solid | समझ नहीं आया · थोड़ा-थोड़ा · ठीक-ठाक · अच्छा · एकदम पक्का |
| Skip | Skip | छोड़ें |
| Metacog link | See how well you judge | देखें आपका अंदाज़ा कितना सही रहता है |

**Illustration slots:** `pet-cat` / `pet-dog` via Rive, 1:1, 96, `thinking` pose, decorative.

**States:** default; with the MEM-25 link; onboarding, check and fix modes (skipped); little learner (skipped entirely); repeat within a day for the same topic (skipped); dark mode.

**Interaction and motion:** chip select `pop`, light haptic.

**Accessibility:** radio group with spoken labels and position ("2 of 5, Shaky").

**Analytics:** `topic_confidence_rated`.

**Web (≥ 600 px):** keys 1–5 select.

**Mock priority:** P2.

---

### LES-08 · Lesson complete
**Purpose:** Reward the lesson, show what changed (XP, accuracy, time, streak, plant, pet), offer to fix mistakes, and point to what's next. **Main action:** [Continue].
**Entry → exits:** LES-07, LES-10 end, LRN-11 end, LRN-12 (segment watched) → LES-01 (next bite), LRN-03 (topic learned), HOME-01, MEM-02 (relearn, `source=comeback`), LES-14 (Fix mistakes row), PRC-03 (Practise this topic), AI-10 or AI-07 (Explain it back, Phase 2), ONB-15 (deferred reminder ask), AUTH-01 (3rd lesson, guest), PAY-19 (every 5th lesson, free, 13+) → PAY-01, SET-13 → AUTH-24 (little learner save-stars row), ME-07 (plant line tap), ME-20 (quest row), ME-16 (badge row), OS share sheet, SOC-15 (Challenge a friend, Phase 2).

**Layout (top to bottom):**
1. Full screen on `bg`, no top bar except a close `X` (= Continue to Home). Renders **at once from local state** (A23): no spinner, no wait for the network.
2. **Celebration illustration** 45% height: the pet's celebration (Rive `celebrate`) with Lottie confetti for the `celebrate` duration.
3. Title `display`: "Lesson complete!" (or "You learned {topic_title}!" when the topic is now learned).
4. **Three Stat tiles** in a row (DESIGN Stat tile, tabular, tint backgrounds): XP (`primaryTint`, counts up), Accuracy (`successTint`, "{n}%", first-try correct over questions; replaced by a "Cards" count if the bite had no questions), Time (`surfaceSunken`, "{m}:{ss}").
5. **Streak line** (first qualifying activity today): plant icon + "Streak {n} days!" with the number flipping (`emphasis`), and "Your plant grew a leaf" (or the stage-up line). Otherwise "Your plant is watered for today." Tap → ME-07.
6. **Daily goal** row: ring 40 (`primary`) + "Daily goal done" or "{left} min to your daily goal".
7. **Fix mistakes row** (A22; only when the bite had misses): `surface` row 64, radius 16, `ArrowCounterClockwise` 24 in `primary`, "Fix {n} mistakes" `label`, "Free · about {minutes} min" `caption`, trailing [Fix] secondary 40 → LES-14. After LES-14 it shows "Mistakes fixed" / "{fixed} of {total} fixed" with a `Check`.
8. Optional rows (max two): quest progress ("{quest_name} · {done}/{target}", → ME-20) and a badge earned (→ ME-16; ME owns art and rules).
9. Buttons: [Continue] primary with the next step in `caption` under it ("Next: {bite_title}" / "Back to {chapter_title}" / "Back to your comeback plan"); a row of secondary actions: [Practise this topic] (`Target`, once the topic is learned; → PRC-03 prefilled), [Explain it back] (`ChatTeardropText`, Phase 2; when the topic was just learned; → AI-10, or AI-07 for free students), [Share] (`ShareNetwork`).
10. **One extra, at most** (flow §7.5), below the buttons and never covering them, in this order: the deferred onboarding pair, ONB-08 daily goal then ONB-15 reminder ask (first finished lesson after onboarding's [Finish later] or a direct lane; the pair counts as one extra); AUTH-01 soft login sheet (guest, 3rd lesson, slides up 1.2 s after the counts finish); the little-learner save-stars row; **PAY-19 inline upsell card** (free, 13+, every 5th lesson; PAY-19 owns its look and copy).
11. **Little learner variant:** stars instead of XP ("You got {n} stars!"), no accuracy or time tiles, no Fix row (wrong answers were already retried with the pet), big [Next] button with `ArrowRight`, the pet says the line aloud. At the 3rd lesson a row "Ask a grown-up to save your stars" (`Lock`, hold to open SET-13, then AUTH-24).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Lesson complete! | पाठ पूरा! |
| Topic learned | You learned {topic_title}! | आपने {topic_title} सीख लिया! |
| Stat labels | XP · Accuracy · Time · Cards | XP · सटीकता · समय · कार्ड |
| Streak | Streak {n} days! | {n} दिन की स्ट्रीक! |
| Plant, leaf | Your plant grew a leaf | आपके पौधे पर नया पत्ता आया |
| Plant, stage up | Your plant is now a {stage_name}! | आपका पौधा अब {stage_name} बन गया! |
| Plant, watered | Your plant is watered for today. | आज पौधे को पानी मिल गया। |
| Goal | Daily goal done · {left} min to your daily goal | आज का लक्ष्य पूरा · लक्ष्य में {left} मिनट बाकी |
| Fix row | {n, plural, one {Fix # mistake} other {Fix # mistakes}} · Free · about {minutes} min · Fix | {n} गलतियाँ सुधारें · मुफ़्त · लगभग {minutes} मिनट · सुधारें |
| Fix done | Mistakes fixed · {fixed} of {total} fixed | गलतियाँ सुधर गईं · {total} में से {fixed} सुधरीं |
| Continue | Continue | आगे बढ़ें |
| Next caption | Next: {bite_title} · Back to {chapter_title} · Back to your comeback plan | अगला: {bite_title} · {chapter_title} पर वापस · वापसी योजना पर लौटें |
| Practise | Practise this topic | इस टॉपिक का अभ्यास करें |
| Explain back | Explain it back | अपने शब्दों में समझाएँ |
| Share | Share | शेयर करें |
| Challenge (Phase 2) | Challenge a friend | किसी दोस्त को चुनौती दें |
| Pet lines (rotate) | You did it! · That was great work! · I knew you could do it! | आपने कर दिखाया! · बहुत बढ़िया काम! · मुझे आप पर पूरा भरोसा था! |
| Offline caption | Will sync when you're online | ऑनलाइन होने पर सिंक होगा |
| Little learner title (तुम) | You got {n} stars! | तुम्हें {n} सितारे मिले! |
| Little learner next | Next | आगे |
| Save stars row (तुम) | Ask a grown-up to save your stars | अपने सितारे सेव करने के लिए किसी बड़े से पूछो |

**Illustration slots:**
| Slot | Preset | Ratio | Shows | Alt |
|---|---|---|---|---|
| Celebration | `pet-cat` / `pet-dog` via Rive `celebrate` | 1:1, up to 45% height | Pet dancing (proud or excited mood) | "{pet_name} is celebrating" |
| Plant | `plant-stage` via Rive (`water`, `grow`) | 1:1, 48 inline | Current plant | "Your plant: {stage}" |
| Share image | `pet-cat` / `pet-dog` celebrate pose, with the stats overlaid by the app (no text in the art) | 4:5 | For sharing | "Lesson complete card" |

PAY-19 brings its own art (the gold tag).

**States:**
- **Default:** as laid out.
- **Topic learned:** title variant; [Continue] goes to LRN-03 (learned) or the next topic per the plan; Practise and Explain it back shown.
- **First lesson of the day:** streak line; medium haptic + chime when the number flips.
- **Daily goal just met:** goal ring completes with `pop` and a second, smaller celebration.
- **Mistakes in the bite:** Fix row; it is not "the one extra" and always shows when there were misses.
- **Relearn (`source=comeback`):** caption "Back to your comeback plan"; [Continue] → MEM-02.
- **First lesson after onboarding's [Finish later] (or a direct lane):** ONB-08 then ONB-15 are the extra, counted as one.
- **3rd lesson, guest:** AUTH-01 slides up 1.2 s after the counts finish (AUTH owns frequency, R29).
- **Every 5th lesson, free, 13+:** PAY-19 below the buttons, if PAY-19's own rules allow (not in the first 3 days, at most 2 a day). If another extra takes the slot, PAY-19 waits for the 10th.
- **Offline:** numbers are optimistic (computed by app-core) with the offline caption under the stats; no correction animation later (the server value quietly replaces it on Home). Practise, Explain it back and Share need the network.
- **Pro:** no PAY-19.
- **Signed in with social access (Phase 2):** Share offers "Challenge a friend" (SOC-15). Minors need the `social` consent scope; never for little learners.
- **Little learner:** variant above.
- **Reduced motion:** no confetti, static celebration pose, numbers appear without counting.
- **Dark mode:** tiles use dark tints.

**Interaction and motion:** the screen appears the moment the last card ends (A23). Confetti for the `celebrate` duration; XP counts up over 800 ms with tabular figures; tiles enter with a 60 ms stagger (`gentle`); success haptic on enter; jingle. The Fix row fades in after the tiles (`base`). [Share] opens the OS share sheet with the generated image and a deep link (no personal data in the link).

**Accessibility:** title announced first, then the three stats as one sentence ("Earned {xp} XP, accuracy {n} percent, time {m} minutes {s} seconds"). Confetti and the celebration are decorative to screen readers. Focus lands on [Continue]; the Fix row is next in order.

**Analytics:** `lesson_completed` (learning event), `lesson_complete_viewed` (`streak_incremented`, `goal_met`, `extra`), `fix_mistakes_started` (via LES-14), `practise_topic_tapped`, `explain_back_tapped`, `soft_login_triggered`, `upsell_card_shown` and `upsell_card_tapped` (PAY-19 owns them).

**Web (≥ 600 px):** centred 560 column; stat tiles side by side; the extra sits under the buttons; Enter = Continue.

**Mock priority:** **P0** (default with streak line and the Fix row); PAY-19 variant P1; little learner P1.

---

### LES-09 · Preview finished
**Purpose:** End a free Deep Dive preview honestly and offer both ways forward. **Main action:** [Try Pro for ₹1].
**Entry → exits:** LES-01 preview limit reached (after `free.deep_dive_preview_cards` cards) → PAY-01 (trigger `deep_dive_lock`), LRN-07 (quick revision), LRN-03; kid variants as LRN-05 (SET-13 or PAY-03).

**Layout (top to bottom):** full card in the player: pet holding the gold tag 160; title "That was the free preview" `title`; line "Unlock the full deep dive with Pro, or revise this topic free."; what's left: "{n} more cards · {minutes} min" with a mini list of the remaining bite titles; [Try Pro for ₹1] primary; [Do quick revision free] secondary; [Back to topic] ghost; fine print.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | That was the free preview | मुफ़्त झलक यहीं तक थी |
| Line | Unlock the full deep dive with Pro, or revise this topic free. | पूरा डीप डाइव प्रो में खोलें, या इस टॉपिक को मुफ़्त में दोहराएँ। |
| Left | {n} more cards · {minutes} min | {n} और कार्ड · {minutes} मिनट |
| Pro | Try Pro for ₹1 | ₹1 में प्रो आज़माएँ |
| Free | Do quick revision free | क्विक रिविज़न मुफ़्त करें |
| Back | Back to topic | टॉपिक पर वापस |
| Fine print | First month {trial_price}, then {monthly_price}/month. Cancel anytime. | पहला महीना {trial_price}, फिर {monthly_price}/महीना। कभी भी रद्द करें। |

**Illustration slots:** `pet-*`, 1:1, 160, pet holding a blank gold tag, alt "{pet_name} holding the Pro offer".

**States:** default; offline (Pro button disabled "Needs internet"; quick revision works if local); trial used (button "See Pro", fine print without the trial); kid (Ask a grown-up variants, as LRN-05); after buying Pro (returns here and the lesson continues from the next card automatically, with a short celebration toast "Pro unlocked!" / "प्रो चालू!"); dark mode.

**Interaction and motion:** no timers; preview progress counts as cards seen (kept after upgrade).

**Accessibility:** price as text; focus on title then primary.

**Analytics:** `preview_finished`, `pro_gate_action`.

**Web (≥ 600 px):** centred in the lesson column.

**Mock priority:** P1.

---

### LES-10 · Rapid cards (Quick revision mode)
**Purpose:** Run a short set of fast recall cards and the common-traps card after the revision sheet. **Main action:** answer and move on quickly.
**Entry → exits:** LRN-07 [Start rapid cards] (including the MEM-02 relearn variant) → LES-02 (compact), LES-04, LES-05, LES-07 → LES-08.

**Layout (top to bottom):** the LES-01 shell with these changes:
1. Top bar shows "Rapid round" and "{n} left" instead of the counter; the progress bar is continuous (not segmented).
2. Cards are `question` (choice and input types) and `summary` recall cards. Summary cards are shown as recall prompts: the point with a blank or as "Do you remember…?" with [Show] and then self-rating buttons (Again, Hard, Good, Easy, DESIGN Rating buttons, with next-interval labels) since they feed FSRS.
3. The combo (A19) appears after `learn.combo_streak_len` first-try correct answers in a row, once per lesson ("{n} in a row!", `primaryTint`, `Lightning`).
4. The last card is the **Common traps** card: a list of "Mistake → Correct idea" rows (`Warning` and `CheckCircle` icons), [Finish].
5. Feedback is a compact inline banner (not a sheet) on correct; wrong uses the full LES-02 with a shorter explanation (Feynman only, steps behind "More").

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Rapid round | तेज़ राउंड |
| Left | {n} left | {n} बाकी |
| Combo | {n} in a row! | लगातार {n} सही! |
| Recall prompt | Do you remember? · Show | याद है? · दिखाएँ |
| Ratings | Again · Hard · Good · Easy | फिर से · मुश्किल · ठीक · आसान |
| Traps | Common traps · Mistake · Correct idea | आम गलतियाँ · गलती · सही बात |
| Finish | Finish | पूरा करें |
| More | More | और देखें |

**Illustration slots:** none per card (rapid cards are text-first); summary `media` shown small (1:1, 96) when present.

**States:** default; relearn (`source=comeback`: only the topic's very-low-recall cards, then back to MEM-02 after LES-08); offline (works for local bundles); little learner (not used: they have no Quick revision mode); dark mode.

**Interaction and motion:** transitions `base` (faster than the Deep Dive's `slow`); correct auto-advances after 600 ms unless the student taps "Why?"; combo chip `pop`.

**Accessibility:** auto-advance is off when a screen reader is on or reduced motion is set; rating buttons have text and the interval.

**Analytics:** `answer_submitted` (context lesson, mode quick_revision), `review_rated` (context lesson), `lesson_completed`.

**Web (≥ 600 px):** keys 1–4 rate, Space shows the answer.

**Mock priority:** **P0** (one question card and the traps card).

---

### LES-11 · Lesson loading and load error
**Purpose:** Cover the short wait while a bundle opens, and recover from a failure. **Main action:** none while loading; [Try again] on error.
**Entry → exits:** any lesson start → LES-01; error → LES-01 (retry), LRN-03 (back), LRN-16 (if offline).

**Layout (top to bottom):**
1. **Loading:** the LES-01 top bar (close only) and a skeleton card in the subject tint: a 40% height block, two `surfaceSunken` text bars; after 1.5 s a Pet line "Getting your lesson ready…"; after 8 s "Still loading. You can wait or try later." with [Back].
2. **Error:** `empty-state` illustration (pet holding a wrench), "Something broke on our side", [Try again] primary, [Back to topic] ghost, and a small `caption` with the trace ID for support ("Code: {trace_short}").

**Copy:**
| Key | EN | HI |
|---|---|---|
| Loading | Getting your lesson ready… | आपका पाठ तैयार हो रहा है… |
| Slow | Still loading. You can wait or try later. | अभी भी लोड हो रहा है। रुकें या बाद में आएँ। |
| Error | Something broke on our side | हमारी तरफ़ कुछ गड़बड़ हुई |
| Try again | Try again | फिर कोशिश करें |
| Back | Back to topic | टॉपिक पर वापस |
| Code | Code: {trace_short} | कोड: {trace_short} |

**Illustration slots:** error: `empty-state`, 4:3, pet holding a toy wrench beside a toolbox, alt "{pet_name} is fixing something".

**States:** loading, slow, error, offline (goes to LRN-16 instead), dark mode.

**Interaction and motion:** skeleton shimmer is a slow opacity pulse (off in reduced motion).

**Accessibility:** loading announced once; error title focused.

**Analytics:** `screen_view` (`screen_id` = LES-11, `state`), errors go to Sentry with the trace ID (no PII).

**Web (≥ 600 px):** same in the 720 column.

**Mock priority:** P2.

---

### LES-12 · Quick check mode
**Purpose:** Run a short, hint-free check (Find my level or Test out) that can only mark things learned, never failed. **Main action:** [Check], then [Next].
**Entry → exits:** HOME-08 [Start] (`kind=placement`), LRN-06 [Start test out] (`kind=test_out`, chapter), LRN-02 long-press "Mark as learned" (`kind=test_out`, one topic) → LES-02 (check-mode band) → LES-13; close → LES-05 (check variant) → back to the opening screen.

**Layout (top to bottom):** the LES-01 shell with these changes:
1. **Top bar:** close `X`, a header chip on `primaryTint` with `Gauge` 16 ("Quick check · {n} of {count}") or `Rocket` 16 ("Test out · {n} of {count}"), and a continuous progress bar under it (not segmented). No overflow except Report a problem (SET-24).
2. **Cards:** question cards only (LES-01.11 to .14), rendered by the shared question renderer with `showConfidence` on and `showToughOne` off. The Confidence row matters here: a correct answer tagged Guess does not pass a topic (flow §6.4) and a correct answer tagged Sure pre-marks a chapter in Find my level (flow §6.5). A `caption` under the chips says so once, on the first card.
3. **One try per question.** No hint, no struck options, no help ladder, no tutor button, no first-time demo replay. [I don't know yet] stays (it counts as not passed, with no red).
4. **Feedback:** LES-02 in check mode (band plus "In simple words", [Next]).
5. After the last question → LES-13.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Placement chip | Quick check · {n} of {count} | छोटा टेस्ट · {count} में से {n} |
| Test out chip | Test out · {n} of {count} | टेस्ट आउट · {count} में से {n} |
| Confidence note (first card) | Tap "Sure" only if you are. Guesses don't count as learned. | "पक्का" तभी चुनें जब सच में पक्का हो। अंदाज़े वाले सही जवाब "सीख लिया" में नहीं गिने जाते। |
| Next | Next | अगला |
| Last question | See my result | मेरा नतीजा देखें |

The placement chip matches the string onboarding defined for ONB-13 ("छोटा टेस्ट"), so the term stays the same across the app.

**Illustration slots:** none beyond question media from content.

**States:** default; offline (works when the placement set or the chapter's bundles are on the device; else LRN-16 before starting); guest (same; marks sync after sign-in); free vs Pro (identical; never uses the practice quota and never shows a Pro gate, even in a Pro chapter, because only questions are shown); little learner (not used in Phase 1–2; Phase 3 decides); dark mode.

**Interaction and motion:** cards slide with `base` (faster than a lesson's `slow`); no combo and no XP chip during the check. Back navigation shows answered cards read-only.

**Accessibility:** each card announces "Question {n} of {count}" and the chip's mode name; the confidence note is read once. Everything else as LES-01.11.

**Analytics:** `lesson_started` (`mode` = check, `entry`: placement, test_out), `answer_submitted` (`context` = check), `answer_dont_know`, `lesson_exit_prompted` (`mode` = check).

**Web (≥ 600 px):** as LES-01 in the 720 column; keys 1–4 / A–D select, Enter checks.

**Mock priority:** P1.

---

### LES-13 · Check result
**Purpose:** Show what a Find my level or Test out check found, mark what passed, and suggest where to go next without locking anything. **Main action:** [Use this] (placement) or [Continue] (test out).
**Entry → exits:** LES-12 last question → placement: [Use this] → HOME-01 (plan's current chapter updated), [Keep my plan] → HOME-01; test out: [Continue] → LRN-02, [Start {topic_title}] → LRN-03; "Undo" link → LRN-02 overflow "Reset chapter progress" (test out) or HOME-08 (redo placement).

**Layout (top to bottom):**
1. Full card in the player, no progress bar. Pet 96 (`proud` when anything passed, `curious` otherwise).
2. **Placement variant:**
   - Title `title`: "Start from {chapter_title}?"
   - Line `body`: "You already know some of the early chapters. We marked them so your reviews check them soon."
   - Rows, one per chapter asked (in syllabus order): chapter name `label`, trailing state chip: "Looks learned" (`successTint`, `Check`) or "Worth a lesson" (`surfaceSunken`, `BookOpen`).
   - [Use this] primary, [Keep my plan] secondary; `caption` "Nothing is locked. Redo it anytime from the subject's ⋯ menu."
3. **Test out variant:**
   - Title `title`: "You tested out of {n} topics!" (ICU plural), or "Good warm-up!" when none passed.
   - Line `body`: "Passed topics are marked learned. The rest are worth a lesson." (or, when none passed, "These topics are worth a lesson. Nothing was marked failed.")
   - Rows, one per topic: topic title `label`, trailing chip "Marked learned" (`successTint`, `Check`), "Worth a lesson" (`surfaceSunken`, `BookOpen`) or "Not in this check" (`surfaceSunken`, `Minus`).
   - [Continue] primary (→ LRN-02); [Start {topic_title}] secondary for the first topic worth a lesson.
4. A stat row: "+{xp} XP" chip (`primaryTint`) and "{correct} of {total} right" `caption`.
5. Streak line only when the check counts as a qualifying activity (flow §12 Q7).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Placement title | Start from {chapter_title}? | {chapter_title} से शुरू करें? |
| Placement line | You already know some of the early chapters. We marked them so your reviews check them soon. | शुरुआती अध्यायों में से कुछ आपको पहले से आते हैं। हमने उन्हें मार्क कर दिया है, ताकि रिव्यू में जल्द उनकी जाँच हो। |
| Placement line, none | Let's start at the beginning. That's a great place to be. | चलिए शुरुआत से शुरू करें। यह बहुत अच्छी जगह है। |
| Chips | Looks learned · Worth a lesson · Marked learned · Not in this check | सीखा हुआ लगता है · एक पाठ ज़रूरी · सीख लिया मार्क हुआ · इस टेस्ट में नहीं |
| Placement buttons | Use this · Keep my plan | यही रखें · मेरी योजना रखें |
| Placement note | Nothing is locked. Redo it anytime from the subject's ⋯ menu. | कुछ भी लॉक नहीं है। विषय के ⋯ मेनू से इसे कभी भी दोबारा किया जा सकता है। |
| Test out title | {n, plural, one {You tested out of # topic!} other {You tested out of # topics!}} | {n, plural, one {आपने # टॉपिक टेस्ट आउट कर लिया!} other {आपने # टॉपिक टेस्ट आउट कर लिए!}} |
| Test out title, none | Good warm-up! | अच्छी तैयारी हुई! |
| Test out line | Passed topics are marked learned. The rest are worth a lesson. | पास हुए टॉपिक "सीख लिया" हो गए। बाकी के लिए एक पाठ ज़रूरी है। |
| Test out line, none | These topics are worth a lesson. Nothing was marked failed. | इन टॉपिक के लिए एक पाठ ज़रूरी है। कुछ भी फ़ेल नहीं माना गया। |
| Test out buttons | Continue · Start {topic_title} | आगे बढ़ें · {topic_title} शुरू करें |
| Score | {correct} of {total} right | {total} में से {correct} सही |
| Undo | Undo this | इसे वापस लें |
| Undo title | Undo this check? | यह टेस्ट वापस लें? |
| Undo body | Only the topics this check marked learned go back to how they were. | सिर्फ़ वही टॉपिक पहले जैसे होंगे जिन्हें इस टेस्ट ने "सीख लिया" मार्क किया था। |
| Undo keep | Keep the marks | मार्क रहने दें |
| Pet proud alt | {pet_name} looks proud | {pet_name} गर्व से खुश है |
| Pet curious alt | {pet_name} is curious | {pet_name} उत्सुक है |

**Illustration slots:** `pet-cat` / `pet-dog` via Rive, 1:1, 96, `proud` or `curious` pose, alt "{pet_name} looks proud" / "{pet_name} is curious".

**States:** placement with a suggestion; placement with no correct-and-sure answers (line "none", [Use this] hidden, [Keep my plan] becomes [Start from the beginning] primary); test out with passes; test out with none passed; one-topic test out from "Mark as learned" (single row; [Continue] returns to LRN-02); offline (marks are local and sync later); dark mode.

**Interaction and motion:** rows enter with a 60 ms stagger (`gentle`); passed chips pop (`pop`) once; success haptic when anything passed. No confetti (this is a check, not a lesson). "Undo this" asks for a confirm and clears only the marks this check made.

**Accessibility:** the title is focused first; each row reads "{name}, {state}"; chips have text and icons, not colour alone.

**Analytics:** `check_completed` (`kind`: placement, test_out; `correct`, `total`, `topics_passed`), `topic_learned` (`learned_via`: placement, test_out) per passed topic, `find_level_result_action` (`use`, `keep`).

**Web (≥ 600 px):** centred in the lesson column, 560 wide.

**Mock priority:** P1 (both variants).

---

### LES-14 · Fix mistakes round
**Purpose:** Let the student retry what they missed in the bite, right away and free (A22). **Main action:** [Check] on each question.
**Entry → exits:** LES-08 Fix row → LES-02 (normal two tries and help ladder) → LES-08 (row updated); close → back to LES-08 with progress kept.

**Layout (top to bottom):** the LES-01 shell with these changes:
1. **Top bar:** close `X`, a header chip on `primaryTint` with `ArrowCounterClockwise` 16: "Fix mistakes · {n} of {count}", and a continuous progress bar.
2. **Cards:** the bite's missed questions in the order they came, or a sibling question on the same concept when one exists in the bundle (so the student doesn't just recall the shown answer), up to `learn.fix_mistakes_max`. Each card has a small `caption` "From card {index}" so the student knows where it came from.
3. **Help ladder as in a lesson:** two tries, hint, worked solution, [Try it in the sim], [Ask {pet_name} why].
4. **End card:** pet `proud` 96, "{fixed} of {total} fixed", line "These will come back in your reviews.", [Done] primary → LES-08.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Chip | Fix mistakes · {n} of {count} | गलतियाँ सुधारें · {count} में से {n} |
| Source | From card {index} | कार्ड {index} से |
| End title | {fixed} of {total} fixed | {total} में से {fixed} सुधरीं |
| End line | These will come back in your reviews. | ये आपके रिव्यू में फिर आएँगे। |
| End line, all fixed | All fixed! They'll still come back in your reviews to stick. | सब सुधर गईं! पक्का करने के लिए ये रिव्यू में फिर आएँगे। |
| Done | Done | हो गया |

**Illustration slots:** end card: `pet-cat` / `pet-dog` via Rive, 1:1, 96, `proud` pose, alt "{pet_name} looks proud".

**States:** default; all fixed; some still wrong (no penalty; the review cards already scheduled stay); offline (works, everything is in the bundle; [Ask {pet_name} why] needs internet); free and Pro identical (never uses gems, the practice quota or any limit; X1); little learner (not used; LES-08 has no Fix row for them); dark mode.

**Interaction and motion:** as LES-01 question cards; transitions `base`. No combo. XP from `xp.fix_*` flags appears on the end card, not per question.

**Accessibility:** each card announces "Fix {n} of {count}, from card {index}"; the end card title is focused.

**Analytics:** `fix_mistakes_started` (`count`), `answer_submitted` (`context` = fix), `fix_mistakes_completed` (`fixed`, `total`).

**Web (≥ 600 px):** as LES-01.

**Mock priority:** P1.

---

### WEB-01 · Web app shell
**Purpose:** The strings the web app's frame needs around every screen (TRD §4.2): the four tabs (R46), the skip link, the language and Night Colour switches, the offline banner, the error and not-found pages, and the development-only stand-ins for Google sign-in and payment (shown only in local and test builds, never in production). **Main action:** none (frame).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Tab learn | Learn | सीखें |
| Tab labs | Labs | लैब |
| Tab practice | Practice | प्रैक्टिस |
| Tab me | Me | मैं |
| Main nav | Main | मुख्य |
| Skip link | Skip to content | सामग्री पर जाएँ |
| Language button | हिन्दी | English |
| Language button a11y | Switch to Hindi | अंग्रेज़ी में बदलें |
| Theme light a11y | Switch to light colours | हल्के रंगों पर जाएँ |
| Theme dark a11y | Switch to Night Colour | नाइट कलर पर जाएँ |
| Offline banner | You're offline. Your progress is saved on this device. | आप ऑफ़लाइन हैं। आपकी प्रगति इस डिवाइस पर सुरक्षित है। |
| Back online | Back online. Saving your progress now. | फिर से ऑनलाइन। आपकी प्रगति सेव हो रही है। |
| Error title | Something went wrong | कुछ गड़बड़ हो गई |
| Error body | Your progress is safe. Try reloading the page. | आपकी प्रगति सुरक्षित है। पेज फिर से लोड करके देखें। |
| Error action | Reload | फिर से लोड करें |
| Not found title | We couldn't find that page | हमें यह पेज नहीं मिला |
| Not found body | It may have moved. Let's get you back to learning. | शायद यह कहीं और चला गया है। चलिए, वापस पढ़ाई पर चलते हैं। |
| Not found action | Go to Home | होम पर जाएँ |
| Loading | Loading | लोड हो रहा है |
| Load error | That didn't load. Check your internet and try again. | यह लोड नहीं हुआ। इंटरनेट देखकर फिर से कोशिश करें। |
| Retry | Try again | फिर से कोशिश करें |
| Fixture notice | Sample content for testing | टेस्टिंग के लिए नमूना सामग्री |
| Dev sign in title | Test sign-in (development only) | टेस्ट साइन-इन (केवल डेवलपमेंट) |
| Dev sign in body | There is no Google here. Type any test email to stand in for a Google account. | यहाँ Google नहीं है। Google खाते की जगह कोई भी टेस्ट ईमेल लिखें। |
| Dev email | Test email | टेस्ट ईमेल |
| Dev name | Name | नाम |
| Dev submit | Continue | जारी रखें |
| Dev email error | Type an email with an @ | @ वाला ईमेल लिखें |
| Fake pay title | Test payment (development only) | टेस्ट पेमेंट (केवल डेवलपमेंट) |
| Fake pay body | No money moves. Pick what the bank answers. | कोई पैसा नहीं कटेगा। चुनें कि बैंक क्या जवाब दे। |
| Fake pay approve | Approve payment | पेमेंट मंज़ूर करें |
| Fake pay decline | Decline payment | पेमेंट मना करें |
| See all | See all | सभी देखें |
| Your subjects | Your subjects | आपके विषय |
| Chapters count | {n, plural, one {# chapter} other {# chapters}} | {n, plural, one {# अध्याय} other {# अध्याय}} |
| Topics count | {n, plural, one {# topic} other {# topics}} | {n, plural, one {# टॉपिक} other {# टॉपिक}} |
| Minutes | {n} min | {n} मिनट |
| Learned | Learned | सीख लिया |
| Start | Start | शुरू करें |
| Back | Back | वापस |

**Mock priority:** none (frame strings).

---

### WEB-02 · Web lesson player cards
**Purpose:** The labels the web lesson player puts around published cards and questions (LES-01 to LES-03): card kind chips, answer inputs for every question type, the six interactive widgets, lab and online-only fallbacks, and the experiment, formula and worked-example headings. The content itself always comes from the bundle. **Main action:** as LES-01.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Kind story | Story | कहानी |
| Kind explainer | Explainer | समझें |
| Kind formula | Formula | फ़ॉर्मूला |
| Kind animation | Animation | एनिमेशन |
| Kind interactive | Try it | करके देखें |
| Kind sim | Lab | लैब |
| Kind model3d | 3D model | 3D मॉडल |
| Kind pano360 | 360° view | 360° व्यू |
| Kind derivation | Derivation | व्युत्पत्ति |
| Kind worked example | Worked example | हल किया हुआ उदाहरण |
| Kind question | Question | सवाल |
| Kind memory hook | Memory trick | याद रखने की ट्रिक |
| Kind roleplay | Role-play | रोल-प्ले |
| Kind video | Video | वीडियो |
| Kind experiment | Experiment | प्रयोग |
| Kind summary | Summary | सारांश |
| Kind cheat sheet | Cheat sheet | चीट शीट |
| Kind common traps | Common traps | आम गलतियाँ |
| Previous card a11y | Previous card | पिछला कार्ड |
| Next card | Next card | अगला कार्ड |
| Read only note | You've done this card. | यह कार्ड आप कर चुके हैं। |
| Task first | Finish the task above to go on. | आगे जाने के लिए ऊपर का काम पूरा करें। |
| Skip task | Skip task | काम छोड़ें |
| Media missing | Picture coming soon | तस्वीर जल्द आएगी |
| Transcript | Read the transcript | ट्रांसक्रिप्ट पढ़ें |
| Lab fallback title | The lab isn't ready on this device yet | यह लैब अभी इस डिवाइस पर तैयार नहीं है |
| Model fallback title | The 3D view isn't ready on this device yet | 3D व्यू अभी इस डिवाइस पर तैयार नहीं है |
| Pano fallback title | The 360° view isn't ready on this device yet | 360° व्यू अभी इस डिवाइस पर तैयार नहीं है |
| Online only title | Needs internet | इंटरनेट चाहिए |
| Online only body | This card needs internet. Skipping it never counts against you. | इस कार्ड के लिए इंटरनेट चाहिए। इसे छोड़ने से आपका कुछ नहीं कटेगा। |
| Play video | Play video | वीडियो चलाएँ |
| Roleplay unavailable | Role-play with the tutor is coming soon. | ट्यूटर के साथ रोल-प्ले जल्द आ रहा है। |
| Materials | You need | आपको चाहिए |
| Steps | Steps | स्टेप |
| Safety | Stay safe | सुरक्षित रहें |
| Why it works | Why it works | ऐसा क्यों होता है |
| Adult supervision | Do this with a grown-up. | इसे किसी बड़े के साथ करें। |
| Problem | Problem | सवाल |
| Show solution | Show the solution | हल दिखाएँ |
| Answer | Answer | जवाब |
| Symbols | What the symbols mean | चिह्नों का मतलब |
| Works when | Works when | कब लागू होता है |
| Why step | Why | क्यों |
| Your answer | Your answer | आपका जवाब |
| Type a number | Type a number | एक संख्या लिखें |
| Correct answer | Correct answer | सही जवाब |
| Assertion | Assertion | अभिकथन |
| Reason | Reason | कारण |
| Statement n | Statement {n} | कथन {n} |
| Passage | Read the passage | अनुच्छेद पढ़ें |
| List one | List I | सूची I |
| List two | List II | सूची II |
| Pick match | Match for {item} | {item} का मिलान |
| Choose | Choose | चुनें |
| Blank n | Blank {n} | रिक्त स्थान {n} |
| Move up a11y | Move {step} up | {step} को ऊपर ले जाएँ |
| Move down a11y | Move {step} down | {step} को नीचे ले जाएँ |
| Order hint | Put the steps in order | स्टेप सही क्रम में लगाएँ |
| Matrix hint | Tick every match in each row | हर पंक्ति में हर सही मिलान पर टिक करें |
| Sort hint | Put each item in the right box | हर चीज़ को सही डिब्बे में रखें |
| Box for item | Box for {item} | {item} का डिब्बा |
| Label for spot | Label for spot {n} | स्थान {n} का लेबल |
| Tap reveal hint | Tap each tile to see what's inside | हर टाइल पर टैप करके अंदर देखें |
| Slider value | Value | मान |
| Graph x | x | x |
| Graph y | y | y |
| Widget right | That's right! | बिल्कुल सही! |
| Widget wrong | Not quite. Look at the highlighted ones. | पूरी तरह सही नहीं। हाइलाइट किए हुए देखें। |
| XP chip | +{xp} XP | +{xp} XP |

**Mock priority:** none (labels inside LES-01 to LES-03).

---

## Appendix A · P0 screens for the visual mocks

| Screen | States to mock |
|---|---|
| HOME-01 Home | Default (exam chip top left, hero `continue`, path strip with a review node and [Cheat sheet], grid with "Next:" lines, Memory and Library tiles); new user (`start_here`); streak at risk (`streak_saver`, warning streak card, freeze slots); offline banner |
| HOME-05 Search | Grouped results (with Labs and elements, Memory); no results with "Ask {pet_name}" |
| LRN-01 Subject map | Default with Free / Pro chips on chapters |
| LRN-02 Chapter | Header card with "Open cheat sheet"; rail with done, next (expanded), review row, in progress and Pro rows; pinned CTA |
| LRN-03 Topic card | New topic (Deep dive selected); Pro-gated Deep dive with Quick revision selected; subject-tint memory trick |
| LRN-05 Pro preview sheet | Deep dive variant |
| LRN-07 Quick revision sheet | Default |
| LES-01 Lesson player | Explainer with key terms; MCQ single with the Tough one chip; numerical with keypad; inline sim card |
| LES-02 Feedback | Correct; wrong first (hint); wrong second (worked solution with [Try it in the sim] and [Ask {pet_name} why]) |
| LES-08 Lesson complete | Default with streak line and the Fix row |
| LES-10 Rapid cards | One question card; common traps card |
| HOME-06 Little learner Home (Phase 3 set) | Default path with pet and [Play], three tabs |

P1 mocks to add after the P0 set: HOME-08, LRN-06, LES-12, LES-13 (both variants), LES-14, PAY-19 placement on LES-08.

## Appendix B · Screens in other areas referenced here

Every cross-area reference in this doc is a real screen ID; the full table is in `docs/flows/learn.md` §13. There are no `TODO(<AREA>)` placeholders left.
