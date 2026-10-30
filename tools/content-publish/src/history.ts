/**
 * publish-history.json: every hash ever published per bundle, manifest and content item. It keeps
 * versions monotonic and tells the publisher which earlier versions to build patches from.
 */
import type { PublishHistory } from "@smriti/content-schema";
import { validateWith } from "@smriti/content-schema";

import { PublishError } from "./errors.js";

export const HISTORY_KEY = "publish-history.json";

export function emptyHistory(fixture: boolean): PublishHistory {
  return { schema: "publish-history@1", ...(fixture ? { fixture: true } : {}), bundles: {}, manifests: {}, items: {} };
}

export function parseHistory(bytes: Uint8Array | null, fixture: boolean): PublishHistory {
  if (!bytes) return emptyHistory(fixture);
  const doc = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  const res = validateWith<PublishHistory>("publish-history.schema.json", doc);
  if (!res.ok) throw new PublishError("history_invalid", res.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  const h = res.value;
  if (Boolean(h.fixture) !== fixture) {
    throw new PublishError(
      "history_mixed",
      fixture
        ? "the target already holds real content; fixtures may not be published over it"
        : "the target holds the fixture course; publish real content to a fresh target",
    );
  }
  return h;
}

export interface Recorded {
  version: number;
  /** True when this hash was not the latest before. */
  changed: boolean;
  /** Earlier hashes, newest first (for patches). */
  previous: string[];
}

/** Record a bundle hash; a new hash gets the next version. */
export function recordBundle(h: PublishHistory, id: string, hash: string, sizeBytes: number, now: string): Recorded {
  const list = (h.bundles[id] ??= []);
  const last = list[list.length - 1];
  const previous = list
    .filter((e) => e.hash !== hash)
    .map((e) => e.hash)
    .reverse();
  if (last && last.hash === hash) return { version: last.version, changed: false, previous };
  const version = (last?.version ?? 0) + 1;
  list.push({ hash, version, size_bytes: sizeBytes, published_at: now });
  return { version, changed: true, previous };
}

export function lastManifest(h: PublishHistory, key: string): { hash: string; version: number } | null {
  const list = h.manifests[key] ?? [];
  return list[list.length - 1] ?? null;
}

export function recordManifest(h: PublishHistory, key: string, hash: string, version: number, now: string): void {
  const list = (h.manifests[key] ??= []);
  const last = list[list.length - 1];
  if (last && last.hash === hash) return;
  list.push({ hash, version, published_at: now });
}

/** Record a content item's per-locale hashes; any change makes a new version. */
export function recordItem(h: PublishHistory, id: string, hashes: Record<string, string>, now: string): Recorded {
  const list = (h.items[id] ??= []);
  const last = list[list.length - 1];
  const same =
    last &&
    Object.keys(hashes).length === Object.keys(last.hashes).length &&
    Object.entries(hashes).every(([k, v]) => last.hashes[k] === v);
  if (last && same) return { version: last.version, changed: false, previous: [] };
  const version = (last?.version ?? 0) + 1;
  list.push({ version, hashes, published_at: now });
  return { version, changed: true, previous: [] };
}
