/**
 * Published content on the web: the manifest per exam profile and locale (`GET /v1/content/manifest`)
 * and immutable, content-addressed bundles from the CDN (`{CDN}/c/<path>`, TRD §7.2). Bundles are
 * cached by the service worker (CacheFirst: the hash is in the name) and recorded in the local
 * `bundles` table, so a lesson opened once works offline.
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError, unwrap } from "@smriti/api-client";
import type { BundleEntry, Manifest, TypedBundle } from "@smriti/content-schema";
import { lessonConfig, type LessonConfig } from "@smriti/lesson-core";
import type { Flags } from "@smriti/config";
import { useServices } from "../boot/context";
import { useI18n } from "./i18n";
import { useProfileIds } from "./queries";

export type BundleMode = "deep_dive" | "quick_revision" | "practice";

/** The CDN content root when no API has told us yet (`{CDN_BASE_URL}/c`, same origin /c in dev). */
export function contentBase(cdnBaseUrl: string | undefined): string {
  return `${(cdnBaseUrl ?? "").replace(/\/+$/, "")}/c/`;
}

export const contentKeys = {
  manifest: (profile: string, locale: string) => ["smriti", "content", "manifest", profile, locale] as const,
  bundle: (hash: string) => ["bundle", hash] as const,
};

export interface LoadedManifest {
  profile: string;
  manifest: Manifest;
  /** Files (bundles, assets) resolve against this, with the manifest's own `path` values. */
  baseUrl: string;
}

/**
 * `GET /v1/content/manifest` through the generated client. Local APIs inline the manifest; a CDN
 * deployment returns its url. A profile with nothing published yet resolves to null.
 */
export function useManifest() {
  const s = useServices();
  const { locale } = useI18n();
  const profile = useProfileIds()[0] ?? null;
  return useQuery({
    queryKey: contentKeys.manifest(profile ?? "none", locale),
    enabled: !!profile,
    staleTime: 10 * 60_000,
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
    queryFn: async (): Promise<LoadedManifest | null> => {
      let res;
      try {
        res = await unwrap(s.client.GET("/v1/content/manifest", { params: { query: { exam: profile ?? "", locale } } }), s.client);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
      let manifest = res.manifest as unknown as Manifest | null;
      if (!manifest && res.url) {
        const r = await s.fetch(res.url);
        if (!r.ok) throw new Error(`manifest ${r.status}`);
        manifest = (await r.json()) as Manifest;
      }
      if (!manifest) return null;
      return { profile: res.exam_profile_id, manifest, baseUrl: (res.base_url || s.contentBaseUrl).replace(/\/+$/, "") + "/" };
    },
  });
}

export function bundleEntry(m: Manifest | undefined, topicId: string, mode: BundleMode): BundleEntry | null {
  return m?.topics[topicId]?.bundles[mode] ?? null;
}

export function useBundle(topicId: string | null, mode: BundleMode) {
  const s = useServices();
  const loaded = useManifest().data ?? null;
  const entry = topicId ? bundleEntry(loaded?.manifest, topicId, mode) : null;
  return useQuery({
    queryKey: contentKeys.bundle(entry?.hash ?? "none"),
    enabled: !!entry && !!loaded,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: async () => {
      const e = entry as BundleEntry;
      const base = (loaded as LoadedManifest).baseUrl;
      const res = await s.fetch(`${base}${e.path}`);
      if (!res.ok) throw new Error(`bundle ${res.status}`);
      const bundle = (await res.json()) as TypedBundle;
      await s.storage.bundles
        .put({ bundle_id: e.id, hash: e.hash, path: e.path, bytes: e.size_bytes, pinned: false, last_opened_at: new Date().toISOString(), source: "cache", kind: mode, locale: bundle.locale })
        .catch(() => undefined);
      return { bundle, entry: e, baseUrl: base };
    },
  });
}

/** A chapter in the catalogue view (subject → chapters → topics), from the manifest. */
export interface CatalogTopic {
  id: string;
  name: string;
  sort: number;
  minutes: number;
  hasDeepDive: boolean;
  hasQuickRevision: boolean;
  deepDiveFree: boolean;
  cardCount: number;
  /** Questions in the topic's practice bundle (0 when there is none). */
  practiceCount: number;
}
export interface CatalogChapter {
  id: string;
  name: string;
  index: number;
  unit: string;
  free: boolean;
  topics: CatalogTopic[];
}
export interface CatalogSubject {
  id: string;
  name: string;
  family: string;
  chapters: CatalogChapter[];
}

/** About 20 seconds a card, at least a minute (an estimate for the row meta only). */
const minutesFor = (cards: number) => Math.max(1, Math.round((cards * 20) / 60));

export function catalogFrom(m: Manifest | undefined): CatalogSubject[] {
  if (!m) return [];
  return [...m.subjects]
    .sort((a, b) => a.sort - b.sort)
    .map((s) => ({
      id: s.id,
      name: s.name,
      family: s.color_family,
      chapters: [...s.chapters]
        .sort((a, b) => a.sort - b.sort)
        .map((c, i) => ({
          id: c.id,
          name: c.name,
          index: i,
          unit: c.unit,
          free: c.free_deep_dive || m.free.deep_dive_chapters.includes(c.id),
          topics: c.topics
            .map((id) => ({ id, t: m.topics[id] }))
            .filter((x): x is { id: string; t: NonNullable<typeof x.t> } => !!x.t)
            .sort((a, b) => a.t.sort - b.t.sort)
            .map(({ id, t }) => {
              const dd = t.bundles.deep_dive;
              return {
                id,
                name: t.name,
                sort: t.sort,
                minutes: minutesFor(dd?.card_count ?? t.bundles.quick_revision?.card_count ?? 1),
                hasDeepDive: !!dd,
                hasQuickRevision: !!t.bundles.quick_revision,
                deepDiveFree: dd?.is_free ?? false,
                cardCount: dd?.card_count ?? 0,
                practiceCount: t.bundles.practice?.card_count ?? 0,
              };
            }),
        })),
    }));
}

export function useCatalog() {
  const q = useManifest();
  const m = q.data?.manifest;
  return { ...q, subjects: catalogFrom(m), fixture: m?.fixture === true, manifest: m, unpublished: q.isSuccess && !q.data };
}

export interface TopicLocation {
  subject: CatalogSubject;
  chapter: CatalogChapter;
  topic: CatalogTopic;
  topicIndex: number;
}

export function findTopic(subjects: CatalogSubject[], topicId: string): TopicLocation | null {
  for (const subject of subjects)
    for (const chapter of subject.chapters) {
      const i = chapter.topics.findIndex((t) => t.id === topicId);
      const topic = chapter.topics[i];
      if (topic) return { subject, chapter, topic, topicIndex: i };
    }
  return null;
}

/** Lesson settings from owner flags (`xp.*`, `free.deep_dive_preview_cards`, `learn.*`). */
export function lessonConfigFrom(flags: Flags): LessonConfig {
  const opt = (v: number | null | undefined) => (typeof v === "number" ? v : null);
  return lessonConfig(
    {
      firstTry: flags.get("xp.lesson_first_try"),
      secondTry: flags.get("xp.lesson_second_try"),
      attempt: flags.get("xp.lesson_attempt"),
      complete: flags.get("xp.lesson_complete"),
      combo: flags.get("xp.combo_bonus"),
    },
    {
      previewCards: flags.get("free.deep_dive_preview_cards"),
      comboStreakLen: flags.get("learn.combo_streak_len"),
      findLevelQuestions: flags.get("learn.find_level_questions"),
      fixMistakesMax: opt(flags.get("learn.fix_mistakes_max")),
      testOutQuestionsPerTopic: opt(flags.get("learn.test_out_questions_per_topic")),
      resumeRestartDays: opt(flags.get("learn.resume_restart_days")),
    },
  );
}
