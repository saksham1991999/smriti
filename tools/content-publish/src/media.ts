import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import type { MediaRequest, ResolvedMedia } from "@smriti/content-schema";
import { localize } from "@smriti/content-schema";
import type { ContentSet } from "@smriti/content-schema/check";

import { sha256Hex } from "./canonical.js";
import { PublishError } from "./errors.js";

/** An asset file to upload or copy next to the bundles, at `assets/{sha256}.{ext}`. */
export interface AssetFile {
  ref: string;
  sha256: string;
  key: string;
  mime: string;
  bytes: number;
  /** Absolute path of the source file, for fixtures (copied from design/mocks/assets). */
  sourcePath: string | null;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "application/json": "json",
  "model/gltf-binary": "glb",
  "application/octet-stream": "bin",
};

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]),
);
MIME_BY_EXT.riv = "application/octet-stream";
MIME_BY_EXT.jpeg = "image/jpeg";

export function assetKey(sha256: string, mime: string, sourcePath: string | null): string {
  const fromPath = sourcePath ? extname(sourcePath).slice(1).toLowerCase() : "";
  const ext = EXT_BY_MIME[mime] && mime !== "application/octet-stream" ? EXT_BY_MIME[mime] : fromPath || "bin";
  return `assets/${sha256}.${ext}`;
}

export interface MediaContext {
  set: ContentSet;
  repoRoot: string;
  /** Fixture builds may reference media that is not approved yet; it ships as unavailable. */
  fixture: boolean;
}

/** Resolve one media request id for a bundle in one locale. */
export function resolveMedia(
  ref: string,
  locale: string,
  ctx: MediaContext,
): { media: ResolvedMedia; asset: AssetFile | null } {
  const entry = ctx.set.media.get(ref);
  if (!entry) throw new PublishError("media_unknown", `${ref} has no media request`);
  const r = entry.request;
  const base: ResolvedMedia = {
    ref,
    kind: r.kind,
    status: "unavailable",
    url: null,
    alt: r.alt ? localize(r.alt, locale) : null,
    decorative: r.decorative ?? false,
    transcript: r.transcript ? localize(r.transcript, locale) : null,
    label_anchors: r.label_anchors ?? [],
  };
  if (r.status !== "approved" || !r.result) {
    if (!ctx.fixture) {
      throw new PublishError("media_not_approved", `${ref} is ${r.status}; only approved media can be published`);
    }
    return { media: base, asset: null };
  }
  const result = r.result;
  if (r.kind === "sim") return { media: resolveSim(r, base, ctx), asset: null };

  let sourcePath: string | null = null;
  let bytes = result.bytes ?? null;
  let mime = result.mime ?? null;
  if (result.source_path) {
    if (!ctx.fixture) throw new PublishError("media_source_path", `${ref}: source_path is only for fixtures`);
    sourcePath = join(ctx.repoRoot, result.source_path);
    if (!existsSync(sourcePath)) throw new PublishError("media_missing_file", `${ref}: ${result.source_path} not found`);
    const data = readFileSync(sourcePath);
    if (sha256Hex(data) !== result.sha256) throw new PublishError("media_sha_mismatch", `${ref}: sha256 does not match the file`);
    bytes = data.length;
    mime = mime ?? MIME_BY_EXT[extname(sourcePath).slice(1).toLowerCase()] ?? "application/octet-stream";
  }
  if (bytes === null || mime === null) {
    throw new PublishError("media_result_incomplete", `${ref}: approved result needs mime and bytes`);
  }
  const key = assetKey(result.sha256, mime, sourcePath);
  return {
    media: {
      ...base,
      status: "ready",
      url: key,
      sha256: result.sha256,
      mime,
      bytes,
      width: result.width ?? null,
      height: result.height ?? null,
    },
    asset: { ref, sha256: result.sha256, key, mime, bytes, sourcePath },
  };
}

function resolveSim(r: MediaRequest, base: ResolvedMedia, ctx: MediaContext): ResolvedMedia {
  const simId = r.result?.sim_id;
  const sim = simId ? ctx.set.simsById.get(simId) : undefined;
  if (!sim) {
    if (ctx.fixture) return base;
    throw new PublishError("sim_unknown", `${r.id}: result.sim_id ${simId ?? "(none)"} has no sims/{id}/sim.json`);
  }
  const m = sim.doc;
  return {
    ...base,
    status: "ready",
    url: `sims/${m.id}/${m.version}/${m.entry}`,
    sim: {
      id: m.id,
      version: m.version,
      entry: m.entry,
      aspect: m.aspect,
      size_bytes: m.size_bytes,
      origin: m.origin,
      licence: m.licence,
      attribution: m.attribution ?? null,
    },
  };
}
