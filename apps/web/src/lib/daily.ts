import { create } from "zustand";
import { localDate } from "@smriti/app-core";
import { prefs, timeZone } from "../platform/web";

/**
 * Minutes studied today on this device, for the daily-goal ring (HOME-01, LES-08). Lessons and
 * reviews add their time as they finish; a new local day starts from zero. `practice` counts the
 * questions checked today for the free practice quota (app-core `practiceQuota`); the server's
 * count wins when it is higher (reconcileUsage).
 */
interface DailyData {
  day: string;
  ms: number;
  practice: number;
}
interface Daily extends DailyData {
  add(ms: number): void;
  addPractice(n: number): void;
}

const today = () => localDate(Date.now(), timeZone());

const fresh = (): DailyData => ({ day: today(), ms: 0, practice: 0 });

function load(): DailyData {
  try {
    const raw = prefs.get("daily.v1");
    const v = raw ? (JSON.parse(raw) as Partial<DailyData>) : null;
    return v && v.day === today() ? { ...fresh(), ...v } : fresh();
  } catch {
    return fresh();
  }
}

function current(get: () => DailyData): DailyData {
  const d = get();
  return d.day === today() ? { day: d.day, ms: d.ms, practice: d.practice } : fresh();
}

export const useDaily = create<Daily>((set, get) => ({
  ...load(),
  add(ms) {
    const next = { ...current(get), ms: current(get).ms + Math.max(0, ms) };
    prefs.set("daily.v1", JSON.stringify(next));
    set(next);
  },
  addPractice(n) {
    const next = { ...current(get), practice: current(get).practice + Math.max(0, n) };
    prefs.set("daily.v1", JSON.stringify(next));
    set(next);
  },
}));

/** Whole minutes today (0 on a new day). */
export function useTodayMinutes(): number {
  const { day, ms } = useDaily();
  return day === today() ? Math.floor(ms / 60_000) : 0;
}

/** Practice questions checked today on this device. */
export function usePracticeToday(): number {
  const { day, practice } = useDaily();
  return day === today() ? practice : 0;
}
