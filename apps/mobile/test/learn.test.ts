/** LRN-01/02 progress from the device: chapter status, the CTA's topic, filters and review rows. */
import { SrsScheduler } from '@smriti/app-core';

import type { ChapterView, SubjectView, TopicView } from '../src/content/repo';
import { chapterProgress, dueByTopic, filterChapters, subjectProgress } from '../src/services/learn';
import type { TopicState } from '../src/services/progress';
import { createTestApp } from './harness';

const topic = (id: string, minutes: number | null): TopicView => ({ id, name: id, chapterId: 'ch', sort: 0, depth: {}, hasDeepDive: true, hasQuickRevision: true, freeDeepDive: true, minutes });
const chapter = (id: string, topics: TopicView[]): ChapterView => ({ id, name: id, subjectId: 's', unitId: 'u', free: true, topics });
const state = (tp: TopicView, status: TopicState['status'], percent: number): TopicState => ({ topic: tp, status, percent, bitesCompleted: [] });

test('chapter progress picks the topic to continue and the minutes left', () => {
  const [a, b, c] = [topic('a', 5), topic('b', 7), topic('c', null)];
  const ch = chapter('ch1', [a, b, c]);
  const states = new Map([
    ['a', state(a, 'learned', 100)],
    ['c', state(c, 'in_progress', 40)],
  ]);
  const p = chapterProgress(ch, states);
  expect(p).toMatchObject({ done: 1, total: 3, percent: 47, status: 'in_progress', nextInProgress: true, minutesLeft: 7 });
  expect(p.next?.id).toBe('c');

  const fresh = chapterProgress(ch, new Map());
  expect(fresh).toMatchObject({ status: 'not_started', nextInProgress: false, percent: 0 });
  expect(fresh.next?.id).toBe('a');

  const all = new Map([a, b, c].map((tp) => [tp.id, state(tp, 'learned', 100)] as const));
  expect(chapterProgress(ch, all)).toMatchObject({ status: 'learned', next: null, done: 3 });
});

test('subject filters keep chapters by status', () => {
  const [a, b] = [topic('a', 5), topic('b', 5)];
  const subject: SubjectView = { id: 's', name: 'S', colorFamily: 'physics', chapters: [chapter('one', [a]), chapter('two', [b])] };
  const sp = subjectProgress(subject, new Map([['a', state(a, 'in_progress', 50)]]));
  expect(sp).toMatchObject({ done: 0, total: 2, percent: 25 });
  expect(filterChapters(subject, sp, 'in_progress').map((c) => c.id)).toEqual(['one']);
  expect(filterChapters(subject, sp, 'not_started').map((c) => c.id)).toEqual(['two']);
  expect(filterChapters(subject, sp, 'all')).toHaveLength(2);
});

test('review rows count cards due today per topic', async () => {
  const { app, clock } = createTestApp();
  await app.boot();
  const s = new SrsScheduler({ enableFuzz: false });
  const base = { ...s.newCard('c:fx.chapter-a.topic-a:dd:01', clock.now), state: 2 as const, stability: 3, difficulty: 5, reps: 3, due_at: new Date(clock.now - 3_600_000).toISOString() };
  await app.deps.stores.storage.srs_cards.putMany([
    base,
    { ...base, card_ref: 'q:q.fx.chapter-a.topic-a.0002' },
    { ...base, card_ref: 'c:fx.chapter-a.topic-b:dd:01', due_at: new Date(clock.now + 5 * 86_400_000).toISOString() },
    { ...base, card_ref: 'c:fx.chapter-a.topic-b:dd:02', state: 0 as const },
  ]);
  const due = await dueByTopic(app);
  expect(due.get('fx.chapter-a.topic-a')).toBe(2);
  expect(due.has('fx.chapter-a.topic-b')).toBe(false);
  app.stop();
});
