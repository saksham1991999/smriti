/**
 * DEV and TEST only: hands the social fake real single-answer questions from the device's own
 * content bundles, as the server's question bank would pick them. The public body loses its key,
 * solution and hints, which only the fake keeps (as the server does).
 */
import type { SmritiApp } from '../services/app';
import type { FakeDuelQuestion } from './fake-api/social';

export function duelQuestionsFrom(app: SmritiApp, max = 10): FakeDuelQuestion[] {
  const locale = app.ui.getState().locale;
  const exam = app.examProfileId();
  const out: FakeDuelQuestion[] = [];
  for (const topic of app.deps.content.topics(locale, exam)) {
    for (const mode of ['practice', 'deep_dive'] as const) {
      const b = app.deps.content.load(locale, topic.id, mode, exam);
      for (const q of Object.values(b?.bundle.questions ?? {}) as unknown as Record<string, unknown>[]) {
        if (q.type !== 'mcq_single' || out.some((x) => x.id === q.id)) continue;
        const key = (q.answer as { option_ids?: string[] } | undefined)?.option_ids;
        if (!key?.length) continue;
        const { answer: _a, solution: _s, hints: _h, ...body } = q;
        out.push({ id: String(q.id), body, correct: key });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}
