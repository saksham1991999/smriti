// Resolved themes: the colour set for a mode with an exam accent applied, subject lookups and data-viz steps.
import { mix } from "./color";
import {
  colors,
  dataViz,
  examAccent,
  subjectMap,
  subjects,
  type ColorSet,
  type ExamKey,
  type Mode,
  type SubjectColors,
  type SubjectFamily,
} from "./tokens";

export const DEFAULT_SUBJECT_FAMILY: SubjectFamily = "physics";

function isFamily(v: string): v is SubjectFamily {
  return Object.prototype.hasOwnProperty.call(subjects, v);
}

/**
 * The colour family for a subject id ("phy", "economy") or a family name ("physics").
 * Unknown ids fall back to the physics family so a new subject never renders uncoloured;
 * add it to `subjectMap` in tokens.json.
 */
export function subjectFamily(idOrFamily: string | undefined | null): SubjectFamily {
  if (!idOrFamily) return DEFAULT_SUBJECT_FAMILY;
  if (isFamily(idOrFamily)) return idOrFamily;
  return subjectMap[idOrFamily] ?? DEFAULT_SUBJECT_FAMILY;
}

export function subjectColors(idOrFamily: string | undefined | null, mode: Mode): SubjectColors {
  return subjects[subjectFamily(idOrFamily)][mode];
}

/** The colour set for a mode, with the exam app's accent swapped into the primary family (DESIGN.md §2.3). */
export function resolveColors(mode: Mode, exam: ExamKey = "all"): ColorSet {
  const base = colors[mode];
  const a = examAccent[exam];
  const dark = mode === "dark";
  return {
    ...base,
    primary: dark ? a.dark : a.light,
    primaryPressed: dark ? a.pressedDark : a.pressedLight,
    onPrimary: dark ? a.onAccentDark : a.onAccentLight,
    primaryTint: dark ? a.tintDark : a.tintLight,
    primaryText: dark ? a.textDark : a.textLight,
  };
}

export interface HeatStep {
  fill: string;
  text: string;
  textToken: "ink" | "onPrimary";
}

/** Heat map steps for a mode: the base (all-exams) primary mixed into surface. */
export function heatmapSteps(mode: Mode): HeatStep[] {
  const c = colors[mode];
  return dataViz.sequential.map((s) => ({ fill: mix(c.primary, c.surface, s.mix), text: c[s.text], textToken: s.text }));
}

/** Index into `heatmapSteps` for a percentage (0-100). */
export function heatmapStepIndex(percent: number): number {
  const steps = dataViz.sequential.length;
  const p = Math.min(100, Math.max(0, percent));
  return Math.min(steps - 1, Math.floor((p / 100) * steps));
}
