/**
 * The publish job (TRD §7.2): content/ -> immutable bundles, patches, manifests, seed packs, the
 * site index and SQL for the content.* catalogue.
 *
 * Order matters for clients: assets, then bundles and patches, then the hash-named manifests, and
 * only then the short-cache current manifests, so a device never sees a manifest that points at
 * a file that is not there yet.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { BundleMode } from "@smriti/content-schema";
import { checkRoot } from "@smriti/content-schema/check";

import { type BuiltBundle, BUNDLE_MODES, buildBundle, bundlePath, hasBundle } from "./bundle.js";
import { canonicalJson, hashed } from "./canonical.js";
import { PublishError } from "./errors.js";
import { HISTORY_KEY, lastManifest, parseHistory, recordBundle, recordItem, recordManifest } from "./history.js";
import { bundleKey, buildManifest, manifestKey, manifestPaths, type PatchRef } from "./manifest.js";
import { allowsUnapprovedMedia, type AssetFile, isPublishEnvironment, type MediaContext, PUBLISH_ENVIRONMENTS, type PublishEnvironment } from "./media.js";
import { diffBundles, patchPath } from "./patch.js";
import { planProfile, type ProfilePlan, releasedSubjects } from "./plan.js";
import { buildSeedPack } from "./seed.js";
import { buildSiteIndex, SITE_INDEX_KEY } from "./site-index.js";
import { generateSql } from "./sql.js";
import { type ObjectStore } from "./store.js";

export interface PublishOptions {
  repoRoot: string;
  /** The content root to publish: content/ or content/fixtures/. */
  contentRoot: string;
  store: ObjectStore;
  /**
   * Required, never defaulted: production refuses unapproved media; staging and local ship it
   * as unavailable with a warning per item. R2 takes production or staging; the fixture course
   * is never production.
   */
  environment: PublishEnvironment;
  /** Where metadata.sql and publish-report.json are written (a local folder). */
  reportDir: string;
  /** Publish time, recorded in history (inject it for reproducible runs). */
  now?: Date;
  /** Patches are built from this many earlier versions of each bundle. */
  keepPatches?: number;
  log?: (line: string) => void;
}

export interface PublishReport {
  schema: "publish-report@1";
  target: string;
  environment: PublishEnvironment;
  content_root: string;
  fixture: boolean;
  published_at: string;
  subjects: string[];
  bundles: { id: string; hash: string; path: string; size_bytes: number; version: number; changed: boolean }[];
  patches: { bundle_id: string; path: string; size_bytes: number }[];
  manifests: { exam_profile: string; locale: string; version: number; hash: string; path: string }[];
  seed_packs: { variant_id: string; locale: string; total_bytes: number; hash: string; bundles: number; assets: number }[];
  assets: { key: string; bytes: number; uploaded: boolean }[];
  site_index: string | null;
  sql: { path: string; tables: Record<string, string[]>; rows: Record<string, number> };
  /** Media that is not approved yet and shipped as unavailable; always empty for production. */
  unapproved_media: { ref: string; status: string }[];
  warnings: string[];
}

const JSON_TYPE = "application/json";

export async function publish(opts: PublishOptions): Promise<PublishReport> {
  const log = opts.log ?? (() => {});
  const now = (opts.now ?? new Date()).toISOString();
  const keepPatches = opts.keepPatches ?? 3;
  const { store } = opts;
  const warnings: string[] = [];
  const { environment } = opts;
  if (!isPublishEnvironment(environment)) {
    throw new PublishError("environment_required", `say which environment this publish is for: ${PUBLISH_ENVIRONMENTS.join(", ")}`);
  }
  if (store.kind === "r2" && environment === "local") {
    throw new PublishError("environment_remote", "a local build goes to a folder; R2 takes production or staging");
  }

  // 1. Load and check. Any error stops the publish before anything is written.
  const { set, report } = checkRoot(resolve(opts.contentRoot), opts.repoRoot);
  if (report.errors > 0) {
    const first = report.findings.filter((f) => f.severity === "error").slice(0, 5);
    throw new PublishError(
      "content_check",
      `${report.errors} error(s) in ${report.root}: ${first.map((f) => `${f.code} ${f.file}`).join("; ")}`,
    );
  }
  const fixture = set.isFixtureRoot || set.files.some((f) => f.doc.fixture === true);
  if (fixture && store.kind !== "local" && store.kind !== "memory") {
    throw new PublishError("fixture_remote", `the fixture course may only be published to a local folder, not ${store.description}`);
  }
  if (fixture && environment === "production") {
    throw new PublishError("fixture_production", "the fixture course is test data and is never a production publish");
  }
  const remote = store.kind === "r2";
  // A remote target only gets subjects marked for release; a local build gets everything.
  const subjectFilter = remote ? releasedSubjects(set) : null;
  if (remote && subjectFilter && subjectFilter.size === 0) {
    throw new PublishError("nothing_released", "no exam map lists released_subjects");
  }

  const history = parseHistory(await store.get("content", HISTORY_KEY), fixture);
  const unapproved = new Map<string, string>();
  const media: MediaContext = { set, repoRoot: opts.repoRoot, fixture, allowUnapproved: allowsUnapprovedMedia(environment, fixture), unapproved };

  // 2. Plan profiles and build every bundle they need, once per locale.
  const plans: ProfilePlan[] = [];
  for (const id of [...set.profiles.keys()].sort()) {
    const plan = planProfile(set, id, subjectFilter);
    if (plan && plan.subjects.length) plans.push(plan);
  }
  const built = new Map<string, Map<string, BuiltBundle>>(); // locale -> key -> bundle
  for (const plan of plans) {
    for (const locale of plan.locales) {
      const forLocale = built.get(locale) ?? new Map<string, BuiltBundle>();
      built.set(locale, forLocale);
      for (const s of plan.subjects) {
        for (const c of s.chapters) {
          for (const topic of c.topics) {
            for (const mode of BUNDLE_MODES) {
              const key = bundleKey(topic, mode);
              if (forLocale.has(key) || !hasBundle(set, topic, mode)) continue;
              forLocale.set(key, buildBundle(set, topic, mode, locale, media));
            }
          }
        }
      }
    }
  }

  // 3. Assets first.
  const assets = new Map<string, AssetFile>();
  for (const forLocale of built.values()) for (const b of forLocale.values()) for (const a of b.assets) assets.set(a.key, a);
  const assetReport: PublishReport["assets"] = [];
  for (const a of [...assets.values()].sort((x, y) => x.key.localeCompare(y.key))) {
    if (await store.exists("assets", a.key)) {
      assetReport.push({ key: a.key, bytes: a.bytes, uploaded: false });
    } else if (a.sourcePath) {
      await store.put("assets", a.key, readFileSync(a.sourcePath), { contentType: a.mime, immutable: true });
      assetReport.push({ key: a.key, bytes: a.bytes, uploaded: true });
    } else if (remote) {
      throw new PublishError("asset_missing", `${a.ref}: ${a.key} is not in the assets bucket`);
    } else {
      warnings.push(`${a.ref}: ${a.key} is not in the local output (it lives in R2)`);
    }
  }

  // 4. Bundles, history and patches.
  const bundleReport: PublishReport["bundles"] = [];
  const patchReport: PublishReport["patches"] = [];
  const patchesById = new Map<string, PatchRef[]>();
  const patchRows: { bundleId: string; from: string; to: string; size: number }[] = [];
  for (const [, forLocale] of [...built.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const b of [...forLocale.values()].sort((x, y) => x.bundle.id.localeCompare(y.bundle.id))) {
      if (!(await store.exists("content", b.path))) {
        await store.put("content", b.path, b.bytes, { contentType: JSON_TYPE, immutable: true });
      }
      const rec = recordBundle(history, b.bundle.id, b.hash, b.bytes.length, now);
      bundleReport.push({ id: b.bundle.id, hash: b.hash, path: b.path, size_bytes: b.bytes.length, version: rec.version, changed: rec.changed });
      const refs: PatchRef[] = [];
      for (const from of rec.previous.slice(0, keepPatches)) {
        const path = patchPath(from, b.hash);
        let size: number;
        const existing = await store.get("content", path);
        if (existing) {
          size = existing.length;
        } else {
          const old = await store.get(
            "content",
            bundlePath(b.bundle.topic.id, b.bundle.mode as BundleMode, b.bundle.locale, from),
          );
          if (!old) {
            warnings.push(`${b.bundle.id}: version ${from.slice(0, 12)} is gone, no patch from it`);
            continue;
          }
          const patch = diffBundles(JSON.parse(Buffer.from(old).toString("utf8")), b.bundle as unknown as Record<string, unknown>);
          const bytes = Buffer.from(canonicalJson(patch), "utf8");
          await store.put("content", path, bytes, { contentType: JSON_TYPE, immutable: true });
          size = bytes.length;
        }
        refs.push({ from_hash: from, path, size_bytes: size });
        patchReport.push({ bundle_id: b.bundle.id, path, size_bytes: size });
        patchRows.push({ bundleId: b.bundle.id, from, to: b.hash, size });
      }
      patchesById.set(b.bundle.id, refs);
    }
  }

  // 5. Content item versions (lessons and extras) and question versions.
  const itemVersions = new Map<string, number>();
  for (const { doc } of [...set.lessons, ...set.extras]) {
    const id = (doc as { id: string }).id;
    itemVersions.set(id, recordItem(history, id, { all: hashed(doc).hash }, now).version);
  }
  const questionVersions = new Map<string, number>();
  for (const [id, e] of [...set.questions.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    questionVersions.set(id, recordItem(history, id, { all: hashed(e.question).hash }, now).version);
  }

  // 6. Manifests: archived copy first, then the current pointer.
  const manifestReport: PublishReport["manifests"] = [];
  const manifestsByLocale = new Map<string, Map<string, { path: string; hash: string; version: number; bytes: Uint8Array }>>();
  for (const plan of plans) {
    for (const locale of plan.locales) {
      const inputs = { set, plan, locale, bundles: built.get(locale) ?? new Map(), patches: patchesById, fixture };
      const key = manifestKey(plan.profileId, locale);
      const last = lastManifest(history, key);
      let m = buildManifest(inputs, last?.version ?? 1);
      if (last && m.hash !== last.hash) m = buildManifest(inputs, last.version + 1);
      const paths = manifestPaths(plan.profileId, locale, m.hash);
      await store.put("content", paths.archived, m.bytes, { contentType: JSON_TYPE, immutable: true });
      await store.put("content", paths.current, m.bytes, { contentType: JSON_TYPE, immutable: false });
      recordManifest(history, key, m.hash, m.manifest.version, now);
      manifestReport.push({ exam_profile: plan.profileId, locale, version: m.manifest.version, hash: m.hash, path: paths.archived });
      const byProfile = manifestsByLocale.get(locale) ?? new Map();
      byProfile.set(plan.profileId, { path: paths.archived, hash: m.hash, version: m.manifest.version, bytes: m.bytes });
      manifestsByLocale.set(locale, byProfile);
    }
  }

  // 7. Seed packs, one per variant and locale.
  const plansById = new Map(plans.map((p) => [p.profileId, p]));
  const seedReport: PublishReport["seed_packs"] = [];
  const seedRows: { variant: string; locale: string; bundleIds: string[]; hash: string }[] = [];
  for (const { doc: spec } of [...set.seedSpecs].sort((a, b) => a.doc.variant_id.localeCompare(b.doc.variant_id))) {
    if (!spec.exam_profiles.every((p) => plansById.has(p))) {
      warnings.push(`seed pack ${spec.variant_id}: a profile is not published to this target, skipped`);
      continue;
    }
    for (const locale of spec.locales) {
      const seed = await buildSeedPack({
        set,
        spec,
        locale,
        plans: plansById,
        manifests: manifestsByLocale.get(locale) ?? new Map(),
        bundles: built.get(locale) ?? new Map(),
        media,
        readAsset: async (a) => (a.sourcePath ? readFileSync(a.sourcePath) : store.get("assets", a.key)),
      });
      for (const f of seed.files) {
        await store.put("content", `${seed.root}${f.path}`, f.bytes, { contentType: f.path.endsWith(".json") ? JSON_TYPE : "application/octet-stream", immutable: false });
      }
      seedReport.push({
        variant_id: spec.variant_id,
        locale,
        total_bytes: seed.pack.total_bytes,
        hash: seed.pack.hash,
        bundles: seed.pack.bundles.length,
        assets: seed.pack.assets.length,
      });
      seedRows.push({ variant: spec.variant_id, locale, bundleIds: seed.pack.bundles.map((b) => b.id), hash: seed.pack.hash });
    }
  }

  // 8. The marketing site's index.
  // Unapproved media that shipped as unavailable (staging, local and fixture builds only).
  const unapprovedMedia = [...unapproved].map(([ref, status]) => ({ ref, status })).sort((a, b) => a.ref.localeCompare(b.ref));
  for (const m of unapprovedMedia) warnings.push(`${m.ref} is ${m.status}, not approved: shipped as unavailable (${environment} build)`);

  const siteIndex = buildSiteIndex({ set, plans, fixture, now: new Date(now) });
  if (siteIndex) {
    await store.put("content", SITE_INDEX_KEY, Buffer.from(`${JSON.stringify(siteIndex, null, 2)}\n`), {
      contentType: JSON_TYPE,
      immutable: false,
    });
  } else {
    warnings.push("no exam has published subjects, so no site index was written");
  }

  // 9. History last: it records what is now live.
  await store.put("content", HISTORY_KEY, Buffer.from(`${JSON.stringify(history, null, 2)}\n`), {
    contentType: JSON_TYPE,
    immutable: false,
  });

  // 10. SQL for the content.* catalogue and the report, both local files.
  const allBundles = [...built.values()].flatMap((m) => [...m.values()]);
  const sql = generateSql({
    set,
    history,
    now,
    fixture,
    subjects: subjectFilter,
    bundles: allBundles
      .map((b) => ({
        id: b.bundle.id,
        topic: b.bundle.topic.id,
        mode: b.bundle.mode,
        locale: b.bundle.locale,
        hash: b.hash,
        size: b.bytes.length,
        cardCount: b.cardCount,
        minApp: b.bundle.min_app_version,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    patches: patchRows,
    manifests: manifestReport.map((m) => ({ profile: m.exam_profile, locale: m.locale })),
    seedPacks: seedRows,
    itemVersions,
    questionVersions,
  });
  mkdirSync(opts.reportDir, { recursive: true });
  const sqlPath = join(opts.reportDir, "metadata.sql");
  writeFileSync(sqlPath, sql.sql);

  const result: PublishReport = {
    schema: "publish-report@1",
    target: store.description,
    environment,
    content_root: report.root,
    fixture,
    published_at: now,
    subjects: [...new Set(plans.flatMap((p) => p.subjects.map((s) => s.subject.id)))].sort(),
    bundles: bundleReport,
    patches: patchReport,
    manifests: manifestReport,
    seed_packs: seedReport,
    assets: assetReport,
    site_index: siteIndex ? SITE_INDEX_KEY : null,
    sql: { path: sqlPath, tables: sql.tables, rows: sql.rowCounts },
    unapproved_media: unapprovedMedia,
    warnings,
  };
  const reportPath = join(opts.reportDir, "publish-report.json");
  if (!existsSync(dirname(reportPath))) mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  log(
    `published ${bundleReport.length} bundles (${bundleReport.filter((b) => b.changed).length} changed), ${patchReport.length} patches, ${manifestReport.length} manifests, ${seedReport.length} seed packs to ${store.description}`,
  );
  for (const w of warnings) log(`warning: ${w}`);
  return result;
}
