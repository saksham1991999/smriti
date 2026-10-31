import type { ActivityBundle, ActivityEntry, Manifest, TopicEntry, TypedBundle } from '@smriti/content-schema/runtime';
import type { ImageSourcePropType } from 'react-native';

import type { SeedPackFiles } from '../seed/types';

export type ContentLocale = 'en' | 'hi';
export type BundleMode = 'deep_dive' | 'quick_revision' | 'practice';

export interface TopicView {
  id: string;
  name: string;
  chapterId: string;
  sort: number;
  depth: Record<string, number>;
  hasDeepDive: boolean;
  hasQuickRevision: boolean;
  freeDeepDive: boolean;
  /** Estimated minutes for one bite, from the bundle when it is on the device. */
  minutes: number | null;
}

export interface ChapterView {
  id: string;
  name: string;
  subjectId: string;
  /** The manifest's unit id (manifest@1 has no unit names, so LRN-01 shows no unit headers yet). */
  unitId: string;
  free: boolean;
  topics: TopicView[];
}

export interface SubjectView {
  id: string;
  name: string;
  colorFamily: string;
  /**
   * Unit names (content-schema `SubjectFile.units`, localised). manifest@1 does not carry them
   * yet, so this is empty and LRN-01 shows no unit headers until the publisher adds them.
   */
  units?: { id: string; name: string }[];
  chapters: ChapterView[];
}

export interface LoadedBundle {
  bundle: TypedBundle;
  /** The content hash, sent as `bundle_version` (sync contract). */
  hash: string;
  examDepth: Record<string, number> | null;
}

/**
 * Lessons on the device. The seed pack (TRD §3.2) is bundled with the build, so the first
 * lesson works offline on first launch; later downloads go through app-core's ContentManager
 * (see `downloads.ts`). Manifests are `manifest@1` from tools/content-publish.
 */
export class ContentRepo {
  /** Bundles downloaded after install (LRN-15), by manifest path; filled by `ContentDownloads`. */
  private readonly downloaded: Record<ContentLocale, Map<string, unknown>> = { en: new Map(), hi: new Map() };

  constructor(private readonly packs: Record<ContentLocale, SeedPackFiles>) {}

  /** A downloaded bundle becomes readable like a seed one (manifest paths are content-addressed). */
  addBundle(locale: ContentLocale, path: string, json: unknown): void {
    this.downloaded[locale].set(path, json);
  }

  removeBundle(locale: ContentLocale, path: string): void {
    this.downloaded[locale].delete(path);
  }

  /** Shipped in the build's seed pack: always on the device, never downloaded or removed. */
  inSeed(locale: ContentLocale, path: string): boolean {
    return Boolean(this.packs[locale].bundles[path]);
  }

  hasBundle(locale: ContentLocale, path: string): boolean {
    return this.inSeed(locale, path) || this.downloaded[locale].has(path);
  }

  /** Whether a topic's bundle for a mode is on the device (LRN-02 "Needs internet" chips). */
  available(locale: ContentLocale, topicId: string, mode: BundleMode, examProfileId?: string | null): boolean {
    const entry = this.manifest(locale, examProfileId).topics[topicId]?.bundles[mode];
    return Boolean(entry && this.hasBundle(locale, entry.path));
  }

  private read(locale: ContentLocale, path: string): TypedBundle | null {
    const loader = this.packs[locale].bundles[path];
    if (loader) return loader() as TypedBundle;
    return (this.downloaded[locale].get(path) as TypedBundle | undefined) ?? null;
  }

  isFixture(locale: ContentLocale): boolean {
    return this.packs[locale].pack.fixture === true;
  }

  /** The manifest for an exam profile, falling back to the seed pack's first one (dev seed packs). */
  manifest(locale: ContentLocale, examProfileId?: string | null): Manifest {
    const files = this.packs[locale];
    const entry = files.pack.manifests.find((m) => m.exam_profile === examProfileId) ?? files.pack.manifests[0];
    if (!entry) throw new Error(`seed pack ${files.pack.variant_id}/${locale} has no manifest`);
    const load = files.manifests[entry.path];
    if (!load) throw new Error(`seed pack is missing ${entry.path}`);
    return load() as Manifest;
  }

  subjects(locale: ContentLocale, examProfileId?: string | null): SubjectView[] {
    const m = this.manifest(locale, examProfileId);
    const free = new Set(m.free.deep_dive_chapters);
    return [...m.subjects]
      .sort((a, b) => a.sort - b.sort)
      .map((s) => ({
        id: s.id,
        name: s.name,
        colorFamily: s.color_family,
        units: unitNames(s),
        chapters: [...s.chapters]
          .sort((a, b) => a.sort - b.sort)
          .map((c) => ({
            id: c.id,
            name: c.name,
            subjectId: s.id,
            unitId: c.unit,
            free: c.free_deep_dive || free.has(c.id),
            topics: c.topics.map((t) => this.topicView(m, t, c.free_deep_dive || free.has(c.id), locale)).filter((t): t is TopicView => t !== null),
          })),
      }));
  }

  /** Every topic in syllabus order. */
  topics(locale: ContentLocale, examProfileId?: string | null): TopicView[] {
    return this.subjects(locale, examProfileId).flatMap((s) => s.chapters.flatMap((c) => c.topics));
  }

  topic(locale: ContentLocale, topicId: string, examProfileId?: string | null): TopicView | null {
    return this.topics(locale, examProfileId).find((t) => t.id === topicId) ?? null;
  }

  chapterOf(locale: ContentLocale, topicId: string, examProfileId?: string | null): ChapterView | null {
    for (const s of this.subjects(locale, examProfileId)) for (const c of s.chapters) if (c.topics.some((t) => t.id === topicId)) return c;
    return null;
  }

  subjectOf(locale: ContentLocale, topicId: string, examProfileId?: string | null): SubjectView | null {
    return this.subjects(locale, examProfileId).find((s) => s.chapters.some((c) => c.topics.some((t) => t.id === topicId))) ?? null;
  }

  /** Opens a bundle that is on the device, or returns null (the caller shows LRN-16 / LES-11). */
  load(locale: ContentLocale, topicId: string, mode: BundleMode, examProfileId?: string | null): LoadedBundle | null {
    const m = this.manifest(locale, examProfileId);
    const t = m.topics[topicId];
    const entry = t?.bundles[mode];
    if (!t || !entry) return null;
    const bundle = this.read(locale, entry.path);
    if (!bundle) return null;
    return { bundle, hash: entry.hash, examDepth: depthMap(t) };
  }

  /** A topic's little learner activities (story, song, play) in path order, from the manifest. */
  activities(locale: ContentLocale, topicId: string, examProfileId?: string | null): ActivityEntry[] {
    return this.manifest(locale, examProfileId).topics[topicId]?.activities ?? [];
  }

  /** The story, song or play bundle that holds a topic's activities, if it is on the device. */
  loadActivities(locale: ContentLocale, topicId: string, kind: 'story' | 'song' | 'play', examProfileId?: string | null): { bundle: ActivityBundle; hash: string } | null {
    const entry = this.manifest(locale, examProfileId).topics[topicId]?.bundles[kind];
    const bundle = entry ? this.read(locale, entry.path) : null;
    return entry && bundle ? { bundle: bundle as unknown as ActivityBundle, hash: entry.hash } : null;
  }

  /** Bundled image for a media ref's file (`assets/<sha>.webp`), if it is in the seed pack. */
  asset(locale: ContentLocale, path: string): ImageSourcePropType | undefined {
    return this.packs[locale].assets[path.replace(/^\//, '')];
  }

  private topicView(m: Manifest, topicId: string, freeChapter: boolean, locale: ContentLocale): TopicView | null {
    const t = m.topics[topicId];
    if (!t) return null;
    const dd = t.bundles.deep_dive;
    let minutes: number | null = null;
    if (dd) {
      const b = this.read(locale, dd.path);
      minutes = b?.bites[0]?.estimated_minutes ?? b?.estimated_minutes ?? null;
    }
    return {
      id: topicId,
      name: t.name,
      chapterId: t.chapter,
      sort: t.sort,
      depth: depthMap(t),
      hasDeepDive: Boolean(dd),
      hasQuickRevision: Boolean(t.bundles.quick_revision),
      freeDeepDive: freeChapter && (dd?.is_free ?? true),
      minutes,
    };
  }
}

/** Read defensively: a later manifest may add `units: [{ id, name }]` to each subject. */
function unitNames(subject: Manifest['subjects'][number]): { id: string; name: string }[] {
  const raw = (subject as { units?: unknown }).units;
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is { id: string; name: string } => typeof u === 'object' && u !== null && typeof (u as { id?: unknown }).id === 'string' && typeof (u as { name?: unknown }).name === 'string');
}

function depthMap(t: TopicEntry): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(t.depth)) if (typeof v === 'number') out[k] = v;
  return out;
}
