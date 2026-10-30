/** PRC-16 rows and PRC-14 cards come only from real sessions and attempts. */
import { groupByDay, historyRows, mockTrend, periodStart, practiceStats, type AttemptSummary, type PracticeSessionSummary } from '../src/services/history';

const NOW = Date.parse('2026-10-30T10:00:00+05:30');
const TZ = 'Asia/Kolkata';
const session = (id: string, at: string, answered: number, correct: number, kind = 'drill', ended = true): PracticeSessionSummary => ({ id, kind, answered, correct, exam: 'jee-main-2027', size: answered, started_at: at, ended_at: ended ? at : null });
const attempt = (id: string, at: string, score: number | null, max: number | null, extra: Partial<AttemptSummary> = {}): AttemptSummary => ({
  id,
  attempt_no: 1,
  kind: 'full',
  max_score: max,
  mock_id: 'm1',
  score,
  started_at: at,
  status: 'submitted',
  submitted_at: at,
  title: { en: `Mock ${id}`, hi: `मॉक ${id}` },
  ...extra,
});

test('history merges sessions and attempts, newest first, grouped by day', () => {
  const rows = historyRows(
    [session('s1', '2026-10-30T09:00:00+05:30', 10, 7), session('s2', '2026-10-29T18:00:00+05:30', 0, 0, 'pyq_set', false)],
    [attempt('a1', '2026-10-30T08:00:00+05:30', 120, 300), attempt('a2', '2026-10-20T08:00:00+05:30', null, null, { status: 'abandoned' })],
    'hi',
  );
  expect(rows.map((r) => `${r.type}:${r.id}`)).toEqual(['drill:s1', 'mock:a1', 'pyq:s2']);
  expect(rows[0]).toMatchObject({ answered: 10, accuracy: 70, finished: true });
  expect(rows[1]).toMatchObject({ title: 'मॉक a1', scorePct: 40, answered: null });
  expect(rows[2]).toMatchObject({ accuracy: null, finished: false });
  const groups = groupByDay(rows, NOW, TZ);
  expect(groups.map((g) => g.label)).toEqual(['today', 'yesterday']);
  expect(groups[0]!.rows).toHaveLength(2);
});

test('period stats and the mock trend use only what happened in the period', () => {
  const sessions = [session('s1', '2026-10-29T09:00:00+05:30', 10, 8), session('s2', '2026-09-01T09:00:00+05:30', 20, 5)];
  expect(practiceStats(sessions, periodStart('7d', NOW))).toEqual({ sessions: 1, answered: 10, correct: 8, accuracy: 80 });
  expect(practiceStats(sessions, periodStart('all', NOW))).toMatchObject({ answered: 30, accuracy: 43 });
  expect(practiceStats([], periodStart('all', NOW)).accuracy).toBeNull();
  const trend = mockTrend(
    [attempt('b', '2026-10-28T08:00:00+05:30', 150, 300), attempt('a', '2026-10-21T08:00:00+05:30', 90, 300), attempt('p', '2026-10-22T08:00:00+05:30', 10, 20, { kind: 'pyq_paper' }), attempt('x', '2026-10-23T08:00:00+05:30', null, 300)],
    'en',
    periodStart('30d', NOW),
  );
  expect(trend.map((p) => [p.id, p.pct])).toEqual([
    ['a', 30],
    ['b', 50],
  ]);
});
