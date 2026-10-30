/**
 * Delta patches between two versions of one bundle (TRD §3.2). A patch replaces whole cards and
 * whole map entries, which keeps applying it trivial on the device; applying it to the old bundle
 * gives exactly the new bundle (same canonical hash).
 */
import type { BundlePatch } from "@smriti/content-schema";

import { canonicalJson, hashed } from "./canonical.js";
import { PublishError } from "./errors.js";

type Json = Record<string, unknown>;
type CardLike = { id: string } & Json;

/** Keyed maps patched entry by entry. */
export const PATCH_MAPS = ["questions", "mnemonics", "sheets", "pyq_papers", "media", "math"] as const;
const SPECIAL = new Set<string>(["cards", ...PATCH_MAPS]);

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

export function patchPath(fromHash: string, toHash: string): string {
  return `patches/${fromHash}-${toHash}.json`;
}

export function diffBundles(from: Json, to: Json): BundlePatch {
  const fromHash = hashed(from).hash;
  const toHash = hashed(to).hash;
  if (from.id !== to.id) throw new PublishError("patch_mismatch", `cannot patch ${String(from.id)} into ${String(to.id)}`);

  const set: Json = {};
  const unset: string[] = [];
  for (const key of Object.keys(to).sort()) {
    if (SPECIAL.has(key)) continue;
    if (!(key in from) || !same(from[key], to[key])) set[key] = to[key];
  }
  for (const key of Object.keys(from).sort()) {
    if (!SPECIAL.has(key) && !(key in to)) unset.push(key);
  }

  const oldCards = new Map(((from.cards as CardLike[]) ?? []).map((c) => [c.id, c]));
  const newCards = (to.cards as CardLike[]) ?? [];
  const newIds = new Set(newCards.map((c) => c.id));
  const cards = {
    order: newCards.map((c) => c.id),
    upsert: newCards.filter((c) => !oldCards.has(c.id) || !same(oldCards.get(c.id), c)),
    removed: [...oldCards.keys()].filter((id) => !newIds.has(id)).sort(),
  };

  const maps: BundlePatch["maps"] = {};
  for (const name of PATCH_MAPS) {
    if (!(name in to)) continue;
    const a = (from[name] as Json | undefined) ?? {};
    const b = (to[name] as Json | undefined) ?? {};
    const upsert: Json = {};
    for (const k of Object.keys(b).sort()) if (!(k in a) || !same(a[k], b[k])) upsert[k] = b[k];
    const removed = Object.keys(a)
      .filter((k) => !(k in b))
      .sort();
    if (Object.keys(upsert).length || removed.length) maps[name] = { upsert, removed };
  }
  // A map that exists on one side only is a top-level change too.
  for (const name of PATCH_MAPS) {
    if (name in to && !(name in from)) set[name] = {};
    if (name in from && !(name in to)) unset.push(name);
  }
  unset.sort();

  return {
    schema: "patch@1",
    bundle_id: String(to.id),
    from_hash: fromHash,
    to_hash: toHash,
    set,
    unset,
    cards,
    maps,
  };
}

/** Apply a patch. Throws when the base is not the patch's from version or the result is not its to version. */
export function applyPatch(base: Json, patch: BundlePatch): Json {
  if (hashed(base).hash !== patch.from_hash) {
    throw new PublishError("patch_base", `bundle ${String(base.id)} is not version ${patch.from_hash}`);
  }
  const out: Json = structuredClone(base);
  for (const key of patch.unset) delete out[key];
  for (const [key, value] of Object.entries(patch.set)) out[key] = structuredClone(value);

  const byId = new Map(((base.cards as CardLike[]) ?? []).map((c) => [c.id, c]));
  for (const c of patch.cards.upsert as CardLike[]) byId.set(c.id, c);
  out.cards = patch.cards.order.map((id) => {
    const c = byId.get(id);
    if (!c) throw new PublishError("patch_card", `patch order names unknown card ${id}`);
    return structuredClone(c);
  });

  for (const [name, change] of Object.entries(patch.maps)) {
    if (!change) continue;
    const target = { ...((out[name] as Json | undefined) ?? {}) };
    for (const k of change.removed) delete target[k];
    for (const [k, v] of Object.entries(change.upsert)) target[k] = structuredClone(v);
    out[name] = target;
  }

  if (hashed(out).hash !== patch.to_hash) {
    throw new PublishError("patch_result", `patched ${String(base.id)} does not match ${patch.to_hash}`);
  }
  return out;
}
