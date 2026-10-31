/** LRN-02 / LRN-06 / LES-12 / LES-13 / LRN-15: test out, reset and chapter downloads on the device. */
import { InMemoryStorage, type Fetch, type FileStore } from '@smriti/app-core';
import { LessonSession, uuidv7, currentCard, type LessonState } from '@smriti/lesson-core';

import { ContentDownloads } from '../src/content/downloads';
import { ContentRepo } from '../src/content/repo';
import { seedPacks } from '../src/seed/generated';
import { defaultChapterChoice, prepareTestOut, resetChapter, saveTestOut, undoTestOut, type PreparedCheck } from '../src/services/checks';
import { saveLessonResult } from '../src/services/progress';
import { createTestApp, nodeCrypto } from './harness';
import { rightAnswer } from './play';

function playCheck(app: ReturnType<typeof createTestApp>['app'], prepared: PreparedCheck, missTopics: Set<string>): LessonState {
  const s = new LessonSession({ config: prepared.config, clock: () => app.now(), tz: 'Asia/Kolkata', newId: (now) => uuidv7(now) });
  s.dispatch({ type: 'start', plan: prepared.plan });
  for (let guard = 0; guard < 400; guard++) {
    const st = s.state;
    const card = currentCard(st);
    switch (st.phase) {
      case 'card':
        s.dispatch({ type: 'next' });
        break;
      case 'question':
        if (card && missTopics.has(card.topicId)) s.dispatch({ type: 'dont_know' });
        else s.dispatch({ type: 'submit', answer: rightAnswer(card!.question!), confidence: 'sure' });
        break;
      case 'feedback':
      case 'explain':
      case 'hint':
        s.dispatch({ type: 'continue' });
        break;
      case 'confidence':
        s.dispatch({ type: 'confidence', value: 'sure' });
        break;
      default:
        return st;
    }
  }
  throw new Error('check did not finish');
}

const running: { stop(): void }[] = [];
afterEach(() => {
  for (const a of running.splice(0)) a.stop();
});

async function bootedApp() {
  const rig = createTestApp();
  await rig.app.boot();
  running.push(rig.app);
  const chapter = rig.app.deps.content.subjects('en', rig.app.examProfileId())[0]!.chapters[0]!;
  return { ...rig, chapter };
}

test('test out marks passed topics learned, never failed, and Undo clears only its marks', async () => {
  const { app, chapter } = await bootedApp();
  const prepared = prepareTestOut(app, chapter.id);
  expect(prepared).not.toBeNull();
  expect(prepared!.plan.mode).toBe('quick_check');
  expect(prepared!.plan.attemptsAllowed).toBe(1);
  expect(prepared!.plan.hints).toBe(false);
  const checked = [...prepared!.checked];
  expect(checked.length).toBeGreaterThan(1);
  const [missed, ...rest] = checked as [string, ...string[]];

  // One topic was already learned by a lesson: the check leaves its row alone.
  const already = rest[0]!;
  await app.deps.stores.storage.topic_status.put({ topic_id: already, status: 'learned', learned_via: 'lesson', percent: 100, updated_at: new Date(app.now()).toISOString() });

  const state = playCheck(app, prepared!, new Set([missed]));
  const out = await saveTestOut(app, prepared!, state);
  expect(out.result.unfinished).toBe(false);
  expect(out.result.passed.sort()).toEqual([...rest].sort());
  expect(out.result.worthALesson).toEqual([missed]);
  expect(out.marks.map((m) => m.topicId).sort()).toEqual(rest.filter((t) => t !== already).sort());

  const rows = new Map((await app.deps.stores.storage.topic_status.all()).map((r) => [r.topic_id, r]));
  expect(rows.get(missed)).toBeUndefined();
  expect(rows.get(already)?.learned_via).toBe('lesson');
  for (const m of out.marks) expect(rows.get(m.topicId)).toMatchObject({ status: 'learned', learned_via: 'test_out' });

  await undoTestOut(app, out.marks);
  const after = new Map((await app.deps.stores.storage.topic_status.all()).map((r) => [r.topic_id, r]));
  for (const m of out.marks) expect(after.get(m.topicId)).toBeUndefined();
  expect(after.get(already)?.learned_via).toBe('lesson');
});

test('an unfinished check marks nothing', async () => {
  const { app, chapter } = await bootedApp();
  const prepared = prepareTestOut(app, chapter.id)!;
  const s = new LessonSession({ config: prepared.config, clock: () => app.now(), tz: 'Asia/Kolkata', newId: (now) => uuidv7(now) });
  s.dispatch({ type: 'start', plan: prepared.plan });
  s.dispatch({ type: 'exit' });
  const out = await saveTestOut(app, prepared, s.state);
  expect(out.result.unfinished).toBe(true);
  expect(out.marks).toEqual([]);
  expect(await app.deps.stores.storage.topic_status.all()).toEqual([]);
});

test('"Mark as learned" checks one topic only', async () => {
  const { app, chapter } = await bootedApp();
  const topicId = prepareTestOut(app, chapter.id)!.plan.cards[0]!.topicId;
  const one = prepareTestOut(app, chapter.id, topicId)!;
  expect(one.topics.map((t) => t.id)).toEqual([topicId]);
  expect(new Set(one.plan.cards.map((c) => c.topicId))).toEqual(new Set([topicId]));
  expect(one.plan.topicId).toBe(topicId);
});

test('reset clears the chapter’s topic status and lesson progress', async () => {
  const { app, chapter } = await bootedApp();
  const [a, b] = chapter.topics as [typeof chapter.topics[0], typeof chapter.topics[0]];
  const now = new Date(app.now()).toISOString();
  await app.deps.stores.storage.topic_status.put({ topic_id: a.id, status: 'learned', learned_via: 'test_out', percent: 100, updated_at: now });
  await saveLessonResult(app, { mode: 'deep_dive', topicId: b.id, biteId: 'x', biteCount: 2, bundleVersion: 'h' } as never, { cardsSeen: 3, accuracy: 1 } as never);
  expect((await app.deps.stores.storage.lesson_progress.all()).length).toBe(1);
  await resetChapter(app, chapter);
  expect(await app.deps.stores.storage.topic_status.all()).toEqual([]);
  expect(await app.deps.stores.storage.lesson_progress.all()).toEqual([]);
});

test('LRN-06 defaults to Test out until most topics are learned', () => {
  expect(defaultChapterChoice(0, 4)).toBe('test_out');
  expect(defaultChapterChoice(2, 4)).toBe('test_out');
  expect(defaultChapterChoice(3, 4)).toBe('practise');
});

// ── LRN-15 downloads ─────────────────────────────────────────────────────────

function memoryFiles(): FileStore & { size(): number } {
  const m = new Map<string, Uint8Array>();
  return {
    read: async (p) => m.get(p) ?? null,
    write: async (p, d) => void m.set(p, d),
    delete: async (p) => void m.delete(p),
    exists: async (p) => m.has(p),
    size: () => m.size,
  };
}

/** A seed pack without the chapter's practice bundles, and a CDN that serves them. */
function rigWithoutPractice(tamper = false) {
  const en = seedPacks.en;
  const manifest = new ContentRepo(seedPacks).manifest('en');
  const practice = Object.values(manifest.topics)
    .map((t) => t?.bundles.practice)
    .filter((b): b is NonNullable<typeof b> => Boolean(b));
  const bundles = { ...en.bundles };
  const served = new Map<string, unknown>();
  for (const b of practice) {
    served.set(b.path, en.bundles[b.path]!());
    delete bundles[b.path];
  }
  const packs = { ...seedPacks, en: { ...en, bundles } };
  const requested: string[] = [];
  const fetch: Fetch = async (url) => {
    requested.push(url);
    const path = url.replace('https://cdn.test/c/', '');
    const body = served.get(path);
    if (!body) return { status: 404, ok: false, json: async () => null, text: async () => '', headers: { get: () => null } };
    const json = tamper ? { ...(body as object), tampered: true } : body;
    return { status: 200, ok: true, json: async () => json, text: async () => JSON.stringify(json), headers: { get: () => null } };
  };
  const storage = new InMemoryStorage();
  const files = memoryFiles();
  const make = (repo: ContentRepo) =>
    new ContentDownloads({ repo, storage, files, fetch, crypto: nodeCrypto, clock: () => Date.parse('2026-10-31T05:00:00Z'), contentBaseUrl: 'https://cdn.test/c', limitBytes: 500 * 1024 * 1024, isOnline: () => true });
  return { packs, practice, requested, storage, files, make };
}

test('a chapter download fetches only what the seed pack lacks, verifies it and opens it offline', async () => {
  const { packs, practice, requested, make } = rigWithoutPractice();
  const repo = new ContentRepo(packs);
  const downloads = make(repo);
  const chapter = repo.subjects('en')[0]!.chapters[0]!;
  const topicId = chapter.topics[0]!.id;
  expect(repo.load('en', topicId, 'practice')).toBeNull();

  const plan = await downloads.plan({ id: chapter.id, kind: 'chapter', chapters: [chapter] }, ['en'], null);
  expect(plan.state).toBe('none');
  expect(plan.missingBytes).toBe(practice.reduce((n, b) => n + b.size_bytes, 0));
  expect(plan.lessons).toBe(chapter.topics.filter((t) => t.hasDeepDive).length);

  const seen: number[] = [];
  await downloads.download(plan, null, (f) => seen.push(f));
  expect(seen.at(-1)).toBe(1);
  expect(requested.length).toBe(practice.length);
  expect(repo.load('en', topicId, 'practice')?.bundle.topic.id).toBe(topicId);
  expect((await downloads.plan({ id: chapter.id, kind: 'chapter', chapters: [chapter] }, ['en'], null)).state).toBe('downloaded');

  // A fresh start: hydrate makes the pinned files readable again without the network.
  const repo2 = new ContentRepo(packs);
  const again = make(repo2);
  expect(await again.hydrate(['en'], null)).toBe(practice.length);
  expect(repo2.load('en', topicId, 'practice')).not.toBeNull();
  expect(requested.length).toBe(practice.length);

  // Remove download: no longer pinned, still readable as cache until evicted.
  await again.remove(await again.plan({ id: chapter.id, kind: 'chapter', chapters: [chapter] }, ['en'], null));
  expect((await again.plan({ id: chapter.id, kind: 'chapter', chapters: [chapter] }, ['en'], null)).state).toBe('none');
  expect(repo2.load('en', topicId, 'practice')).not.toBeNull();
});

test('a bundle whose hash does not match the manifest is refused', async () => {
  const { packs, make } = rigWithoutPractice(true);
  const repo = new ContentRepo(packs);
  const downloads = make(repo);
  const chapter = repo.subjects('en')[0]!.chapters[0]!;
  const plan = await downloads.plan({ id: chapter.id, kind: 'chapter', chapters: [chapter] }, ['en'], null);
  await expect(downloads.download(plan, null, () => undefined)).rejects.toMatchObject({ code: 'hash_mismatch' });
  expect(repo.load('en', chapter.topics[0]!.id, 'practice')).toBeNull();
});

test('the fixture seed pack ships the whole chapter: nothing to download', async () => {
  const repo = new ContentRepo(seedPacks);
  const { make } = rigWithoutPractice();
  const downloads = make(repo);
  const chapter = repo.subjects('en')[0]!.chapters[0]!;
  expect((await downloads.plan({ id: chapter.id, kind: 'chapter', chapters: [chapter] }, ['en', 'hi'], null)).state).toBe('built_in');
});
