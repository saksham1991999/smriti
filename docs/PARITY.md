# Platform parity

The screen and feature matrix for iOS, Android and web (TRD §2.1). A pull request that adds or changes a feature on one platform updates its row here. Screen ids come from `docs/APP_FLOW.md` and `docs/UX_FLOW.md`.

The table records what the code in `apps/mobile` and `apps/web` does today, not what is planned. iOS and Android share one Expo codebase, so their columns only differ where a feature is platform-specific.

**Status:** **Built** means the screen or feature works end to end against the API (or the fake API in dev and tests). **Partial** means it exists with gaps, listed in the notes. **Not built** means there is no screen yet. **n/a** means the feature is not meant for that platform.

Last updated 30 Oct 2026, from the apps as merged into `claude/project-thread-vnixsy`.

## Onboarding and accounts

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Welcome and language | ONB-01, ONB-02 | Built | Built | Built | |
| Goal, class, birth year, level | ONB-03 to ONB-06 | Built | Built | Built | |
| Buddy (pet) and seed | ONB-07 to ONB-09 | Built | Built | Built | |
| First lesson and first win | ONB-13, ONB-14 | Built | Built | Built | |
| Daily goal and reminder | ONB-12, ONB-15 | Built | Built | Built | Web asks for browser notification permission. |
| Google sign-in | AUTH-01 | Built | Built | Built | |
| Apple sign-in | AUTH-01 | Built | n/a | Not built | |
| Sign out (wipes the device profile) | AUTH-12 | Built | Built | Built | Mobile also clears the home-screen widgets. |
| Account deletion | AUTH-13 | Not built | Not built | Built | |
| Profile switch | SET | Not built | Not built | Not built | |

## Learn

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Home (streak, hero, up next) | HOME-01 | Built | Built | Built | |
| Today's plan card | HOME-02 | Not built | Not built | Not built | app-core has `buildLocalPlan`; mobile uses it only for the widgets so far. |
| Little learner Home | HOME-06, SET-13 | Partial | Partial | Not built | Mobile: three tabs (R14), the path (lessons playable; song and play shown as coming), gentle pet and plant, the 2-second "For grown-ups" hold and the SET-13 gate with the parent's own sign-in and PIN, behind `feature.little_learner`. Storybook nodes (LRN-11) wait for bundles that carry `storybook@1`. The speaker button plays on web only until `expo-audio` is linked. |
| Subject and chapter | LRN-02, LRN-03 | Built | Built | Built | Web also has a topic page. |
| Lesson player (Deep Dive) | LES-01 | Built | Built | Built | |
| Lesson end | LES-09 | Built | Built | Built | |

## Memory and Labs

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Memory hub | MEM-01 | Partial | Partial | Not built | Mobile shows the hub with no due count. |
| Review session (FSRS) | MEM-03 | Not built | Not built | Built | |
| Labs hub | LAB-01 | Partial | Partial | Built | Mobile shows "coming". |
| Lab player (sims) | LAB-02 to LAB-05 | Partial | Partial | Built | Web runs sims in a sandboxed iframe through `sim-bridge`. Mobile has only the LAB-05 failure screen. |

## Practice

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Practice hub | PRC-01 | Built | Built | Built | |
| Topic drill | PRC-03 | Not built | Not built | Built | |
| Daily challenge | PRC-11, PRC-12 | Built | Built | Not built | |
| Mock list | MOCK-01 | Built | Built | Built | Web shows the exam's mock on the runner's start screen. |
| Mock runner | MOCK-02 onwards | Not built | Not built | Built | |
| AI tutor chat | AI-02 | Built | Built | Not built | |

## Me and money

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Me | ME-01 | Built | Built | Built | |
| Settings: language, appearance | SET-01, SET-06, SET-07 | Built | Built | Built | Mobile adds haptics (SET-08); web adds daily goal (SET-10) and the analytics choice (SET-11). |
| Notification settings | SET-03 | Not built | Not built | Built | Mobile keeps the reminder set in onboarding. |
| Paywall and purchase | PAY-01, PAY-08 | Built | Built | Built | Mobile uses RevenueCat (fake provider in dev); web uses Razorpay (fake step in dev). |
| Your plan | PAY | Not built | Not built | Built | |
| Parent mode, PIN and time limits | SET-13 to SET-16, SET-19 | Partial | Partial | Not built | Mobile: the gate (parent's own session on the child's phone, PIN), dashboard with Needs you, weekly report, time limits and the little learner switches, through `/v1/guardian/*`. The child's phone enforces the limit offline (app-core `timeLimitState`) and opens SET-19, where the child asks through `/v1/me/time-requests`. Not built: SET-17 consents, SET-18 add a child, the friends row, "Send a cheer" (no API yet). |

## Notifications and widgets

| Feature | Screens | iOS | Android | Web | Notes |
|---|---|---|---|---|---|
| Local habit reminders | NTF-01 | Built | Built | Partial | Web asks for permission; Web Push delivery is not built. |
| Home-screen widgets: plant, pet and today, plan | NTF-08, NTF-09, NTF-10 | Built | Built | n/a | Mobile only. WidgetKit extension and Android AppWidgets from `apps/mobile/plugins/widgets`. Not yet run on a device: there was no Xcode or Android SDK to build with. The large widget shows "Set your exam date" until the app stores an exam date. |
| Widget prompt | NTF-11 | Not built | Not built | n/a | |
