# Platform parity

The screen and feature matrix for iOS, Android and web (TRD §2.1). A pull request that adds or changes a feature on one platform updates its row here. Screen ids come from `docs/APP_FLOW.md` and `docs/UX_FLOW.md`.

The table records what the code in `apps/mobile` and `apps/web` does today, not what is planned. iOS and Android share one Expo codebase, so their columns only differ where a feature is platform-specific.

**Status:** **Built** means the screen or feature works end to end against the API (or the fake API in dev and tests). **Partial** means it exists with gaps, listed in the notes. **Not built** means there is no screen yet. **n/a** means the feature is not meant for that platform.

Last updated 31 Oct 2026. The mobile columns come from the mobile build branch (`worktree-agent-a8c9fe7059bbdadfa`), the web column from the apps as merged into `claude/project-thread-vnixsy`. Mobile screens have been checked in the Expo web preview at 390 px and through Jest. They have not been run on a device: the Maestro flows in `apps/mobile/maestro` are written but have not been run.

## Onboarding and accounts

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Welcome and language | ONB-01, ONB-02 | Built | Built | Built | |
| Goal, class, birth year, level | ONB-03 to ONB-06 | Built | Built | Built | |
| Buddy (pet) and seed | ONB-07 to ONB-09 | Built | Built | Built | |
| First lesson and first win | ONB-13, ONB-14 | Built | Built | Built | |
| Daily goal and reminder | ONB-12, ONB-15 | Built | Built | Built | Web asks for browser notification permission. Mobile has a denied state (ONB-15). |
| Google sign-in | AUTH-01, AUTH-02 | Built | Built | Built | |
| Apple sign-in | AUTH-01 | Built | n/a | Not built | |
| Guest progress merge on sign-in | AUTH-06, AUTH-08 | Built | Built | Built | |
| Sign out (wipes the device profile) | AUTH-12 | Built | Built | Built | Mobile also clears the home-screen widgets. |
| Account deletion | AUTH-13 | Not built | Not built | Built | |
| Profile switch | SET | Not built | Not built | Not built | |

## Learn

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Home (streak, hero, up next) | HOME-01 | Built | Built | Built | |
| Search | HOME-05 | Not built | Not built | Partial | Web searches topics, labs and the student's decks; formulas and PYQs need a server route. |
| Streak check-in | ENT-08 | Not built | Not built | Partial | Web shows the comeback, resting and long-break variants from the plant and the last open on this device. Freeze and incident variants wait for a "freeze used" fact; the exam-date row waits for an ONB-06 edit mode. |
| Today's plan card | HOME-02 | Not built | Not built | Not built | app-core has `buildLocalPlan`; mobile uses it only for the widgets so far. |
| Little learner Home | HOME-06, SET-13 | Partial | Partial | Not built | Mobile: three tabs (R14), the path (each topic's storybooks, lesson, songs and play from the manifest's `topics[].activities`), gentle pet and plant, the 2-second "For grown-ups" hold and the SET-13 gate with the parent's own sign-in and PIN, behind `feature.little_learner`. The speaker button plays on web only until `expo-audio` is linked. |
| Story, song and play | LRN-11, LRN-17, LRN-18 | Partial | Partial | Not built | Mobile: the lesson-player-native StoryPlayer, SongPlayer and PlayPlayer at `/activity/[id]`, opened from HOME-06. A finish records `activity_completed` (app-core `recordActivityCompleted`) and marks the node done on the device in the same transaction. Web preview plays CDN audio and measures tracing with a canvas glyph mask; on the phone the players stay silent and accept any trace until expo-audio and a native glyph mask (Skia) are added. |
| Subject map | LRN-01 | Partial | Partial | Built | Mobile has the All, In progress and Not started filters, the Weak filter (shown once `learn.weak_filter_min_attempts` is set) and unit headers when the manifest names its units (today's manifests don't, so none show). Not yet: "Download subject" in the overflow and the Downloaded chip on chapter cards (the subject scope is in the LRN-15 sheet). |
| Chapter | LRN-02 | Partial | Partial | Built | Mobile has the topic rail, Practise, Chapter test (LRN-06 sheet: Test out or Practise), reviews by topic, the long-press topic menu (Quick revision, Download, Mark as learned), Download for offline (LRN-15, Pro, chapter or subject, Wi-Fi only, both languages, remove), Reset progress and Report. Not yet: the LRN-06 mock card (mock cards carry no chapter id), resuming a Wi-Fi-only download in the background, and the "Manage downloads" link (no ME-21 screen). Test-out marks and resets are local only: the sync contract has no event for them. Web also has a topic page. |
| Test out and its result | LES-12, LES-13 | Built | Built | Not built | Mobile runs lesson-core's check plan (one try, no hints), marks passed topics learned with `learned_via: test_out`, never marks a topic failed, and offers "Undo this". All checkable questions are used while `learn.test_out_questions_per_topic` is unset. |
| Lesson player (Deep Dive) | LES-01 to LES-08 | Built | Built | Built | Mobile includes the not-found state (LES-11). |
| Lesson end | LES-09 | Built | Built | Built | |
| Little learner lesson | LES-01, LES-02 (little learner) | Partial | Partial | Partial | The lesson players render lesson-core's `little` mode: gentle hint, the guided finish (the shown answer is tapped, so every question ends on a win), no XP chip, counter or confidence row, the LES-02 pet lines on both platforms, and card narration that auto-plays (never when muted) through the host's audio port. Mobile opens it from HOME-06 (behind `feature.little_learner`). Hosts do not pass an audio port or mute setting yet. The story pet reacts at page turns. |

## Memory and Labs

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Memory hub | MEM-01 | Built | Built | Not built | |
| Comeback after a break | MEM-02 | Built | Built | Built | |
| Memory palaces | MEM-12 to MEM-15, MEM-17, MEM-18 | Partial | Partial | Partial | Web: palace screens in apps/web/src/screens/phase2/palace (moving onto app-core's palace store). Mobile: palaces on app-core's palace documents (offline in the profile database, synced as `palace_saved`, the same module the web app uses), RoomCard list, template and name, items from list mnemonics in learned topics, builder with tap-then-tap placing, swap and Auto-place, walk and the "What's here?" quiz (Again or Good schedules each item's `p:` card with the device FSRS), behind Pro. Not built: room and template art (needs Agnes images), the drag canvas, MEM-16 spot notes and pictures, "Put them back", items from decks and saved hooks, room rename and split, "From your lessons" system walks. |
| Insights | MEM-25 | Partial | Partial | Partial | Web: MEM-25 with fading soon and sleep review. Mobile: calibration (Sure, 50:50, Guess bars and the two headline counts) from `/v1/insights/calibration`, with the "answers still needed" state; fading topics from `/v1/insights/weak-areas` (opens a topic review); tonight's sleep review status from `/v1/insights/sleep-review`. Not built: the range and subject filters, the topic heat map, per-subject scores, the target mark and MEM-26. |
| Review session (FSRS) | MEM-03, MEM-04 | Built | Built | Built | Mobile can scope a session to one topic (from LRN-02) and has Undo for the last rating: the rating is held on the device until the next rating, the end of the session, leaving or going to the background, so nothing is retracted from the outbox. |
| Labs hub | LAB-01 | Built | Built | Built | Mobile shows per-lab progress and "Works offline" once a lab is downloaded. |
| Lab detail and info | LAB-03, LAB-18 | Built | Built | Built | Mobile asks before a download on mobile data when the lab is larger than `lab.confirm_download_mb`, and points to the lesson's explainer when the lab can't be fetched. |
| Lab player (sims) | LAB-04, LAB-06 | Partial | Partial | Built | Mobile runs the real sim bundles in `react-native-webview` through `sim-bridge` (`createWebViewHost`), downloaded to the device and cached for offline use (Pro). Tasks, check, hint, skip, readings table, reset, battery saver, slow-start and one restart after a crash. Full screen keeps the running sim and puts the tasks in a side panel; the orientation unlock and rotate hint are not built yet. Not yet run on a device; the web preview runs the same screens through an iframe. |
| Lab fallback and complete | LAB-05, LAB-07 | Built | Built | Built | |

## Practice

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Practice hub | PRC-01 | Built | Built | Built | |
| Weak spots | PRC-02 | Built | Built | Not built | |
| Topic drill, session and summary | PRC-03 to PRC-06 | Built | Built | Built | Mobile includes the free-limit sheet (PRC-17). |
| PYQ browser (hub, by chapter, by paper) | PRC-07 to PRC-10 | Built | Built | Not built | Mobile shows each PYQ's source (PRC-18). |
| Daily challenge | PRC-11, PRC-12 | Built | Built | Not built | |
| Share card | PRC-13 | Built | Built | Not built | Mobile renders the card as a view and shares it as an image (`react-native-view-shot` and `expo-sharing`, both MIT). The card has no question text and nothing that identifies the student. The web preview uses the Web Share API or a download. |
| Progress and analytics | PRC-14 | Partial | Partial | Built | Mobile shows practice, mock trend and syllabus covered; its readiness, speed, confidence and mistake cards can now use `GET /v1/analytics/summary`. Web reads those cards from it (held-back cards show what is still needed), plus the mock trend and weak spots. |
| Practice history | PRC-16 | Built | Built | Not built | |
| Mock list | MOCK-01 | Built | Built | Built | Web shows the exam's mock on the runner's start screen. |
| Mock runner, submit and report | MOCK-02 to MOCK-19 | Built | Built | Built | |
| Live mocks | MOCK-03, MOCK-24 | Partial | Partial | Not built | Mobile at `/live/[id]`: the room through `/v1/live/mocks/{id}` with a countdown on the server's clock (kept offset, so it runs offline), [Register] (Pro; free opens the paywall) to Registered to [Start now] into MOCK-02/04 for that mock, the late-start line, taken and closed states; the leaderboard with frozen ranks, percentiles and the learner's row pinned. Not built: the MOCK-01 live strip that links here (the mock list is the practice build's screen), reminder toggle and Add to calendar, the Realtime/SSE start signal (the room refetches at window edges instead), Friends and My city tabs, and nickname words for under-18 rows (shown as "Nickname" with their pet). |
| Solutions | MOCK-22 | Built | Built | Not built | |
| Mock history and custom mock | MOCK-25, MOCK-26 | Built | Built | Not built | |

## AI tutor

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Tutor chat (streamed) | AI-02 to AI-07 | Built | Built | Not built | Mobile streams with `expo/fetch`. |
| Safety helplines | AI-08 | Built | Built | Not built | Helplines come from the server's safety event, never from the app. |
| Tutor history | AI-09 | Built | Built | Not built | |
| Photo doubt | AI-12, AI-16 | Partial | Partial | Not built | The screens exist; there is no photo-doubt API route yet. |
| Feynman explain-back | AI-10, AI-11 | Built | Built | Not built | Typed or dictated explanation, graded by `/v1/feynman/attempts`. When grading is unavailable the explanation is kept and the screen says so. Gaps go to review as tutor cards. Answering a follow-up isn't built yet. Opened from LRN-07 when `feature.feynman` is on. |
| Voice tutor | AI-13 to AI-15 | Partial | Partial | Not built | `VoiceSession` checks `/v1/voice/quota`, then mints a session. There is no realtime audio transport yet (it needs a native audio module), so AI-13 shows "Voice isn't ready yet" with the reason (Pro, no allowance set, offline, needs an update) and a way into text chat. The live and summary screens are built and tested with a scripted transport. |
| Read-aloud and dictation | `/v1/speech/*` | Partial | Partial | Not built | `ReadAloudButton` on AI-11 and the little-learner home; the mic works on web. Native playback and recording need expo-audio. When the API has no speech provider, a toast says listening isn't available. |

## Me and money

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Me | ME-01 | Built | Built | Built | |
| Settings: language, appearance | SET-01, SET-06, SET-07 | Built | Built | Built | Mobile adds haptics (SET-08); web adds daily goal (SET-10) and the analytics choice (SET-11). |
| Report a problem with content | SET-24 | Built | Built | Not built | Reachable from lessons, questions, chapters and labs. |
| Notification settings | SET-03 | Not built | Not built | Built | Mobile keeps the reminder set in onboarding. |
| Paywall and purchase | PAY-01, PAY-08, PAY-09 | Built | Built | Built | Mobile uses RevenueCat (fake provider in dev); web uses Razorpay (fake step in dev). Prices come from the server. |
| Your plan | PAY | Not built | Not built | Built | |
| Parent mode, PIN and time limits | SET-13 to SET-19 | Partial | Partial | Partial | Mobile: the gate (parent's own session on the child's phone, PIN), dashboard with Needs you, weekly report, time limits and the little learner switches, through `/v1/guardian/*`. The child's phone enforces the limit offline (app-core `timeLimitState`) and opens SET-19, where the child asks through `/v1/me/time-requests`. Not built: SET-17 consents, SET-18 add a child, the friends row, "Send a cheer" (no API yet). Web: SET-13 gate with a separate grown-up Google session (AUTH-24, the learner stays signed in), SET-14 dashboard, SET-15 report, SET-16 limits, SET-17 consents and friends; no PIN (SET-18, SET-19). |
| Pet room, revival quest, shop, quests | ME-04, ME-08, ME-17, ME-20 | Not built | Not built | Built | Web lists only the shop items that have names and art (treat, freeze). |
| Ask a grown-up (paywall and tutor limit) | PAY-03, AI-06 | Not built | Not built | Partial | Web opens Parent mode; "Send to my parent" waits for the PAY-17 token API. |

## Social

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Friends tab and locked states | SOC-01, SOC-02 | Partial | Partial | Not built | Mobile: the Friends tab behind `feature.friends` (R46), never for little learners; the server's gate picks SOC-02 (guest, ask a parent, under 13). League card, friends today, Duos, Challenge, Squads and Shared decks. SOC-07 is a short sheet (Challenge, Cheer). Names arrive resolved for the viewer (R31). No activity feed (SOC-01 activity) or leaderboards (SOC-10) yet. |
| Add friends | SOC-03 to SOC-05 | Partial | Partial | Not built | Mobile: invite link (share on native, copy on web), add a friend's code, username search. Not built: the QR (needs a QR renderer and `expo-camera`) and SOC-03 username setup. |
| Inbox, cheers and nudges | SOC-06, SOC-22 | Built | Built | Not built | Preset messages only, never free text. |
| League | SOC-08 | Partial | Partial | Not built | Rows, zones, time left, teen Join. Not built: SOC-09 week result, SOC-24 rules. |
| Duos | SOC-11, SOC-12 | Partial | Partial | Not built | Mobile: list, pick friends, accept, preset nudge. Not built: SOC-25 Duo detail. |
| Squads | SOC-13, SOC-14 | Partial | Partial | Not built | Create (exam toggle), join by code, home with members, quest (when configured) and Cheer the squad. No crest or name picker yet. |
| Duels | SOC-15 to SOC-19 | Partial | Partial | Not built | Mobile: friend or random, the match queue with Keep looking, Practise solo or Challenge a friend; live play polls `GET /v1/duels/{id}` every second (no SSE on mobile yet). Not built: SOC-17 countdown, rematch, async challenges, SOC-20 push entry. |
| Shared decks | SOC-21 | Partial | Partial | Not built | List by scope, Add a copy, Helpful. No deck preview or sharing one of yours yet. |

## Notifications and widgets

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Local habit reminders | NTF-01 | Built | Built | Partial | Web asks for permission; Web Push delivery is not built. |
| Home-screen widgets: plant, pet and today, plan | NTF-08, NTF-09, NTF-10 | Built | Built | n/a | Mobile only. WidgetKit extension and Android AppWidgets from `apps/mobile/plugins/widgets`. Not yet run on a device: there was no Xcode or Android SDK to build with. The large widget shows "Set your exam date" until the app stores an exam date. |
| Widget prompt | NTF-11 | Not built | Not built | n/a | |
