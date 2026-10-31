# Platform parity

The screen and feature matrix for iOS, Android and web (TRD §2.1). A pull request that adds or changes a feature on one platform updates its row here. Screen ids come from `docs/APP_FLOW.md` and `docs/UX_FLOW.md`.

The table records what the code in `apps/mobile` and `apps/web` does today, not what is planned. iOS and Android share one Expo codebase, so their columns only differ where a feature is platform-specific.

**Status:** **Built** means the screen or feature works end to end against the API (or the fake API in dev and tests). **Partial** means it exists with gaps, listed in the notes. **Not built** means there is no screen yet. **n/a** means the feature is not meant for that platform.

Last updated 30 Oct 2026. The mobile columns come from the mobile build branch (`worktree-agent-a8c9fe7059bbdadfa`), the web column from the apps as merged into `claude/project-thread-vnixsy`. Mobile screens have been checked in the Expo web preview at 390 px and through Jest. They have not been run on a device: the Maestro flows in `apps/mobile/maestro` are written but have not been run.

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
| Today's plan card | HOME-02 | Not built | Not built | Not built | app-core has `buildLocalPlan`; mobile uses it only for the widgets so far. |
| Little learner Home | HOME-06, SET-13 | Partial | Partial | Not built | Mobile: three tabs (R14), the path (lessons playable; song and play shown as coming), gentle pet and plant, the 2-second "For grown-ups" hold and the SET-13 gate with the parent's own sign-in and PIN, behind `feature.little_learner`. Storybook nodes (LRN-11) wait for bundles that carry `storybook@1`. The speaker button plays on web only until `expo-audio` is linked. |
| Subject map | LRN-01 | Partial | Partial | Built | Mobile has the All, In progress and Not started filters; no Weak filter and no units yet. |
| Chapter | LRN-02 | Partial | Partial | Built | Mobile has the topic rail, Practise, Chapter test (LRN-06 sheet), reviews by topic and Report. Not yet: test-out (LES-12), chapter download, reset progress, long-press. Web also has a topic page. |
| Lesson player (Deep Dive) | LES-01 to LES-08 | Built | Built | Built | Mobile includes the not-found state (LES-11). |
| Lesson end | LES-09 | Built | Built | Built | |

## Memory and Labs

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Memory hub | MEM-01 | Built | Built | Not built | |
| Comeback after a break | MEM-02 | Built | Built | Not built | |
| Review session (FSRS) | MEM-03, MEM-04 | Built | Built | Built | Mobile can scope a session to one topic (from LRN-02). No undo yet. |
| Labs hub | LAB-01 | Built | Built | Built | Mobile shows per-lab progress and "Works offline" once a lab is downloaded. |
| Lab detail and info | LAB-03, LAB-18 | Partial | Partial | Built | No mobile-data confirmation before a download yet: the network service does not report cellular. |
| Lab player (sims) | LAB-04, LAB-06 | Partial | Partial | Built | Mobile runs the real sim bundles in `react-native-webview` through `sim-bridge` (`createWebViewHost`), downloaded to the device and cached for offline use (Pro). Tasks, check, hint, skip, readings table, reset, battery saver, slow-start and one restart after a crash. No full-screen mode yet. Not yet run on a device; the web preview runs the same screens through an iframe. |
| Lab fallback and complete | LAB-05, LAB-07 | Built | Built | Built | |

## Practice

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Practice hub | PRC-01 | Built | Built | Built | |
| Weak spots | PRC-02 | Built | Built | Not built | |
| Topic drill, session and summary | PRC-03 to PRC-06 | Built | Built | Built | Mobile includes the free-limit sheet (PRC-17). |
| PYQ browser (hub, by chapter, by paper) | PRC-07 to PRC-10 | Built | Built | Not built | Mobile shows each PYQ's source (PRC-18). |
| Daily challenge | PRC-11, PRC-12 | Built | Built | Not built | |
| Share card | PRC-13 | Not built | Not built | Not built | Needs a view-capture and share dependency decision. |
| Progress and analytics | PRC-14 | Partial | Partial | Not built | Mobile shows practice, mock trend and syllabus covered. Readiness, speed, confidence and mistake cards wait for an analytics API. |
| Practice history | PRC-16 | Built | Built | Not built | |
| Mock list | MOCK-01 | Built | Built | Built | Web shows the exam's mock on the runner's start screen. |
| Mock runner, submit and report | MOCK-02 to MOCK-19 | Built | Built | Built | |
| Solutions | MOCK-22 | Built | Built | Not built | |
| Mock history and custom mock | MOCK-25, MOCK-26 | Built | Built | Not built | |

## AI tutor

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Tutor chat (streamed) | AI-02 to AI-07 | Built | Built | Not built | Mobile streams with `expo/fetch`. |
| Safety helplines | AI-08 | Built | Built | Not built | Helplines come from the server's safety event, never from the app. |
| Tutor history | AI-09 | Built | Built | Not built | |
| Photo doubt | AI-12, AI-16 | Partial | Partial | Not built | The screens exist; there is no photo-doubt API route yet. |

## Me and money

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Me | ME-01 | Built | Built | Built | |
| Settings: language, appearance | SET-01, SET-06, SET-07 | Built | Built | Built | Mobile adds haptics (SET-08); web adds daily goal (SET-10) and the analytics choice (SET-11). |
| Report a problem with content | SET-24 | Built | Built | Not built | Reachable from lessons, questions, chapters and labs. |
| Notification settings | SET-03 | Not built | Not built | Built | Mobile keeps the reminder set in onboarding. |
| Paywall and purchase | PAY-01, PAY-08, PAY-09 | Built | Built | Built | Mobile uses RevenueCat (fake provider in dev); web uses Razorpay (fake step in dev). Prices come from the server. |
| Your plan | PAY | Not built | Not built | Built | |
| Parent mode, PIN and time limits | SET-13 to SET-16, SET-19 | Partial | Partial | Not built | Mobile: the gate (parent's own session on the child's phone, PIN), dashboard with Needs you, weekly report, time limits and the little learner switches, through `/v1/guardian/*`. The child's phone enforces the limit offline (app-core `timeLimitState`) and opens SET-19, where the child asks through `/v1/me/time-requests`. Not built: SET-17 consents, SET-18 add a child, the friends row, "Send a cheer" (no API yet). |

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
