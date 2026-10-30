/**
 * Drills and the PYQ bank end to end against a real local apps/api with the fixture content
 * loaded: weak spots → a topic drill through DrillRunner (bodies from the seed pack, checked on the
 * device and by the server) → complete → PYQ papers and a paper → a content report.
 * Skipped unless SMRITI_LIVE_API is set.
 */
import { createSession, DrillRunner, fetchPyqPaper, fetchWeakSpots, listPyqPapers, listPyqs, reportContent } from '../../src/services/drill';
import { createTestApp } from '../harness';
import { nodeFetch } from './node-fetch';

const BASE = process.env.SMRITI_LIVE_API;
const live = BASE ? describe : describe.skip;
const EXAM = process.env.SMRITI_LIVE_MOCK_EXAM ?? 'fx-exam-2027';

live('drills and PYQs against the real API', () => {
  it('runs a topic drill and reads the PYQ bank', async () => {
    const { app } = createTestApp({ variant: 'all', now: Date.now(), live: { baseUrl: BASE!, fetch: nodeFetch } });
    await app.boot();
    await app.ensureSession();
    await app.chooseLocale('en');
    await app.answerGoal([EXAM], null);
    await app.answerBirthYear(2007);

    const weak = await fetchWeakSpots(app);
    expect(weak.exam).toBe(EXAM);

    const topic = app.deps.content.topics('en', EXAM)[0]!;
    const session = await createSession(app, { mode: 'drill', topic_id: topic.id, count: 5, difficulty: 'adaptive', source: 'hub' });
    expect(session.size).toBeGreaterThan(0);
    const runner = new DrillRunner(app, session, { feedback: 'after_each', timed: false, concepts: [], topicId: topic.id, chapterTest: false });
    // Every question renders from the seed pack, no network needed for the body.
    expect(runner.rows.every((r) => r.question !== null)).toBe(true);

    for (let i = 0; i < runner.rows.length; i++) {
      const q = runner.current.question as unknown as { options?: { id: string }[] };
      // Every question gets the first option; a wrong one is tagged, retried with the key, sent again.
      runner.setDraft({ kind: 'options', optionIds: [q.options?.[0]?.id ?? 'a'] });
      runner.setConfidence('sure');
      runner.check();
      await runner.flush();
      expect(runner.current.result!.confirmed).toBe(true);
      expect(runner.current.solution).not.toBeNull();
      if (!runner.current.result!.correct && runner.canRetry()) {
        runner.setMistake('conceptual');
        const detail = runner.current.result!.local!.detail;
        const key = detail.kind === 'options' ? detail.correctIds : [];
        runner.retry();
        expect(runner.current.attempt).toBe(2);
        runner.setDraft({ kind: 'options', optionIds: key });
        runner.check();
        await runner.flush();
        expect(runner.current.result).toMatchObject({ correct: true, confirmed: true });
        expect(runner.current.first!.correct).toBe(false);
      }
      runner.next();
    }
    await runner.finish('finished');
    const s = runner.summary();
    console.log('drill', JSON.stringify({ size: s.size, answered: s.answered, correct: s.correct, server: { answered: runner.session.answered, correct: runner.session.correct, ended: runner.session.ended_at !== null } }));
    expect(runner.session.answered).toBe(s.answered);
    expect(runner.session.correct).toBe(s.correct);
    expect(runner.session.ended_at).not.toBeNull();

    const papers = await listPyqPapers(app);
    console.log('papers', papers.map((p) => `${p.id} ${p.year} ${p.question_count}`));
    if (papers.length > 0) {
      const paper = await fetchPyqPaper(app, papers[0]!.id);
      expect(paper.items.length).toBe(paper.question_count);
      const pyqs = await listPyqs(app, { year: [paper.year] });
      expect(pyqs.length).toBeGreaterThan(0);
    }

    const report = await reportContent(app, { kind: 'question', item_ref: session.questions[0]!.question_id, reason: 'typo', note: null });
    expect(report.status).toBe('open');
    app.stop();
  });
});
