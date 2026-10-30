/** Bundles of the fixture course, built by the real publisher, for lesson-core tests. */
import type { BundleMode, TypedBundle } from "@smriti/content-schema";
import { checkRoot, findRepoRoot } from "@smriti/content-schema/check";
import { buildBundle } from "@smriti/content-publish";

import { lessonConfig, type LessonConfig } from "../src/index.js";

const repoRoot = findRepoRoot(__dirname);
const { set, report } = checkRoot(`${repoRoot}/content/fixtures`, repoRoot);
if (report.errors > 0) throw new Error("the fixture course does not pass the content check");

const cache = new Map<string, { bundle: TypedBundle; hash: string }>();

export function fixtureBundle(topic: "a" | "b" | "c" | "d", mode: BundleMode, locale = "en"): { bundle: TypedBundle; hash: string } {
  const key = `${topic}|${mode}|${locale}`;
  const hit = cache.get(key);
  if (hit) return structuredClone(hit);
  const built = buildBundle(set, `fx.chapter-a.topic-${topic}`, mode, locale, { set, repoRoot, fixture: true });
  const out = { bundle: built.bundle as unknown as TypedBundle, hash: built.hash };
  cache.set(key, out);
  return structuredClone(out);
}

/** The fixture exam's depths: every concept at 3, except topic D concept 2 at 4. */
export const EXAM_DEPTH: Record<string, number> = Object.fromEntries(
  set.examMaps[0]!.doc.concepts.map((c) => [c.id, c.depth]),
);

/** Test XP amounts (the real ones are owner flags). */
export const XP = { firstTry: 10, secondTry: 5, attempt: 1, complete: 20, combo: 15 };

export function config(overrides: Partial<Omit<LessonConfig, "xp">> = {}): LessonConfig {
  return lessonConfig(XP, overrides);
}

export const T0 = Date.parse("2026-10-30T10:00:00.000Z");
