/**
 * LRN-02 (long-press actions, LRN-06, reset), LES-12 and MEM-03 Undo through the real screens on
 * the dev fake API and in-memory storage.
 */
import { SrsScheduler } from '@smriti/app-core';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import path from 'node:path';

import { provideAppForTests } from '../src/services/device';
import { createTestApp, type TestRig } from './harness';

jest.setTimeout(60_000);

const appDir = path.join(__dirname, '..', 'app');
const CHAPTER = 'fx.chapter-a';
let rig: TestRig;

/** Polls a store read outside act(), so no async act overlaps the next screen's updates. */
async function until(check: () => Promise<boolean>, ms = 10_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condition not met');
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function onboard(r: TestRig) {
  const { app } = r;
  await app.boot();
  await app.ensureSession();
  await app.chooseLocale('en');
  await app.answerGoal(['jee-main-2027'], null);
  await app.answerBirthYear(2008);
  await app.answerLevel('starting');
  await app.nameBuddy('cat', 'Miko');
  await app.plantSeed();
  await app.setDailyGoal(10, true);
  await app.answerReminder(null);
}

beforeEach(() => {
  rig = createTestApp({ variant: 'jee' });
  provideAppForTests(rig.app);
});

afterEach(() => {
  rig.app.stop();
  provideAppForTests(null);
});

test('long-press a topic, then Mark as learned opens a one-topic test out', async () => {
  await onboard(rig);
  const topic = rig.app.deps.content.subjects('en', rig.app.examProfileId())[0]!.chapters[0]!.topics[0]!;
  await renderRouter(appDir, { initialUrl: `/chapter/${CHAPTER}` });
  await screen.findByTestId('LRN-02', {}, { timeout: 10_000 });
  await act(async () => fireEvent(screen.getByTestId(`topic-${topic.id}`), 'longPress'));
  await screen.findByTestId('topic-action-mark');
  await fireEvent.press(screen.getByTestId('topic-action-mark'));
  await screen.findByTestId('LES-12', {}, { timeout: 10_000 });
  expect(screen.getByTestId('check-chip')).toBeTruthy();
  expect(screen.getByTestId('check-confidence-note')).toBeTruthy();
});

test('LRN-06 offers test out from the device, and reset clears the chapter', async () => {
  await onboard(rig);
  const now = new Date(rig.app.now()).toISOString();
  const first = rig.app.deps.content.subjects('en', rig.app.examProfileId())[0]!.chapters[0]!.topics[0]!;
  await rig.app.deps.stores.storage.topic_status.put({ topic_id: first.id, status: 'learned', learned_via: 'test_out', percent: 100, updated_at: now });
  await renderRouter(appDir, { initialUrl: `/chapter/${CHAPTER}` });
  await screen.findByTestId('LRN-02', {}, { timeout: 10_000 });

  await fireEvent.press(screen.getByTestId('chapter-tool-test'));
  await screen.findByTestId('chapter-choice-test-out');
  expect(screen.getByTestId('chapter-choice-practise')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('chapter-menu'));
  await fireEvent.press(await screen.findByTestId('chapter-reset'));
  await fireEvent.press(await screen.findByTestId('chapter-reset-confirm'));
  await until(async () => (await rig.app.deps.stores.storage.topic_status.all()).length === 0);
  await screen.findByTestId('chapter-toast');
});

test('MEM-03 Undo drops the last rating before it reaches the outbox', async () => {
  await onboard(rig);
  const s = new SrsScheduler({ enableFuzz: false });
  const now = rig.app.now();
  const card = (ref: string) => ({ ...s.newCard(ref, now - 86_400_000), state: 2 as const, stability: 3, difficulty: 5, reps: 3, due_at: new Date(now - 3_600_000).toISOString(), last_review_at: new Date(now - 4 * 86_400_000).toISOString() });
  await rig.app.deps.stores.storage.srs_cards.putMany([card('c:fx.chapter-a.topic-a:dd:01'), card('c:fx.chapter-a.topic-a:dd:02')]);
  const rated = async () => (await rig.app.deps.stores.storage.outbox.all()).filter((r) => r.type === 'review_rated');

  await renderRouter(appDir, { initialUrl: '/review' });
  await screen.findByTestId('MEM-03', {}, { timeout: 10_000 });
  await fireEvent.press(await screen.findByTestId('review-show', {}, { timeout: 10_000 }));
  await fireEvent.press(within(await screen.findByTestId('review-rate', {}, { timeout: 10_000 })).getAllByRole('button')[2]!);
  await screen.findByTestId('review-undo', {}, { timeout: 10_000 });
  expect(await rated()).toHaveLength(0);

  await fireEvent.press(screen.getByTestId('review-undo'));
  // Back on the first card with its answer showing; nothing was written.
  await screen.findByTestId('review-rate', {}, { timeout: 10_000 });
  expect(screen.queryByTestId('review-undo')).toBeNull();
  expect(await rated()).toHaveLength(0);

  // Rate it again, then the second: the first commits when the second is rated.
  await fireEvent.press(within(await screen.findByTestId('review-rate', {}, { timeout: 10_000 })).getAllByRole('button')[2]!);
  await fireEvent.press(await screen.findByTestId('review-show', {}, { timeout: 10_000 }));
  await fireEvent.press(within(await screen.findByTestId('review-rate', {}, { timeout: 10_000 })).getAllByRole('button')[2]!);
  await screen.findByTestId('MEM-04', {}, { timeout: 10_000 });
  await until(async () => (await rated()).length === 2);
});
