# Auth screens: sign-in, accounts, consent and parent sign-in

Status: Draft v0.3 (revision 1), 29 Oct 2026. Screen specs for the AUTH prefix. The logic behind them (branches, server steps, data, analytics) is in [`docs/flows/auth.md`](../flows/auth.md). Tokens and components come from `DESIGN.md` §2–§5 and §7 and `packages/tokens/tokens.json`. Placeholders such as `{pet_name}` are filled by the app at runtime.

---

## 0. Conventions used in every block

### 0.1 Shared chrome

- **Sheets:** Sheet component (DESIGN §5), radius 28 at the top, grabber, `scrim` behind. Heights: 40%, 60% or full. AUTH-01 is 60% and grows with dynamic type up to full. AUTH-02 is full height.
- **Full screens:** `bg` background, top bar 56 with back (`CaretLeft`, 24, label "Back") on the left and no search. Primary button pinned 16 above the safe area, full width minus 20 per side.
- **Pet line:** DESIGN Pet line (40 px avatar plus a bubble on `surface`, at most two lines), spoken by the screen reader. Guests use the pet picked in onboarding; if there isn't one yet, the cat and dog appear together.
- **Guardian-facing screens** (AUTH-19 guardian view, AUTH-20, AUTH-22, AUTH-24, AUTH-26, AUTH-28) speak to an adult. They use no pet line, a calmer layout, and `body` text at 16/24 minimum. They never show the child's progress or notes.
- **Legal footer:** `caption` in `inkMuted`, centred, with "Terms" and "Privacy policy" as inline links in `primary` (48 tall hit areas). Opens the web pages in the in-app browser.

### 0.2 The Google and Apple buttons

These are brand-owned controls. They follow Google's and Apple's rules, not our Button variants, so they are the only place in the app where colours come from a third party. The values are in `packages/tokens/tokens.json` under `thirdParty.google` and `thirdParty.apple`, so components still read tokens, never raw hex. This is the documented brand exception in DESIGN.md §5 (R29).

**Continue with Google** ([Google branding guidelines](https://developers.google.com/identity/branding-guidelines)):
- **Mobile:** the library's `GoogleLogoButton`, pill shape, height 56 (scaled, aspect ratio kept so the G isn't stretched), full width minus 20 per side.
- **Light mode:** Google "light" theme. Fill `thirdParty.google.light.fill` (#FFFFFF), 1 px inside stroke `thirdParty.google.light.stroke` (#747775), text `thirdParty.google.light.text` (#1F1F1F). **Night Colour:** Google "dark" theme, `thirdParty.google.dark.*` (#131314, #8E918F, #E3E3E3). On a tinted ground the "neutral" theme, `thirdParty.google.neutral.*` (#F2F2F2, no stroke, #1F1F1F).
- **Logo:** the standard-colour G from Google's asset kit, on its own white or dark ground. Never recoloured, never monochrome, never resized relative to the button.
- **Padding:** `thirdParty.google.padding.*`: Android and web 12 left of the G, 10 between G and text, 12 right of the text; iOS 16, 12, 16.
- **Label:** only Google's approved labels (R29): "Continue with Google" (our default) or "Sign in with Google", never just "Google". English in Google Sans Medium 14/20 (`thirdParty.google.font`, research §11.8; the library's own button font where it draws the button). Hindi "Google के साथ जारी रखें" (R40) in Noto Sans Devanagari 600, because Google Sans has no Devanagari. Google allows and encourages localised labels.
- **Web:** Google renders the button itself (`renderButton`, `continue_with`, `pill`, `outline` in light mode, `filled_black` in Night Colour, `locale` = app language, width = container up to 400). On iOS browsers we draw the same look with the official asset and run the redirect flow (flow §5.3).
- **Pressed:** the library's pressed state (a light overlay). No scale animation, so it matches Google's own buttons. Loading: the label is replaced by a spinner in the text colour, the width stays.

**Continue with Apple** (iOS only):
- `AppleAuthenticationButton`, type `CONTINUE`, style `BLACK` in light mode and `WHITE` in Night Colour (`WHITE_OUTLINE` on white grounds; mock values in `thirdParty.apple.*`), corner radius 28, height 56, the same width as the Google button. Apple renders and localises the label ("Continue with Apple", Hindi from the system when the app runs in Hindi).
- Sits 12 below the Google button. Both are the same size, which meets Google's "at least as prominent" rule and Apple's guidance together.

**Trust line** (R29, R40): under the provider buttons on every sign-in surface (AUTH-01, AUTH-02, AUTH-19 guardian view, AUTH-22, AUTH-23 consent-first, AUTH-24, AUTH-29, AUTH-32): "We never call you or share your email." / "हम आपको कभी कॉल नहीं करेंगे और आपका ईमेल किसी से शेयर नहीं करेंगे।" in `caption` `inkMuted` with `ShieldCheck` 16. It fits on one line at 360 px in English; Hindi may wrap to two lines, which is allowed. No extra sentence is added.

### 0.3 Hindi copy rules

- No gendered verb endings for the student, the guardian or the pet. Use noun phrases ("सेव हो गया!"), ने constructions, plural honorifics for a third person ("{first_name} इस्तेमाल करना चाहते हैं") and imperatives ("आगे बढ़ें").
- Product words stay as students say them: साइन इन, अकाउंट, प्रो, स्ट्रीक, पेट, सेव. Brand names stay in Latin script: Google, Apple, Google Play, App Store, DigiLocker, UPI.
- Western digits in both languages. Containers grow for Hindi strings 20–30% longer (DESIGN §1).

### 0.4 Reasons

AUTH-01 and AUTH-02 take a `reason` (flow §4). The reason picks the title, the one-line reason under it, and the illustration pose. Copy for each reason is in the screen's table.

---

## Sign-in

### AUTH-01 · Login sheet, soft
**Purpose:** Invite a guest to save their progress at a moment when it matters, without blocking anything. **Main action:** Continue with Google.
**Entry → exits:** LES-08 (3rd lesson, `lesson_3`; 1st lesson on Safari and iOS browsers, `web_storage_risk`), HOME-01 streak card "Save your plant" (`streak_day_2`), ME-01 "Not saved yet" row and AUTH-33 chip, SET-02 guest row, inline "Sign in to..." links (`save_progress`), PRC-12 and MOCK-24 "Sign in to appear on the leaderboard" (`leaderboard`) → AUTH-03 (age unknown), AUTH-04, AUTH-05 (iOS), AUTH-18 (teen, when `minor.defer_sync_until_consent` is on), AUTH-24 (under 13), AUTH-30, back to the origin on [Later], swipe down or back.

**Layout (top to bottom):**
1. Grabber.
2. Illustration, 160 tall, centred: the pet holding the potted plant (`lesson_3`, `save_progress`, `web_storage_risk`), the pet watering the plant (`streak_day_2`), or the pet on a small podium (`leaderboard`).
3. Title in `title` (22/28, 800), centred, up to 2 lines. It names the pet and the plant (research A12).
4. Reason line in `body` `inkMuted`, centred, up to 3 lines.
5. A row of two Stat tiles, 12 apart, on `surfaceSunken`: streak days and lessons done (tabular figures). Shown only when lessons ≥ 1.
6. iOS only: one `caption` line in `inkMuted` with `ArrowSquareOut` 16: "Google will open for a moment." It prepares the student for iOS's own "wants to use google.com to sign in" alert (flow §5.2).
7. 24 gap. Continue with Google (§0.2).
8. iOS only: 12 gap, Continue with Apple (§0.2).
9. 12 gap. [Later], Button secondary, **full width and 56 tall like the provider buttons** (research A10). Never a small link.
10. Trust line in `caption` `inkMuted` with `ShieldCheck` 16 (copy below), on every variant.
11. Legal footer.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title, `lesson_3` | Keep {pet_name} and your plant safe on any phone. | {pet_name} और अपना पौधा हर फ़ोन पर सुरक्षित रखें। |
| Reason, `lesson_3` | You've finished 3 lessons. Sign in once and they're saved to your Google account. | आपने 3 लेसन पूरे कर लिए। एक बार साइन इन करें, ये आपके Google अकाउंट में सेव हो जाएँगे। |
| Title, `streak_day_2` | Don't lose your 2-day plant. Save it in one tap. | अपना 2 दिन का पौधा मत खोइए। एक टैप में सेव करें। |
| Reason, `streak_day_2` | Tomorrow is day 3. Sign in so {pet_name} and your plant are never lost. | कल तीसरा दिन है। साइन इन करें, ताकि {pet_name} और आपका पौधा कभी न खोएँ। |
| Title, `web_storage_risk` | Keep your first lesson safe | अपना पहला लेसन सुरक्षित रखें |
| Reason, `web_storage_risk` | This browser can clear what a site saves if you don't visit for a while. Sign in so your progress lives in your account. | अगर आप कुछ दिन न आएँ, तो यह ब्राउज़र साइट का सेव किया हुआ डेटा मिटा सकता है। साइन इन करें, ताकि प्रोग्रेस आपके अकाउंट में रहे। |
| Title, `save_progress` | Not saved yet | अभी सेव नहीं है |
| Reason, `save_progress` | Sign in so you don't lose it if you change phones. | फ़ोन बदलें तो भी न खोए, इसके लिए साइन इन करें। |
| Title, `leaderboard` | Get on the leaderboard | लीडरबोर्ड पर आइए |
| Reason, `leaderboard` | Sign in so your score counts and you can see where you stand. | साइन इन करें, ताकि आपका स्कोर गिना जाए और आप देख सकें कि आप कहाँ हैं। |
| Reason line 2, `leaderboard`, teen | Others will see your pet and a nickname once a parent says yes. | माता-पिता की हाँ के बाद दूसरों को आपका पेट और एक निकनेम दिखेगा। |
| Stat tiles | {n}-day streak · {n} lessons | {n} दिन की स्ट्रीक · {n} लेसन |
| iOS prep line | Google will open for a moment. | थोड़ी देर के लिए Google खुलेगा। |
| Google button | Continue with Google | Google के साथ जारी रखें |
| Later | Later | बाद में |
| Trust line | We never call you or share your email. | हम आपको कभी कॉल नहीं करेंगे और आपका ईमेल किसी से शेयर नहीं करेंगे। |
| Cancelled line | No problem. You can save anytime from Me. | कोई बात नहीं। आप कभी भी 'मैं' टैब से सेव कर सकते हैं। |
| Offline line | No internet. Your progress stays on this phone, and we'll save it when you're back online. | इंटरनेट नहीं है। प्रोग्रेस इसी फ़ोन पर है, ऑनलाइन होते ही सेव कर देंगे। |
| Title, teen with deferred sync | Ask a parent to save your progress | अपनी प्रोग्रेस सेव करने के लिए माता-पिता से पूछें |
| Reason, teen with deferred sync | Your progress is only on this phone. If the app is removed, it's gone. | आपकी प्रोग्रेस सिर्फ़ इसी फ़ोन पर है। ऐप हटाया तो यह भी चली जाएगी। |
| Ask a parent button | Ask a parent | माता-पिता से पूछें |
| Legal footer | By continuing, you agree to the Terms and the Privacy policy. | आगे बढ़कर आप शर्तों और निजता नीति से सहमत होते हैं। |
| Pet line (bubble on the illustration) | Let's keep all of this safe! | आइए, यह सब सुरक्षित रखें! |
| Web One Tap banner | Keep {pet_name} and your plant safe on any phone. We never call you or share your email. | {pet_name} और अपना पौधा हर फ़ोन पर सुरक्षित रखें। हम आपको कभी कॉल नहीं करेंगे और आपका ईमेल किसी से शेयर नहीं करेंगे। |

The Google label is only ever "Continue with Google" or "Sign in with Google" (R29). On web Google renders and localises it.

**Illustration slots:** `pet-cat` or `pet-dog` (the student's pet), 1:1, the pet hugging the terracotta plant pot (watering it for `streak_day_2`, standing on a small podium with no numbers for `leaderboard`), happy mood. Alt text intent: "{pet_name} holding your plant". Under-10 mode never reaches this sheet.

**States:**
- **Default:** as above.
- **Budget (flow §4):** the sheet opens only if the R29 budget allows it. A skipped trigger shows nothing at all; there is no smaller fallback banner.
- **Offline:** both provider buttons disabled (40% opacity, `inkDisabled` label), the offline line above them with `CloudSlash` 16. [Later] stays enabled. Buttons re-enable on reconnect.
- **Loading:** after a tap, the tapped button shows its spinner, the other button and [Later] are disabled, the sheet can't be swiped away. Then AUTH-04.
- **Cancelled by the student in Google's UI:** back to default with the cancelled line under the title (once). A cancel doesn't count as a "Later".
- **Error:** AUTH-30 replaces the buttons area in place (no new sheet).
- **Age unknown:** the first tap on a provider opens AUTH-03 inside the sheet first.
- **Teen 13–17:** same sheet. Consent comes later (flow §6.10). For `leaderboard` the teen line is added under the reason.
- **Tap triggers** (`save_progress`, `leaderboard`): open even during the R29 pause, because the student tapped a link (flow §4).
- **Teen with `minor.defer_sync_until_consent` on:** the "Ask a parent" title and reason. The provider buttons are replaced by [Ask a parent] (Button primary), which opens AUTH-18. [Later] and the trust line stay. The teen's own Google sign-in comes after the guardian agrees (AUTH-23).
- **Under 13:** this sheet is never shown. The trigger opens AUTH-24 or the learn doc's "Ask a grown-up" row.
- **Dark mode:** `surface` sheet, Google dark theme, Apple white style.

**Interaction and motion:** slides up with `slow` (300 ms) `standard` easing, 1.2 s after LES-08's counts finish. The pet does one `hop` on appear (Rive). Swipe down, the scrim or back = [Later] (each counts once toward the R29 limit). Light haptic on a button tap. No sound. Never opens while a lesson card, review, mock section or tutor chat is on screen.

**Accessibility:** focus order: title, reason, stat tiles (read as one: "12-day streak, 3 lessons"), iOS prep line, Google, Apple, Later, trust line, footer links. The sheet is announced as a dialog with its title. The illustration is decorative when the pet line is present (the line carries the meaning). All three buttons keep 56 height and wrap their label at 200% type rather than shrink.

**Analytics:** `auth_prompt_shown` (`reason`, `variant = soft`, `surface`), `auth_prompt_dismissed` (`via`, `later_count`), `auth_prompt_skipped`, `auth_provider_tapped`, `auth_provider_result`.

**Web (≥ 600 px):** a centred dialog 480 wide, radius 28, same content, the Google-rendered button (personalised for a returning Google session). Esc closes as [Later]. **One Tap first** (flow §5.3): at a soft moment the web app first calls One Tap with `context: 'use'`. While One Tap shows, a one-line banner (`surfaceRaised`, `ShieldCheck` 16, the "Web One Tap banner" copy) sits at the top of the page content instead of this dialog. If One Tap isn't displayed, this dialog opens. Closing One Tap counts as [Later] and nothing else opens. On phone-width web the sheet layout above applies.

**Mock priority:** P0.

---

### AUTH-02 · Login sheet, hard
**Purpose:** Explain that the next step needs an account and get the student signed in, then resume what they were doing. **Main action:** Continue with Google.
**Entry → exits:** SOC-02 and other SOC entry points and deep links (`social`), PAY-01 [Start for ₹1] or [Get Pro] (`start_trial`), ONB-01 "I already have an account" (`restore`), MEM-11 share and community submit (`share_deck`, `community`), SET-02 after AUTH-12 (`switch_account`), AUTH-31 (`session_expired`) → AUTH-03, AUTH-04, AUTH-05, AUTH-24 (under 13, or the "Restoring your child's account?" row), AUTH-10 (Android and web link), AUTH-30, origin on [Back].

**Layout (top to bottom):**
1. Top row: close button (`X`, 24, 48 target, label "Back") on the right. Grabber hidden (full height).
2. Illustration, 200 tall, centred, pose by reason.
3. Title in `title`, centred.
4. Reason line in `body` `inkMuted`, centred, up to 3 lines.
5. For `start_trial`, only when the server says the person is eligible (R38, flow §8): a `primaryTint` chip under the reason, "₹1 for your first month, then ₹99/month". Not eligible: the chip reads "₹99/month". For `restore`: nothing else.
6. iOS only: the prep line "Google will open for a moment." as AUTH-01.
7. Flexible space, then the buttons block pinned to the bottom third: Continue with Google, then Continue with Apple on iOS, then [Back] as a full-width Button secondary.
8. Reason `restore` only: a list row under the buttons, `UsersThree` 24, "Restoring your child's account? Sign in with your own Google account", `CaretRight`. Opens AUTH-24 with `entry = restore`.
9. Android and web only, reasons `restore` and `switch_account`: ghost link "Used Apple on your iPhone?" (AUTH-10).
10. Trust line and legal footer as AUTH-01.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title, `social` | Sign in to add friends | दोस्त जोड़ने के लिए साइन इन करें |
| Reason, `social` | Friends and leagues need an account so others can find you. | दोस्त और लीग के लिए अकाउंट चाहिए, ताकि दूसरे आपको ढूँढ सकें। |
| Title, `start_trial` | Sign in to start Pro | प्रो शुरू करने के लिए साइन इन करें |
| Reason, `start_trial` | Your Pro plan is linked to your Google account, so it works on every {brand} app. | आपका Pro प्लान आपके Google अकाउंट से जुड़ेगा, हर {brand} ऐप पर चलेगा। |
| Reason, `start_trial`, iOS with Apple | Your Pro plan is linked to your account, so it works on every {brand} app. | आपका Pro प्लान आपके अकाउंट से जुड़ेगा, हर {brand} ऐप पर चलेगा। |
| Trial chip, eligible | ₹1 for your first month, then ₹99/month | पहला महीना ₹1, फिर ₹99/महीना |
| Price chip, not eligible | ₹99/month | ₹99/महीना |
| Title, `restore` | Welcome back! | फिर से स्वागत है! |
| Reason, `restore` | Sign in to bring back your streak, pet and notes. | अपनी स्ट्रीक, पेट और नोट्स वापस लाने के लिए साइन इन करें। |
| Title, `share_deck` / `community` | Sign in to share | शेयर करने के लिए साइन इन करें |
| Reason, `share_deck` / `community` | Sharing needs an account, so you can manage what you've shared. | शेयर करने के लिए अकाउंट चाहिए, ताकि आप अपनी शेयर की हुई चीज़ें संभाल सकें। |
| Title, `switch_account` | Sign in with another account | दूसरे अकाउंट से साइन इन करें |
| Reason, `switch_account` | Pick the Google account you want to use on this phone. | वह Google अकाउंट चुनें जिसे आप इस फ़ोन पर इस्तेमाल करना चाहते हैं। |
| Title, `session_expired` | Please sign in again | कृपया फिर से साइन इन करें |
| Reason, `session_expired` | Use the same account to save the progress on this phone. | इस फ़ोन की प्रोग्रेस सेव करने के लिए उसी अकाउंट का इस्तेमाल करें। |
| Back | Back | वापस |
| Child restore row | Restoring your child's account? Sign in with your own Google account | बच्चे का अकाउंट वापस ला रहे हैं? अपने Google अकाउंट से साइन इन करें |
| Apple help link | Used Apple on your iPhone? | iPhone पर Apple से साइन इन किया था? |

The trust line, the iOS prep line, the Google label and the legal footer are AUTH-01's.

**Illustration slots:** `pet-cat` / `pet-dog`, 1:1. `social`: the pet waving to a second, generic pet in the distance (excited). `start_trial`: the pet holding a gold ₹1 tag (the paywall's pose, reused from the image index; not eligible: the same pet holding a gold star). `restore`: the pet running towards the viewer with the plant pot (happy). `share_deck`: the pet holding a small stack of cards. `switch_account`, `session_expired`: the pet curious, head tilted. Alt text intent: the pose in words. No text in the image (the ₹1 is a shape on the tag, the amount is overlaid by the app).

**States:**
- **Default, offline, loading, cancelled, error, age unknown:** as AUTH-01. The cancelled line isn't shown on hard sheets.
- **Restore on a brand-new install:** Android first tries Google's bottom sheet with authorised accounts (flow §5.1). If an account is found, Google's own "Continue as {name}" sheet appears on top of AUTH-02. On Android 14 and later the returning student usually arrived through AUTH-32 instead.
- **`start_trial` for a guest:** the chip follows the server's guest hint; after sign-in PAY-01 re-checks (flow §8).
- **Under 13:** never shown. Little-learner triggers go to AUTH-24.
- **Free vs Pro:** no difference.
- **Dark mode:** as AUTH-01.

**Interaction and motion:** slides up as a full sheet with `slow`. [Back], X, the back gesture and Android back return to the origin with the action not done; the origin keeps its lock icon. Hard sheets don't use the soft budget. After success the sheet closes with `base` and the pending action resumes in place (for example the friend request sends, with its own toast), with the AUTH-06 toast first.

**Accessibility:** focus starts on the title. X is the last element in focus order but first in the top bar for touch. The child-restore row is a button with its full sentence as the label.

**Analytics:** `auth_prompt_shown` (`variant = hard`), `auth_prompt_dismissed`, `auth_provider_tapped`, `auth_provider_result`, `auth_return_to_origin`.

**Web (≥ 600 px):** centred dialog 520 wide with the Google-rendered button (personalised when possible). No One Tap on hard sheets. The `restore` reason on web is AUTH-29 instead.

**Mock priority:** P0 (`social`, `start_trial`, `restore`).

---

### AUTH-03 · Age check
**Purpose:** Find out whether the person signing in is under 13, 13 to 17, or 18 and over, when onboarding didn't. **Main action:** Continue.
**Entry → exits:** AUTH-01, AUTH-02, SOC-02 social gate (tutor and social doc §B4) → AUTH-04 / AUTH-05 (13 and over), AUTH-24 (under 13), back to the sheet.

**Layout (top to bottom):**
1. Inside the sheet: back arrow top left (returns to the sheet's buttons).
2. Title in `heading`.
3. One line in `body` `inkMuted` explaining why.
4. Year wheel (the same control as ONB-04), no default selected, years from the current year back 80 years. The wheel's empty state shows "Select" in `inkMuted`.
5. Only when the selected year is the boundary year (the student could be 12 or 13, or 17 or 18): a month row of 12 Chips, wrapping.
6. [Prefer not to say], Button ghost.
7. [Continue], Button primary, disabled until a year (and month when asked) is set.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | What year were you born? | आपका जन्म किस साल हुआ? |
| Why | We ask everyone. It sets the right safety settings. | हम सबसे पूछते हैं। इससे सही सुरक्षा सेटिंग्स लगती हैं। |
| Month prompt | Which month? | कौन-सा महीना? |
| Select | Select | चुनें |
| Prefer not to say | Prefer not to say | नहीं बताना चाहते |
| Continue | Continue | आगे बढ़ें |

**Illustration slots:** none (the sheet's illustration stays above, scaled to 96).

**States:**
- **Default:** nothing selected.
- **Prefer not to say:** treated as 13–17 (guardian consent rules apply later). The profile stores `age_source = 'declined'`.
- **Under 13 result:** the sheet changes to AUTH-24's "Ask a grown-up" intro without showing the age back to the child.
- **Offline:** works (the answer is stored locally and synced).

**Interaction and motion:** the content cross-fades in with `base`. The wheel snaps with a light haptic per year. No hint anywhere that a different answer unlocks more.

**Accessibility:** the wheel is an adjustable control ("Birth year, not set, swipe up or down to adjust"). Months are a radio group. Continue's disabled state is announced.

**Analytics:** `auth_age_check_shown`, `auth_age_check_result` (`band` only, never the year).

**Web (≥ 600 px):** a select for year and one for month, side by side.

**Mock priority:** P1.

---

### AUTH-04 · Google handoff and loading
**Purpose:** Show that Google is opening and then that we are signing the student in, so a slow phone never looks frozen. **Main action:** none (a waiting state).
**Entry → exits:** AUTH-01, AUTH-02, AUTH-15, AUTH-19, AUTH-22, AUTH-24, AUTH-29 → Google's own UI (Credential Manager sheet, Google account chooser, `ASWebAuthenticationSession`, GIS popup or redirect) → AUTH-06, AUTH-07, AUTH-08, AUTH-09, AUTH-30, back to the origin sheet on cancel.

**Layout (top to bottom):**
1. iOS only, when AUTH-04 opens from a screen without the prep line (AUTH-15, AUTH-19, AUTH-24): the status line first reads "Google will open for a moment." and stays until iOS's own alert appears.
2. Google's UI on top of our sheet. We don't draw anything over it.
3. After Google returns, our sheet's content is replaced in place by: the pet in its `thinking` pose, 120 tall.
4. One status line in `heading`, centred.
5. A thin indeterminate Progress bar (8 tall, `primary` on `track`), 200 wide.
6. A second line in `caption` `inkMuted` after 5 s.

**Copy:**
| Key | EN | HI |
|---|---|---|
| iOS prep | Google will open for a moment. | थोड़ी देर के लिए Google खुलेगा। |
| Signing in | Signing you in… | साइन इन हो रहा है… |
| Merging | Adding this phone's progress to your account… | इस फ़ोन की प्रोग्रेस आपके अकाउंट में जोड़ी जा रही है… |
| Browser fallback | Opening Google in your browser… | ब्राउज़र में Google खुल रहा है… |
| Slow (after 5 s) | Still working. This can take a few seconds on a slow network. | काम जारी है। धीमे नेटवर्क पर कुछ सेकंड लग सकते हैं। |
| Restoring (hand-off to ENT-09) | Getting your progress… | आपकी प्रोग्रेस लाई जा रही है… |

**Illustration slots:** `pet-cat` / `pet-dog`, 1:1, thinking pose (a paw on the chin). Decorative (the status line carries the meaning).

**States:**
- **Signing in:** default line.
- **Merging:** the merging line. After `auth.merge_wait_s` the app moves on (AUTH-08 pending variant).
- **Browser fallback:** the line shows before the browser tab opens.
- **Error, offline:** AUTH-30.
- **Reduced motion:** the pet is static, the bar becomes a static "Working" caption that updates every 2 s.

**Interaction and motion:** no gestures, the sheet can't be dismissed while the network call runs (`auth.signin_timeout_s` ends it with AUTH-30). Rive `think` trigger loops.

**Accessibility:** the status line is a live region (polite). Focus stays on it. Screen readers hear "Signing you in" once, then the result.

**Analytics:** `auth_fallback_used` when the browser path runs. The result is logged by `auth_provider_result`.

**Web (≥ 600 px):** the GIS popup or the full-page redirect. On redirect, AUTH-29 shows this state on return at `/auth/callback`.

**Mock priority:** P0 (Android Credential Manager over AUTH-01, then the signing-in state; iOS prep line, then the system alert).

---

### AUTH-05 · Sign in with Apple
**Purpose:** Let iPhone users sign in with Apple, as App Store guideline 4.8 requires. **Main action:** Continue with Apple (Apple's own sheet).
**Entry → exits:** AUTH-01, AUTH-02, AUTH-15, AUTH-19, AUTH-24 (iOS) → Apple's system sheet (Face ID or passcode, name and Hide My Email choices) → AUTH-04 signing-in state → AUTH-06 / AUTH-08 / AUTH-30.

**Layout (top to bottom):**
1. Apple's system sheet. We draw nothing over it.
2. On return, AUTH-04's signing-in state.
3. If Apple didn't give a name (not the first authorisation), nothing is asked (flow A15). The name can be set later in SET-02.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Button | Continue with Apple (rendered by Apple) | Apple के साथ जारी रखें (Apple दिखाता है) |
| Hidden email note (SET-02, not here) | Signed in with Apple | Apple से साइन इन |

**Illustration slots:** none.

**States:** cancelled (back to the sheet, no message), error (AUTH-30), offline (button disabled on the sheet). Minors and adults are the same.

**Interaction and motion:** Apple's.

**Accessibility:** Apple's sheet is accessible by the system. Our button is labelled by Apple.

**Analytics:** `auth_provider_tapped` and `auth_provider_result` with `provider = apple`.

**Web (≥ 600 px):** not shown (owner decision; flow Q4).

**Mock priority:** P1.

---

### AUTH-06 · Saved / Welcome back
**Purpose:** Confirm that sign-in worked and the student's things are safe, then get out of the way, with nothing to fill in (research A13). **Main action:** none for the toast; [Continue] on the restore card.
**Entry → exits:** AUTH-04 after a link (toast over the origin screen), ENT-09 after a restore (card) → the origin (AUTH-01/02 caller) with any pending action resumed, HOME-01 or AUTH-25 (restore), AUTH-18 (teen when `auth.guardian_consent_gate = signin`), AUTH-11 (iOS, from the "Add Google too" action).

**Layout (top to bottom):**
*Link: a toast* (DESIGN §5 Toast, bottom, above the tab bar):
1. `CloudCheck` 20 in `success` with the pet's head (32) beside it.
2. Line 1 in `bodyStrong`, up to 2 lines: the saved message.
3. Line 2 in `caption`: "You're signed in as {email}."
4. iOS, Apple sign-ins only, once per account: the toast's one action, [Add Google too] (opens AUTH-11).
5. The AUTH-33 chip on the origin screen (ME-01 header, LES-08) turns to "Saved to {email}" at the same moment.

*Restore: a card* (sheet at 60%, after ENT-09):
1. Illustration 180: the pet running to the viewer with the plant.
2. Title in `title`.
3. One line in `body` `inkMuted`.
4. [Continue], Button primary.

No name field, no school or city question, no pet sheet in either form.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Toast line 1, link | Saved! {pet_name}, your plant and {n} days of progress are now in your Google account. | सेव हो गया! {pet_name}, आपका पौधा और {n} दिन की प्रोग्रेस अब आपके Google अकाउंट में है। |
| Toast line 1, link, first day | Saved! {pet_name} and your plant are now in your Google account. | सेव हो गया! {pet_name} और आपका पौधा अब आपके Google अकाउंट में है। |
| Toast line 1, link, Apple | Saved! {pet_name}, your plant and {n} days of progress are now in your account. | सेव हो गया! {pet_name}, आपका पौधा और {n} दिन की प्रोग्रेस अब आपके अकाउंट में है। |
| Toast line 2 | You're signed in as {email}. | आप {email} से साइन इन हैं। |
| Toast line 2, Apple | You're signed in with Apple. | आप Apple से साइन इन हैं। |
| Add Google action (iOS, Apple) | Add Google too | Google भी जोड़ें |
| Title, restore | Welcome back, {first_name}! | फिर से स्वागत है, {first_name}! |
| Title, restore, no name | Welcome back! | फिर से स्वागत है! |
| Line, restore | Your {n}-day streak is safe. | आपका {n} दिन की स्ट्रीक सुरक्षित है। |
| Line, restore, no streak | Everything is back where you left it. | सब कुछ वहीं है जहाँ आपने छोड़ा था। |
| Continue | Continue | आगे बढ़ें |
| Pet line (restore card) | Yay! Now nothing gets lost. | वाह! अब कुछ भी नहीं खोएगा। |

`{n}` is the number of activity days (one qualifying activity each, flow §6.3). The first-day line is used when `{n}` is 1. A relay email is never shown.

**Illustration slots:** toast: the pet's head from `pet-cat` / `pet-dog` (the avatar asset, current mood). Restore card: `pet-cat` / `pet-dog`, 1:1, running pose with the plant pot. Alt text intent: "{pet_name} is happy to see you".

**States:**
- **Link:** toast.
- **Link with a pending action** (hard sheets): the toast shows, then the action resumes (its own feedback follows the toast, never on top of it).
- **Restore:** card. The first name comes from the profile; minors' first name is private and shown only to them.
- **Teen, consent gate `signin`:** after the toast, AUTH-18 opens.
- **Offline right after sign-in:** not possible (sign-in needed the network). If `/v1/auth/linked` fails, the toast is the same (it retries in the background).
- **Dark mode:** standard.

**Interaction and motion:** toast: slides up with `base`, success haptic, the "complete" sound if sound is on, 4 s (DESIGN §5), swipe to dismiss. The pet head does one `hop`. Restore card: the pet `celebrate` trigger, Lottie confetti (no text) for 1200 ms. Reduced motion: no confetti, static poses.

**Accessibility:** the toast is announced politely: "Saved! {pet_name}, your plant and {n} days of progress are now in your Google account. You're signed in as {email}." With a screen reader running, the toast stays until dismissed. The restore card's focus starts on the title.

**Analytics:** `auth_linked` (`provider`, `path`, `reason`).

**Web (≥ 600 px):** the toast at the bottom left (360 wide); the restore card as a centred dialog.

**Mock priority:** P0.

---

### AUTH-07 · Is this progress yours?
**Purpose:** On a shared phone, stop one person's guest progress from being added to someone else's account. **Main action:** Yes, add it.
**Entry → exits:** merge path, only when this phone had another account signed out on it (flow §6.4) → AUTH-04 merging state → AUTH-08 (added) or AUTH-06 (started fresh).

**Layout (top to bottom):**
1. Sheet at 60%, no grabber (a choice is needed).
2. Illustration 120: the pet looking at two plant pots, curious.
3. Title in `title`.
4. Body in `body`, with the numbers in `label` weight.
5. [Yes, add them], Button primary.
6. [No, it's someone else's], Button secondary.
7. Under the second button, `caption` `inkMuted`: what happens if they say no.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Is this progress yours? | क्या यह प्रोग्रेस आपकी है? |
| Body | This phone has {lessons} lessons and a {n}-day streak from before you signed in. Add them to your account? | साइन इन से पहले इस फ़ोन पर {lessons} लेसन और {n} दिन की स्ट्रीक है। क्या इन्हें अपने अकाउंट में जोड़ें? |
| Yes | Yes, add them | हाँ, जोड़ें |
| No | No, it's someone else's | नहीं, यह किसी और की है |
| No note | It will be removed from this phone. Your account stays as it is. | यह इस फ़ोन से हटा दी जाएगी। आपका अकाउंट जैसा है वैसा ही रहेगा। |

**Illustration slots:** `pet-cat` / `pet-dog`, 1:1, curious pose between two pots. Decorative.

**States:** default only. Offline can't happen here (sign-in just succeeded). If the merge intent has expired (more than 10 minutes on this screen), the choice still works: the app requests a new intent silently.

**Interaction and motion:** no swipe-to-dismiss. Android back = no choice made, keeps the sheet. Light haptic on tap.

**Accessibility:** both buttons have full-sentence labels. Focus starts on the title.

**Analytics:** `auth_shared_phone_check` (`choice`).

**Web (≥ 600 px):** centred dialog. On web the trigger is the same local flag in `localStorage`.

**Mock priority:** P1.

---

### AUTH-08 · Merge notice
**Purpose:** Tell the student plainly that their guest progress was added to the account they already had, with exact numbers. **Main action:** Great.
**Entry → exits:** AUTH-04 merging state → origin (resume the pending action), HOME-01 (restore), AUTH-18 (teen with gate `signin`).

**Layout (top to bottom):**
1. Sheet at 60%, grows to full with long Hindi or large type.
2. Illustration 160: the account's pet hugging the plant, proud.
3. Title in `title`.
4. One line in `body` `inkMuted`.
5. A card on `surfaceRaised`, radius 20, padding 16, with up to four rows (icon 24 + text in `label` + number in `label` tabular, right-aligned): `BookOpen` lessons added, `Lightning` XP added, `Plant` streak, `PawPrint` buddy. Rows with zero are hidden.
6. [Great], Button primary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Welcome back! | फिर से स्वागत है! |
| Line | We joined this phone's progress with your account. You kept the longer streak ({streak} days) and all your lessons. | इस फ़ोन की प्रोग्रेस आपके अकाउंट से जोड़ दी गई। लंबी स्ट्रीक ({streak} दिन) और सारे लेसन आपके पास हैं। |
| Line, no streak | We joined this phone's progress with your account. You kept all your lessons. | इस फ़ोन की प्रोग्रेस आपके अकाउंट से जोड़ दी गई। सारे लेसन आपके पास हैं। |
| Two pets line | You had two buddies. {pet_a} is your main buddy; {pet_b} is visiting your pet room. | आपके दो दोस्त थे। {pet_a} आपका मुख्य दोस्त है, {pet_b} आपके पेट रूम में है। |
| Lessons row | Lessons added · +{n} | जोड़े गए लेसन · +{n} |
| XP row | XP added · +{n} | जोड़े गए XP · +{n} |
| Streak row | Streak · {n} days (the longer one) | स्ट्रीक · {n} दिन (जो लंबी थी) |
| Buddy row, account pet kept | {account_pet} stays your buddy | {account_pet} ही आपका साथी रहेगा |
| Buddy row, guest pet moved | {guest_pet} is your buddy now | अब {guest_pet} आपका साथी है |
| Buddy row, both kept | {pet_b} is visiting your pet room | {pet_b} आपके पेट रूम में है |
| Pending title | Almost there | बस थोड़ा और |
| Pending line | We're still adding your progress. It will show up soon. | हम अभी आपकी प्रोग्रेस जोड़ रहे हैं। यह जल्द दिखेगी। |
| Great | Great | बढ़िया |

**Illustration slots:** `pet-cat` / `pet-dog` (the pet the account keeps), 1:1, proud pose holding the plant. Two pets: both pet presets side by side, the visiting one waving. Alt text intent: "{account_pet} with your plant" or "{pet_a} and {pet_b} together".

**States:**
- **Done:** numbers from `account_merges.stats`.
- **Two pets** (`pet_kept = both`, `merge.keep_guest_pet` on): the two-pets line is added under the main line, and the illustration shows both pets side by side. With the flag off, the buddy row says the account pet stays.
- **Pending** (merge longer than `auth.merge_wait_s`): pending title and line, no numbers. A toast later says "Your progress has been added" when the merge finishes.
- **Failed after retries:** same as pending for the student. Support follows up (flow §7).
- **Nothing added** (empty guest): this screen isn't shown; AUTH-06 restore is.
- **Dark mode:** standard.

**Interaction and motion:** numbers count up over `emphasis` (400 ms) with `gentle` spring, then the pet's `celebrate` trigger. Success haptic. Reduced motion: numbers appear at their final value.

**Accessibility:** the card is read row by row ("Lessons added, plus 3"). The streak row says "the longer one" in words, so it never depends on colour.

**Analytics:** `auth_linked` (`path = merge`), `auth_merge_completed`, `auth_merge_failed`.

**Web (≥ 600 px):** centred dialog 480 wide.

**Mock priority:** P0.

---

### AUTH-09 · Account in use, switch account
**Purpose:** Resolve the rare cases where the chosen account isn't the expected one. **Main action:** depends on the variant (see Copy).
**Entry → exits:** merge path `409 account_is_guardian`, AUTH-31 when a different account signs in, AUTH-11 when the Google account already has its own Smriti account → AUTH-02 (pick another account), AUTH-08 (learn too), SET-23 (support), origin.

**Layout (top to bottom):**
1. Sheet at 60%.
2. Icon in a 64 circle on `primaryTint`: `UserSwitch` 32 in `primary`.
3. Title in `title`.
4. Body in `body`.
5. Primary button, then secondary button.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Parent title | This Google account is a parent account | यह Google अकाउंट एक पैरेंट अकाउंट है |
| Parent body | It's linked to {count} learners as their parent or guardian. | यह {count} बच्चों के पैरेंट या अभिभावक के रूप में जुड़ा है। |
| Parent primary | Use a different Google account | दूसरा Google अकाउंट इस्तेमाल करें |
| Parent secondary | It's me, I want to learn too | यह मैं ही हूँ, मुझे भी पढ़ना है |
| Different account title | You signed in with a different account | आपने दूसरे अकाउंट से साइन इन किया है |
| Different account body | This phone has {n} unsaved lessons for the account that was signed in before. They'll be removed from this phone. | इस फ़ोन पर पहले वाले अकाउंट के {n} लेसन सेव नहीं हुए हैं। ये इस फ़ोन से हटा दिए जाएँगे। |
| Different account primary | Go back and use that account | वापस जाएँ और वही अकाउंट इस्तेमाल करें |
| Different account secondary | Continue with this account | इसी अकाउंट के साथ आगे बढ़ें |
| Already has account title | This Google account has its own {app_name} account | इस Google अकाउंट का अपना अलग {app_name} अकाउंट है |
| Already has account body | Two accounts can't be joined here. Sign in with it separately, or ask us to help. | दो अकाउंट यहाँ जोड़े नहीं जा सकते। उससे अलग से साइन इन करें, या हमसे मदद लें। |
| Already has account primary | OK | ठीक है |
| Already has account secondary | Contact support | सहायता से संपर्क करें |

**Illustration slots:** none (a Phosphor icon keeps this small, serious moment calm).

**States:** three variants as above. Minor: the parent variant can appear for a teen who picked a parent's Google account by mistake; the primary action is then the obvious choice.

**Interaction and motion:** standard sheet. The "Continue with this account" button uses Button destructive styling only in the different-account variant, because local data is removed.

**Accessibility:** focus on the title. Destructive action announced as "Continue with this account, removes unsaved lessons from this phone".

**Analytics:** `account_switch_started` (different-account variant), `auth_provider_result` with `error_code = account_is_guardian`.

**Web (≥ 600 px):** centred dialog.

**Mock priority:** P1.

---

### AUTH-10 · Used Apple on your iPhone?
**Purpose:** Help someone who signed up with Apple on an iPhone get into their account on Android or the web, where only Google is offered. **Main action:** Got it.
**Entry → exits:** AUTH-02 and AUTH-29 link → back.

**Layout (top to bottom):**
1. Sheet at 60%.
2. Title in `heading`.
3. Numbered steps (3), each a row with a number in a 32 circle on `surfaceSunken` and the step in `body`.
4. One `caption` `inkMuted` line: what happens after.
5. [Got it], Button primary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Used Apple on your iPhone? | iPhone पर Apple से साइन इन किया था? |
| Step 1 | Open {app_name} on your iPhone. | अपने iPhone पर {app_name} खोलें। |
| Step 2 | Go to Me, then Settings, then Account. | 'मैं' में जाएँ, फिर सेटिंग्स, फिर अकाउंट। |
| Step 3 | Tap Add Google and pick your Google account. | 'Google जोड़ें' पर टैप करें और अपना Google अकाउंट चुनें। |
| After | Then sign in here with that Google account. Everything will be here. | फिर यहाँ उसी Google अकाउंट से साइन इन करें। सब कुछ यहाँ मिलेगा। |
| Got it | Got it | समझ गए |

**Illustration slots:** none.

**States:** default only.

**Interaction and motion:** standard sheet.

**Accessibility:** steps are an ordered list.

**Analytics:** `auth_prompt_shown` with `reason = apple_help`.

**Web (≥ 600 px):** centred dialog.

**Mock priority:** P2.

---

### AUTH-11 · Add another sign-in
**Purpose:** Let an iPhone user add Google (or Apple) to the same account, so they can sign in anywhere. **Main action:** Continue with Google (or Apple).
**Entry → exits:** SET-02 "Add Google" or "Add Apple" rows, AUTH-06 row (iOS) → AUTH-04 / AUTH-05 → SET-02 with a toast, AUTH-09 (already has its own account), AUTH-30.

**Layout (top to bottom):**
1. Sheet at 40%.
2. Title in `heading`.
3. One line in `body` `inkMuted`.
4. The provider button (§0.2).
5. [Not now], Button ghost.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title, Google | Add Google to your account | अपने अकाउंट में Google जोड़ें |
| Line, Google | Then you can sign in on Android phones and on the web too. | फिर आप Android फ़ोन और वेब पर भी साइन इन कर पाएँगे। |
| Title, Apple | Add Apple to your account | अपने अकाउंट में Apple जोड़ें |
| Line, Apple | Then you can sign in on any iPhone with your Apple ID. | फिर आप किसी भी iPhone पर अपनी Apple ID से साइन इन कर पाएँगे। |
| Success toast | Google added | Google जुड़ गया |

**Illustration slots:** none.

**States:** offline (button disabled), loading, error. `identity_already_exists` for a signed-in user opens AUTH-09 "already has account" (no self-serve merge of two real accounts, flow §6.6).

**Interaction and motion:** standard.

**Accessibility:** standard.

**Analytics:** `auth_provider_result` with `flow = add_identity`.

**Web (≥ 600 px):** not shown (web has only Google, which the account already has).

**Mock priority:** P2.

---

### AUTH-12 · Sign out confirm
**Purpose:** Make sure the student knows sign-out clears this phone, and never lose unsaved progress by surprise. **Main action:** Sign out.
**Entry → exits:** SET-02 [Sign out], SET-02 [Switch account] → sign-out steps (flow §6.7) → ONB-01 (fresh guest) or AUTH-02 (`switch_account`); [Cancel] → SET-02.

**Layout (top to bottom):**
1. Sheet at 40% (default) or 60% (unsynced).
2. Title in `heading`.
3. Body in `body`.
4. Unsynced variant only: a card on `warningTint`, `CloudSlash` 24 in `warningText`, the question in `label` and the counts line under it (research §11.9).
5. Default variant only: a small switch row "Sign out of all devices" (off by default), 48 tall. It sits above the buttons, so the choice is made before the tap that acts on it.
6. Primary action button: [Stay signed in] (Button primary) in the unsynced variant, [Sign out] (Button primary) otherwise. The unsynced variant adds [Sign out anyway] (Button destructive) under it.
7. [Cancel], Button ghost.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Sign out of {app_name}? | {app_name} से साइन आउट करें? |
| Title, switch | Switch account? | अकाउंट बदलें? |
| Body | Your progress is saved to your account. This phone will be cleared for the next person. | आपकी प्रोग्रेस आपके अकाउंट में सेव है। अगले व्यक्ति के लिए यह फ़ोन साफ़ कर दिया जाएगा। |
| All devices | Sign out of all devices | सभी डिवाइस से साइन आउट करें |
| Sign out | Sign out | साइन आउट करें |
| Switch | Sign out and switch | साइन आउट करके बदलें |
| Cancel | Cancel | रद्द करें |
| Unsynced question | {n} lessons haven't saved yet. Stay signed in until they do? | {n} लेसन अभी सेव नहीं हुए हैं। जब तक सेव न हों, साइन इन रहें? |
| Unsynced counts | {n} lessons and {m} reviews will save when you're online. Check the chip in Me: it says "Saved" when it's safe. | {n} लेसन और {m} रिव्यू ऑनलाइन होते ही सेव होंगे। 'मैं' टैब का चिप "सेव है" दिखाए, तब सब सुरक्षित है। |
| Stay signed in | Stay signed in | साइन इन रहें |
| Sign out anyway | Sign out anyway | फिर भी साइन आउट करें |
| Saving | Saving your progress… | आपकी प्रोग्रेस सेव हो रही है… |
| Pet line (default variant) | See you soon! | जल्द मिलते हैं! |

**Illustration slots:** none (pet line avatar only).

**States:**
- **Default:** body, the all-devices switch, Sign out.
- **Saving:** after tapping Sign out while online with a small outbox, the button shows its spinner and "Saving your progress…" until the flush finishes (then sign-out continues) or fails (then the unsynced variant).
- **Unsynced** (offline, or the flush failed): the warning card, [Stay signed in] (primary, returns to SET-02), [Sign out anyway] (destructive), [Cancel]. Only lessons are counted in the question; reviews appear in the counts line. With 0 lessons the question reads "{m} reviews haven't saved yet. Stay signed in until they do?" / "{m} रिव्यू अभी सेव नहीं हुए हैं। जब तक सेव न हों, साइन इन रहें?"
- **Pro:** no difference (Pro stays on the account).
- **Managed child:** never shown (no sign-out for children; Parent mode handles it).
- **Guest:** never shown (SET-02 shows "Erase this phone's progress" instead, which uses this sheet's layout with the erase copy below).

| Key (guest erase) | EN | HI |
|---|---|---|
| Title | Erase this phone's progress? | इस फ़ोन की प्रोग्रेस मिटाएँ? |
| Body | You're a guest, so this can't be undone. Your streak, pet and notes will be gone. | आप गेस्ट हैं, इसलिए इसे वापस नहीं लाया जा सकता। आपकी स्ट्रीक, पेट और नोट्स मिट जाएँगे। |
| Erase | Erase | मिटाएँ |

**Interaction and motion:** standard sheet. After sign-out the app fades to ONB-01 with `slow`. Warning haptic on [Sign out anyway] and [Erase].

**Accessibility:** destructive buttons say what they lose in their label ("Sign out anyway, 3 lessons and 12 reviews will be lost").

**Analytics:** `auth_signed_out` (`scope`, `unsynced_lost`), `guest_erase_confirmed`.

**Web (≥ 600 px):** centred dialog. The body says "This browser" instead of "This phone".

| Key (web) | EN | HI |
|---|---|---|
| Body | Your progress is saved to your account. This browser will be cleared for the next person. | आपकी प्रोग्रेस आपके अकाउंट में सेव है। अगले व्यक्ति के लिए यह ब्राउज़र साफ़ कर दिया जाएगा। |

**Mock priority:** P0 (default and unsynced).

---

## Delete account

### AUTH-13 · Delete account: what goes
**Purpose:** Show exactly what deleting removes and what is kept, before anything happens. **Main action:** Continue.
**Entry → exits:** SET-02 and SET-11 [Delete account], `app.<domain>/delete-account`, SET-14 (parent deleting a child) → AUTH-15, store subscription page (from the AUTH-14 panel), SET-12 (download data first), back to the origin on [Keep my account].

**Layout (top to bottom):**
1. Top bar: back, step chip "Step 1 of 2" (`caption` on `surfaceSunken`). Deleting takes two screens and is never hidden (research X16).
2. Title in `title`.
3. "What will be deleted" heading in `heading`, then a list on `surface` (radius 20) with rows: icon 24 + `body` text. Icons: `Plant`, `NotePencil`, `UsersThree`, `ChatCircleText`, `Image`. Rows are 48 tall, and 42 tall on a 360-wide screen so the list and both pinned buttons fit without scrolling; text still wraps rather than truncates.
4. "What we keep" heading, then one row with `Receipt` 24.
5. Guardian variant: a card on `warningTint` with the child names.
5a. Pro active: the AUTH-14 subscription panel, here, above the download link.
6. A row link "Download your data first" (`DownloadSimple` 24, `CaretRight`), opens SET-12.
7. A line in `body` with `Clock` 20: the grace period (`auth.deletion_grace_days`).
8. Pinned: [Continue], Button destructive. Above it, [Keep my account], Button secondary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Step chip | Step 1 of 2 | चरण 1 / 2 |
| Title | Delete your account | अपना अकाउंट डिलीट करें |
| Title, parent deleting a child | Delete {child_name}'s account | {child_name} का अकाउंट डिलीट करें |
| Deleted heading | What will be deleted | क्या डिलीट होगा |
| Row 1 | Your progress, streak, plant and pet | आपकी प्रोग्रेस, स्ट्रीक, पौधा और पेट |
| Row 2 | Your notes, decks, memory palaces and saved cards | आपके नोट्स, डेक, मेमोरी पैलेस और सेव किए कार्ड |
| Row 3 | Your friends, league and squads | आपके दोस्त, लीग और स्क्वॉड |
| Row 4 | Your tutor chats | आपकी ट्यूटर चैट |
| Row 5 | Photos and files you uploaded | आपकी अपलोड की हुई फ़ोटो और फ़ाइलें |
| Kept heading | What we keep | हम क्या रखते हैं |
| Kept row | Payment records, because tax law needs them. They don't include your learning. | भुगतान के रिकॉर्ड, क्योंकि टैक्स कानून के लिए ज़रूरी हैं। इनमें आपकी पढ़ाई की जानकारी नहीं होती। |
| Guardian card | {child_names}'s accounts will be deleted too, because they're managed by you. | {child_names} के अकाउंट भी डिलीट हो जाएँगे, क्योंकि उन्हें आप संभालते हैं। |
| Download link | Download your data first | पहले अपना डेटा डाउनलोड करें |
| Grace line | You'll have {grace_days} days to change your mind. | आपके पास मन बदलने के लिए {grace_days} दिन होंगे। |
| Continue | Continue | आगे बढ़ें |
| Keep | Keep my account | मेरा अकाउंट रखें |

**Illustration slots:** none. This is a serious screen; the pet doesn't appear.

**States:** default; guardian variant; parent-deleting-a-child variant (rows speak about the child: "{child_name}'s progress, streak, plant and pet"); offline (Continue disabled with "Connect to the internet to delete your account"). Managed child: never shown to the child.

**Interaction and motion:** standard push (iOS) or shared-axis (Android).

**Accessibility:** lists are real lists. The step chip is read as "Step 1 of 2". The destructive button's label: "Continue to delete your account".

**Analytics:** `account_delete_step_viewed` (`step = 1`, `has_store_sub`).

**Web (≥ 600 px):** content column 560 wide, centred, buttons inline at the bottom of the column.

**Mock priority:** P0.

---

### AUTH-14 · Delete account: your subscription
**Purpose:** Make sure a Pro subscriber doesn't keep paying after deleting. It is a panel inside AUTH-13, not its own step, so deletion stays two screens (research X16). **Main action:** Open the store's subscriptions (store); none for web (AUTH-13's [Continue] carries on).
**Entry → exits:** shown inside AUTH-13 when Pro is active → store subscription page (Play or App Store) and back; AUTH-13 [Continue] → AUTH-15.

**Layout (top to bottom):**
1. A card on `surfaceRaised`, radius 20, padding 16, `CreditCard` 24.
2. Title in `heading`.
3. Body in `body`.
4. Store variant: [Open {store} subscriptions], Button secondary, full width. Once the store says it won't renew, a `success` line with `CheckCircle` 20: "Cancelled in {store}". Web variant: no button (we cancel it when the deletion is requested).
5. `caption` `inkMuted`: a note on the current period.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title, store | Cancel Pro in {store} first | पहले {store} में प्रो रद्द करें |
| Body, store | Deleting your account doesn't stop {store} from charging you. Cancel there, then come back. | अकाउंट डिलीट करने से {store} का शुल्क नहीं रुकता। वहाँ रद्द करें, फिर वापस आएँ। |
| Open store | Open {store} subscriptions | {store} सब्सक्रिप्शन खोलें |
| Cancelled | Cancelled in {store} | {store} में रद्द हो गया |
| Title, web | We'll cancel your Pro | हम आपका प्रो रद्द कर देंगे |
| Body, web | Your UPI Autopay or card won't be charged again. | आपके UPI ऑटोपे या कार्ड से फिर शुल्क नहीं कटेगा। |
| Period note | Pro ends when your account is deleted. | अकाउंट डिलीट होने पर प्रो खत्म हो जाएगा। |
| Store names | Google Play · App Store | Google Play · App Store |

**Illustration slots:** none.

**States:** store (Play, App Store), web (Razorpay), both (a store and a web subscription: both blocks stacked). Pro bought on another platform: the store variant names the store it was bought in, with "Open it on the phone you bought it on". Offline: buttons disabled.

**Interaction and motion:** [Open {store} subscriptions] opens the store's manage page (Play: subscriptions deep link with the product and package; iOS: the App Store subscriptions page). On return, the app re-reads the entitlement and shows the cancelled line if the subscription no longer renews. AUTH-13's [Continue] works either way, because the body already said the store keeps charging.

**Accessibility:** store names are read as written.

**Analytics:** `has_store_sub` on AUTH-13's `account_delete_step_viewed`.

**Web (≥ 600 px):** as AUTH-13. A store subscription on web says "Cancel it on your phone in {store}".

**Mock priority:** P1.

---

### AUTH-15 · Delete account: confirm it's you
**Purpose:** Make sure the account owner, not someone else holding the phone, is deleting it. **Main action:** Delete my account (after re-sign-in).
**Entry → exits:** AUTH-13 or AUTH-14 → Google or Apple re-sign-in (AUTH-04 / AUTH-05) → AUTH-16; back.

**Layout (top to bottom):**
1. Top bar with "Step 2 of 2".
2. Title in `title`.
3. Body naming the account: first name and masked email (for example "r•••@gmail.com"), or "Apple ID" for Apple.
4. Before re-sign-in: the provider button (§0.2) for the account's provider.
5. After re-sign-in: a `successTint` row with `CheckCircle` 24 "Confirmed", then [Delete my account], Button destructive, pinned.
6. [Cancel], Button ghost.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Confirm it's you | पुष्टि करें कि यह आप ही हैं |
| Body | Sign in again to delete {first_name}'s account ({masked_email}). | {first_name} का अकाउंट ({masked_email}) डिलीट करने के लिए फिर से साइन इन करें। |
| Confirmed | Confirmed | पुष्टि हो गई |
| Delete | Delete my account | मेरा अकाउंट डिलीट करें |
| Wrong account | That's a different Google account. Use the one you signed in with. | यह दूसरा Google अकाउंट है। वही इस्तेमाल करें जिससे आपने साइन इन किया था। |
| Cancel | Cancel | रद्द करें |

**Illustration slots:** none.

**States:** before and after re-sign-in; wrong account (the error line in `errorText` with `WarningCircle`, the button stays); re-sign-in older than 5 minutes when Delete is tapped (asks again); offline (disabled); error (AUTH-30 inline).

**Interaction and motion:** warning haptic on Delete. The button shows a spinner while `POST /v1/account/deletion` runs.

**Accessibility:** the masked email is read character-group by group as written. The confirmed state is announced.

**Analytics:** `account_delete_step_viewed` (`step = 2`), `account_delete_requested` (`provider`).

**Web (≥ 600 px):** as AUTH-13, with the Google-rendered button.

**Mock priority:** P1.

---

### AUTH-16 · Delete account: scheduled
**Purpose:** Confirm the deletion is booked, say when, and say how to undo it. **Main action:** Done.
**Entry → exits:** AUTH-15 → ONB-01 (fresh guest).

**Layout (top to bottom):**
1. Full screen, no back.
2. Illustration 200: the pet waving gently.
3. Title in `title` with the date.
4. Body in `body`.
5. [Done], Button primary.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Your account will be deleted on {date} | आपका अकाउंट {date} को डिलीट हो जाएगा |
| Body | You're signed out on every device. If you change your mind, sign in before {date}. | आप हर डिवाइस से साइन आउट हो गए हैं। मन बदले तो {date} से पहले साइन इन करें। |
| Done | Done | ठीक है |
| Pet line | Take care! You're always welcome back. | अपना ध्यान रखें! आपका हमेशा स्वागत है। |

**Illustration slots:** `pet-cat` / `pet-dog`, 1:1, waving pose, calm (happy, not sad: DESIGN §6.3 says sad states are gentle, and a goodbye shouldn't guilt). Alt text intent: "{pet_name} waving goodbye".

**States:** default. Parent deleting a child: "{child_name}'s account will be deleted on {date}" and [Done] returns to SET-14.

**Interaction and motion:** fade in with `slow`. Rive `wave` trigger once. No sound.

**Accessibility:** the date is spoken in full ("5 November 2026").

**Analytics:** none extra (the request was logged on AUTH-15).

**Web (≥ 600 px):** centred column.

**Mock priority:** P1.

---

### AUTH-17 · Keep your account?
**Purpose:** Let someone who signs in during the grace period stop the deletion. **Main action:** Keep my account.
**Entry → exits:** any sign-in that finds `deletion_scheduled_for` set → HOME-01 (kept), ONB-01 (continue deleting).

**Layout (top to bottom):**
1. Full screen.
2. Illustration 200: the pet perking up with the plant.
3. Title in `title`.
4. Body in `body`.
5. [Keep my account], Button primary.
6. [Continue deleting], Button ghost.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Your account is set to be deleted on {date} | आपका अकाउंट {date} को डिलीट होने वाला है |
| Body | Keep it, and everything comes back as it was. | इसे रखें, और सब कुछ पहले जैसा वापस आ जाएगा। |
| Keep | Keep my account | मेरा अकाउंट रखें |
| Continue deleting | Continue deleting | डिलीट जारी रखें |
| Kept toast | Welcome back! Your account is safe. | फिर से स्वागत है! आपका अकाउंट सुरक्षित है। |

**Illustration slots:** `pet-cat` / `pet-dog`, 1:1, excited pose. Alt text intent: "{pet_name} is excited".

**States:** default, loading, offline (buttons disabled), error.

**Interaction and motion:** success haptic on Keep, then ENT-09 restore.

**Accessibility:** standard.

**Analytics:** `account_delete_cancelled`.

**Web (≥ 600 px):** centred column.

**Mock priority:** P2.

---

## Guardian consent (13 to 17)

### AUTH-18 · Guardian consent: ask
**Purpose:** Explain to a teen why a parent or guardian has to say yes, and let them choose how. Phase 1 build; with the default flags a teen first needs it at a Phase 2 feature (flow, Phases). **Main action:** My parent is here (or Send them a link).
**Entry → exits:** the gated feature (SOC-02, the AI-12 voice and AI-16 photo gates, MEM-11 share and community submit), AUTH-06 / AUTH-08 (gate `signin`), SET-11 consent rows → AUTH-19, AUTH-21, origin on [Not now].

**Layout (top to bottom):**
1. Full screen, top bar with back.
2. Illustration 200: a teen and an adult side by side looking at a phone, friendly.
3. Title in `title`.
4. Body in `body` naming the feature.
5. Two large option cards (radius 20, `surface`, `line` border, min height 88, 12 apart), each with an icon 32 in a 56 circle on `primaryTint`, a title in `heading` and a line in `body` `inkMuted`: `HandArrowUp` "My parent is here", `PaperPlaneTilt` "Send them a link".
6. A `caption` `inkMuted` line: what the guardian will see.
7. [Not now], Button ghost, pinned.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Ask a parent or guardian | माता-पिता या अभिभावक से पूछें |
| Body | You're under 18, so a parent or guardian needs to say yes to {feature}. It takes a minute. | आपकी उम्र 18 से कम है, इसलिए {feature} के लिए माता-पिता या अभिभावक की हाँ ज़रूरी है। इसमें एक मिनट लगता है। |
| Feature: social | friends and leagues | दोस्त और लीग |
| Feature: voice | the voice tutor | वॉइस ट्यूटर |
| Feature: uploads | photo doubts | फ़ोटो डाउट |
| Feature: community | sharing decks and memory tricks | डेक और याद रखने की तरकीबें शेयर करना |
| Feature: account (gate `signin`) | saving your account | अपना अकाउंट सेव करना |
| Option 1 title | My parent is here | माता-पिता यहीं हैं |
| Option 1 line | Hand them this phone | उन्हें यह फ़ोन दें |
| Option 2 title | Send them a link | उन्हें लिंक भेजें |
| Option 2 line | They say yes on their own phone | वे अपने फ़ोन पर हाँ कहेंगे |
| Guardian note | They'll sign in with their own Google account and see exactly what you can use. | वे अपने Google अकाउंट से साइन इन करेंगे और देखेंगे कि आप क्या-क्या इस्तेमाल कर सकते हैं। |
| Not now | Not now | अभी नहीं |
| Pet line | It's quick, I promise! | बस एक मिनट लगेगा! |

**Illustration slots:** `sunny-scene`, 3:2, an Indian teen and a parent on a sofa at home looking at one phone together, warm light, everyday clothes. Alt text intent: "A student and a parent looking at a phone together". Generated once and reused from the image index.

**States:**
- **Default.**
- **Pending request exists** (a link already sent): the second card shows "Link sent {time} ago" and opens AUTH-21 on its waiting state.
- **Declined recently** (within `auth.consent_retry_h`): both cards disabled with "You can ask again on {date}." / "आप {date} को फिर से पूछ सकते हैं।"
- **Consent first** (`minor.defer_sync_until_consent` on, opened from AUTH-01's [Ask a parent]): the teen has no account yet. Same cards; the request is made from the device (flow §6.10). The `account` scope is always asked.
- **Blocked after `auth.consent_decline_limit` declines** (flow §6.10): cards hidden, line "Your guardian said no for now. You can ask again on {date}."
- **Offline:** cards disabled, "Connect to the internet to ask."
- **Dark mode:** standard.

**Interaction and motion:** cards press to 0.97 with `fast`. Light haptic.

**Accessibility:** each card is one button with its title and line as the label. The illustration has alt text.

**Analytics:** `guardian_consent_requested` (`channel` on choice, `gate`, `scopes`).

**Web (≥ 600 px):** the two cards side by side, 280 wide each.

**Mock priority:** P0.

---

### AUTH-19 · Guardian consent: hand the phone
**Purpose:** Hand the phone from the teen to the guardian, then let the guardian sign in without touching the teen's account. Phase 1 build; with the default flags a teen first needs it at a Phase 2 feature (flow, Phases). **Main action:** student view: They have it. Guardian view: Continue with Google.
**Entry → exits:** AUTH-18 option 1 → guardian sign-in (AUTH-04 / AUTH-05 in an in-memory session) → AUTH-20; [Not now, give it back] → AUTH-18.

**Layout (top to bottom), student view:**
1. Full screen, illustration 240: a phone passing from one hand to another.
2. Title in `title`.
3. [They have it], Button primary, pinned.

**Layout (top to bottom), guardian view** (after [They have it], the screen changes with a cross-fade and the copy speaks to the adult):
1. Top: the app logo (24) and `caption` "For parents and guardians".
2. Title in `title`.
3. Body in `body`, then a `surfaceSunken` card listing the asked features as Chips (read-only).
4. A line with `LockKey` 20 in `body` `inkMuted`: the account-stays-separate promise.
5. Continue with Google (§0.2), then Continue with Apple on iOS.
6. [Use another account], Button ghost (Android: opens the browser sign-in with an ephemeral session where supported).
7. [Not now, give it back], Button ghost.
8. Trust line (AUTH-01 copy).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Student title | Hand the phone to your parent or guardian | फ़ोन अपने माता-पिता या अभिभावक को दें |
| Student button | They have it | उनके पास है |
| Guardian kicker | For parents and guardians | माता-पिता और अभिभावकों के लिए |
| Guardian title | Hello! {first_name} wants to use {feature} on {app_name} | नमस्ते! {first_name} {app_name} पर {feature} इस्तेमाल करना चाहते हैं |
| Guardian body | Please sign in with your own Google account to check and agree. | देखने और सहमति देने के लिए कृपया अपने Google अकाउंट से साइन इन करें। |
| Separate promise | Your account stays separate. You won't stay signed in on this phone. | आपका अकाउंट अलग रहेगा। आप इस फ़ोन पर साइन इन नहीं रहेंगे। |
| Use another account | Use another account | दूसरा अकाउंट इस्तेमाल करें |
| Give back | Not now, give it back | अभी नहीं, फ़ोन वापस दें |

**Illustration slots:** student view: `sunny-object`, 1:1, a phone being passed between two hands (diverse skin tones), on transparent. Alt text intent: "Passing the phone". Guardian view: none (calm, text first).

**States:**
- **Guardian picks the teen's own Google account:** AUTH-20 doesn't open; an inline `errorText` line "This is {first_name}'s account. Please use your own." and the buttons stay.
- **Guardian account is a declared minor:** "This account belongs to someone under 18. A parent or guardian needs to use their own account."
- **Request expired** (`auth.consent_handoff_ttl_min`): "This took too long. Hand the phone back to start again." with [Give it back].
- **Offline:** buttons disabled.
- **Dark mode:** standard.

**Interaction and motion:** the student-to-guardian change is a cross-fade with `slow`, no pet (signals a different reader). Light haptic on [They have it].

**Accessibility:** the screen reader announces the change of audience ("For parents and guardians" as a heading). Focus moves to the guardian title.

**Analytics:** `guardian_consent_requested` (`channel = handoff`).

**Web (≥ 600 px):** the same two views in a 560 column.

**Mock priority:** P0 (both views).

---

### AUTH-20 · Guardian consent: review and agree
**Purpose:** Show the guardian exactly what they are agreeing to, item by item, and record their consent. Phase 1 build; with the default flags a teen first needs it at a Phase 2 feature (flow, Phases). **Main action:** I agree.
**Entry → exits:** AUTH-19 (same device), AUTH-22 (guardian's own phone), AUTH-24 / AUTH-26 (parent creating a managed child, child variant), SET-17 (granting a scope later) → AUTH-23 on the teen's phone, a done state on the guardian's phone, SET-14 (parent flow).

**Layout (top to bottom):**
1. Top bar: "For parents and guardians" kicker; close (`X`) on the guardian's own phone.
2. Title in `title`.
3. A line in `body` `inkMuted`: "{guardian_first_name}, signed in with Google" with a small G (16) or Apple mark, and [Not you?] link.
4. The scopes list on `surface`, radius 20: one row per scope, min height 72, with icon 24, title in `label`, one line in `body` `inkMuted`, and a Switch on the right. The `account` row has no switch; it shows a Chip "Needed" instead. Only the scopes the teen asked for start on; others start off.
5. Declaration: a checkbox row (48 target) with the declaration in `body`.
6. DigiLocker step (only when `auth.guardian_digilocker` is on and the guardian isn't a `known_adult`): a list row with `IdentificationCard` 24, "Confirm your age with DigiLocker", `CaretRight`, and a `caption` line.
7. Links: "Read the full notice" (opens the consent notice in the guardian's language) and "What we never do".
8. A `caption` `inkMuted` line: change any time.
9. Pinned: [I agree], Button primary, disabled until the declaration is ticked (and DigiLocker done when required). [No thanks], Button ghost.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | What {first_name} will be able to do | {first_name} क्या-क्या कर पाएँगे |
| Signed in as | {guardian_first_name}, signed in with Google | {guardian_first_name}, Google से साइन इन |
| Not you | Not you? | आप नहीं हैं? |
| Row: account | Save progress to an account · Keeps lessons and streaks safe across phones. | प्रोग्रेस को अकाउंट में सेव करना · लेसन और स्ट्रीक हर फ़ोन पर सुरक्षित रहते हैं। |
| Needed chip | Needed | ज़रूरी |
| Row: social | Friends and leagues · Preset messages only, no open chat. Others see only their pet and a made-up nickname, never their name. | दोस्त और लीग · सिर्फ़ तय संदेश, कोई खुली चैट नहीं। दूसरों को सिर्फ़ उनका पेट और एक बनाया हुआ निकनेम दिखता है, नाम कभी नहीं। |
| Row: community | Share decks and memory tricks · Shared under their nickname, never their name. | डेक और याद रखने की तरकीबें शेयर करना · उनके निकनेम से शेयर होती हैं, नाम से कभी नहीं। |
| Row: voice | Voice tutor · Their voice is sent to our speech partner to answer questions. Transcripts are kept for 180 days. | वॉइस ट्यूटर · सवालों के जवाब के लिए उनकी आवाज़ हमारे स्पीच पार्टनर को भेजी जाती है। ट्रांसक्रिप्ट 180 दिन तक रखे जाते हैं। |
| Row: uploads | Photo doubts · Photos of questions they take are used only to answer them. | फ़ोटो डाउट · उनकी ली गई सवालों की फ़ोटो सिर्फ़ जवाब देने के लिए इस्तेमाल होती हैं। |
| Declaration | I am {first_name}'s parent or legal guardian, and I am 18 or older. | मैं {first_name} के माता-पिता में से एक या कानूनी अभिभावक हूँ, और मेरी उम्र 18 साल या उससे ज़्यादा है। |
| DigiLocker row | Confirm your age with DigiLocker | DigiLocker से अपनी उम्र की पुष्टि करें |
| DigiLocker line | We only ask DigiLocker whether you are 18 or older. | हम DigiLocker से सिर्फ़ यह पूछते हैं कि आपकी उम्र 18 या उससे ज़्यादा है या नहीं। |
| Notice link | Read the full notice | पूरी सूचना पढ़ें |
| Never link | What we never do | हम क्या कभी नहीं करते |
| Never list (sheet) | No ads. No selling data. No open chat with strangers. No tracking for ads. | कोई विज्ञापन नहीं। डेटा की बिक्री नहीं। अनजान लोगों से खुली चैट नहीं। विज्ञापन के लिए ट्रैकिंग नहीं। |
| Change later | You can change this any time in Parent mode. | आप इसे कभी भी पैरेंट मोड में बदल सकते हैं। |
| Agree | I agree | मैं सहमत हूँ |
| No thanks | No thanks | नहीं, धन्यवाद |
| Done (guardian's own phone) | Thank you. {first_name} can use what you allowed. | धन्यवाद। {first_name} अब वह इस्तेमाल कर सकते हैं जिसकी आपने अनुमति दी है। |
| Done, give back (same phone) | Thank you. Please hand the phone back to {first_name}. | धन्यवाद। कृपया फ़ोन {first_name} को वापस दें। |

**Illustration slots:** none (a legal moment; text first).

**States:**
- **Default:** the asked scopes on.
- **Managed child variant** (parent creating a child): title "What {child_name} will be able to do", social row says "Friend duels only, preset messages"; voice row hidden for little learners.
- **Loading:** I agree shows a spinner.
- **Request already decided** (another tap from a second device): "You've already answered this request."
- **Expired:** "This request has expired. Ask {first_name} to send a new one."
- **Offline:** buttons disabled.
- **Dark mode:** standard.

**Interaction and motion:** switches animate with `fast`. On agree, a `successTint` check pops with the `pop` spring, success haptic, then the done line.

**Accessibility:** each row is a switch with its title and line as the label ("Friends and leagues, preset messages only..., off"). The Needed row is static text. The declaration checkbox is required and says so. Focus order: title, signed-in line, rows, declaration, DigiLocker, links, buttons.

**Analytics:** `guardian_consent_decided` (`channel`, `decision`, `scopes_granted`, `age_assurance`).

**Web (≥ 600 px):** a 640 column, rows unchanged, buttons inline at the end.

**Mock priority:** P0.

---

### AUTH-21 · Guardian consent: send a link or QR
**Purpose:** Let the teen send the request to a guardian who isn't with them, and wait for the answer. Phase 1 build; with the default flags a teen first needs it at a Phase 2 feature (flow, Phases). **Main action:** Share link.
**Entry → exits:** AUTH-18 option 2 → system share sheet, AUTH-23 (when the guardian answers), back to the origin (the request keeps waiting).

**Layout (top to bottom):**
1. Full screen, top bar with back.
2. Title in `title`.
3. Body in `body`.
4. QR code in a 240 × 240 `surface` card, radius 20, with 16 padding (the code is generated by the app from the link; it is a data mark, not an illustration).
5. [Share link], Button primary. [Copy link], Button secondary.
6. Waiting row: a small spinner and the waiting line in `label`, with "Expires {relative_time}" in `caption`.
7. [Cancel request], Button ghost.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Send this to your parent or guardian | इसे अपने माता-पिता या अभिभावक को भेजें |
| Body | They can scan the code or open the link on their phone. It works for 3 days. | वे अपने फ़ोन पर कोड स्कैन कर सकते हैं या लिंक खोल सकते हैं। यह 3 दिन तक चलेगा। |
| Share | Share link | लिंक शेयर करें |
| Copy | Copy link | लिंक कॉपी करें |
| Copied toast | Link copied | लिंक कॉपी हो गया |
| Waiting | Waiting for your guardian… | अभिभावक का इंतज़ार है… |
| Expires | Expires in {duration} | {duration} में खत्म होगा |
| Cancel | Cancel request | अनुरोध रद्द करें |
| Share message | Hi! I need your OK for a few things in {app_name}, the study app I use. Please open this link: {link} | नमस्ते! पढ़ाई वाले ऐप {app_name} में कुछ चीज़ों के लिए आपकी हाँ चाहिए। कृपया यह लिंक खोलें: {link} |
| Pet line | Let's wait together. | चलिए, साथ में इंतज़ार करते हैं। |

**Illustration slots:** none (the QR code is the visual).

**States:**
- **Waiting** (default after sharing).
- **Answered:** moves to AUTH-23 automatically.
- **Expired:** the QR fades to 30%, the line "This link expired", [Send a new link] replaces Share.
- **Offline:** QR and link still show (they were created online), the waiting row says "Offline. We'll check when you're back online."
- **App in background:** a push tells the teen the answer (NTF-01, kind `consent_decided`, transactional, in the me-money NTF-01 catalogue).

**Interaction and motion:** polling every 5 s while open. The spinner is a slow rotation; reduced motion shows a static `HourglassMedium` icon.

**Accessibility:** the QR has the label "QR code for your guardian. Use Share link to send it instead." The waiting row is a live region that announces the answer.

**Analytics:** `guardian_consent_link_shared` (`via`), `guardian_consent_expired`.

**Web (≥ 600 px):** QR and buttons side by side.

**Mock priority:** P1.

---

### AUTH-22 · Guardian consent: guardian landing
**Purpose:** Greet a guardian who opened the link on their own phone or computer, and get them signed in. Phase 1 build; with the default flags a teen first needs it at a Phase 2 feature (flow, Phases). **Main action:** Continue with Google.
**Entry → exits:** `smriti.app/guardian/{code}` (app if installed, otherwise the web app) → AUTH-04 → AUTH-20; expired or used links → a closed state.

**Layout (top to bottom):**
1. The app logo and name, centred.
2. Title in `title`.
3. Body in `body`.
4. A short "About {app_name}" card on `surfaceSunken` with two lines and the Phosphor `ShieldCheck` 24.
5. Continue with Google (One Tap with `context: 'signin'` also offered on web), Continue with Apple on iOS.
6. Trust line (AUTH-01 copy).
7. Legal footer.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | {first_name} asked for your OK | {first_name} ने आपकी सहमति माँगी है |
| Title, no name yet (consent-first variant) | Your child asked for your OK | आपके बच्चे ने आपकी सहमति माँगी है |
| Body | Sign in with your Google account to see what they asked for. | उन्होंने क्या माँगा है, यह देखने के लिए अपने Google अकाउंट से साइन इन करें। |
| About line 1 | {app_name} is a learning app for Indian students, from class 1 to competitive exams. | {app_name} भारतीय छात्रों के लिए पढ़ाई का ऐप है, कक्षा 1 से प्रतियोगी परीक्षाओं तक। |
| About line 2 | There are no ads, and children can't chat freely with strangers. | इसमें कोई विज्ञापन नहीं है, और बच्चे अनजान लोगों से खुलकर चैट नहीं कर सकते। |
| Expired title | This link has expired | इस लिंक की समय-सीमा खत्म हो गई |
| Expired body | Ask {first_name} to send a new one from the app. | {first_name} से ऐप से नया लिंक भेजने को कहें। |
| Used title | You've already answered this request | आप इस अनुरोध का जवाब पहले ही दे चुके हैं |
| Language toggle | हिन्दी · English | हिन्दी · English |

**Illustration slots:** none (keeps the page light on a guardian's phone).

**States:** default; consent-first variant (`minor.defer_sync_until_consent` on: the teen has no account yet, so no first name; the page shows the no-name title and the teen's pet avatar, and AUTH-20 uses "your child" in place of `{first_name}`); signed in already (skips to AUTH-20); expired; used; in-app browser (AUTH-30 "Open in your browser", common when the link is opened inside a social app); offline (web: the service worker shows "You're offline").

**Interaction and motion:** a plain page. Language follows the browser, with the toggle at the top right.

**Accessibility:** the first heading is the title. The page works with keyboard only.

**Analytics:** `auth_prompt_shown` (`reason = guardian_link`), `auth_provider_result`.

**Web (≥ 600 px):** a 480 column, centred.

**Mock priority:** P1.

---

### AUTH-23 · Guardian consent: result
**Purpose:** Tell the teen what the guardian decided and take them to the feature, or back, kindly. Phase 1 build; with the default flags a teen first needs it at a Phase 2 feature (flow, Phases). **Main action:** Continue.
**Entry → exits:** AUTH-20 (same phone), AUTH-21 (link), a push → the gated feature (agreed), the origin (declined, expired), SET-11 (revoked).

**Layout (top to bottom):**
1. Full screen.
2. Illustration 200, by result.
3. Title in `title`.
4. Body in `body`.
5. Agreed: Chips for the features now on, each with `CheckCircle` 16.
6. [Continue], Button primary. Expired: [Send a new link], Button primary, and [Not now], Button ghost.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Agreed title | Your guardian said yes! | आपके अभिभावक ने हाँ कह दी! |
| Agreed body | These are on now: | ये अब चालू हैं: |
| Declined title | Your guardian said no for now | आपके अभिभावक ने अभी के लिए मना किया है |
| Declined body | Everything else in {app_name} still works. You can ask again on {date}. | {app_name} में बाकी सब पहले जैसा चलता रहेगा। आप {date} को फिर से पूछ सकते हैं। |
| Expired title | The link expired | लिंक की समय-सीमा खत्म हो गई |
| Expired body | No answer came in time. You can send a new link. | समय पर कोई जवाब नहीं आया। आप नया लिंक भेज सकते हैं। |
| Agreed body, consent first | Now sign in with your own Google account to save your progress. | अब अपनी प्रोग्रेस सेव करने के लिए अपने Google अकाउंट से साइन इन करें। |
| Send new | Send a new link | नया लिंक भेजें |
| Revoked title | Your guardian turned off {feature} | आपके अभिभावक ने {feature} बंद कर दिया है |
| Revoked body | Talk to them if you'd like it back. Your learning isn't affected. | अगर आपको यह वापस चाहिए तो उनसे बात करें। आपकी पढ़ाई पर कोई असर नहीं पड़ेगा। |
| Continue | Continue | आगे बढ़ें |
| Pet line, agreed | Yay! Let's go! | वाह! चलिए! |
| Pet line, declined | That's OK. Let's keep learning together. | कोई बात नहीं। चलिए, साथ में पढ़ते रहें। |

**Illustration slots:** `pet-cat` / `pet-dog`, 1:1: agreed, excited pose; declined, expired and revoked, a gentle curious pose (never sad: the decision isn't the teen's fault). Alt text intent: the mood in words.

**States:** agreed, declined, expired, revoked. **Agreed, consent first** (`minor.defer_sync_until_consent` on): the agreed body for this variant, and [Continue] is replaced by Continue with Google (Continue with Apple under it on iOS), the iOS prep line and the trust line (AUTH-01 copy). The teen's sign-in claims the consent and the outbox flushes for the first time (flow §6.10); then the AUTH-06 toast. Offline: can't arrive offline (result needs the network); a push opens it later (not in the consent-first variant, which has no push token).

**Interaction and motion:** agreed: confetti (`celebrate`), success haptic. Others: a plain fade, no haptic.

**Accessibility:** the feature chips are a list read in full.

**Analytics:** `guardian_consent_decided` (logged server-side; the client logs `screen_view` only), `guardian_consent_withdrawn` for the revoked view.

**Web (≥ 600 px):** centred column.

**Mock priority:** P1 (agreed and declined).

---

## Parents and managed children

### AUTH-24 · Parent sign-in
**Purpose:** Get a parent signed in with their own Google account, so they can own and protect their child's account. Phase 1, account part only (TRD §18 D9); the Parent mode dashboard is Phase 3. **Main action:** Continue with Google.
**Entry → exits:** SET-13 parent gate (first time on this device), HOME-06 grown-ups corner and the LES-08 "Ask a grown-up" row (through SET-13), AUTH-02 "Restoring your child's account?", AUTH-03 (under 13 result) → AUTH-04 / AUTH-05 → AUTH-20 (child variant, first time), AUTH-26 (add a child), AUTH-28 (restore), SET-14 (Parent dashboard), back.

**Layout (top to bottom):**
1. Full screen, top bar with back and the kicker "For parents and guardians".
2. Illustration 200: a parent and a young child with the pet.
3. Title in `title`.
4. Body in `body`, naming the child when known.
5. Continue with Google, then Continue with Apple on iOS.
6. A switch row (48): "Stay signed in on this phone", off by default.
7. A `caption` `inkMuted` line on what the child sees.
8. Trust line (AUTH-01 copy).
8. Legal footer.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Kicker | For parents and guardians | माता-पिता और अभिभावकों के लिए |
| Title | Sign in as the parent | पैरेंट के रूप में साइन इन करें |
| Body, child known | Use your own Google account. {child_name}'s progress is saved under it, and you can bring it back on any phone. | अपने Google अकाउंट का इस्तेमाल करें। {child_name} की प्रोग्रेस उसी के तहत सेव होगी, और आप इसे किसी भी फ़ोन पर वापस ला सकते हैं। |
| Body, restore | Use the Google account you used to set up your child. | वही Google अकाउंट इस्तेमाल करें जिससे आपने अपने बच्चे का अकाउंट बनाया था। |
| Stay signed in | Stay signed in on this phone | इस फ़ोन पर साइन इन रहें |
| Child note | Your child never needs a Google account or a password. | आपके बच्चे को कभी Google अकाउंट या पासवर्ड की ज़रूरत नहीं होगी। |
| Child-side line (shown to the child before SET-13) | Ask a grown-up to help save your work! | अपना काम सेव करने के लिए किसी बड़े से मदद लें! |

**Illustration slots:** `sunny-scene`, 3:2, an Indian parent and a young child (6–9) at a table at home with a cat and a dog nearby, warm and calm. Alt text intent: "A parent and child with their study buddy". Reused for AUTH-26 and AUTH-28.

**States:**
- **First time (no child yet linked):** after sign-in → AUTH-20 child variant → back to the child's Home with AUTH-06 "Saved!".
- **Returning parent:** after sign-in → SET-14 (or AUTH-25 if several profiles).
- **Restore entry:** → AUTH-28.
- **Parent's Google account is a declared minor:** "This account belongs to someone under 18. Please use a parent's account."
- **Offline:** buttons disabled.
- **Dark mode:** standard.

**Interaction and motion:** standard push. Android: tries Google's bottom sheet with authorised accounts first for returning parents.

**Accessibility:** the kicker is a heading level above the title. The switch has its full label.

**Analytics:** `parent_signed_in` (`entry`, `stay_signed_in`).

**Web (≥ 600 px):** two columns at ≥ 1024 (illustration left, content right); a 560 column below.

**Mock priority:** P0.

---

### AUTH-25 · Who's learning?
**Purpose:** On a phone with more than one profile, let each person open their own profile, and keep everyone's data apart. Phase 1, account part (flow phases). This is the only "Who's learning?" screen; SET-20 points here. **Main action:** tap a profile.
**Entry → exits:** app launch when the device has 2 or more profiles, the profile switch in the top bar of HOME-06 and ME-01, SET-20 → HOME-01 / HOME-06 for the chosen profile, SET-13 (adult profiles, Grown-ups, and every tile when "Ask before switching profiles" is on), AUTH-26 (via SET-13).

**Layout (top to bottom):**
1. Full screen, no back.
2. Title in `display` (30/36), centred.
3. A grid of profile cards, 2 columns on phones (3 on tablets), 12 apart: each card 160 tall, radius 24, `surface`, the profile's pet (96, its current mood) on a tint circle in the profile's colour (the pet's colour family, not a subject colour), the first name in `heading`, and for adult profiles a small `LockSimple` 16 chip "Grown-up".
4. A last card "Grown-ups" with `UserGear` 32, opens SET-13.
5. Nothing else (no tab bar).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Who's learning? | अब किसकी बारी है? |
| Grown-up chip | Grown-up | बड़े |
| Grown-ups card | Grown-ups | बड़ों के लिए |
| Profile a11y | {first_name}, with {pet_name} | {first_name}, {pet_name} के साथ |
| Pet line (under the title) | Tap your buddy to start! | शुरू करने के लिए अपने साथी पर टैप करें! |
| Pet line, ask before switching | Ask a grown-up to switch. | बदलने के लिए बड़ों से पूछें। |
| Locked tile a11y | {first_name}, with {pet_name}. A grown-up opens this. | {first_name}, {pet_name} के साथ। इसे बड़े खोलेंगे। |

**Illustration slots:** `pet-cat` / `pet-dog` per profile, 1:1, the profile's current mood (under-10 profiles use only happy, excited, curious, sleepy). Alt text: the card's label carries it.

**States:**
- **Default.**
- **Ask before switching profiles on** (the parent's SET-14 setting, `parent.ask_before_switching`): every tile shows a small `LockSimple` 16, and tapping any tile, child or adult, opens SET-13 first. The switch happens only when the gate passes. Closing or failing the gate returns to AUTH-25 with the current profile unchanged (on launch: the last active profile stays selected and nothing opens until the gate passes). The pet line changes to the "ask" copy.
- **A profile whose session ended** (for example the parent removed this device): the card shows `WarningCircle` 16 and "Ask a grown-up", and tapping it opens SET-13 → AUTH-28.
- **Offline:** works (sessions and data are local).
- **Dark mode:** standard.

**Interaction and motion:** cards press with `fast`, the pet does a `hop` on tap, then a shared-element transition of the pet into the Home header (`slow`). With "Ask before switching" on, the tap opens SET-13 as a sheet first and the transition plays after the gate. Reduced motion: fade.

**Accessibility:** each card is one button. Adult cards say "Grown-up, needs a check". Big targets suit young children.

**Analytics:** `child_profile_switched` (`profiles_on_device`, `gated` bool).

**Web (≥ 600 px):** not shown on web in Phase 1 (one profile per browser).

**Mock priority:** P0.

---

### AUTH-26 · Add a child
**Purpose:** Let a signed-in parent create a managed account for a child on this phone. Phase 1, account part only (TRD §18 D9); the Parent mode dashboard is Phase 3. **Main action:** Create profile.
**Entry → exits:** SET-18 "Create a child account" (behind SET-13), AUTH-25 via SET-13, AUTH-28 empty state → AUTH-20 child variant (consent) → ONB-09 (hand the phone to the child, little-learner onboarding) → HOME-06.

**Layout (top to bottom):**
1. Full screen, top bar with back, kicker "For parents and guardians".
2. Title in `title`.
3. Input "Child's first name" (56, radius 16, `surfaceSunken`), max 20 characters, with the hint.
4. Class picker: a row of Chips for Class 1 to 8 (wraps), one choice. Classes come from config (the variant's school classes).
5. A `caption` `inkMuted` line on what is stored.
6. [Create profile], Button primary, pinned, disabled until name and class are set.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Add a child | बच्चा जोड़ें |
| Name label | Child's first name | बच्चे का पहला नाम |
| Name hint | Only a first name. Only you and your child see it. Other students see their pet and a made-up nickname. | सिर्फ़ पहला नाम। यह सिर्फ़ आपको और आपके बच्चे को दिखेगा। दूसरे छात्रों को उनका पेट और एक बनाया हुआ निकनेम दिखता है। |
| Class label | Class | कक्षा |
| Class chip | Class {n} | कक्षा {n} |
| Stored line | We store the first name and class. No photo, no birthday, no school. | हम सिर्फ़ पहला नाम और कक्षा रखते हैं। कोई फ़ोटो, जन्मदिन या स्कूल नहीं। |
| Create | Create profile | प्रोफ़ाइल बनाएँ |
| Created toast | {child_name}'s profile is ready | {child_name} की प्रोफ़ाइल तैयार है |

**Illustration slots:** reuses AUTH-24's `sunny-scene`, scaled to 140.

**States:** default; name fails the blocklist (`errorText` "Please use a different name."); offline (Create disabled); loading; limit reached (`auth.max_children_per_guardian`: "You can add up to {n} children."). Class 1–5 sets under-10 mode; class 6–8 sets the `10_12` rules. The class picker shows only classes whose content has shipped; classes 1 to 8 arrive in Phase 3 (R8).

**Interaction and motion:** standard. Success haptic on create.

**Accessibility:** labels above inputs, the chip group is a radio group.

**Analytics:** `child_profile_created` (`adopted_guest = false`, `class_band`).

**Web (≥ 600 px):** not in Phase 1 (managed children live on phones and tablets). Parents can see children on web in Parent mode later (Phase 3).

**Mock priority:** P1.

---

### AUTH-27 · Link to your guardian
**Purpose:** Let a teen confirm that a parent who started the link really is their guardian. Ships with SET-18. **Main action:** Yes, link.
**Entry → exits:** QR or link from SET-18 "Link a teen" on the parent's phone, opened on the teen's phone → AUTH-02 if the teen isn't signed in → AUTH-20 on the parent's phone, back.

**Layout (top to bottom):**
1. Full screen, top bar with back.
2. Illustration 160 (reuses AUTH-18's scene).
3. Title in `title`.
4. Body in `body`: what the guardian will and won't see.
5. [Yes, link], Button primary. [This isn't my parent], Button ghost.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Link {parent_first_name} as your guardian? | {parent_first_name} को अपना अभिभावक जोड़ें? |
| Body | They'll see your weekly progress and choose which features you can use. They can't read your notes or tutor chats. | वे आपकी हफ़्ते की प्रोग्रेस देख पाएँगे और तय करेंगे कि आप कौन-सी सुविधाएँ इस्तेमाल करें। वे आपके नोट्स या ट्यूटर चैट नहीं पढ़ सकते। |
| Yes | Yes, link | हाँ, जोड़ें |
| No | This isn't my parent | ये मेरे माता-पिता नहीं हैं |
| No result | OK, nothing was linked. | ठीक है, कुछ नहीं जोड़ा गया। |
| Offline | Connect to the internet to answer. | जवाब देने के लिए इंटरनेट से जुड़ें। |
| Failed | That didn't go through. Try again in a moment. | यह नहीं हो पाया। थोड़ी देर में फिर कोशिश करें। |
| Settings row | {parent_first_name} wants to link as your guardian | {parent_first_name} आपके अभिभावक के रूप में जुड़ना चाहते हैं |

**Illustration slots:** reuses AUTH-18's `sunny-scene`.

**States:** default; adult teen (18+): "You're 18 or older, so you don't need a guardian." and the link ends; expired; offline.

**Interaction and motion:** standard.

**Accessibility:** standard.

**Analytics:** `guardian_consent_requested` (`channel = link`, initiated by the guardian), then `guardian_consent_decided`.

**Web (≥ 600 px):** centred column.

**Mock priority:** P2.

---

### AUTH-28 · Restore a child on this device
**Purpose:** Let a signed-in parent bring one or more of their children back on a new or reset phone. Phase 1, account part only (TRD §18 D9); the Parent mode dashboard is Phase 3. **Main action:** Bring back.
**Entry → exits:** AUTH-24 restore entry, AUTH-25 "Ask a grown-up" card via SET-13 → ENT-09 (restoring each child) → AUTH-25 (several profiles) or HOME-06; AUTH-26 from the empty state.

**Layout (top to bottom):**
1. Full screen, top bar with back, kicker "For parents and guardians".
2. Title in `title`.
3. A list of child cards (radius 20, `surface`, min height 80): pet 56, first name in `heading`, class in `caption`, and a checkbox on the right (48 target). Children already on this phone show "On this phone" and no checkbox.
4. [Bring back], Button primary, pinned, disabled until one is ticked.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Whose progress should come back to this phone? | इस फ़ोन पर किसकी प्रोग्रेस वापस लाएँ? |
| On this phone | On this phone | इस फ़ोन पर है |
| Bring back | Bring back | वापस लाएँ |
| Empty title | No children on this account yet | इस अकाउंट में अभी कोई बच्चा नहीं है |
| Empty action | Add a child | बच्चा जोड़ें |
| Wrong account hint | Not seeing your child? You may have used a different Google account. | आपका बच्चा नहीं दिख रहा? शायद आपने कोई दूसरा Google अकाउंट इस्तेमाल किया था। |
| Switch | Use another account | दूसरा अकाउंट इस्तेमाल करें |

**Illustration slots:** pets per child, 1:1, happy. Empty state: `empty-state`, 4:3, the cat and dog peeking into an empty basket, gentle. Alt text intent: "No profiles yet".

**States:** default; empty; loading list; offline (disabled with the offline line); one child (pre-ticked).

**Interaction and motion:** standard. After Bring back, each child's session is created and ENT-09 runs.

**Accessibility:** checkboxes have the child's name as the label.

**Analytics:** `child_restored` (`count`).

**Web (≥ 600 px):** not in Phase 1.

**Mock priority:** P1.

---

## Web and shared states

### AUTH-29 · Web sign-in page
**Purpose:** The web app's sign-in page, reached from the marketing site, a restore on web, or any web link that needs an account. **Main action:** Continue with Google (or One Tap).
**Entry → exits:** marketing site "Sign in" (`app.<domain>/login?next=`), web AUTH-02 `restore`, `/auth/callback` (redirect return) → `next` route, HOME-01, ONB-02 (brand-new account), AUTH-10, AUTH-30.

**Layout (top to bottom):**
1. Top: logo lockup (DESIGN §12) left, language toggle right.
2. At ≥ 1024 px a two-column layout: left, the illustration on a `primaryTint` panel; right, the content column (400 wide). Below 600 px a single column with the small illustration above the title.
3. Title in `display`.
4. Subtitle in `body` `inkMuted`.
5. The Google-rendered button, personalised ("Continue as {name}") for a Google session that used the site before. One Tap with `context: 'signin'` also appears (top right on desktop Chrome, through FedCM); with one returning account and no sign-out it may sign in automatically. This is the only page where the marketing site sends people for One Tap (flow §5.3).
6. Link row: "New here? Start learning free" (to onboarding).
7. Link: "Used Apple on your iPhone?" (AUTH-10).
8. Trust line and legal footer.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Sign in to {app_name} | {app_name} में साइन इन करें |
| Trust line | We never call you or share your email. | हम आपको कभी कॉल नहीं करेंगे और आपका ईमेल किसी से शेयर नहीं करेंगे। |
| Subtitle | Pick up where you left off, on any device. | किसी भी डिवाइस पर वहीं से शुरू करें जहाँ छोड़ा था। |
| New here | New here? Start learning free | पहली बार? मुफ़्त में पढ़ना शुरू करें |
| Apple link | Used Apple on your iPhone? | iPhone पर Apple से साइन इन किया था? |
| Callback loading | Signing you in… | साइन इन हो रहा है… |
| In-app browser title | Open this page in Chrome or Safari | यह पेज Chrome या Safari में खोलें |
| In-app browser body | Google sign-in doesn't work inside this app's browser. | इस ऐप के ब्राउज़र में Google साइन-इन नहीं चलता। |
| Open in Chrome (Android) | Open in Chrome | Chrome में खोलें |
| Copy link | Copy link | लिंक कॉपी करें |

**Illustration slots:** `sunny-scene`, 3:2, a student at a desk with a laptop and the cat and dog beside a plant, warm. Alt text intent: "A student learning with their buddies". Decorative. Below 600 px it stays, as a small image (about 120 tall) above the title, rather than being hidden.

**States:** default; One Tap shown or not (button always present); callback loading; in-app browser; iOS browser (our branded button with the redirect flow); offline (button disabled, service-worker offline line); already signed in (redirects to `next` at once).

**Interaction and motion:** page fade-in with `base`. No auto-redirect after sign-in errors.

**Accessibility:** one `h1`. The Google iframe button is reachable by Tab; the page's own controls follow it. One Tap is never the only way in.

**Analytics:** `auth_prompt_shown` (`reason = site_sign_in`), `auth_onetap_not_displayed`, `auth_provider_result` (`flow = onetap | button | redirect`).

**Web (≥ 600 px):** this is a web screen; the layout above covers all widths.

**Mock priority:** P0.

---

### AUTH-30 · Sign-in problems
**Purpose:** Say plainly what went wrong and offer the one thing that helps. **Main action:** depends on the error (usually Try again).
**Entry → exits:** AUTH-01, 02, 04, 11, 15, 19, 22, 24, 29 → retry, browser fallback, system settings, SET-23 support, back.

**Layout (top to bottom):**
1. Shown in place of the provider buttons inside the current sheet or page (not a new sheet).
2. Pet line with a gentle pose (or an icon 32 on guardian-facing screens).
3. Error title in `heading`.
4. One line in `body`.
5. One action button (Button primary or secondary), plus [Back] ghost.
6. For server errors: a `caption` `inkMuted` "Code {trace_short}" (the first 8 characters of the trace id, UX_FLOW §5).

**Copy:**
| Key | EN | HI |
|---|---|---|
| Offline title | You're offline | आप ऑफ़लाइन हैं |
| Offline line | No internet. Your progress stays on this phone, and we'll save it when you're back online. | इंटरनेट नहीं है। प्रोग्रेस इसी फ़ोन पर है, ऑनलाइन होते ही सेव कर देंगे। |
| Network title | Couldn't reach Google | Google से कनेक्ट नहीं हो पाया |
| Network line | Try again in a moment. | थोड़ी देर में फिर कोशिश करें। |
| Try again | Try again | फिर से कोशिश करें |
| No Play services title | Google sign-in needs an update on this phone | इस फ़ोन पर Google साइन-इन को अपडेट चाहिए |
| No Play services line | We'll sign you in through your browser instead. | हम इसके बजाय आपके ब्राउज़र से साइन इन कराएँगे। |
| Use browser | Continue in browser | ब्राउज़र में आगे बढ़ें |
| Update Play services | Update Google Play services | Google Play services अपडेट करें |
| No account title | No Google account on this phone | इस फ़ोन पर कोई Google अकाउंट नहीं है |
| No account line | Add one in the next step. It takes a minute. | अगले चरण में एक जोड़ें। इसमें एक मिनट लगता है। |
| Add account | Add a Google account | Google अकाउंट जोड़ें |
| Paused title | This account is paused | यह अकाउंट रोका गया है |
| Paused line | Contact us and we'll help. | हमसे संपर्क करें, हम मदद करेंगे। |
| Contact | Contact support | सहायता से संपर्क करें |
| Too many title | Too many tries | बहुत ज़्यादा कोशिशें |
| Too many line | Please wait a minute, then try again. | कृपया एक मिनट रुकें, फिर कोशिश करें। |
| Clock title | Your phone's date and time look wrong | आपके फ़ोन की तारीख और समय गलत लग रहे हैं |
| Clock line | Fix them in Settings, then try again. | सेटिंग्स में ठीक करें, फिर कोशिश करें। |
| Open settings | Open settings | सेटिंग्स खोलें |
| Our side title | Something went wrong on our side | हमारी तरफ़ से कुछ गड़बड़ हुई |
| Our side line | Try again in a bit. | थोड़ी देर में फिर कोशिश करें। |
| In-app browser | See AUTH-29 | AUTH-29 देखें |
| Back | Back | वापस |
| Pet line | Oops! Let's try that again. | उफ़! चलिए, फिर से कोशिश करें। |

**Illustration slots:** pet avatar in the Pet line only (curious pose). No large art.

**States:** each error above is a state. Cancel is not an error (no AUTH-30).

**Interaction and motion:** cross-fade in place with `base`. Warning haptic only for "paused". Retry backs off (the button shows "Try again in {s}s" for rate limits).

**Accessibility:** the title is announced as an alert. The trace code is read as letters and digits.

**Analytics:** `auth_provider_result` (`result = error`, `error_code`), `auth_fallback_used`.

**Web (≥ 600 px):** same blocks inside AUTH-29 or the dialog.

**Mock priority:** P0 (offline, no Play services, our side).

---

### AUTH-31 · Session ended
**Purpose:** Tell a signed-in student that they need to sign in again, without losing what's on the phone. **Main action:** Sign in again.
**Entry → exits:** any screen when a refresh fails with an auth error (flow §6.9) → AUTH-02 (`session_expired`), AUTH-09 (different account), origin with a banner on [Not now].

**Layout (top to bottom):**
1. Sheet at 40%, not dismissible by swipe.
2. Icon in a 64 circle on `primaryTint`: `Key` 32 in `primary`.
3. Title in `heading`.
4. Body in `body`.
5. [Sign in again], Button primary. [Not now], Button ghost.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Please sign in again | कृपया फिर से साइन इन करें |
| Body | For your safety, you were signed out. Your progress on this phone is kept until you sign in. | सुरक्षा के लिए आपको साइन आउट कर दिया गया। साइन इन करने तक इस फ़ोन पर आपकी प्रोग्रेस रखी रहेगी। |
| Sign in again | Sign in again | फिर से साइन इन करें |
| Not now | Not now | अभी नहीं |
| Banner (after Not now) | Sign in to save your progress | अपनी प्रोग्रेस सेव करने के लिए साइन इन करें |

**Illustration slots:** none.

**States:** default. After [Not now], learning continues and events stay in the outbox; a slim banner (36, `warningTint`, `warningText`, `CloudSlash`) sits under the top bar on main screens and opens AUTH-02. Managed child profile: the copy is replaced by "Ask a grown-up to sign in again" and opens SET-13.

**Interaction and motion:** standard sheet. No haptic.

**Accessibility:** announced as a dialog. The banner is a button.

**Analytics:** `auth_session_ended` (`cause`).

**Web (≥ 600 px):** centred dialog.

**Mock priority:** P1.

---

## Returning students and save state

### AUTH-32 · Returning-account card
**Purpose:** On Android, when a silent check finds a Google account on the phone that used Smriti before, offer one tap to bring everything back, while new students see nothing at all. Phase 1, behind `onb.returning_account_check` (an A/B test owned by onboarding). **Main action:** Continue with Google.
**Entry → exits:** ONB-01 on first launch, Android 14 and later, after the silent query finds a candidate (flow §6.12; onboarding doc §6.9.1) → AUTH-04 (`reason = restore`, no AUTH-02) → ENT-09 → AUTH-06 restore card → HOME-01 (or AUTH-25); [Close] → ONB-01 without the card; AUTH-09 when the account is a parent's.

**Layout (top to bottom):**
1. A card on `surfaceRaised`, radius 20, padding 16, full width minus 20 per side, placed above ONB-01's language buttons. ONB-01's own layout is unchanged around it and both language buttons stay usable.
2. Top row: the student-agnostic pets (cat and dog together, 48) on the left, the title in `heading`, and a close button (`X`, 24, 48 target, label "Close") on the right.
3. One line in `body` `inkMuted`.
4. 16 gap. Continue with Google (§0.2), full card width.
5. Trust line in `caption` `inkMuted` with `ShieldCheck` 16.

The card never names an account. The silent check can't tell us which account it found; Google's own sheet shows "Continue as {name}" after the tap.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Title | Welcome back! | फिर से स्वागत है! |
| Line | Continue with Google to bring back your streak, pet and notes. | अपनी स्ट्रीक, पेट और नोट्स वापस लाने के लिए Google के साथ जारी रखें। |
| Google button | Continue with Google | Google के साथ जारी रखें |
| Trust line | We never call you or share your email. | हम आपको कभी कॉल नहीं करेंगे और आपका ईमेल किसी से शेयर नहीं करेंगे। |
| Close a11y | Close, start as a new student | बंद करें, नए छात्र की तरह शुरू करें |

ONB-01 shows the card in the device language (Hindi for `hi-*`, English otherwise), like the rest of ONB-01 before a language is picked.

**Illustration slots:** `pet-cat` and `pet-dog` together (the onboarding pair, no student pet exists yet), 1:1, waving, happy. Alt text intent: "The cat and dog waving hello".

**States:**
- **No candidate, Android 13 and below, iOS, web, offline, timeout, flag off:** the card doesn't exist; ONB-01 is exactly as onboarding specifies.
- **Candidate:** the card fades in once ONB-01 has settled (it never pushes ONB-01's content after the student has started reading; if the answer arrives after the student tapped a language, the card isn't shown).
- **Loading:** after the tap, the button shows its spinner; Google's sheet opens over ONB-01.
- **Cancelled in Google's sheet:** back to ONB-01 with the card still there.
- **Error:** AUTH-30 inline in the card.
- **Dark mode:** `surfaceRaised` card, Google dark theme.

**Interaction and motion:** fades in with `base` and no slide (nothing on ONB-01 moves). [Close] collapses the card with `base` and hides it for this install. Light haptic on the button. Reduced motion: appears without a fade.

**Accessibility:** the card is a labelled region ("Welcome back"). It comes after ONB-01's title in focus order and before the language buttons. The close button's label says what it means ("start as a new student").

**Analytics:** `auth_returning_check` (`result`); `returning_card_shown` and `returning_card_action` (onboarding doc); `auth_provider_tapped` (`flow = bottom_sheet`).

**Web (≥ 600 px):** not shown (flow §5.3: no One Tap on a first visit).

**Mock priority:** P1.

---

### AUTH-33 · Save-state chip
**Purpose:** Show, always truthfully, whether this student's progress is safe, in one small reusable component that ME-01, SET-02 and LES-08 embed (flow §6.13, research §11.7). It is a component, not a screen. **Main action:** tap (guest: save; signed in: see the account).
**Entry → exits:** embedded in the ME-01 header, the SET-02 account row, LES-08 (one line, first lesson complete after the first sign-in only), and ONB-14 (onboarding doc) → AUTH-01 (`save_progress`) for guests, SET-02 for signed-in students.

**Layout (top to bottom):**
1. Chip status style (DESIGN §5): height 32 (48 tap target), radius 999, horizontal padding 12, icon 16 then 6 gap then text in `label`.
2. Colours by state, from tokens: `guest` on `warningTint` with `warningText`; `saving` on `surfaceSunken` with `inkMuted`; `saved` and `saved_offline` on `successTint` with `successText`.
3. Text truncates the email in the middle (`r…@gmail.com`) when the chip would exceed its container; the full text is in the accessibility label.
4. On LES-08 the same content shows as a one-line row (icon 20 plus text in `body`), not a chip.

**Copy:**
| Key | EN | HI |
|---|---|---|
| `guest` | Only on this phone | सिर्फ़ इसी फ़ोन पर |
| `saving` | Saving… | सेव हो रहा है… |
| `saved` | Saved to {email} | {email} में सेव है |
| `saved_offline` | Saved. New progress syncs when online | सेव है। नई प्रोग्रेस ऑनलाइन होने पर सिंक होगी |
| `saved`, Apple | Saved to your Apple account | आपके Apple अकाउंट में सेव है |
| `saved`, managed child | Saved by your grown-up | आपके बड़ों ने सेव किया है |
| `saved`, managed child, little learner | Saved by your grown-up | तुम्हारे बड़ों ने सेव किया है |
| `guest` a11y hint | Only on this phone. Double-tap to save it to your Google account. | सिर्फ़ इसी फ़ोन पर। Google अकाउंट में सेव करने के लिए डबल-टैप करें। |

Icons (Phosphor): `CloudSlash` (`guest`), `CloudArrowUp` (`saving`), `CloudCheck` (`saved`, `saved_offline`).

**Illustration slots:** none (icon only).

**States:** `guest`, `saving`, `saved`, `saved_offline` (flow §6.13 conditions), plus the Apple and managed-child text variants. With `minor.defer_sync_until_consent` on, a minor stays `guest` until consent. Dark mode: the Night Colour versions of the same tokens.

**Interaction and motion:** state changes cross-fade the icon and text with `fast`; `saving` doesn't spin or pulse (calm, and reduced-motion safe). `saving` never flickers: it shows only after the outbox has had events for `fast`, and goes to `saved` only when the outbox is empty. Tap: light haptic.

**Accessibility:** never colour alone (icon plus text). The chip is a button with its full text as the label ("Saved to {email}"). State changes are announced politely only when the student is on that screen and the change is to `saved` or `guest`, so screen readers aren't flooded during sync.

**Analytics:** `auth_save_chip_tapped` (`state`, `surface`). The email is never sent.

**Web (≥ 600 px):** the same chip in the web ME-01 header and SET-02.

**Mock priority:** P0 (all four states, EN and HI, light and dark).

---

### WEB-07 · Web guardian and sign-in messages
**Purpose:** The short lines the web app shows on the guardian consent screens (AUTH-18 to AUTH-22), AUTH-08 and Parent mode (AUTH-24, SET-14) for the server's answers that the blocks above describe only in words, and for a learner whose first name isn't known yet.

**Copy:**
| Key | EN | HI |
|---|---|---|
| Merge done toast | Your progress has been added | आपकी प्रोग्रेस जोड़ दी गई है |
| Guardian title no name | Hello! Your child wants to use {feature} on {app_name} | नमस्ते! आपका बच्चा {app_name} पर {feature} इस्तेमाल करना चाहता है |
| Your child | your child | आपका बच्चा |
| Is learner | This is {first_name}'s account. Please use your own. | यह {first_name} का अकाउंट है। कृपया अपना अकाउंट इस्तेमाल करें। |
| Is learner no name | This is the student's account. Please use your own. | यह छात्र का अकाउंट है। कृपया अपना अकाउंट इस्तेमाल करें। |
| Is minor | This account belongs to someone under 18. A parent or guardian needs to use their own account. | यह अकाउंट 18 साल से कम उम्र के किसी व्यक्ति का है। माता-पिता या अभिभावक को अपना अकाउंट इस्तेमाल करना होगा। |
| Identity required | Please sign in with Google to give your OK. | सहमति देने के लिए कृपया Google से साइन इन करें। |
| Handoff expired | This took too long. Hand the phone back to start again. | इसमें बहुत समय लग गया। फिर से शुरू करने के लिए फ़ोन वापस दें। |
| Review answered | You've already answered this request. | आप इस अनुरोध का जवाब पहले ही दे चुके हैं। |
| Review expired | This request has expired. Ask {first_name} to send a new one. | इस अनुरोध की समय-सीमा खत्म हो गई। {first_name} से नया भेजने को कहें। |
| Declined retry date | You can ask again on {date}. | आप {date} को फिर से पूछ सकते हैं। |
| Blocked | Your guardian said no for now. You can ask again on {date}. | आपके अभिभावक ने अभी के लिए मना किया है। आप {date} को फिर से पूछ सकते हैं। |
| Offline ask | Connect to the internet to ask. | पूछने के लिए इंटरनेट से जुड़ें। |
| Ask failed | We couldn't send the request. Try again in a moment. | अनुरोध नहीं भेजा जा सका। थोड़ी देर में फिर से कोशिश करें। |
| Link offline | Offline. We'll check when you're back online. | आप ऑफ़लाइन हैं। ऑनलाइन होते ही हम देखेंगे। |
| Parent sign out | Sign out of Parent mode | पेरेंट मोड से साइन आउट करें |

**Mock priority:** P1.

---

## Appendix: P0 screens for the visual mocks

AUTH-01 (`lesson_3`, `streak_day_2`, with [Later] as a full-size button), AUTH-02 (`social`, `start_trial` eligible and not eligible, `restore`), AUTH-04 (Credential Manager over AUTH-01, then signing in; iOS prep line), AUTH-06 (link toast and restore card), AUTH-08, AUTH-12 (default and unsynced), AUTH-13, AUTH-18, AUTH-19 (student and guardian views), AUTH-20, AUTH-24, AUTH-25, AUTH-29 (desktop and phone), AUTH-30 (offline, no Play services, our side), AUTH-33 (all four states). P1 additions this revision: AUTH-32.
