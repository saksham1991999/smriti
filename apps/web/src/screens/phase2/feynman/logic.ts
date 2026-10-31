/**
 * AI-10 and AI-11 logic: words, bands and the overall reaction. The bands come from the server's
 * `feynman.bands` flag (`getting_there` and `clear` thresholds); the scores come from the grader.
 */
import type { Schemas } from "@smriti/api-client";

export type FeynmanResult = Schemas["FeynmanOut"];
export type Band = "needs_work" | "getting_there" | "clear";
export type Overall = "all_clear" | "mixed" | "needs_work";
export interface Bands {
  getting_there: number;
  clear: number;
}
export const METERS = ["clarity", "completeness", "accuracy"] as const;
export type MeterKey = (typeof METERS)[number];

const DEFAULT_BANDS: Bands = { getting_there: 40, clear: 70 };

/** Reads the flag defensively: a malformed value falls back to the documented defaults. */
export function bandsFrom(value: unknown): Bands {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const g = typeof v.getting_there === "number" ? v.getting_there : null;
    const c = typeof v.clear === "number" ? v.clear : null;
    if (g !== null && c !== null && g <= c) return { getting_there: g, clear: c };
  }
  return DEFAULT_BANDS;
}

export function band(score: number, bands: Bands): Band {
  if (score >= bands.clear) return "clear";
  if (score >= bands.getting_there) return "getting_there";
  return "needs_work";
}

const RANK: Record<Band, number> = { needs_work: 0, getting_there: 1, clear: 2 };

/** The pet's reaction follows the weakest meter: all clear, mixed, or needs work. Never shaming. */
export function overall(r: Pick<FeynmanResult, MeterKey>, bands: Bands): Overall {
  const lowest = Math.min(...METERS.map((m) => RANK[band(r[m], bands)]));
  return lowest === 2 ? "all_clear" : lowest === 1 ? "mixed" : "needs_work";
}

/**
 * Words as the server counts them, but never more: letters, marks and digits run together, so a
 * Hindi word with vowel signs counts once. The server's own check is the final word (`too_short`).
 */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{M}\p{N}_]+/gu)?.length ?? 0;
}

/** "+{n} since last time": the rise in the average of the three meters, or null when not higher. */
export function sinceLastTime(r: Pick<FeynmanResult, MeterKey | "previous">): number | null {
  const p = r.previous;
  if (!p) return null;
  const nums = METERS.map((m) => p[m]).filter((x): x is number => typeof x === "number");
  if (nums.length !== METERS.length) return null;
  const before = nums.reduce((a, b) => a + b, 0) / METERS.length;
  const now = METERS.reduce((a, m) => a + r[m], 0) / METERS.length;
  const delta = Math.round(now - before);
  return delta > 0 ? delta : null;
}

export interface Gaps {
  missed: FeynmanResult["key_points"];
  wrong: FeynmanResult["key_points"];
}

export function gapsOf(r: Pick<FeynmanResult, "key_points">): Gaps {
  return { missed: r.key_points.filter((k) => k.status === "missing"), wrong: r.key_points.filter((k) => k.status === "misconception") };
}

/** A key point's text in the reading locale (the bundle's own words; English when Hindi is missing). */
export function pointText(k: FeynmanResult["key_points"][number], locale: "en" | "hi"): string {
  return k.text[locale] ?? k.text.en ?? "";
}

/** Local draft key for an explanation (kept on the device until it's checked). */
export const draftKey = (conceptId: string) => `feynman.draft.${conceptId}`;
