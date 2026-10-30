import type { BundleEntry, BundleMode, Manifest } from "@smriti/content-schema";
import { localize, validateWith } from "@smriti/content-schema";
import type { ContentSet } from "@smriti/content-schema/check";

import { type BuiltBundle, DEFAULT_MIN_APP_VERSION } from "./bundle.js";
import { hashed } from "./canonical.js";
import { PublishError } from "./errors.js";
import { compareVersions, type ProfilePlan } from "./plan.js";

export interface PatchRef {
  from_hash: string;
  path: string;
  size_bytes: number;
}

export interface ManifestInputs {
  set: ContentSet;
  plan: ProfilePlan;
  locale: string;
  /** `${topic}|${mode}` -> built bundle for this locale */
  bundles: Map<string, BuiltBundle>;
  /** bundle id -> patches to its current hash */
  patches: Map<string, PatchRef[]>;
  fixture: boolean;
}

export const bundleKey = (topic: string, mode: BundleMode) => `${topic}|${mode}`;

export function manifestKey(profile: string, locale: string): string {
  return `${profile}.${locale}`;
}

export function manifestPaths(profile: string, locale: string, hash: string): { current: string; archived: string } {
  return { current: `manifests/${profile}.${locale}.json`, archived: `manifests/${profile}.${locale}.${hash}.json` };
}

/** Build a manifest with a given version number (the caller picks the version from history). */
export function buildManifest(inp: ManifestInputs, version: number): { manifest: Manifest; bytes: Buffer; hash: string } {
  const { set, plan, locale } = inp;
  const prof = set.profiles.get(plan.profileId);
  if (!prof) throw new PublishError("profile_unknown", plan.profileId);
  const L = <T>(v: T) => localize(v, locale);
  const topics: Manifest["topics"] = {};
  let minApp = DEFAULT_MIN_APP_VERSION;
  const subjects = plan.subjects.map(({ subject, chapters }) => ({
    id: subject.id,
    name: L(subject.name),
    color_family: subject.color_family,
    sort: subject.sort,
    chapters: chapters.map((pc) => {
      pc.topics.forEach((topicId, ti) => {
        const t = set.topics.get(topicId);
        if (!t) return;
        const bundles: Record<string, BundleEntry> = {};
        for (const mode of ["deep_dive", "quick_revision", "practice"] as const) {
          const b = inp.bundles.get(bundleKey(topicId, mode));
          if (!b) continue;
          if (compareVersions(b.bundle.min_app_version, minApp) > 0) minApp = b.bundle.min_app_version;
          bundles[mode] = {
            id: b.bundle.id,
            hash: b.hash,
            path: b.path,
            size_bytes: b.bytes.length,
            card_count: b.cardCount,
            min_app_version: b.bundle.min_app_version,
            is_free: mode !== "deep_dive" || pc.freeDeepDive,
            patches: inp.patches.get(b.bundle.id) ?? [],
          };
        }
        topics[topicId] = {
          name: L(t.topic.name),
          chapter: pc.chapter.id,
          sort: ti + 1,
          depth: plan.depth.get(topicId) ?? {},
          bundles,
        };
      });
      return {
        id: pc.chapter.id,
        name: L(pc.chapter.name),
        sort: pc.sort,
        unit: pc.chapter.unit,
        free_deep_dive: pc.freeDeepDive,
        topics: pc.topics,
      };
    }),
  }));
  const blueprints = set.blueprints
    .filter((b) => b.doc.exam_profile === plan.profileId)
    .map((b) => ({ paper_code: b.doc.paper_code, version: b.doc.version, effective_from: b.doc.effective_from }))
    .sort((a, b) => a.paper_code.localeCompare(b.paper_code) || a.version - b.version);
  const manifest: Manifest = {
    schema: "manifest@1",
    exam_profile: plan.profileId,
    locale: locale as Manifest["locale"],
    version,
    min_app_version: minApp,
    ...(inp.fixture ? { fixture: true } : {}),
    exam: {
      id: prof.exam.id,
      name: L(prof.exam.name),
      profile_name: prof.profile.name ? L(prof.profile.name) : `${L(prof.exam.name)} ${prof.profile.cycle}`,
      cycle: prof.profile.cycle,
      category: prof.exam.category,
      conducting_body: prof.exam.conducting_body ?? null,
    },
    subjects,
    topics,
    blueprints,
    free: {
      deep_dive_chapters: plan.subjects.flatMap((s) => s.chapters.filter((c) => c.freeDeepDive).map((c) => c.chapter.id)),
    },
  };
  const res = validateWith("manifest.schema.json", manifest);
  if (!res.ok) {
    throw new PublishError("manifest_invalid", res.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  }
  const { bytes, hash } = hashed(manifest);
  return { manifest, bytes, hash };
}
