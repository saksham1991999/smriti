import { create } from "zustand";
import type { LessonOutcome } from "./learner";

/** What LES-08 / ONB-14 render: the outcome plus where the student came from and goes next. */
export interface LessonResult {
  outcome: LessonOutcome;
  topicId: string;
  topicName: string;
  chapterId: string | null;
  chapterName: string | null;
  subject: string;
  mode: "deep_dive" | "quick_revision" | "onboarding";
  nextBiteTitle: string | null;
  synced: boolean;
}

interface Store {
  result: LessonResult | null;
  set(r: LessonResult): void;
  clear(): void;
}

/** In memory only: a reload of LES-08 goes back to Home, whose state already has the result. */
export const useLessonResult = create<Store>((set) => ({
  result: null,
  set: (result) => set({ result }),
  clear: () => set({ result: null }),
}));
