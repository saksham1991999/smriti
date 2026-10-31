/**
 * ENT-08 streak check-in: which variant (if any) the first open of the day shows, from facts the
 * device has. Days away come from the last day this device opened Home; health comes from the
 * server's plant section. The freeze and incident variants need a "freeze used" fact the server
 * does not send yet, so they are never chosen here (the Home streak card carries nothing made up).
 */
import type { PlantSection } from "@smriti/app-core";
import { prefs } from "../platform/web";

export type CheckinVariant = "comeback" | "resting" | "long_break";

export interface CheckinFacts {
  today: string;
  /** The last local day this device opened Home, or null on the first open. */
  lastOpen: string | null;
  /** The last day the check-in was shown on this device. */
  lastShown: string | null;
  /** The local day onboarding finished, if it did. */
  onboardedOn: string | null;
  health: PlantSection["health"] | null;
  /** The planned rest day (R28), if any. */
  restDay: string | null;
  longGapDays: number;
}

export interface Checkin {
  variant: CheckinVariant;
  /** comeback or resting: the copy and art the sheet uses (long break keeps the plant's). */
  tone: "comeback" | "resting";
  daysAway: number;
}

/** Whole days between two `YYYY-MM-DD` dates (b − a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The device's local day, `YYYY-MM-DD`. */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function chooseCheckin(f: CheckinFacts): Checkin | null {
  if (!f.lastOpen || f.lastShown === f.today || f.onboardedOn === f.today) return null;
  const daysAway = dayDiff(f.lastOpen, f.today);
  // Nothing was missed unless a whole day went by without an open.
  if (daysAway < 2) return null;
  const yesterday = localDay(new Date(Date.parse(`${f.today}T12:00:00Z`) - 86_400_000));
  if (f.restDay && daysAway === 2 && f.restDay === yesterday) return null;
  const tone = f.health === "wilted" || f.health === "dormant" ? "resting" : "comeback";
  if (daysAway >= f.longGapDays) return { variant: "long_break", tone, daysAway };
  if (f.health === "droopy" || f.health === "dry") return { variant: "comeback", tone, daysAway };
  if (tone === "resting") return { variant: "resting", tone, daysAway };
  return null;
}

const LAST_OPEN = "home.last_open_day";
const LAST_SHOWN = "home.checkin_shown_day";

let seen: { today: string; lastOpen: string | null; lastShown: string | null } | null = null;

/**
 * Reads the device facts, then records today's open. The first read of the day is kept for the
 * page's lifetime, so Home mounting again (or twice in dev) still sees the earlier open.
 */
export function readAndMarkOpen(today: string): { lastOpen: string | null; lastShown: string | null } {
  if (seen?.today === today) return seen;
  const lastOpen = prefs.get(LAST_OPEN);
  const lastShown = prefs.get(LAST_SHOWN);
  if (lastOpen !== today) prefs.set(LAST_OPEN, today);
  seen = { today, lastOpen, lastShown };
  return seen;
}

export function markCheckinShown(today: string) {
  prefs.set(LAST_SHOWN, today);
  if (seen?.today === today) seen = { ...seen, lastShown: today };
}
