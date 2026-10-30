/**
 * Reviews on the device (MEM-01/03): the queue from `srs_cards`, card faces from the seed pack's
 * bundles, a rating that moves the FSRS schedule and writes `review_rated`, and the rescue set.
 */
import { SrsScheduler } from '@smriti/app-core';

import { cardFace, Reviews, topicOfRef } from '../src/services/reviews';
import { createTestApp } from './harness';

test('a due content card is queued, shown from the bundle, rated and sent', async () => {
  const { app, clock } = createTestApp();
  await app.boot();
  await app.ensureSession();
  const s = new SrsScheduler({ enableFuzz: false });
  const now = clock.now;
  // One review card due yesterday, one not due for a week, one whose bundle isn't on the device.
  const due = { ...s.newCard('c:fx.chapter-a.topic-a:dd:01', now - 86_400_000), state: 2 as const, stability: 3, difficulty: 5, reps: 3, due_at: new Date(now - 86_400_000).toISOString(), last_review_at: new Date(now - 4 * 86_400_000).toISOString() };
  const later = { ...due, card_ref: 'c:fx.chapter-a.topic-b:dd:01', due_at: new Date(now + 7 * 86_400_000).toISOString() };
  const missing = { ...due, card_ref: 'c:nowhere.topic:dd:01' };
  await app.deps.stores.storage.srs_cards.putMany([due, later, missing]);

  const reviews = new Reviews(app);
  const q = await reviews.queue();
  expect(q.cards.map((c) => c.card_ref).sort()).toEqual(['c:fx.chapter-a.topic-a:dd:01', 'c:nowhere.topic:dd:01']);

  const face = await cardFace(app, due);
  expect(face).toMatchObject({ kind: 'content', front: 'Fixture title A1', back: 'Fixture body A1', topicId: 'fx.chapter-a.topic-a' });
  expect(await cardFace(app, missing)).toBeNull();
  expect(topicOfRef('question', 'q.fx.chapter-a.topic-a.0001')).toBe('fx.chapter-a.topic-a');

  const previews = reviews.preview(due);
  expect(previews.map((p) => p.label)).toEqual(['again', 'hard', 'good', 'easy']);
  expect(previews[3]!.intervalMs).toBeGreaterThan(previews[0]!.intervalMs);

  const next = await reviews.rate(due, 3, 'sure', 4200);
  expect(Date.parse(next.due_at)).toBeGreaterThan(now);
  expect(next.reps).toBe(4);
  const stored = await app.deps.stores.storage.srs_cards.get(due.card_ref);
  expect(stored!.due_at).toBe(next.due_at);
  const outbox = await app.deps.stores.storage.outbox.all();
  const rated = outbox.find((r) => r.type === 'review_rated');
  expect(rated?.payload).toMatchObject({ card_ref: due.card_ref, rating: 3, confidence: 'sure', ms_to_answer: 4200, fsrs_state: { reps: 4, state: 2 } });

  // Rated today: the queue no longer has it; the day's count went up.
  expect((await reviews.queue()).cards.map((c) => c.card_ref)).toEqual(['c:nowhere.topic:dd:01']);
  expect((await reviews.stats()).reviewed).toBe(1);

  // The rescue takes due cards first, then the ones closest to due.
  const rescue = await reviews.session('rescue');
  expect(rescue.length).toBe(3);
  app.stop();
});
