import { localDate } from '@smriti/app-core';
import type { Schemas } from '@smriti/api-client';

/**
 * PRC-16 (practice history) and the PRC-14 cards that real data can fill today: practice
 * accuracy from `/v1/practice/sessions`, the mock score trend from `/v1/attempts`, and syllabus
 * touched from `topic_status`. The API has no analytics endpoint yet, so readiness, accuracy vs
 * speed, confidence and mistake-type cards are not shown (never a made-up number).
 */

export type PracticeSessionSummary = Schemas['smriti_api__schemas__practice__SessionSummary'];
export type AttemptSummary = Schemas['AttemptSummary'];

export type HistoryType = 'drill' | 'pyq' | 'challenge' | 'mock';
export type HistoryFilter = 'all' | HistoryType;

export interface HistoryRow {
  id: string;
  type: HistoryType;
  /** Server-provided title (mocks), else null and the screen uses the type's name. */
  title: string | null;
  answered: number | null;
  accuracy: number | null;
  /** Percent of the maximum score, for mocks. */
  scorePct: number | null;
  at: string;
  finished: boolean;
}

export function sessionType(kind: string): HistoryType {
  if (kind.includes('pyq')) return 'pyq';
  if (kind.includes('daily') || kind.includes('challenge')) return 'challenge';
  return 'drill';
}

export function historyRows(sessions: readonly PracticeSessionSummary[], attempts: readonly AttemptSummary[], locale: 'en' | 'hi'): HistoryRow[] {
  const rows: HistoryRow[] = sessions.map((s) => ({
    id: s.id,
    type: sessionType(s.kind),
    title: null,
    answered: s.answered,
    accuracy: s.answered > 0 ? Math.round((s.correct / s.answered) * 100) : null,
    scorePct: null,
    at: s.ended_at ?? s.started_at,
    finished: s.ended_at !== null,
  }));
  for (const a of attempts) {
    if (a.status === 'abandoned') continue;
    rows.push({
      id: a.id,
      type: a.kind === 'pyq_paper' ? 'pyq' : 'mock',
      title: a.title[locale] ?? a.title.en ?? null,
      answered: null,
      accuracy: null,
      scorePct: scorePercent(a),
      at: a.submitted_at ?? a.started_at,
      finished: a.status === 'submitted' || a.status === 'auto_submitted',
    });
  }
  return rows.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
}

export function scorePercent(a: Pick<AttemptSummary, 'score' | 'max_score'>): number | null {
  return a.score !== null && a.max_score ? Math.round((a.score / a.max_score) * 100) : null;
}

export interface DayGroup {
  day: string;
  label: 'today' | 'yesterday' | 'date';
  rows: HistoryRow[];
}

export function groupByDay(rows: readonly HistoryRow[], now: number, timeZone: string): DayGroup[] {
  const today = localDate(now, timeZone);
  const yesterday = localDate(now - 86_400_000, timeZone);
  const out: DayGroup[] = [];
  for (const r of rows) {
    const day = localDate(Date.parse(r.at), timeZone);
    let g = out[out.length - 1];
    if (!g || g.day !== day) {
      g = { day, label: day === today ? 'today' : day === yesterday ? 'yesterday' : 'date', rows: [] };
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}

export type Period = '7d' | '30d' | 'all';

export function periodStart(period: Period, now: number): number {
  return period === '7d' ? now - 7 * 86_400_000 : period === '30d' ? now - 30 * 86_400_000 : Number.NEGATIVE_INFINITY;
}

export interface PracticeStats {
  sessions: number;
  answered: number;
  correct: number;
  accuracy: number | null;
}

export function practiceStats(sessions: readonly PracticeSessionSummary[], since: number): PracticeStats {
  const inside = sessions.filter((s) => Date.parse(s.started_at) >= since);
  const answered = inside.reduce((n, s) => n + s.answered, 0);
  const correct = inside.reduce((n, s) => n + s.correct, 0);
  return { sessions: inside.length, answered, correct, accuracy: answered > 0 ? Math.round((correct / answered) * 100) : null };
}

export interface TrendPoint {
  id: string;
  title: string;
  pct: number;
  at: string;
}

/** Submitted mocks with a score, oldest first (PRC-14 trend card). */
export function mockTrend(attempts: readonly AttemptSummary[], locale: 'en' | 'hi', since: number): TrendPoint[] {
  return attempts
    .filter((a) => (a.status === 'submitted' || a.status === 'auto_submitted') && a.kind !== 'pyq_paper' && Date.parse(a.submitted_at ?? a.started_at) >= since)
    .map((a) => ({ id: a.id, title: a.title[locale] ?? a.title.en ?? '', pct: scorePercent(a), at: a.submitted_at ?? a.started_at }))
    .filter((p): p is TrendPoint => p.pct !== null)
    .sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
}
