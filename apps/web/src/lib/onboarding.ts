import { create } from "zustand";
import type { AgeBand } from "@smriti/app-core";

/**
 * Local onboarding state (onboarding flow §5.3: `onboarding.v1`). Every answer is written here at
 * once and also sent as an `onboarding_answer` event, so a reload resumes at the same step and
 * nothing is lost offline. Kept in localStorage synchronously so route guards can read it.
 */
export type Goal = string; // exam id, "school" or "curious"
export type Level = "starting" | "basics" | "revising";

export interface OnboardingData {
  goals: Goal[];
  classNo: number | null;
  birthYear: number | "prefer_not" | null;
  examMonth: string | null;
  level: Level | null;
  petSpecies: "cat" | "dog" | null;
  petName: string | null;
  seeded: boolean;
  firstLessonTopic: string | null;
  firstWinAt: string | null;
  dailyGoal: number | null;
  reminder: string | null | false;
  completedAt: string | null;
  lessonsCompleted: number;
  installedAt: string;
  upsellsShown: { day: string; count: number };
}

const KEY = "smriti.onboarding.v1";
const empty = (): OnboardingData => ({
  goals: [],
  classNo: null,
  birthYear: null,
  examMonth: null,
  level: null,
  petSpecies: null,
  petName: null,
  seeded: false,
  firstLessonTopic: null,
  firstWinAt: null,
  dailyGoal: null,
  reminder: null,
  completedAt: null,
  lessonsCompleted: 0,
  installedAt: new Date().toISOString(),
  upsellsShown: { day: "", count: 0 },
});

function load(): OnboardingData {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty(), ...(JSON.parse(raw) as Partial<OnboardingData>) } : empty();
  } catch {
    return empty();
  }
}

interface OnboardingStore extends OnboardingData {
  update(patch: Partial<OnboardingData>): void;
  reset(): void;
}

export const useOnboarding = create<OnboardingStore>((set, get) => ({
  ...load(),
  update(patch) {
    set(patch);
    const { update: _u, reset: _r, ...data } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* private mode: keep in memory */
    }
  },
  reset() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set(empty());
  },
}));

/** Age band from the answers (onboarding §6.2): class first, then birth year; unknown → null. */
export function ageBandFrom(d: Pick<OnboardingData, "classNo" | "birthYear">, now = new Date()): AgeBand | null {
  if (d.classNo !== null) return d.classNo <= 5 ? "u10" : d.classNo <= 7 ? "10_12" : "13_17";
  if (d.birthYear === "prefer_not") return "13_17";
  if (typeof d.birthYear === "number") {
    // Ambiguous in the year the student turns 18: treat as the younger option (§6.2).
    const age = now.getFullYear() - d.birthYear;
    return age >= 19 ? "18p" : age >= 13 ? "13_17" : age >= 10 ? "10_12" : "u10";
  }
  return null;
}

export const isMinor = (band: AgeBand | null) => band !== "18p";

/** The exam profile ids the goals map to (catalogue and Home). */
export function profileIdsFor(goals: readonly Goal[], exams: readonly { id: string; profileId: string }[]): string[] {
  return goals.map((g) => exams.find((e) => e.id === g)?.profileId ?? g);
}

/** Which question steps this student sees before the lesson (onboarding §5.1): drives the bar. */
export function questionSteps(d: Pick<OnboardingData, "goals" | "classNo">): string[] {
  const steps = ["goal"];
  const competitive = d.goals.some((g) => g !== "school" && g !== "curious");
  if (d.classNo === null) steps.push("birth-year");
  if (competitive || d.classNo === 10 || d.classNo === 12) steps.push("exam-date");
  if (!(d.goals.length === 1 && d.goals[0] === "curious")) steps.push("level");
  steps.push("buddy");
  return steps;
}
