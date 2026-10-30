import type { KeyValueStore } from '@smriti/app-core';

/**
 * Local onboarding state (onboarding §5.3: "Each step writes its answer to the local onboarding
 * state immediately and appends an outbox event"), so a killed app resumes at the same step.
 */
export type OnboardingStep =
  | 'welcome'
  | 'goal'
  | 'class'
  | 'birth_year'
  | 'level'
  | 'buddy'
  | 'seed'
  | 'first_lesson'
  | 'first_win'
  | 'daily_goal'
  | 'reminder'
  | 'done';

export type SelfLevel = 'starting' | 'basics' | 'revising';

export interface OnboardingState {
  step: OnboardingStep;
  locale: 'en' | 'hi' | null;
  /** Exam profile ids, plus `school` and `curious`; the first one is the main goal. */
  goals: string[];
  schoolClass: number | null;
  birthYear: number | 'declined' | null;
  level: SelfLevel | null;
  pet: { species: 'cat' | 'dog'; name: string } | null;
  seedPlanted: boolean;
  firstLesson: { topicId: string; xp: number; accuracy: number | null; minutes: number } | null;
  dailyGoalMinutes: number | null;
  reminderAt: string | null;
  completedAt: string | null;
  installedAt: string;
}

export const ONBOARDING_KEY = 'onboarding.v1';

export function emptyOnboarding(nowIso: string): OnboardingState {
  return {
    step: 'welcome',
    locale: null,
    goals: [],
    schoolClass: null,
    birthYear: null,
    level: null,
    pet: null,
    seedPlanted: false,
    firstLesson: null,
    dailyGoalMinutes: null,
    reminderAt: null,
    completedAt: null,
    installedAt: nowIso,
  };
}

export async function readOnboarding(kv: KeyValueStore, nowIso: string): Promise<OnboardingState> {
  const raw = await kv.get(ONBOARDING_KEY);
  if (!raw) return emptyOnboarding(nowIso);
  try {
    return { ...emptyOnboarding(nowIso), ...(JSON.parse(raw) as Partial<OnboardingState>) };
  } catch {
    return emptyOnboarding(nowIso);
  }
}

export async function writeOnboarding(kv: KeyValueStore, s: OnboardingState): Promise<void> {
  await kv.set(ONBOARDING_KEY, JSON.stringify(s));
}

/** Screen route for each step (expo-router paths). */
export const STEP_ROUTE: Record<OnboardingStep, string> = {
  welcome: '/onboarding',
  goal: '/onboarding/goal',
  class: '/onboarding/goal',
  birth_year: '/onboarding/birth-year',
  level: '/onboarding/level',
  buddy: '/onboarding/buddy',
  seed: '/onboarding/seed',
  first_lesson: '/onboarding/seed',
  first_win: '/onboarding/first-win',
  daily_goal: '/onboarding/daily-goal',
  reminder: '/onboarding/reminder',
  done: '/',
};

/**
 * The question steps before the lesson for the "{n} quick questions" line and the progress bar
 * (onboarding §5.2): Goal (with the class sheet), age, level, buddy. Exam date (ONB-06) is P1
 * and not built yet, so it is not counted.
 */
export function questionSteps(s: Pick<OnboardingState, 'goals' | 'schoolClass'>, showGoal: boolean): OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  if (showGoal) steps.push('goal');
  if (s.schoolClass === null) steps.push('birth_year');
  const curiousOnly = s.goals.length > 0 && s.goals.every((g) => g === 'curious');
  if (!curiousOnly) steps.push('level');
  steps.push('buddy');
  return steps;
}

/** What comes after a step (the main path, §5.1). */
export function nextStep(step: OnboardingStep, s: OnboardingState): OnboardingStep {
  switch (step) {
    case 'welcome':
      return 'goal';
    case 'goal':
    case 'class':
      return s.schoolClass === null ? 'birth_year' : s.goals.every((g) => g === 'curious') ? 'buddy' : 'level';
    case 'birth_year':
      return s.goals.length > 0 && s.goals.every((g) => g === 'curious') ? 'buddy' : 'level';
    case 'level':
      return 'buddy';
    case 'buddy':
      return 'seed';
    case 'seed':
      return 'first_lesson';
    case 'first_lesson':
      return 'first_win';
    case 'first_win':
      return 'daily_goal';
    case 'daily_goal':
      return 'reminder';
    case 'reminder':
    case 'done':
      return 'done';
  }
}

/** Age band from the answers (onboarding §6.2). Unknown is treated as a minor everywhere. */
export function ageBandFrom(s: Pick<OnboardingState, 'schoolClass' | 'birthYear'>, nowMs: number): 'u10' | '10_12' | '13_17' | '18p' | null {
  if (s.schoolClass !== null) return s.schoolClass <= 5 ? 'u10' : s.schoolClass <= 7 ? '10_12' : '13_17';
  if (s.birthYear === 'declined') return '13_17';
  if (s.birthYear === null) return null;
  const age = new Date(nowMs).getUTCFullYear() - s.birthYear;
  if (age > 18) return '18p';
  if (age >= 13) return '13_17';
  if (age >= 10) return '10_12';
  return 'u10';
}
