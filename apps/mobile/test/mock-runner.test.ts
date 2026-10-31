/**
 * MockRunner's CBT rules and its offline behaviour, without a server: the dev fake has no
 * attempts routes, so every save fails like a phone with no signal. The real API path is
 * test/live/mocks.live.test.ts.
 */
import type { Attempt } from '../src/services/mocks';
import { MockRunner } from '../src/services/mocks';
import { createTestApp } from './harness';

const q = (n: number, section = 'A') => ({
  question_id: `q${n}`,
  section_code: section,
  position: n,
  type: 'mcq_single',
  marking: { correct: 4, wrong: -1, unattempted: 0 },
  body: { id: `q${n}`, type: 'mcq_single', stem: { en: `Stem ${n}`, hi: `प्रश्न ${n}` }, options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: { en: id, hi: id } })) },
  saved: null,
});

function attempt(now: number): Attempt {
  return {
    id: 'att-1',
    mock_id: 'm1',
    kind: 'sectional',
    exam_profile_id: 'fx-exam-2027',
    blueprint_id: 'bp',
    title: { en: 'Mock', hi: 'मॉक' },
    status: 'in_progress',
    attempt_no: 1,
    time_policy: 'practice',
    language: 'en',
    language_switch: 'per_question',
    calculator: 'none',
    interface: 'cbt',
    interface_profile: null,
    section_navigation: 'free',
    early_section_submit: null,
    marked_answer_evaluated: true,
    started_at: new Date(now).toISOString(),
    server_deadline_at: new Date(now + 30 * 60_000).toISOString(),
    server_time: new Date(now).toISOString(),
    remaining_ms: 30 * 60_000,
    paused: false,
    paused_ms: 0,
    pause_count: 0,
    active_device: 'this',
    submitted_at: null,
    score: null,
    max_score: null,
    sections: [{ code: 'A', title: { en: 'A', hi: 'A' }, status: 'open', opened_at: null, closes_at: null, closed_at: null, closed_by: null, question_ids: ['q1', 'q2', 'q3'], attempt_any: null, over_attempt: null, answered: 0 }],
    questions: [q(1), q(2), q(3)],
  };
}

test('save & next, mark, clear and the palette', async () => {
  const { app, clock } = createTestApp();
  await app.boot();
  const r = await MockRunner.load(app, attempt(clock.now));
  expect(r.current).toBe('q1');
  expect(r.counts().not_answered).toBe(1);
  expect(r.counts().not_visited).toBe(2);

  r.setDraft({ kind: 'options', optionIds: ['b'] });
  expect(r.unsaved()).toBe(true);
  clock.advance(20_000);
  r.saveNext();
  expect(r.current).toBe('q2');
  expect(r.row('q1')!.palette).toBe('answered');
  expect(r.row('q1')!.timeMs).toBe(20_000);

  r.markNext(); // no answer: marked
  expect(r.row('q2')!.palette).toBe('marked');
  r.setDraft({ kind: 'options', optionIds: ['c'] });
  r.markNext(); // last question stays
  expect(r.row('q3')!.palette).toBe('answered_marked');
  r.clear();
  expect(r.row('q3')!.palette).toBe('marked');
  expect(r.remainingMs()).toBe(30 * 60_000 - 20_000);
});

test('answers survive a failed save and a restart on the device', async () => {
  const { app, clock } = createTestApp();
  await app.boot();
  const a = attempt(clock.now);
  const r = await MockRunner.load(app, a);
  r.setDraft({ kind: 'options', optionIds: ['d'] });
  r.saveNext();
  await r.flush(); // the fake has no attempts route: stays dirty, kept on the device
  await new Promise((res) => setTimeout(res, 10));

  const reopened = await MockRunner.load(app, a);
  expect(reopened.row('q1')!.answer).toEqual({ kind: 'options', optionIds: ['d'] });
  expect(reopened.row('q1')!.palette).toBe('answered');
  expect(reopened.current).toBe('q2');
});
