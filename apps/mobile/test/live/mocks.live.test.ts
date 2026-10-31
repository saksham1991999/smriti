/**
 * A mock end to end against a real local apps/api with the fixture content loaded
 * (tools/content-publish/out/metadata.sql) and the fixture blueprint active:
 * list → detail → start → answer through MockRunner (save & next, mark, clear) → flush → pause →
 * resume → submit → report → solutions. Skipped unless SMRITI_LIVE_API is set.
 */
import { fetchAttempt, fetchMockDetail, fetchSolutions, MockRunner, startAttempt } from '../../src/services/mocks';
import { fetchMocks } from '../../src/services/practice';
import { createTestApp } from '../harness';
import { nodeFetch } from './node-fetch';

const BASE = process.env.SMRITI_LIVE_API;
const live = BASE ? describe : describe.skip;
const EXAM = process.env.SMRITI_LIVE_MOCK_EXAM ?? 'fx-exam-2027';

live('a mock against the real API', () => {
  it('takes a sectional mock and reads its report and solutions', async () => {
    const { app } = createTestApp({ variant: 'all', now: Date.now(), live: { baseUrl: BASE!, fetch: nodeFetch } });
    await app.boot();
    await app.ensureSession();
    await app.chooseLocale('en');
    await app.answerGoal([EXAM], null);
    await app.answerBirthYear(2007);

    const cards = await fetchMocks(app);
    console.log('mocks', cards.map((c) => `${c.id} ${c.kind} allowed=${c.access.allowed}`));
    const card = cards.find((c) => c.access.allowed);
    expect(card).toBeTruthy();
    const detail = await fetchMockDetail(app, card!.id);
    expect(detail.sections.length).toBeGreaterThan(0);

    const attempt = await startAttempt(app, card!.id, 'en', 'practice');
    expect(attempt.status).toBe('in_progress');
    const runner = await MockRunner.load(app, attempt);
    expect(runner.questions.length).toBe(detail.question_count);

    // First question: answer, save & next. Second: answer and mark. Third: answer then clear.
    const pick = (i: number) => {
      const q = runner.question(runner.current)!;
      const opts = (q.body.options as { id: string }[] | undefined) ?? [];
      runner.setDraft(opts.length ? { kind: 'options', optionIds: [opts[i % opts.length]!.id] } : { kind: 'number', value: '1' });
    };
    pick(0);
    runner.saveNext();
    pick(1);
    runner.markNext();
    if (runner.questions.length > 2) {
      pick(2);
      runner.clear();
    }
    await runner.flush();
    const c = runner.counts();
    expect(c.answered).toBe(1);
    expect(c.answered_marked).toBe(1);
    expect(runner.rejected.size).toBe(0);

    await runner.pause();
    expect(runner.phase).toBe('paused');
    await runner.resume();
    expect(runner.phase).toBe('running');

    // A fresh load from the server has the saved answers (another device, or after a crash).
    const again = await MockRunner.load(app, await fetchAttempt(app, attempt.id));
    expect(again.counts().answered + again.counts().answered_marked).toBe(2);

    const report = await runner.submit();
    console.log('report', JSON.stringify({ score: report.score, max: report.max_score, accuracy: report.accuracy, locked: report.locked, standing: report.standing }));
    expect(['submitted', 'auto_submitted']).toContain(report.status);
    const sols = await fetchSolutions(app, attempt.id);
    expect(sols.items.length).toBe(runner.questions.length);
    app.stop();
  });
});
