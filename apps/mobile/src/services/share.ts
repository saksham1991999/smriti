import type { Schemas } from '@smriti/api-client';

/**
 * PRC-13: what the daily-challenge share card shows. Built only from the result, the streak and
 * the date: no name, no question text, no free text and no link that identifies the student
 * (docs/flows/practice.md §5.5).
 */
export interface ShareCardModel {
  correct: boolean;
  /** m:ss, tabular. */
  time: string;
  /** "Top {pct}%", only when ranks are public and the band means something (never 100%). */
  topPct: number | null;
  /** Days, or null when the toggle is off or there is no streak. */
  streak: number | null;
  /** The challenge day, YYYY-MM-DD. */
  day: string;
}

/** m:ss from milliseconds, rounded down to the second (a 59.9 s answer is 0:59). */
export function minutesSeconds(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * "Top {pct}%" from the share of players the student beat. Shown only when the server ranks the
 * challenge (rank and beat_pct set) and never as "Top 100%" (PRC-13 states).
 */
export function topBand(result: Pick<Schemas['DailyChallengeResult'], 'rank' | 'beat_pct'>): number | null {
  if (result.rank === null || result.beat_pct === null) return null;
  const top = Math.max(1, 100 - result.beat_pct);
  return top < 100 ? top : null;
}

export function shareCardModel(result: Schemas['DailyChallengeResult'], day: string, streakDays: number | null, showStreak: boolean): ShareCardModel {
  return {
    correct: result.correct,
    time: minutesSeconds(result.time_ms),
    topPct: topBand(result),
    streak: showStreak && streakDays && streakDays > 0 ? streakDays : null,
    day,
  };
}
