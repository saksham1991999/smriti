/**
 * Seed packs: what a store variant ships inside the app, so the first lessons work offline from
 * the first launch (TRD §7). One pack per variant and locale, at most `max_bytes` (8 MB).
 */
import type { SeedPack, SeedPackSpecFile } from "@smriti/content-schema";
import { validateWith } from "@smriti/content-schema";
import type { ContentSet } from "@smriti/content-schema/check";

import type { BuiltBundle } from "./bundle.js";
import { hashed } from "./canonical.js";
import { PublishError } from "./errors.js";
import { bundleKey } from "./manifest.js";
import { type AssetFile, type MediaContext, resolveMedia } from "./media.js";
import type { ProfilePlan } from "./plan.js";

export const DEFAULT_SEED_MAX_BYTES = 8 * 1024 * 1024;

export interface SeedInputs {
  set: ContentSet;
  spec: SeedPackSpecFile;
  locale: string;
  plans: Map<string, ProfilePlan>;
  /** profile -> the manifest published for this locale */
  manifests: Map<string, { path: string; hash: string; version: number; bytes: Uint8Array }>;
  bundles: Map<string, BuiltBundle>;
  media: MediaContext;
  readAsset: (asset: AssetFile) => Promise<Uint8Array | null>;
}

export interface BuiltSeedPack {
  pack: SeedPack;
  /** Root folder of the pack, `seed/{variant}/{locale}/`. */
  root: string;
  /** Files relative to root, including seed-pack.json. */
  files: { path: string; bytes: Uint8Array }[];
}

export async function buildSeedPack(inp: SeedInputs): Promise<BuiltSeedPack> {
  const { spec, locale } = inp;
  const maxBytes = spec.max_bytes ?? DEFAULT_SEED_MAX_BYTES;
  const files = new Map<string, Uint8Array>();
  const pack: SeedPack = {
    schema: "seed-pack@1",
    variant_id: spec.variant_id,
    locale: locale as SeedPack["locale"],
    ...(inp.media.fixture ? { fixture: true } : {}),
    hash: "",
    total_bytes: 0,
    manifests: [],
    bundles: [],
    assets: [],
  };
  const assets = new Map<string, AssetFile>();
  const addBundle = (b: BuiltBundle | undefined) => {
    if (!b || files.has(b.path)) return;
    files.set(b.path, b.bytes);
    pack.bundles.push({ id: b.bundle.id, hash: b.hash, path: b.path, size_bytes: b.bytes.length });
    for (const a of b.assets) assets.set(a.key, a);
  };

  for (const profileId of spec.exam_profiles) {
    const plan = inp.plans.get(profileId);
    const manifest = inp.manifests.get(profileId);
    if (!plan || !manifest) {
      throw new PublishError("seed_profile", `${spec.variant_id}: profile ${profileId} has no ${locale} manifest`);
    }
    files.set(manifest.path, manifest.bytes);
    pack.manifests.push({ exam_profile: profileId, path: manifest.path, hash: manifest.hash, version: manifest.version });

    const wanted =
      spec.chapters === "first"
        ? new Set(plan.subjects.map((s) => s.chapters[0]?.chapter.id).filter((c): c is string => !!c))
        : new Set(spec.chapters);
    for (const s of plan.subjects) {
      for (const c of s.chapters) {
        for (const t of c.topics) {
          if (wanted.has(c.chapter.id)) {
            addBundle(inp.bundles.get(bundleKey(t, "deep_dive")));
            addBundle(inp.bundles.get(bundleKey(t, "quick_revision")));
            addBundle(inp.bundles.get(bundleKey(t, "practice")));
          } else if (spec.include_placement) {
            // Find my level draws one placement question per early chapter (learn §6.5).
            const practice = inp.bundles.get(bundleKey(t, "practice"));
            const hasPlacement = practice
              ? Object.values(practice.bundle.questions).some((q) =>
                  ((q as { use?: string[] }).use ?? []).includes("placement"),
                )
              : false;
            if (hasPlacement) addBundle(practice);
          }
        }
      }
    }
  }

  for (const ref of spec.art) {
    const r = resolveMedia(ref, locale, inp.media);
    if (r.asset) assets.set(r.asset.key, r.asset);
    else if (!inp.media.fixture) throw new PublishError("seed_art", `${ref} is not ready`);
  }
  for (const a of [...assets.values()].sort((x, y) => x.key.localeCompare(y.key))) {
    const data = await inp.readAsset(a);
    if (!data) throw new PublishError("seed_asset_missing", `${a.ref} (${a.key}) is not available to copy into the seed pack`);
    files.set(a.key, data);
    pack.assets.push({ ref: a.ref, sha256: a.sha256, path: a.key, bytes: data.length });
  }

  pack.bundles.sort((a, b) => a.id.localeCompare(b.id));
  pack.total_bytes = [...files.values()].reduce((n, b) => n + b.length, 0);
  if (pack.total_bytes > maxBytes) {
    throw new PublishError(
      "seed_too_large",
      `${spec.variant_id}.${locale} is ${pack.total_bytes} bytes, over the ${maxBytes}-byte limit`,
    );
  }
  pack.hash = hashed({ ...pack, hash: "" }).hash;
  const res = validateWith("seed-pack.schema.json", pack);
  if (!res.ok) throw new PublishError("seed_invalid", res.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  const root = `seed/${spec.variant_id}/${locale}/`;
  const list = [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, bytes]) => ({ path, bytes }));
  list.push({ path: "seed-pack.json", bytes: Buffer.from(`${JSON.stringify(pack, null, 2)}\n`) });
  return { pack, root, files: list };
}
