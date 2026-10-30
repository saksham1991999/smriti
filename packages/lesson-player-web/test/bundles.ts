/**
 * Loads the published fixture bundles (`pnpm --filter @smriti/content-publish publish:fixtures`
 * writes tools/content-publish/out). The text in them is labelled fixture test data.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest, TypedBundle } from "@smriti/content-schema";
import { lessonConfig, planLesson, type LessonPlan, type XpConfig } from "@smriti/lesson-core";
import { createI18n } from "@smriti/i18n";

export const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../../tools/content-publish/out");

if (!existsSync(join(OUT, "manifests"))) {
  throw new Error("No published fixtures: run `pnpm --filter @smriti/content-publish publish:fixtures` first");
}

export function manifest(locale: "en" | "hi" = "en"): Manifest {
  return JSON.parse(readFileSync(join(OUT, "manifests", `fx-exam-2027.${locale}.json`), "utf8")) as Manifest;
}

export function bundle(topic: string, mode: "deep_dive" | "quick_revision" | "practice", locale: "en" | "hi" = "en"): { bundle: TypedBundle; hash: string } {
  const entry = manifest(locale).topics[`fx.chapter-a.${topic}`]?.bundles[mode];
  if (!entry) throw new Error(`no ${mode} bundle for ${topic}`);
  return { bundle: JSON.parse(readFileSync(join(OUT, entry.path), "utf8")) as TypedBundle, hash: entry.hash };
}

/** The proposed `xp.*` flag defaults from @smriti/config (learn §7, R51). */
export const XP: XpConfig = { firstTry: 10, secondTry: 5, attempt: 1, complete: 20, combo: 10 };
export const CONFIG = lessonConfig(XP);

export function plan(topic: string, opts: { mode?: "deep_dive" | "quick_revision" | "onboarding"; biteId?: string; previewLimited?: boolean; locale?: "en" | "hi" } = {}): { plan: LessonPlan; bundle: TypedBundle } {
  const mode = opts.mode ?? "deep_dive";
  const b = bundle(topic, mode === "onboarding" ? "deep_dive" : mode, opts.locale);
  return { bundle: b.bundle, plan: planLesson(b.bundle, { mode, bundleVersion: b.hash, examDepth: null, biteId: opts.biteId, previewLimited: opts.previewLimited, config: CONFIG }) };
}

export const tEn = createI18n({ locale: "en", brand: "Smriti" }).t;
export const tHi = createI18n({ locale: "hi", brand: "Smriti" }).t;
