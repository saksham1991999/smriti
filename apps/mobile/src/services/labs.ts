import type { TaskProgress } from '@smriti/sim-bridge';

import type { LabEntry } from '../content/labs';
import type { SmritiApp } from './app';

/**
 * Labs (LAB-03 to LAB-07). A sim is a static bundle built to `{SIM_BASE_URL}/{id}/{version}/`
 * (TRD §7.3, R2 `sims/{id}/{version}/`). On phones the bundle is downloaded once into the app's
 * documents folder and run from `file://` in a WebView, so a lab works offline after its first run
 * (LAB-03: "cached automatically after the first run"). On web it runs from the CDN in a sandboxed
 * iframe. Sims make no network calls at runtime.
 */

/** The file operations the cache needs; expo-file-system on phones, a memory fake in tests. */
export interface SimFiles {
  /** Folder for one sim version, ending in `/` (a `file://` URI on phones). */
  folderUri(id: string, version: string): string;
  exists(uri: string): boolean;
  readText(uri: string): Promise<string>;
  writeText(uri: string, text: string): void;
  /** Downloads `url` to `uri` (creating folders) and returns the bytes written. */
  download(url: string, uri: string): Promise<number>;
  removeFolder(uri: string): void;
}

export interface SimLocation {
  /** The page to load. */
  indexUrl: string;
  /** The folder the sim may load from; the WebView refuses anything outside it. */
  folderUrl: string;
  cached: boolean;
}

export type SimPrepareError = 'not_configured' | 'offline' | 'download';

const MARKER = '.complete';

export function simFolderUrl(base: string, lab: Pick<LabEntry, 'id' | 'version'>): string {
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(lab.id)}/${encodeURIComponent(lab.version)}/`;
}

/**
 * Relative files a sim's `index.html` loads (`src` and `href`), for the download. Absolute URLs,
 * protocol-relative URLs, data URIs and fragments are skipped: built sims have none (CSP), and the
 * cache must never fetch outside the sim's folder.
 */
export function simAssetRefs(html: string): string[] {
  const out = new Set<string>();
  const re = /\s(?:src|href)\s*=\s*["']([^"'#?]+)[^"']*["']/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const ref = m[1]!.trim();
    if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//') || ref.startsWith('/')) continue;
    const clean = ref.replace(/^\.\//, '');
    if (clean.split('/').some((p) => p === '..' || p === '')) continue;
    out.add(clean);
  }
  return [...out];
}

export class SimCache {
  constructor(
    private readonly files: SimFiles | null,
    private readonly base: string | undefined,
  ) {}

  configured(): boolean {
    return Boolean(this.base);
  }

  /** Where the sim runs from without downloading anything: the cached folder, or (web) the CDN. */
  local(lab: LabEntry): SimLocation | null {
    if (this.files) {
      const folder = this.files.folderUri(lab.id, lab.version);
      if (!this.files.exists(folder + MARKER)) return null;
      return { indexUrl: folder + lab.entry, folderUrl: folder, cached: true };
    }
    if (!this.base) return null;
    const folder = simFolderUrl(this.base, lab);
    return { indexUrl: folder + lab.entry, folderUrl: folder, cached: false };
  }

  isCached(lab: LabEntry): boolean {
    return this.files !== null && this.local(lab) !== null;
  }

  /**
   * Makes the sim runnable: on phones downloads the entry page and the files it names into the
   * documents folder, then writes a marker so a half-finished download is never used.
   */
  async prepare(lab: LabEntry, online: boolean, onProgress?: (bytes: number) => void): Promise<SimLocation | SimPrepareError> {
    const ready = this.local(lab);
    if (ready) return ready;
    if (!this.base || !this.files) return 'not_configured';
    if (!online) return 'offline';
    const remote = simFolderUrl(this.base, lab);
    const folder = this.files.folderUri(lab.id, lab.version);
    let bytes = 0;
    try {
      this.files.removeFolder(folder);
      bytes += await this.files.download(remote + lab.entry, folder + lab.entry);
      onProgress?.(bytes);
      const html = await this.files.readText(folder + lab.entry);
      for (const ref of simAssetRefs(html)) {
        bytes += await this.files.download(remote + ref, folder + ref);
        onProgress?.(bytes);
      }
      this.files.writeText(folder + MARKER, JSON.stringify({ id: lab.id, version: lab.version, bytes }));
    } catch {
      try {
        this.files.removeFolder(folder);
      } catch {
        // Nothing to clean.
      }
      return 'download';
    }
    return { indexUrl: folder + lab.entry, folderUrl: folder, cached: true };
  }

  remove(lab: LabEntry): void {
    this.files?.removeFolder(this.files.folderUri(lab.id, lab.version));
  }
}

export function simCache(app: SmritiApp): SimCache {
  return new SimCache(app.deps.simFiles ?? null, app.deps.switches.simBaseUrl);
}

// ── Per-lab progress (LAB-01 "{done} of {total} tasks") ───────────────────────

export interface LabProgress {
  done: number;
  total: number;
  completedAt: string | null;
}

const PROGRESS_KEY = (id: string) => `lab-progress:${id}`;

export async function labProgress(app: SmritiApp, id: string): Promise<LabProgress | null> {
  try {
    const raw = await app.deps.stores.kv.get(PROGRESS_KEY(id));
    return raw ? (JSON.parse(raw) as LabProgress) : null;
  } catch {
    return null;
  }
}

export async function saveLabProgress(app: SmritiApp, id: string, tasks: readonly TaskProgress[], complete: boolean): Promise<void> {
  const prev = await labProgress(app, id);
  const done = tasks.filter((t) => t.status === 'correct').length;
  const next: LabProgress = {
    done: Math.max(done, prev?.done ?? 0),
    total: tasks.length,
    completedAt: complete ? new Date(app.now()).toISOString() : (prev?.completedAt ?? null),
  };
  await app.deps.stores.kv.set(PROGRESS_KEY(id), JSON.stringify(next));
}

/** The next lab in the hub's order, for LAB-07 "Next lab". */
export function nextLab(labs: readonly LabEntry[], id: string): LabEntry | null {
  const i = labs.findIndex((l) => l.id === id);
  return i >= 0 && labs.length > 1 ? labs[(i + 1) % labs.length]! : null;
}

/** Formats a reading with the sim's own precision, in tabular figures by the caller. */
export function formatReading(value: number, precision: number | undefined, locale: string): string {
  const digits = Math.max(0, Math.min(6, precision ?? 2));
  try {
    return new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  } catch {
    return value.toFixed(digits);
  }
}

export function megabytes(bytes: number | null): string {
  if (!bytes) return '0';
  return (bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1);
}

/** What a lesson's sim card says about a lab: LAB-05's `fallback.body` and LAB-07's debrief. */
export interface LabLessonText {
  topicId: string;
  fallbackBody: string | null;
  debrief: string | null;
}

/** A lesson sim card names its sim as `sim.<chapter>.<slug>` or by the bare folder id. */
export function sameSim(ref: string, labId: string): boolean {
  return ref === labId || ref.endsWith(`.${labId}`);
}

/**
 * The first lesson sim card on the device that runs this lab, from the Deep Dive bundles in
 * syllabus order. Null when no lesson on the device uses it (LAB-05 then shows the tasks only).
 */
export function labLessonText(app: SmritiApp, labId: string): LabLessonText | null {
  const locale = app.ui.getState().locale;
  const exam = app.examProfileId();
  for (const topic of app.deps.content.topics(locale, exam)) {
    const loaded = app.deps.content.load(locale, topic.id, 'deep_dive', exam);
    for (const card of loaded?.bundle.cards ?? []) {
      if (card.type !== 'sim' || !sameSim(card.sim, labId)) continue;
      const body = typeof card.fallback?.body === 'string' ? card.fallback.body : null;
      const debrief = typeof card.debrief === 'string' ? card.debrief : null;
      return { topicId: topic.id, fallbackBody: body, debrief };
    }
  }
  return null;
}
