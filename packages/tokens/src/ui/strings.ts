// Fixed strings that the shared components render themselves (a11y labels, rating labels, the Google label).
// Screen copy never lives here: screens pass their text as props from packages/i18n.
// Hindi follows R3 (आप register, no gendered verb forms). Where docs/ux gives a string, it is copied from there.
// Keys mirror the `ui.*` namespace so packages/i18n can take this catalogue over unchanged.

export type Locale = "en" | "hi";

export const uiStringsEn = {
  "common.back": "Back",
  "common.close": "Close",
  "common.dismiss": "Dismiss",
  "common.loading": "Loading",
  "common.moreOptions": "More options",
  "common.on": "On",
  "common.off": "Off",

  "continue.resume": "Resume",

  "streak.pill": "{n}-day streak",
  "streak.freezeReady": "Freeze ready",
  "streak.freezeEmpty": "Empty freeze slot",
  "streak.freezesReady.one": "{n} freeze ready",
  "streak.freezesReady.other": "{n} freezes ready",
  "streak.freezesReady.zero": "No freezes ready",
  "streak.goal": "{done} of {target} min today",
  "streak.atRisk": "Streak at risk",

  "option.selected": "Selected",
  "option.correct": "Correct",
  "option.wrong": "Wrong",

  "confidence.label": "How sure are you? (optional)",
  "confidence.sure": "Sure",
  "confidence.half": "50:50",
  "confidence.guess": "Guess",

  "rating.again": "Again",
  "rating.hard": "Hard",
  "rating.good": "Good",
  "rating.easy": "Easy",
  "rating.a11y": "{label}, next review in {interval}",

  "progress.percent": "{percent}% done",
  "progress.segments": "{done} of {total}",

  "pet.says": "{pet_name} says: {text}",

  "formula.addToVault": "Add to formula vault",
  "formula.inVault": "In your formula vault",
  "formula.symbols": "Tap a symbol to see what it means",
  "formula.loading": "Formula is loading",

  "palette.notVisited": "Not visited",
  "palette.notAnswered": "Not answered",
  "palette.answered": "Answered",
  "palette.marked": "Marked for review",
  "palette.answeredMarked": "Answered and marked for review",
  "palette.cell": "Question {n}, {state}",
  "palette.current": "current question",

  "picker.placeholder": "Choose",

  "meter.empty": "almost empty",
  "meter.quarter": "about a quarter full",
  "meter.half": "about half full",
  "meter.threeQuarters": "about three quarters full",
  "meter.full": "full",
  "meter.a11y": "{label}: {state}, {amount}",

  "dayDots.done": "done",
  "dayDots.today": "today",
  "dayDots.todo": "to do",

  "saveState.guest": "Only on this phone",
  "saveState.saving": "Saving…",
  "saveState.saved": "Saved to {email}",
  "saveState.savedApple": "Saved to your Apple account",
  "saveState.savedManaged": "Saved by your grown-up",
  "saveState.savedOffline": "Saved. New progress syncs when online",
  "saveState.guestHint": "Only on this phone. Double-tap to save it to your Google account.",

  "trial.today": "Today: {price}",
  "trial.reminder": "{date}: we remind you by push and email",
  "trial.renew": "{date}: {price} starts",
  "trial.cancel": "Cancel anytime in 2 taps from Your plan.",
  "trial.notEligible": "{date}: next {price}. Cancel anytime in 2 taps from Your plan.",

  "pro.label": "Pro",
  "pro.a11y": "Pro. Opens a preview",
  "pro.askGrownUp": "Ask a grown-up",

  "timer.left": "Time left",
  "timer.taken": "Time taken",
  "timer.paused": "Paused",
  "timer.warning": "Time running low",
  "timer.final": "Final minutes",

  "sectionTabs.count": "{answered} of {total} answered",
  "sectionTabs.closed": "closed",
  "sectionTabs.notOpen": "not open yet",

  "keypad.answer": "Your answer",
  "keypad.minus": "minus",
  "keypad.decimal": "decimal point",
  "keypad.backspace": "backspace",
  "keypad.clear": "clear",
  "keypad.invalid": "Enter a number",

  "omr.option": "Question {n}, option {x}, {state}",
  "omr.filled": "filled",
  "omr.empty": "empty",
  "omr.flagged": "Flagged",
  "omr.clear": "Clear",

  "score.a11y": "{score} out of {max}",
  "score.of": "of {max}",

  "heat.notEnough": "Not enough data",
  "heat.a11y": "{label}: {percent}% right",

  "timeStrip.showTable": "Show as table",
  "timeStrip.showChart": "Show as chart",
  "timeStrip.question": "Question",
  "timeStrip.time": "Time",
  "timeStrip.target": "Target",
  "timeStrip.result": "Result",
  "timeStrip.targetLine": "Target time",
  "timeStrip.noTarget": "No target time for this paper",
  "timeStrip.right": "Right",
  "timeStrip.wrong": "Wrong",
  "timeStrip.skipped": "Skipped",
  "timeStrip.notScored": "Not scored",
  "timeStrip.bar": "Question {n}, {time}, {result}",

  "leaderboard.you": "You",
  "leaderboard.rankSoon": "Rank soon",
  "leaderboard.notRanked": "Not ranked",
  "leaderboard.a11y": "Rank {rank}, {name}, {score}",

  "citation.dropped": "Dropped",
  "citation.changed": "Answer changed",
  "citation.provisional": "Provisional key",
  "citation.a11y": "From {exam} {year}, {session}. Opens source details.",

  "limit.of": "{used} of {limit}",
  "limit.left": "{remaining} left today",
  "limit.full": "Done for today. Resets at midnight.",
  "limit.getPro": "Get Pro",

  "google.continue": "Continue with Google",
  "google.signIn": "Sign in with Google",
  "apple.continue": "Continue with Apple",
  "auth.trust": "We never call you or share your email.",

  "illustration.loading": "Loading picture",
};

export type UIStringKey = keyof typeof uiStringsEn;
export type UIStrings = Record<UIStringKey, string>;

export const uiStringsHi: UIStrings = {
  "common.back": "वापस",
  "common.close": "बंद करें",
  "common.dismiss": "हटाएँ",
  "common.loading": "लोड हो रहा है",
  "common.moreOptions": "और विकल्प",
  "common.on": "चालू",
  "common.off": "बंद",

  "continue.resume": "आगे पढ़ें",

  "streak.pill": "{n} दिन की स्ट्रीक",
  "streak.freezeReady": "फ़्रीज़ तैयार",
  "streak.freezeEmpty": "फ़्रीज़ की खाली जगह",
  "streak.freezesReady.one": "{n} फ़्रीज़ तैयार",
  "streak.freezesReady.other": "{n} फ़्रीज़ तैयार",
  "streak.freezesReady.zero": "कोई फ़्रीज़ तैयार नहीं",
  "streak.goal": "आज {target} में से {done} मिनट",
  "streak.atRisk": "स्ट्रीक खतरे में",

  "option.selected": "चुना गया",
  "option.correct": "सही",
  "option.wrong": "गलत",

  "confidence.label": "कितना भरोसा है? (वैकल्पिक)",
  "confidence.sure": "पक्का",
  "confidence.half": "50:50",
  "confidence.guess": "अंदाज़ा",

  "rating.again": "फिर से",
  "rating.hard": "कठिन",
  "rating.good": "ठीक",
  "rating.easy": "आसान",
  "rating.a11y": "{label}, अगला रिव्यू {interval} में",

  "progress.percent": "{percent}% पूरा",
  "progress.segments": "{total} में से {done}",

  "pet.says": "{pet_name}: {text}",

  "formula.addToVault": "फ़ॉर्मूला वॉल्ट में जोड़ें",
  "formula.inVault": "आपके फ़ॉर्मूला वॉल्ट में है",
  "formula.symbols": "किसी चिह्न का मतलब देखने के लिए उस पर टैप करें",
  "formula.loading": "फ़ॉर्मूला लोड हो रहा है",

  "palette.notVisited": "नहीं देखे",
  "palette.notAnswered": "उत्तर नहीं दिए",
  "palette.answered": "उत्तर दिए",
  "palette.marked": "रिव्यू के लिए मार्क",
  "palette.answeredMarked": "उत्तर दिए और रिव्यू के लिए मार्क",
  "palette.cell": "प्रश्न {n}, {state}",
  "palette.current": "मौजूदा प्रश्न",

  "picker.placeholder": "चुनें",

  "meter.empty": "लगभग खाली",
  "meter.quarter": "लगभग एक-चौथाई भरा",
  "meter.half": "लगभग आधा भरा",
  "meter.threeQuarters": "लगभग तीन-चौथाई भरा",
  "meter.full": "पूरा भरा",
  "meter.a11y": "{label}: {state}, {amount}",

  "dayDots.done": "पूरा",
  "dayDots.today": "आज",
  "dayDots.todo": "बाकी",

  "saveState.guest": "सिर्फ़ इसी फ़ोन पर",
  "saveState.saving": "सेव हो रहा है…",
  "saveState.saved": "{email} में सेव है",
  "saveState.savedApple": "आपके Apple अकाउंट में सेव है",
  "saveState.savedManaged": "आपके बड़ों ने सेव किया है",
  "saveState.savedOffline": "सेव है। नई प्रोग्रेस ऑनलाइन होने पर सिंक होगी",
  "saveState.guestHint": "सिर्फ़ इसी फ़ोन पर। Google अकाउंट में सेव करने के लिए डबल-टैप करें।",

  "trial.today": "आज: {price}",
  "trial.reminder": "{date}: हम पुश और ईमेल से याद दिलाएँगे",
  "trial.renew": "{date}: {price} शुरू",
  "trial.cancel": "\"आपका प्लान\" से 2 टैप में कभी भी रद्द करें।",
  "trial.notEligible": "{date}: अगले {price}। \"आपका प्लान\" से 2 टैप में कभी भी रद्द करें।",

  "pro.label": "प्रो",
  "pro.a11y": "प्रो। झलक खुलेगी",
  "pro.askGrownUp": "किसी बड़े से पूछें",

  "timer.left": "बचा समय",
  "timer.taken": "लगा समय",
  "timer.paused": "रुका हुआ",
  "timer.warning": "समय कम बचा है",
  "timer.final": "आख़िरी मिनट",

  "sectionTabs.count": "{total} में से {answered} हल किए",
  "sectionTabs.closed": "बंद",
  "sectionTabs.notOpen": "अभी नहीं खुला",

  "keypad.answer": "आपका उत्तर",
  "keypad.minus": "माइनस",
  "keypad.decimal": "दशमलव",
  "keypad.backspace": "मिटाएँ",
  "keypad.clear": "साफ़ करें",
  "keypad.invalid": "कोई संख्या लिखें",

  "omr.option": "प्रश्न {n}, विकल्प {x}, {state}",
  "omr.filled": "भरा हुआ",
  "omr.empty": "खाली",
  "omr.flagged": "चिह्नित",
  "omr.clear": "साफ़ करें",

  "score.a11y": "{max} में से {score}",
  "score.of": "{max} में से",

  "heat.notEnough": "पर्याप्त डेटा नहीं",
  "heat.a11y": "{label}: {percent}% सही",

  "timeStrip.showTable": "टेबल में देखें",
  "timeStrip.showChart": "चार्ट में देखें",
  "timeStrip.question": "प्रश्न",
  "timeStrip.time": "समय",
  "timeStrip.target": "लक्ष्य",
  "timeStrip.result": "नतीजा",
  "timeStrip.targetLine": "लक्ष्य समय",
  "timeStrip.noTarget": "इस पेपर के लिए लक्ष्य समय नहीं है",
  "timeStrip.right": "सही",
  "timeStrip.wrong": "गलत",
  "timeStrip.skipped": "छोड़ा",
  "timeStrip.notScored": "अंक नहीं",
  "timeStrip.bar": "प्रश्न {n}, {time}, {result}",

  "leaderboard.you": "आप",
  "leaderboard.rankSoon": "रैंक जल्द",
  "leaderboard.notRanked": "रैंक नहीं",
  "leaderboard.a11y": "रैंक {rank}, {name}, {score}",

  "citation.dropped": "हटाया गया",
  "citation.changed": "उत्तर बदला गया",
  "citation.provisional": "अस्थायी कुंजी",
  "citation.a11y": "{exam} {year}, {session} से। स्रोत की जानकारी खुलेगी।",

  "limit.of": "{limit} में से {used}",
  "limit.left": "आज {remaining} बाकी",
  "limit.full": "आज के लिए पूरा। आधी रात को फिर से शुरू।",
  "limit.getPro": "Pro लें",

  "google.continue": "Google के साथ जारी रखें",
  "google.signIn": "Google से साइन इन करें",
  "apple.continue": "Apple से जारी रखें",
  "auth.trust": "हम आपको कभी कॉल नहीं करेंगे और आपका ईमेल किसी से शेयर नहीं करेंगे।",

  "illustration.loading": "तस्वीर लोड हो रही है",
};

export const uiStrings: Record<Locale, UIStrings> = { en: uiStringsEn, hi: uiStringsHi };

/** Fill `{name}` placeholders. Unknown placeholders are left as they are, so gaps are visible in QA. */
export function format(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Bound translator for a locale with optional overrides from the app's i18n catalogue. */
export function createTranslator(locale: Locale, overrides?: Partial<UIStrings>) {
  const table: UIStrings = { ...uiStrings[locale], ...(overrides ?? {}) };
  return (key: UIStringKey, vars?: Record<string, string | number>): string => format(table[key], vars);
}
export type Translate = ReturnType<typeof createTranslator>;
