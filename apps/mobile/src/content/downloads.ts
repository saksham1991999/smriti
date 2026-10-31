import { ContentManager, type ContentManagerOptions, type FileStore, type Manifest as ManagerManifest, type ManifestBundle, type Storage } from '@smriti/app-core';
import type { BundleEntry } from '@smriti/content-schema/runtime';

import type { BundleMode, ChapterView, ContentLocale, ContentRepo } from './repo';

/**
 * LRN-15: pin a chapter's bundles on the device. The bundles are the manifest's, fetched and
 * verified by app-core's `ContentManager` (sha256 of canonical JSON, delta patches when offered,
 * LRU eviction of the unpinned rest). Seed-pack bundles ship in the build and are never fetched.
 * Downloaded bundles are handed to `ContentRepo`, so lessons and checks open them like seed ones.
 */

export const DOWNLOAD_MODES: readonly BundleMode[] = ['deep_dive', 'quick_revision', 'practice'];

export interface DownloadItem {
  id: string;
  locale: ContentLocale;
  path: string;
  hash: string;
  bytes: number;
  /** In the build's seed pack. */
  seed: boolean;
  /** Pinned on the device by an earlier download. */
  pinned: boolean;
}

export interface ChapterDownloadPlan {
  /** A chapter id, or a subject id for "All of {subject_name}". */
  scopeId: string;
  scope: 'chapter' | 'subject';
  items: DownloadItem[];
  /** Every bundle of the chapter, for "This chapter · {size} MB". */
  totalBytes: number;
  /** What a download would still fetch. */
  missingBytes: number;
  /** Topics with a Deep Dive, for "{n} lessons". */
  lessons: number;
  /**
   * `built_in`: everything ships in the seed pack. `downloaded`: everything else is pinned.
   * `partial` / `none`: something still needs fetching.
   */
  state: 'built_in' | 'downloaded' | 'partial' | 'none';
}

export interface DownloadsOptions {
  repo: ContentRepo;
  storage: Pick<Storage, 'bundles' | 'asset_cache' | 'transaction'>;
  files: FileStore;
  fetch: ContentManagerOptions['fetch'];
  crypto: ContentManagerOptions['crypto'];
  clock: ContentManagerOptions['clock'];
  /** The content root on the CDN (TRD §8: `cdn.<domain>/c/`). Empty: downloads are off. */
  contentBaseUrl: string;
  limitBytes: number;
  isOnline: () => boolean;
}

export class ContentDownloads {
  readonly manager: ContentManager;

  constructor(private readonly o: DownloadsOptions) {
    this.manager = new ContentManager({
      storage: o.storage,
      files: o.files,
      fetch: o.fetch,
      crypto: o.crypto,
      clock: o.clock,
      cdnBaseUrl: o.contentBaseUrl,
      limitBytes: o.limitBytes,
      isOnline: o.isOnline,
    });
  }

  /** Whether this build can download at all (a CDN is configured). */
  configured(): boolean {
    return this.o.contentBaseUrl.length > 0;
  }

  setLimitBytes(bytes: number): void {
    this.manager.setLimitBytes(bytes);
  }

  /** The manager's view of the manifests for these locales: one entry per published bundle. */
  private managerManifest(locales: readonly ContentLocale[], exam: string | null): ManagerManifest {
    const bundles: ManifestBundle[] = [];
    let version = '';
    for (const locale of locales) {
      const m = this.o.repo.manifest(locale, exam);
      version += `${locale}:${m.version};`;
      for (const [topicId, t] of Object.entries(m.topics)) {
        for (const [kind, e] of Object.entries(t?.bundles ?? {})) {
          if (e) bundles.push(toManagerBundle(e, kind, locale, topicId));
        }
      }
    }
    return { version, bundles };
  }

  async plan(scope: { id: string; kind: 'chapter' | 'subject'; chapters: readonly ChapterView[] }, locales: readonly ContentLocale[], exam: string | null): Promise<ChapterDownloadPlan> {
    const rows = new Map((await this.o.storage.bundles.all()).map((r) => [r.bundle_id, r]));
    const items: DownloadItem[] = [];
    let lessons = 0;
    for (const locale of locales) {
      const m = this.o.repo.manifest(locale, exam);
      for (const tp of scope.chapters.flatMap((c) => c.topics)) {
        const t = m.topics[tp.id];
        if (!t) continue;
        if (locale === locales[0] && t.bundles.deep_dive) lessons += 1;
        for (const mode of DOWNLOAD_MODES) {
          const e = t.bundles[mode];
          if (!e) continue;
          const row = rows.get(e.id);
          items.push({
            id: e.id,
            locale,
            path: e.path,
            hash: e.hash,
            bytes: e.size_bytes,
            seed: this.o.repo.inSeed(locale, e.path),
            pinned: Boolean(row && row.pinned && row.hash === e.hash),
          });
        }
      }
    }
    const fetchable = items.filter((i) => !i.seed);
    const missing = fetchable.filter((i) => !i.pinned);
    const state = fetchable.length === 0 ? 'built_in' : missing.length === 0 ? 'downloaded' : missing.length < fetchable.length ? 'partial' : 'none';
    return {
      scopeId: scope.id,
      scope: scope.kind,
      items,
      totalBytes: items.reduce((n, i) => n + i.bytes, 0),
      missingBytes: missing.reduce((n, i) => n + i.bytes, 0),
      lessons,
      state,
    };
  }

  /**
   * Fetches and pins every bundle the plan still needs, one after another, reporting the share
   * of bytes done. Throws `ContentError` (offline, download_failed, hash_mismatch, storage_full).
   */
  async download(plan: ChapterDownloadPlan, exam: string | null, onProgress: (fraction: number) => void, signal?: { cancelled: boolean }): Promise<void> {
    const locales = [...new Set(plan.items.map((i) => i.locale))];
    this.manager.setManifest(this.managerManifest(locales, exam));
    const todo = plan.items.filter((i) => !i.seed && !i.pinned);
    const total = todo.reduce((n, i) => n + i.bytes, 0) || 1;
    let done = 0;
    onProgress(0);
    for (const item of todo) {
      if (signal?.cancelled) return;
      await this.manager.ensure(item.id, { pin: true });
      this.o.repo.addBundle(item.locale, item.path, await this.manager.open(item.id));
      done += item.bytes;
      onProgress(done / total);
    }
  }

  /** "Remove download": the bundles stop being pinned and become ordinary cache (LRU evicts them). */
  async remove(plan: ChapterDownloadPlan): Promise<void> {
    for (const item of plan.items) if (!item.seed && item.pinned) await this.manager.pin(item.id, false);
  }

  /**
   * At start-up: bundles downloaded in earlier sessions that match the current manifests become
   * readable again. Stale or missing files are left for the next download.
   */
  async hydrate(locales: readonly ContentLocale[], exam: string | null): Promise<number> {
    const manifest = this.managerManifest(locales, exam);
    this.manager.setManifest(manifest);
    const current = new Map(manifest.bundles.map((b) => [b.bundle_id, b]));
    let n = 0;
    for (const row of await this.o.storage.bundles.all()) {
      const remote = current.get(row.bundle_id);
      const locale = remote?.locale as ContentLocale | undefined;
      if (!remote || remote.hash !== row.hash || !locale || this.o.repo.hasBundle(locale, remote.url)) continue;
      try {
        if (!(await this.o.files.exists(row.path))) continue;
        this.o.repo.addBundle(locale, remote.url, await this.manager.open(row.bundle_id));
        n += 1;
      } catch {
        // A damaged file: the next download fetches it again.
      }
    }
    return n;
  }

  usage() {
    return this.manager.usage();
  }
}

function toManagerBundle(e: BundleEntry, kind: string, locale: ContentLocale, topicId: string): ManifestBundle {
  return {
    bundle_id: e.id,
    hash: e.hash,
    bytes: e.size_bytes,
    url: e.path,
    kind,
    locale,
    topic_id: topicId,
    patches: e.patches.map((p) => ({ from_hash: p.from_hash, url: p.path, bytes: p.size_bytes })),
  };
}

/** Megabytes with one decimal for sizes under 10 MB ("2.4 MB"), whole above. */
export function megabytesLabel(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb > 0 && mb < 0.1) return '0.1';
  return mb < 10 ? mb.toFixed(1) : String(Math.round(mb));
}
