/** PRC-13: what the share card may show, built only from the result, the streak and the day. */
import { minutesSeconds, shareCardModel, topBand } from '../src/services/share';

test('time is m:ss, rounded down to the second', () => {
  expect(minutesSeconds(0)).toBe('0:00');
  expect(minutesSeconds(59_900)).toBe('0:59');
  expect(minutesSeconds(61_000)).toBe('1:01');
  expect(minutesSeconds(-5)).toBe('0:00');
});

test('the top band shows only when the server ranks the challenge, and never as 100%', () => {
  expect(topBand({ rank: null, beat_pct: null })).toBeNull();
  expect(topBand({ rank: 3, beat_pct: null })).toBeNull();
  expect(topBand({ rank: 3, beat_pct: 88 })).toBe(12);
  expect(topBand({ rank: 1, beat_pct: 100 })).toBe(1);
  expect(topBand({ rank: 40, beat_pct: 0 })).toBeNull();
});

test('the streak line follows the toggle and is left out with no streak', () => {
  const result = { correct: true, time_ms: 75_000, submitted_at: '2026-10-31T05:00:00Z', rank: null, players: 10, beat_pct: null, min_players_for_rank: 50 };
  expect(shareCardModel(result, '2026-10-31', 4, true)).toEqual({ correct: true, time: '1:15', topPct: null, streak: 4, day: '2026-10-31' });
  expect(shareCardModel(result, '2026-10-31', 4, false).streak).toBeNull();
  expect(shareCardModel(result, '2026-10-31', 0, true).streak).toBeNull();
  expect(shareCardModel(result, '2026-10-31', null, true).streak).toBeNull();
});
