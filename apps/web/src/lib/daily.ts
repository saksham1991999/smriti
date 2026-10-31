import { localDate, type OutboxRow } from "@smriti/app-core";
import { timeZone } from "../platform/web";
import { useOutboxRows } from "./queries";

/**
 * Minutes studied today, for the daily-goal ring (HOME-01, LES-08, PRC-06), folded from the
 * learning events themselves: lessons, reviews, the daily challenge, rescues and focus sessions.
 * The outbox keeps acknowledged rows for two days (`DexieOutbox.remove`), so a lesson still counts
 * after it syncs. A started minute counts, so the lesson that watered the plant is never "0 min".
 */
export function msFromEvents(rows: readonly Pick<OutboxRow, "type" | "occurred_at" | "payload">[], tz: string, today: string): number {
  let ms = 0;
  for (const r of rows) {
    if (localDate(r.occurred_at, tz) !== today) continue;
    const p = r.payload as Record<string, unknown>;
    switch (r.type) {
      case "lesson_completed":
      case "practice_session_completed":
      case "daily_challenge_completed":
      case "rescue_completed":
        ms += Number(p.ms_total) || 0;
        break;
      case "review_rated":
        ms += Number(p.ms_to_answer) || 0;
        break;
      case "focus_session_completed":
        ms += (Number(p.minutes) || 0) * 60_000;
        break;
      default:
        break;
    }
  }
  return ms;
}

export const minutesOf = (ms: number) => Math.ceil(Math.max(0, ms) / 60_000);

/** Whole minutes today (a started minute counts; 0 on a new day). */
export function useTodayMinutes(): number {
  const rows = useOutboxRows().data ?? [];
  const tz = timeZone();
  return minutesOf(msFromEvents(rows, tz, localDate(Date.now(), tz)));
}
