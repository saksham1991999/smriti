/**
 * Labs: the sim download cache (LAB-03/04) and per-lab progress (LAB-01). The cache fetches the
 * entry page and only the relative files it names, writes a marker last, and never runs a
 * half-finished download.
 */
import { LABS } from '../src/content/labs';
import { labProgress, nextLab, SimCache, simAssetRefs, simFolderUrl, saveLabProgress, type SimFiles } from '../src/services/labs';
import { createTestApp } from './harness';

const BASE = 'https://cdn.example.test/sims';
const HTML = `<!doctype html><html><head><link rel="stylesheet" href="./assets/style.css"><script defer src="./assets/sim.js"></script>
<link rel="icon" href="https://elsewhere.test/x.png"><script src="//evil.test/a.js"></script><a href="../up.html"></a><img src="data:image/png;base64,AA"></head></html>`;

class MemoryFiles implements SimFiles {
  files = new Map<string, string>();
  fetched: string[] = [];
  failOn: string | null = null;
  constructor(private readonly remote: Record<string, string>) {}
  folderUri(id: string, version: string) {
    return `file:///docs/sims/${id}/${version}/`;
  }
  exists(uri: string) {
    return this.files.has(uri);
  }
  async readText(uri: string) {
    return this.files.get(uri) ?? '';
  }
  writeText(uri: string, text: string) {
    this.files.set(uri, text);
  }
  async download(url: string, uri: string) {
    this.fetched.push(url);
    if (this.failOn && url.endsWith(this.failOn)) throw new Error('network');
    const body = this.remote[url];
    if (body === undefined) throw new Error('404');
    this.files.set(uri, body);
    return body.length;
  }
  removeFolder(uri: string) {
    for (const k of [...this.files.keys()]) if (k.startsWith(uri)) this.files.delete(k);
  }
}

const lab = LABS.find((l) => l.id === 'simple-pendulum')!;

test('the catalogue carries each sim’s tasks and readings from its manifest', () => {
  expect(lab.taskSpecs.length).toBe(lab.tasks);
  expect(lab.taskSpecs[0]).toMatchObject({ id: expect.any(String), prompt: { en: expect.any(String), hi: expect.any(String) }, check: expect.any(Object) });
  expect(lab.readings.map((r) => r.name)).toContain('period');
  expect(lab.entry).toBe('index.html');
});

test('asset references stay inside the sim folder', () => {
  expect(simAssetRefs(HTML).sort()).toEqual(['assets/sim.js', 'assets/style.css']);
  expect(simFolderUrl(`${BASE}/`, lab)).toBe(`${BASE}/simple-pendulum/${lab.version}/`);
});

test('a sim downloads once, then runs offline from the device', async () => {
  const folder = simFolderUrl(BASE, lab);
  const files = new MemoryFiles({ [`${folder}index.html`]: HTML, [`${folder}assets/sim.js`]: 'js', [`${folder}assets/style.css`]: 'css' });
  const cache = new SimCache(files, BASE);
  expect(cache.local(lab)).toBeNull();
  expect(await cache.prepare(lab, false)).toBe('offline');

  const progress: number[] = [];
  const loc = await cache.prepare(lab, true, (b) => progress.push(b));
  expect(loc).toMatchObject({ indexUrl: 'file:///docs/sims/simple-pendulum/1.0.0/index.html', folderUrl: 'file:///docs/sims/simple-pendulum/1.0.0/', cached: true });
  expect(files.fetched).toEqual([`${folder}index.html`, `${folder}assets/style.css`, `${folder}assets/sim.js`]);
  expect(progress[progress.length - 1]).toBe(HTML.length + 5);
  expect(cache.isCached(lab)).toBe(true);

  // Offline later: no network needed.
  files.fetched = [];
  expect(await cache.prepare(lab, false)).toMatchObject({ cached: true });
  expect(files.fetched).toEqual([]);

  cache.remove(lab);
  expect(cache.isCached(lab)).toBe(false);
});

test('a broken download leaves nothing behind', async () => {
  const folder = simFolderUrl(BASE, lab);
  const files = new MemoryFiles({ [`${folder}index.html`]: HTML, [`${folder}assets/style.css`]: 'css' });
  const cache = new SimCache(files, BASE);
  expect(await cache.prepare(lab, true)).toBe('download');
  expect(files.files.size).toBe(0);
  expect(cache.isCached(lab)).toBe(false);
});

test('web runs from the CDN; no base URL means the explainer', async () => {
  const web = new SimCache(null, BASE);
  expect(web.local(lab)).toMatchObject({ indexUrl: `${BASE}/simple-pendulum/1.0.0/index.html`, cached: false });
  expect(web.isCached(lab)).toBe(false);
  expect(await new SimCache(null, undefined).prepare(lab, true)).toBe('not_configured');
});

test('lab progress keeps the best result and the completion', async () => {
  const { app } = createTestApp();
  await app.boot();
  await saveLabProgress(app, lab.id, [{ taskId: 'a', status: 'correct', tries: 1 }, { taskId: 'b', status: 'wrong', tries: 2 }], false);
  await saveLabProgress(app, lab.id, [{ taskId: 'a', status: 'pending', tries: 0 }, { taskId: 'b', status: 'pending', tries: 0 }], true);
  expect(await labProgress(app, lab.id)).toMatchObject({ done: 1, total: 2, completedAt: expect.any(String) });
  expect(nextLab(LABS, lab.id)?.id).not.toBe(lab.id);
  app.stop();
});
