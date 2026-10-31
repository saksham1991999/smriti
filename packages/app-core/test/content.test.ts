import { describe, expect, it } from 'vitest';

import {
  ContentManager,
  InMemoryStorage,
  applyBundlePatch,
  canonicalJson,
  diffManifest,
  sha256Hex,
  type BundleJson,
  type BundleRow,
  type FileStore,
  type Manifest,
} from '../src';
import { fakeFetch, jsonResponse, nodeCrypto } from './helpers';

class MemoryFiles implements FileStore {
  files = new Map<string, Uint8Array>();
  async read(p: string) {
    return this.files.get(p) ?? null;
  }
  async write(p: string, d: Uint8Array) {
    this.files.set(p, d);
  }
  async delete(p: string) {
    this.files.delete(p);
  }
  async exists(p: string) {
    return this.files.has(p);
  }
}

const hashOf = (b: unknown) => sha256Hex(nodeCrypto, canonicalJson(b));

const v1: BundleJson = { id: 'phy.kin', version: 1, cards: [{ id: 'a', t: 'one' }, { id: 'b', t: 'two' }] };
const v2: BundleJson = { id: 'phy.kin', version: 2, cards: [{ id: 'a', t: 'ONE' }, { id: 'c', t: 'three' }] };
const patch12 = { cards: { changed: [{ id: 'a', t: 'ONE' }], removed: ['b'], added: [{ id: 'c', t: 'three' }] }, set: { version: 2 } };

async function setup(opts: { online?: boolean; limitBytes?: number; badPatch?: boolean } = {}) {
  const h1 = await hashOf(v1);
  const h2 = await hashOf(v2);
  const routes: Record<string, unknown> = {
    'https://cdn.test/b/phy.kin.v1.json': v1,
    'https://cdn.test/b/phy.kin.v2.json': v2,
    'https://cdn.test/p/phy.kin.1-2.json': { from_hash: h1, to_hash: h2, ...(opts.badPatch ? { set: { version: 99 } } : patch12) },
    'https://cdn.test/b/other.json': { id: 'other', cards: [{ id: 'x', t: 'x'.repeat(100) }] },
    'https://cdn.test/b/tampered.json': { id: 'tampered' },
  };
  const server = fakeFetch((url) => (url in routes ? jsonResponse(200, routes[url]) : jsonResponse(404, {})));
  const storage = new InMemoryStorage();
  const files = new MemoryFiles();
  let now = Date.UTC(2026, 9, 29);
  let online = opts.online ?? true;
  const cm = new ContentManager({
    storage, files, fetch: server.fetch, crypto: nodeCrypto, clock: () => (now += 1000), cdnBaseUrl: 'https://cdn.test/',
    limitBytes: opts.limitBytes ?? 500 * 1024 * 1024, isOnline: () => online,
  });
  const otherHash = await hashOf(routes['https://cdn.test/b/other.json']);
  const manifest = (hash: string, withPatch = true): Manifest => ({
    version: '1',
    bundles: [
      { bundle_id: 'phy.kin', hash, bytes: 100, url: hash === h1 ? 'b/phy.kin.v1.json' : '/b/phy.kin.v2.json', patches: withPatch ? [{ from_hash: h1, url: 'p/phy.kin.1-2.json', bytes: 50 }] : [] },
      { bundle_id: 'other', hash: otherHash, bytes: 100, url: 'b/other.json' },
      { bundle_id: 'tampered', hash: 'f'.repeat(64), bytes: 10, url: 'b/tampered.json' },
    ],
  });
  return { cm, storage, files, server, h1, h2, manifest, setOnline: (v: boolean) => (online = v) };
}

describe('canonical JSON and patches', () => {
  it('sorts keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }], 'आ': 'x' })).toBe('{"a":[{"d":2}],"b":1,"आ":"x"}');
  });
  it('applies a card patch', async () => {
    expect(applyBundlePatch(v1, { from_hash: '', to_hash: '', ...patch12 })).toEqual(v2);
    expect(await hashOf(applyBundlePatch(v1, { from_hash: '', to_hash: '', ...patch12 }))).toBe(await hashOf(v2));
  });
});

describe('diffManifest', () => {
  it('splits current, stale (with patch), missing and orphaned', () => {
    const row = (id: string, hash: string): BundleRow => ({ bundle_id: id, hash, path: `${id}.json`, bytes: 1, pinned: false, last_opened_at: null });
    const m: Manifest = { version: '2', bundles: [{ bundle_id: 'a', hash: 'h1', bytes: 1, url: '' }, { bundle_id: 'b', hash: 'h3', bytes: 1, url: '', patches: [{ from_hash: 'h2', url: 'p', bytes: 1 }] }, { bundle_id: 'c', hash: 'h', bytes: 1, url: '' }] };
    const d = diffManifest([row('a', 'h1'), row('b', 'h2'), row('z', 'h')], m);
    expect(d.current.map((r) => r.bundle_id)).toEqual(['a']);
    expect(d.stale[0]?.patch?.url).toBe('p');
    expect(d.missing.map((r) => r.bundle_id)).toEqual(['c']);
    expect(d.orphaned.map((r) => r.bundle_id)).toEqual(['z']);
  });
});

describe('ContentManager', () => {
  it('downloads by hash, verifies it, stores it content-addressed', async () => {
    const { cm, storage, files, manifest, h1 } = await setup();
    cm.setManifest(manifest(h1));
    expect(await cm.open('phy.kin')).toEqual(v1);
    const row = await storage.bundles.get('phy.kin');
    expect(row).toMatchObject({ hash: h1, path: `bundles/phy.kin.${h1}.json`, pinned: false });
    expect(files.files.has(row!.path)).toBe(true);
  });

  it('rejects a download whose hash does not match', async () => {
    const { cm, manifest, h1 } = await setup();
    cm.setManifest(manifest(h1));
    await expect(cm.ensure('tampered')).rejects.toMatchObject({ code: 'hash_mismatch' });
    await expect(cm.ensure('nope')).rejects.toMatchObject({ code: 'not_in_manifest' });
  });

  it('applies a delta patch and deletes the old file', async () => {
    const { cm, files, server, manifest, h1, h2 } = await setup();
    cm.setManifest(manifest(h1));
    await cm.ensure('phy.kin');
    cm.setManifest(manifest(h2));
    expect((await cm.diff()).stale[0]?.patch).not.toBeNull();
    expect(await cm.open('phy.kin')).toEqual(v2);
    expect(server.calls.map((c) => c.url)).toContain('https://cdn.test/p/phy.kin.1-2.json');
    expect(server.calls.map((c) => c.url)).not.toContain('https://cdn.test/b/phy.kin.v2.json');
    expect(files.files.has(`bundles/phy.kin.${h1}.json`)).toBe(false);
  });

  it('falls back to the full bundle when the patched hash does not match', async () => {
    const { cm, server, manifest, h1, h2 } = await setup({ badPatch: true });
    cm.setManifest(manifest(h1));
    await cm.ensure('phy.kin');
    cm.setManifest(manifest(h2));
    expect(await cm.open('phy.kin')).toEqual(v2);
    expect(server.calls.map((c) => c.url)).toContain('https://cdn.test/b/phy.kin.v2.json');
  });

  it('offline: an older local copy keeps working; nothing local fails cleanly', async () => {
    const { cm, manifest, h1, h2, setOnline } = await setup();
    cm.setManifest(manifest(h1));
    await cm.ensure('phy.kin');
    cm.setManifest(manifest(h2));
    setOnline(false);
    expect(await cm.open('phy.kin')).toEqual(v1);
    await expect(cm.ensure('other')).rejects.toMatchObject({ code: 'offline' });
  });

  it('evicts least recently used unpinned items above the limit, never pinned ones or the one in use', async () => {
    const { cm, storage, manifest, h1 } = await setup({ limitBytes: 150 });
    cm.setManifest(manifest(h1));
    await cm.ensure('phy.kin', { pin: true });
    await cm.ensure('other');
    await storage.asset_cache.put({ key: 'img1', path: 'a/img1', bytes: 40, last_access_at: '2020-01-01T00:00:00Z', pinned: false });
    const evicted = await cm.evict();
    expect(evicted).toEqual(['img1', 'other']);
    expect(await storage.bundles.get('phy.kin')).toBeDefined();
    const u = await cm.usage();
    expect(u.totalBytes).toBeLessThanOrEqual(150);
    expect(u.pinnedBytes).toBe(u.totalBytes);
    // The bundle just opened is kept even when it alone is over the limit.
    cm.setLimitBytes(1);
    await storage.bundles.delete('other');
    await cm.ensure('other');
    expect(await storage.bundles.get('other')).toBeDefined();
  });

  it('clear cache keeps pins; Pro ending unpins downloads but not the seed pack', async () => {
    const { cm, storage, manifest, h1 } = await setup();
    cm.setManifest(manifest(h1));
    await cm.ensure('phy.kin', { pin: true });
    await cm.ensure('other');
    await storage.bundles.put({ bundle_id: 'seed', hash: 'h', path: 'seed.json', bytes: 5, pinned: true, last_opened_at: null, source: 'seed' });
    expect(await cm.clearCache()).toBeGreaterThan(0);
    expect((await storage.bundles.all()).map((b) => b.bundle_id).sort()).toEqual(['phy.kin', 'seed']);
    await cm.unpinDownloads();
    expect((await storage.bundles.get('phy.kin'))?.pinned).toBe(false);
    expect((await storage.bundles.get('seed'))?.pinned).toBe(true);
  });

  it('sign-out wipes private assets only', async () => {
    const { cm, storage } = await setup();
    await storage.asset_cache.put({ key: 'tutor-img', path: 'p1', bytes: 1, last_access_at: 'x', pinned: false, private: true });
    await storage.asset_cache.put({ key: 'lesson-img', path: 'p2', bytes: 1, last_access_at: 'x', pinned: false });
    await cm.wipePrivateAssets();
    expect((await storage.asset_cache.all()).map((a) => a.key)).toEqual(['lesson-img']);
  });
});
