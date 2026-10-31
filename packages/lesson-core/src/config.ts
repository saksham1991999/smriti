/**
 * Player settings. Values come from @smriti/config flags at runtime; lesson-core never invents
 * them. Only the values fixed by rulings have defaults here. XP amounts are owner flags (`xp.*`,
 * learn Q6), so the host must pass them.
 */
export interface XpConfig {
  /** `xp.lesson_first_try`: a right answer on the first try. */
  firstTry: number;
  /** `xp.lesson_second_try`: a right answer on the second try. */
  secondTry: number;
  /** `xp.lesson_attempt`: an answer that stayed wrong, or "I don't know yet" (trying still counts). */
  attempt: number;
  /** `xp.lesson_complete`: finishing a bite, a Quick Revision or a check. */
  complete: number;
  /** `xp.combo_bonus`: the combo celebration, once per lesson. */
  combo: number;
}

export interface LessonConfig {
  /** `free.deep_dive_preview_cards` (R16). */
  previewCards: number;
  /** `learn.combo_streak_len` (A19). */
  comboStreakLen: number;
  /** `learn.fix_mistakes_max` (owner flag; null means no cap). */
  fixMistakesMax: number | null;
  /** `learn.test_out_questions_per_topic` (owner flag). */
  testOutQuestionsPerTopic: number | null;
  /** `learn.find_level_questions` (R27). */
  findLevelQuestions: number;
  /** `learn.resume_restart_days` (owner flag; null: never offer a restart sheet for age alone). */
  resumeRestartDays: number | null;
  xp: XpConfig;
}

/** Values fixed by rulings (R16, A19, R27). Everything else comes from the host. */
export const RULED_DEFAULTS = {
  previewCards: 4,
  comboStreakLen: 5,
  findLevelQuestions: 5,
} as const;

export function lessonConfig(
  xp: XpConfig,
  overrides: Partial<Omit<LessonConfig, "xp">> = {},
): LessonConfig {
  return {
    previewCards: RULED_DEFAULTS.previewCards,
    comboStreakLen: RULED_DEFAULTS.comboStreakLen,
    findLevelQuestions: RULED_DEFAULTS.findLevelQuestions,
    fixMistakesMax: null,
    testOutQuestionsPerTopic: null,
    resumeRestartDays: null,
    ...overrides,
    xp,
  };
}
