import { sha256Hex, utf8Encode, type CryptoLike } from '../crypto';
import type { Clock, Fetch } from '../platform';
import type { AssetCacheRow, BundleRow, Storage } from '../storage/types';
import { toIso } from '../time';

/**
 * Content downloads (TRD §3.2, me-money §3.8): the manifest lists bundles, which are
 * content-addressed (hash in the filename) and immutable. A client holding an older version
 * fetches a delta patch when the manifest offers one from its hash, else the full bundle.
 * Least-recently-used, unpinned items are evicted above the limit (500 MB default, student
 * configurable). Explicit downloads and the seed pack are pinned.
 *
 * Hashes are SHA-256 hex of the canonical JSON of the bundle (sorted keys, no whitespace), so a
 * patched bundle can be verified without the publisher's exact bytes.
 */

export interface ManifestPatch {
  from_hash: string;
  url: string;
  bytes: number;
}

export interface ManifestBundle {
  bundle_id: string;
  hash: string;
  bytes: number;
  /** Absolute, or relative to the CDN base URL. */
  url: string;
  kind?: string;
  locale?: string;
  topic_id?: string;
  patches?: ManifestPatch[];
}

export interface Manifest {
  version: string;
  bundles: ManifestBundle[];
}

/** File access for bundle and media files: expo-file-system on mobile, Cache Storage / OPFS on web. */
export interface FileStore {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** A bundle's JSON shape as far as patching needs it: cards with ids, plus other fields. */
export interface BundleJson {
  cards?: { id: string; [k: string]: unknown }[];
  [k: string]: unknown;
}

/** Delta patch: added, changed and removed cards, plus replaced top-level fields. */
export interface BundlePatch {
  from_hash: string;
  to_hash: string;
  cards?: { added?: { id: string; [k: string]: unknown }[]; changed?: { id: string; [k: string]: unknown }[]; removed?: string[] };
  set?: Record<string, unknown>;
}

export interface ManifestDiff {
  current: BundleRow[];
  /** Local bundles with a newer hash in the manifest; `patch` set when one applies. */
  stale: { local: BundleRow; remote: ManifestBundle; patch: ManifestPatch | null }[];
  /** Manifest bundles not on the device. */
  missing: ManifestBundle[];
  /** Local bundles no longer in the manifest (kept until evicted; never deleted if pinned). */
  orphaned: BundleRow[];
}

export function diffManifest(local: readonly BundleRow[], manifest: Manifest): ManifestDiff {
  const remote = new Map(manifest.bundles.map((b) => [b.bundle_id, b]));
  const localIds = new Set(local.map((b) => b.bundle_id));
  const diff: ManifestDiff = { current: [], stale: [], missing: [], orphaned: [] };
  for (const l of local) {
    const r = remote.get(l.bundle_id);
    if (!r) diff.orphaned.push(l);
    else if (r.hash === l.hash) diff.current.push(l);
    else diff.stale.push({ local: l, remote: r, patch: r.patches?.find((p) => p.from_hash === l.hash) ?? null });
  }
  for (const r of manifest.bundles) if (!localIds.has(r.bundle_id)) diff.missing.push(r);
  return diff;
}

/** Canonical JSON: object keys sorted, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function applyBundlePatch(bundle: BundleJson, patch: BundlePatch): BundleJson {
  const out: BundleJson = { ...bundle, ...(patch.set ?? {}) };
  if (patch.cards) {
    const removed = new Set(patch.cards.removed ?? []);
    const changed = new Map((patch.cards.changed ?? []).map((c) => [c.id, c]));
    const cards = (bundle.cards ?? []).filter((c) => !removed.has(c.id)).map((c) => changed.get(c.id) ?? c);
    const ids = new Set(cards.map((c) => c.id));
    for (const a of patch.cards.added ?? []) if (!ids.has(a.id)) cards.push(a);
    out.cards = cards;
  }
  return out;
}

function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++] ?? 0;
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b < 0xe0) cp = ((b & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    else if (b < 0xf0) cp = ((b & 0x0f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    else cp = ((b & 0x07) << 18) | (((bytes[i++] ?? 0) & 0x3f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

export class ContentError extends Error {
  constructor(
    readonly code: 'not_in_manifest' | 'offline' | 'download_failed' | 'hash_mismatch' | 'storage_full',
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface ContentManagerOptions {
  storage: Pick<Storage, 'bundles' | 'asset_cache' | 'transaction'>;
  files: FileStore;
  fetch: Fetch;
  crypto: CryptoLike;
  clock: Clock;
  cdnBaseUrl: string;
  /** `content.cache_limit_mb` × 1 MiB; the student can change it in ME-21. */
  limitBytes: number;
  isOnline: () => boolean;
}

export interface UsageReport {
  totalBytes: number;
  pinnedBytes: number;
  limitBytes: number;
  bundles: number;
  assets: number;
}

export class ContentManager {
  private manifest: Manifest | null = null;
  constructor(private readonly o: ContentManagerOptions) {}

  setManifest(m: Manifest) {
    this.manifest = m;
  }

  setLimitBytes(bytes: number) {
    this.o.limitBytes = bytes;
  }

  static pathFor(bundleId: string, hash: string): string {
    return `bundles/${encodeURIComponent(bundleId)}.${hash}.json`;
  }

  async diff(): Promise<ManifestDiff> {
    if (!this.manifest) throw new ContentError('not_in_manifest', 'no manifest');
    return diffManifest(await this.o.storage.bundles.all(), this.manifest);
  }

  /** Reads a bundle, downloading or patching it first when needed. Touches it for LRU. */
  async open(bundleId: string): Promise<BundleJson> {
    let row = await this.ensure(bundleId);
    let data = await this.o.files.read(row.path);
    if (!data) {
      // The file went missing (OS cache purge): forget the row and fetch once more.
      await this.o.storage.bundles.delete(bundleId);
      row = await this.ensure(bundleId);
      data = await this.o.files.read(row.path);
      if (!data) throw new ContentError('storage_full', bundleId);
    }
    return JSON.parse(decodeUtf8(data)) as BundleJson;
  }

  /**
   * Makes sure the manifest's version of a bundle is on the device. Offline, an older local copy
   * is used as is (downloaded lessons keep working).
   */
  async ensure(bundleId: string, opts: { pin?: boolean } = {}): Promise<BundleRow> {
    const now = toIso(this.o.clock());
    const local = await this.o.storage.bundles.get(bundleId);
    const remote = this.manifest?.bundles.find((b) => b.bundle_id === bundleId);

    if (local && (!remote || remote.hash === local.hash || !this.o.isOnline())) {
      const touched = { ...local, last_opened_at: now, pinned: local.pinned || Boolean(opts.pin) };
      await this.o.storage.bundles.put(touched);
      return touched;
    }
    if (!remote) throw new ContentError('not_in_manifest', bundleId);
    if (!this.o.isOnline()) throw new ContentError('offline', bundleId);

    let json: BundleJson | null = null;
    const patch = local ? remote.patches?.find((p) => p.from_hash === local.hash) : undefined;
    if (local && patch) json = await this.tryPatch(local, patch, remote.hash);
    if (!json) json = await this.download(remote);

    const text = canonicalJson(json);
    const bytes = utf8Encode(text);
    const path = ContentManager.pathFor(bundleId, remote.hash);
    await this.o.files.write(path, bytes);
    const row: BundleRow = {
      bundle_id: bundleId,
      hash: remote.hash,
      path,
      bytes: bytes.length,
      pinned: (local?.pinned ?? false) || Boolean(opts.pin),
      last_opened_at: now,
      source: opts.pin ? 'download' : 'cache',
      ...(remote.kind ? { kind: remote.kind } : {}),
      ...(remote.locale ? { locale: remote.locale } : {}),
    };
    await this.o.storage.bundles.put(row);
    if (local && local.path !== path) await this.o.files.delete(local.path);
    await this.evict([bundleId]);
    return row;
  }

  private async tryPatch(local: BundleRow, patch: ManifestPatch, toHash: string): Promise<BundleJson | null> {
    try {
      const [oldBytes, patchJson] = await Promise.all([this.o.files.read(local.path), this.fetchJson(patch.url)]);
      if (!oldBytes) return null;
      const next = applyBundlePatch(JSON.parse(decodeUtf8(oldBytes)) as BundleJson, patchJson as BundlePatch);
      const hash = await sha256Hex(this.o.crypto, canonicalJson(next));
      return hash === toHash ? next : null; // mismatch: fall back to the full bundle
    } catch {
      return null;
    }
  }

  private async download(remote: ManifestBundle): Promise<BundleJson> {
    const json = (await this.fetchJson(remote.url)) as BundleJson;
    const hash = await sha256Hex(this.o.crypto, canonicalJson(json));
    if (hash !== remote.hash) throw new ContentError('hash_mismatch', remote.bundle_id);
    return json;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const full = /^https?:\/\//.test(url) ? url : `${this.o.cdnBaseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
    let res;
    try {
      res = await this.o.fetch(full, { method: 'GET', headers: { Accept: 'application/json' } });
    } catch {
      throw new ContentError('download_failed', 'network');
    }
    if (!res.ok) throw new ContentError('download_failed', `http_${res.status}`);
    return res.json();
  }

  async pin(bundleId: string, pinned = true) {
    const row = await this.o.storage.bundles.get(bundleId);
    if (row) await this.o.storage.bundles.put({ ...row, pinned });
  }

  /** When Pro ends, pinned downloads become normal cache (the seed pack stays pinned). */
  async unpinDownloads() {
    for (const row of await this.o.storage.bundles.all()) {
      if (row.pinned && row.source !== 'seed') await this.o.storage.bundles.put({ ...row, pinned: false });
    }
  }

  async usage(): Promise<UsageReport> {
    const [bundles, assets] = await Promise.all([this.o.storage.bundles.all(), this.o.storage.asset_cache.all()]);
    const all = [...bundles, ...assets];
    return {
      totalBytes: all.reduce((a, b) => a + b.bytes, 0),
      pinnedBytes: all.filter((x) => x.pinned).reduce((a, b) => a + b.bytes, 0),
      limitBytes: this.o.limitBytes,
      bundles: bundles.length,
      assets: assets.length,
    };
  }

  /**
   * LRU eviction of unpinned bundles and assets until total ≤ limit. `keep` protects keys in use
   * (the bundle being opened). Returns evicted keys.
   */
  async evict(keep: readonly string[] = []): Promise<string[]> {
    const [bundles, assets] = await Promise.all([this.o.storage.bundles.all(), this.o.storage.asset_cache.all()]);
    type Item = { key: string; bytes: number; pinned: boolean; at: string; path: string; table: 'bundles' | 'asset_cache' };
    const items: Item[] = [
      ...bundles.map((b) => ({ key: b.bundle_id, bytes: b.bytes, pinned: b.pinned, at: b.last_opened_at ?? '', path: b.path, table: 'bundles' as const })),
      ...assets.map((a: AssetCacheRow) => ({ key: a.key, bytes: a.bytes, pinned: a.pinned, at: a.last_access_at, path: a.path, table: 'asset_cache' as const })),
    ];
    let total = items.reduce((a, b) => a + b.bytes, 0);
    const victims = items.filter((i) => !i.pinned && !keep.includes(i.key)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const evicted: string[] = [];
    for (const v of victims) {
      if (total <= this.o.limitBytes) break;
      await this.o.files.delete(v.path);
      if (v.table === 'bundles') await this.o.storage.bundles.delete(v.key);
      else await this.o.storage.asset_cache.delete(v.key);
      total -= v.bytes;
      evicted.push(v.key);
    }
    return evicted;
  }

  /** ME-21 "Clear cache": removes every unpinned bundle and asset. */
  async clearCache(): Promise<number> {
    const before = await this.usage();
    const limit = this.o.limitBytes;
    this.o.limitBytes = 0;
    try {
      await this.evict();
    } finally {
      this.o.limitBytes = limit;
    }
    return before.totalBytes - (await this.usage()).totalBytes;
  }

  /** Sign-out: private assets go; public bundles and media stay for the next profile. */
  async wipePrivateAssets(): Promise<void> {
    for (const a of await this.o.storage.asset_cache.all()) {
      if (a.private) {
        await this.o.files.delete(a.path);
        await this.o.storage.asset_cache.delete(a.key);
      }
    }
  }
}
