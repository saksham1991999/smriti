import type { AgeBand } from '../sync/types';
import type { LocalDate } from '../time';

/**
 * Age bands and the learner experience both apps derive from them (Phase 3: classes 1–8 and
 * the under-10 experience). Sources: onboarding §6.2 (bands, defaults), §6.3 (little learner
 * path), learn §5.6 (HOME-06), me-money §3.1, §3.3, §4.7 (under-10 Me, pet clamp, parent mode),
 * R3 (तुम only for little learners), R14 (three tabs, no tutor button, no prices), R15 (children
 * see "Ask a grown-up" instead of a paywall), R46 (four tabs in Phase 1, Friends in Phase 2).
 *
 * Two switches, kept apart on purpose:
 *
 * - **Little learner mode** (`littleLearner`): class 1–5 with Phase 3 on (`feature.little_learner`).
 *   HOME-06, three tabs, story path, read-aloud, तुम.
 * - **Gentle mode** (`gentle`): the under-10 rules for the pet and plant (never below sleepy,
 *   plant never past droopy). It follows the `u10` band too, so a child under 10 by birth year
 *   gets gentle states even in Phase 1, before the little learner Home exists (onboarding §6.2:
 *   "`u10` defaults apply without the little learner Home").
 */

/** School classes that make a little learner (onboarding §6.2, learn §5.6). */
export const LITTLE_LEARNER_CLASSES = { min: 1, max: 5 } as const;
/** Classes the app knows (school content runs class 1 to 12; Phase 3 adds 1–8). */
export const SCHOOL_CLASSES = { min: 1, max: 12 } as const;

export function isLittleLearnerClass(schoolClass: number | null | undefined): boolean {
  return (
    typeof schoolClass === 'number' &&
    Number.isInteger(schoolClass) &&
    schoolClass >= LITTLE_LEARNER_CLASSES.min &&
    schoolClass <= LITTLE_LEARNER_CLASSES.max
  );
}

/**
 * The band a school class implies (onboarding §6.2): class 1–5 `u10`, 6–7 `10_12`, 8–12 `13_17`.
 * A conservative default that errs young; an 18-year-old in class 12 corrects it once in SET-02.
 */
export function bandForClass(schoolClass: number): AgeBand {
  if (!Number.isInteger(schoolClass) || schoolClass < SCHOOL_CLASSES.min || schoolClass > SCHOOL_CLASSES.max) {
    throw new RangeError(`School class must be ${SCHOOL_CLASSES.min}–${SCHOOL_CLASSES.max}, got ${schoolClass}`);
  }
  if (schoolClass <= LITTLE_LEARNER_CLASSES.max) return 'u10';
  if (schoolClass <= 7) return '10_12';
  return '13_17';
}

/** ONB-04's answer: a birth year, and the month only in the year the student turns 18. */
export interface BirthAnswer {
  year: number;
  /** 1–12, or null when not asked or not answered. */
  month?: number | null;
}

/**
 * Whole years on `today`. An unknown month is the younger option (onboarding §6.2): the
 * birthday is taken as the last day of the year, and a known month as its last day.
 */
export function ageOn(birth: BirthAnswer, today: LocalDate): number {
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const month = birth.month && birth.month >= 1 && birth.month <= 12 ? birth.month : 12;
  const lastDay = new Date(Date.UTC(birth.year, month, 0)).getUTCDate();
  let years = ty - birth.year;
  if (tm < month || (tm === month && td < lastDay)) years -= 1;
  return Math.max(0, years);
}

export function bandForAge(age: number): AgeBand {
  if (age < 10) return 'u10';
  if (age < 13) return '10_12';
  if (age < 18) return '13_17';
  return '18p';
}

export interface AgeBandInput {
  /** The server's `profile.age_band`, once synced: it always wins. */
  storedBand?: AgeBand | null;
  schoolClass: number | null;
  /** ONB-04: a birth, "declined" (Prefer not to say), or null when never asked. */
  birth: BirthAnswer | 'declined' | null;
}

/**
 * The band to apply from the first event (onboarding §6.2). A picked class decides (ONB-04 is
 * not asked then); otherwise the birth year; "Prefer not to say" gives `13_17`. Null means
 * unknown, which every rule treats as a minor.
 */
export function resolveAgeBand(input: AgeBandInput, today: LocalDate): AgeBand | null {
  if (input.storedBand) return input.storedBand;
  if (input.schoolClass !== null) return bandForClass(input.schoolClass);
  if (input.birth === 'declined') return '13_17';
  if (input.birth === null) return null;
  return bandForAge(ageOn(input.birth, today));
}

export type TabKey = 'learn' | 'labs' | 'practice' | 'friends' | 'me';
/** APP_FLOW §1 target. Friends arrives in Phase 2 (R46). */
export const ALL_TABS: readonly TabKey[] = ['learn', 'labs', 'practice', 'friends', 'me'];
/** R14: Learn, Labs, Me. No Practice (mocks, PYQs) and no Friends. */
export const LITTLE_LEARNER_TABS: readonly TabKey[] = ['learn', 'labs', 'me'];

/** Parent-mode settings for one child (SET-14, SET-16). Defaults are the doc's "off". */
export interface ParentSettings {
  /** SET-14: the chips-only little learner tutor (AI-02 variant). Off by default (R14). */
  tutorButton: boolean;
  /** SET-14: the mnemonic forge as "Picture rhymes" (memory-labs Q8). Off by default. */
  pictureRhymes: boolean;
}

export const DEFAULT_PARENT_SETTINGS: ParentSettings = { tutorButton: false, pictureRhymes: false };

export interface LearnerFacts {
  ageBand: AgeBand | null;
  schoolClass: number | null;
  /** A managed child (created by a parent, AUTH-26; no Google account of its own). */
  managedChild?: boolean;
}

export interface ExperienceOptions {
  /** `feature.little_learner` (Phase 3). */
  littleLearnerEnabled: boolean;
  /** Phase 2 Friends tab is live (R46). The tab shows a lock until consent (SOC-02). */
  friendsEnabled?: boolean;
  parent?: ParentSettings;
}

export type AnalyticsLevel = 'learning_only' | 'reduced' | 'full';

export interface LearnerExperience {
  littleLearner: boolean;
  gentle: boolean;
  /** R3: the Hindi register. Use the `_little_learner` key variants when `tum`. */
  register: 'aap' | 'tum';
  home: 'HOME-01' | 'HOME-06';
  tabs: readonly TabKey[];
  /** Rupee prices anywhere (R14, R15: none for under-10s). */
  showPrices: boolean;
  /** `ask_grown_up`: LRN-05 / PAY gate variant for under-13s (learn §6.2 "Children"). */
  paywall: 'standard' | 'ask_grown_up';
  tutorButton: boolean;
  tutorVariant: 'standard' | 'chips_only';
  /** Search, gems, leagues, the exam switcher and the Deep dive / Quick revision choice. */
  search: boolean;
  gems: boolean;
  leagues: boolean;
  examSwitcher: boolean;
  topicModeChoice: boolean;
  /** Duel, squad and invite links (dropped for little learners; topic and lab links kept). */
  socialDeepLinks: boolean;
  /** Who signs in: under-13s only through a parent (AUTH-24); never a login sheet for a child. */
  signIn: 'self' | 'parent';
  analytics: AnalyticsLevel;
  /** Every label and pet line is spoken (onboarding §6.3, HOME-06). */
  readAloud: boolean;
  /** MEM-19 "Make it stick". */
  mnemonicForge: boolean;
  /** SET-16 limits and SET-19 apply on this device. */
  timeLimits: boolean;
  /** Little learners default to light unless the parent changes it (HOME-06). */
  defaultTheme: 'system' | 'light';
}

export function isGentle(facts: Pick<LearnerFacts, 'ageBand' | 'schoolClass'>, littleLearnerEnabled: boolean): boolean {
  return facts.ageBand === 'u10' || (littleLearnerEnabled && isLittleLearnerClass(facts.schoolClass));
}

export function learnerExperience(facts: LearnerFacts, opts: ExperienceOptions): LearnerExperience {
  const little = opts.littleLearnerEnabled && isLittleLearnerClass(facts.schoolClass);
  const gentle = isGentle(facts, opts.littleLearnerEnabled);
  const parent = opts.parent ?? DEFAULT_PARENT_SETTINGS;
  const band = facts.ageBand;
  const under13 = band === 'u10' || band === '10_12' || little;
  const tabs = little ? LITTLE_LEARNER_TABS : ALL_TABS.filter((t) => t !== 'friends' || opts.friendsEnabled === true);
  return {
    littleLearner: little,
    gentle,
    register: little ? 'tum' : 'aap',
    home: little ? 'HOME-06' : 'HOME-01',
    tabs,
    showPrices: !(band === 'u10' || little),
    paywall: under13 ? 'ask_grown_up' : 'standard',
    tutorButton: little ? parent.tutorButton : true,
    tutorVariant: little ? 'chips_only' : 'standard',
    search: !little,
    gems: !little,
    leagues: !little,
    examSwitcher: !little,
    topicModeChoice: !little,
    socialDeepLinks: !little,
    signIn: under13 ? 'parent' : 'self',
    analytics: band === 'u10' || little ? 'learning_only' : band === '18p' ? 'full' : 'reduced',
    readAloud: little,
    mnemonicForge: little ? parent.pictureRhymes : true,
    timeLimits: little || facts.managedChild === true,
    defaultTheme: little ? 'light' : 'system',
  };
}

/**
 * The key to translate in the learner's register (R3). Mirrors `littleLearnerVariants` in
 * `@smriti/i18n` (`{key}_little_learner`, then `little_learner_{slug}`), so code that holds only a
 * `t` and `exists` (widgets, notifications) picks the same string as `Translator.tr`.
 */
export function registerKey(key: string, register: LearnerExperience['register'], exists: (key: string) => boolean): string {
  if (register !== 'tum') return key;
  const m = /^([^:]+):([^.]+)\.(.+)$/.exec(key);
  if (!m || m[3]?.includes('little_learner')) return key;
  const [, ns, screen, slug] = m;
  for (const candidate of [`${ns}:${screen}.${slug}_little_learner`, `${ns}:${screen}.little_learner_${slug}`]) {
    if (exists(candidate)) return candidate;
  }
  return key;
}
