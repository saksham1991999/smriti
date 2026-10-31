// Pure display logic shared by ui-web and ui-native so both platforms behave the same.
// Product rules (what to show when) live in packages/app-core; this is only how a component draws its props.
import { heatmapStepIndex } from "../theme";
import type { MockPaletteShape } from "../tokens";
import type { Locale, UIStringKey } from "./strings";

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export const clamp01 = (n: number): number => clamp(Number.isFinite(n) ? n : 0, 0, 1);

/** 0-1 to a whole percent. */
export const toPercent = (fraction: number): number => Math.round(clamp01(fraction) * 100);

/** Geometry for an SVG progress ring drawn as a stroked circle. */
export function ringGeometry(size: number, stroke: number, value: number) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return { r, cx: size / 2, cy: size / 2, circumference, dashOffset: circumference * (1 - clamp01(value)) };
}

// ---------- Timer ----------

export type TimerMode = "countdown" | "countup";
export type TimerPhase = "default" | "warning" | "final" | "paused" | "done";

export interface TimerInput {
  mode: TimerMode;
  /** ms since epoch on the server-offset clock. Countdown needs endsAt, count-up needs startedAt. */
  endsAt?: number;
  startedAt?: number;
  now: number;
  warnAtMs?: number;
  finalAtMs?: number;
  paused?: boolean;
  /** Frozen value while paused (remaining for countdown, elapsed for count-up). */
  pausedMs?: number;
}

export interface TimerState {
  ms: number;
  text: string;
  phase: TimerPhase;
}

/** "1:05:09" over an hour, "05:09" under (always "hh:mm:ss" when `forceHours`). Tabular-figure friendly. */
export function formatClock(ms: number, forceHours = false): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 || forceHours ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** Spoken form: "1 hour 5 minutes 9 seconds". Kept simple; screen readers read the digits otherwise. */
export function timerState(i: TimerInput): TimerState {
  let ms: number;
  if (i.paused && i.pausedMs !== undefined) ms = i.pausedMs;
  else if (i.mode === "countdown") ms = Math.max(0, (i.endsAt ?? i.now) - i.now);
  else ms = Math.max(0, i.now - (i.startedAt ?? i.now));
  const forceHours = i.mode === "countdown" && (i.endsAt ?? 0) - (i.startedAt ?? i.now) >= 3_600_000;
  const text = formatClock(ms, forceHours);
  if (i.paused) return { ms, text, phase: "paused" };
  if (i.mode === "countup") return { ms, text, phase: "default" }; // count-up never uses warning colours
  if (ms <= 0) return { ms, text, phase: "done" };
  if (i.finalAtMs !== undefined && ms <= i.finalAtMs) return { ms, text, phase: "final" };
  if (i.warnAtMs !== undefined && ms <= i.warnAtMs) return { ms, text, phase: "warning" };
  return { ms, text, phase: "default" };
}

// ---------- Limit meter ----------

export type LimitPhase = "in_range" | "last_few" | "full";

/** `lastFewAt` is how many remaining counts as "last few"; default 20% of the limit, at least 1. */
export function limitState(used: number, limit: number, lastFewAt?: number) {
  const safeLimit = Math.max(0, limit);
  const u = clamp(used, 0, safeLimit);
  const remaining = safeLimit - u;
  const threshold = lastFewAt ?? Math.max(1, Math.ceil(safeLimit * 0.2));
  const phase: LimitPhase = remaining <= 0 ? "full" : remaining <= threshold ? "last_few" : "in_range";
  return { used: u, limit: safeLimit, remaining, fraction: safeLimit === 0 ? 1 : u / safeLimit, phase };
}

// ---------- Meter ----------

export function meterAmountKey(value: number): UIStringKey {
  const v = clamp(value, 0, 100);
  if (v < 13) return "meter.empty";
  if (v < 38) return "meter.quarter";
  if (v < 63) return "meter.half";
  if (v < 88) return "meter.threeQuarters";
  return "meter.full";
}

// ---------- Save-state chip ----------

/** "r…@gmail.com": keeps the first character of the local part and the whole domain when it fits. */
export function truncateEmailMiddle(email: string, maxChars: number): string {
  if (email.length <= maxChars) return email;
  const at = email.indexOf("@");
  if (at <= 0) return `${email.slice(0, Math.max(1, maxChars - 1))}…`;
  const domain = email.slice(at);
  const room = maxChars - domain.length - 1;
  if (room < 1) return `${email[0]}…${domain}`;
  return `${email.slice(0, room)}…${domain}`;
}

// ---------- Numeric keypad ----------

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "-" | "backspace" | "clear";
/** 4 x 4 grid (docs/ux/practice.md, Numeric keypad). `null` cells stay empty. */
export const keypadLayout: (KeypadKey | null)[][] = [
  ["7", "8", "9", "backspace"],
  ["4", "5", "6", "clear"],
  ["1", "2", "3", "-"],
  [null, "0", ".", null],
];

export interface KeypadOptions {
  allowDecimal: boolean;
  allowNegative: boolean;
  maxLength: number;
}

/** Applies one key press. Invalid presses return the value unchanged. */
export function applyKeypadKey(value: string, key: KeypadKey, o: KeypadOptions): string {
  if (key === "clear") return "";
  if (key === "backspace") return value.slice(0, -1);
  if (key === "-") {
    if (!o.allowNegative) return value;
    return value.startsWith("-") ? value.slice(1) : `-${value}`;
  }
  const digits = value.replace("-", "").length;
  if (digits >= o.maxLength) return value;
  if (key === ".") {
    if (!o.allowDecimal || value.includes(".")) return value;
    return value === "" || value === "-" ? `${value}0.` : `${value}.`;
  }
  if (value === "0") return key;
  if (value === "-0") return `-${key}`;
  return value + key;
}

/** Maps a hardware key (KeyboardEvent.key) to a keypad key. */
export function keypadKeyFromKeyboard(key: string): KeypadKey | null {
  if (/^[0-9]$/.test(key)) return key as KeypadKey;
  if (key === "." || key === ",") return ".";
  if (key === "-" || key === "Subtract") return "-";
  if (key === "Backspace") return "backspace";
  if (key === "Delete" || key === "Escape") return "clear";
  return null;
}

export function isCompleteNumber(value: string, format: "integer" | "decimal" = "decimal"): boolean {
  if (value === "" || value === "-") return false;
  return format === "integer" ? /^-?\d+$/.test(value) : /^-?\d+(\.\d+)?$/.test(value);
}

// ---------- Mock palette shapes ----------

/** Polygon points in a 0-1 box, shared by the web clip-path and the native SVG. */
export function paletteShapePoints(shape: MockPaletteShape): [number, number][] | null {
  if (shape === "pentagon-down") return [[0, 0], [1, 0], [1, 0.7], [0.5, 1], [0, 0.7]];
  if (shape === "pentagon-up") return [[0.5, 0], [1, 0.3], [1, 1], [0, 1], [0, 0.3]];
  return null; // square and circles use border radius
}

export const paletteStateKey = {
  notVisited: "palette.notVisited",
  notAnswered: "palette.notAnswered",
  answered: "palette.answered",
  marked: "palette.marked",
  answeredMarked: "palette.answeredMarked",
} as const satisfies Record<string, UIStringKey>;

// ---------- Heat map ----------

export type HeatCell = { kind: "filled"; percent: number; step: number } | { kind: "tooFew" };

export function heatCell(value: number | null, count: number, minCount: number): HeatCell {
  if (value === null || count < minCount) return { kind: "tooFew" };
  const percent = Math.round(clamp(value, 0, 100));
  return { kind: "filled", percent, step: heatmapStepIndex(percent) };
}

// ---------- Time strip ----------

export type TimeResult = "right" | "wrong" | "skipped" | "not_scored";
export const timeResultKey = {
  right: "timeStrip.right",
  wrong: "timeStrip.wrong",
  skipped: "timeStrip.skipped",
  not_scored: "timeStrip.notScored",
} as const satisfies Record<TimeResult, UIStringKey>;

/** Bar heights (px) for a strip of `maxHeight`, scaled to the longest time or target. */
export function timeStripHeights(items: { timeMs: number; targetMs?: number }[], maxHeight: number) {
  const max = Math.max(1, ...items.map((i) => Math.max(i.timeMs, i.targetMs ?? 0)));
  return {
    max,
    heights: items.map((i) => Math.max(2, Math.round((i.timeMs / max) * maxHeight))),
    targets: items.map((i) => (i.targetMs === undefined ? null : Math.round((i.targetMs / max) * maxHeight))),
  };
}

/** "1 min 05 s" style short duration for captions and table cells. */
export function formatShortDuration(ms: number, locale: Locale = "en"): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const [mu, su] = locale === "hi" ? ["मिनट", "से"] : ["min", "s"];
  if (m === 0) return `${s} ${su}`;
  return `${m} ${mu} ${String(s).padStart(2, "0")} ${su}`;
}

// ---------- Misc ----------

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Negative scores print with a true minus sign: "−12" (docs/ux/practice.md, Score ring). */
export function formatScore(score: number): string {
  return score < 0 ? `−${Math.abs(score)}` : String(score);
}

/** True when the string has Devanagari, so native text picks Noto Sans Devanagari and the 1.15x line height. */
export const hasDevanagari = (s: string): boolean => /[ऀ-ॿ]/.test(s);

export function pluralCategory(n: number, locale: Locale): "zero" | "one" | "other" {
  if (n === 0) return "zero";
  return new Intl.PluralRules(locale === "hi" ? "hi-IN" : "en-IN").select(n) === "one" ? "one" : "other";
}
