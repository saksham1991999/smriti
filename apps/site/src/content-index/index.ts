// Loads the site content index at build time and exposes the selectors the pages use.
//
// Source order: CONTENT_INDEX_PATH (written by the content-engine publish job); else the
// publisher's local output, tools/content-publish/out/site-index.json, when it exists; else the
// local fixture (marked `"fixture": true`). CONTENT_INDEX_PATH=fixture forces the local fixture
// (the e2e smoke tests expect its pages). With SITE_REQUIRE_CONTENT_INDEX=1 any fixture fails the
// build, so production can never ship placeholder pages.
//
// The publisher writes site-index.json only when some subject is released. When its
// publish-report.json (next to the index) says `"site_index": null`, nothing is released: the
// site builds from an empty index and shows "coming soon" states, never a stale or sample index.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { site } from "../config/site";
import fixture from "./fixture/site-index.fixture.json";
import { SiteIndex, type Blueprint, type Chapter, type Exam, type Subject, type Topic } from "./schema";

export type { Blueprint, Chapter, Exam, Subject, Topic, SiteIndex as SiteIndexType } from "./schema";

const FIXTURE_NAME = "fixture/site-index.fixture.json";

export interface LoadOptions {
  path?: string | undefined;
  requireReal?: boolean;
}

export function parseIndex(raw: unknown, source: string): SiteIndex {
  const result = SiteIndex.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 20)
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Content index at ${source} is invalid:\n${issues}`);
  }
  return result.data;
}

/** The index for a build where nothing is released yet: no exams, no pages below /exams/. */
export function emptyIndex(generatedAt = "unreleased"): SiteIndex {
  return { schema: "site-index@1", generated_at: generatedAt, exams: [], subjects: [], home_try_lesson: null };
}

/** True when the build has no released exam (the home page and /exams/ say "coming soon"). */
export const isUnreleased = (idx: SiteIndex): boolean => idx.exams.length === 0;

interface PublishReportLite {
  site_index: string | null;
  published_at?: string;
}

/**
 * The publisher's report in `dir`, when there is one. Undefined when it is missing or is not a
 * publish report; a report that cannot be parsed fails the build rather than guessing.
 */
export function readPublishReport(dir: string): PublishReportLite | undefined {
  const file = join(dir, "publish-report.json");
  if (!existsSync(file)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Could not read the publish report at ${file}: ${(err as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null || (raw as { schema?: unknown }).schema !== "publish-report@1") return undefined;
  const r = raw as { site_index?: unknown; published_at?: unknown };
  if (r.site_index !== null && typeof r.site_index !== "string") return undefined;
  return { site_index: r.site_index, ...(typeof r.published_at === "string" ? { published_at: r.published_at } : {}) };
}

export function loadIndexFrom(opts: LoadOptions = {}): SiteIndex {
  const configured = opts.path;
  let raw: unknown = fixture;
  let file = FIXTURE_NAME;
  if (configured) {
    file = isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      throw new Error(`Could not read the content index at ${file}: ${(err as Error).message}`);
    }
  }
  const idx = parseIndex(raw, file);
  if (opts.requireReal && (idx.fixture || !configured)) {
    throw new Error(
      "SITE_REQUIRE_CONTENT_INDEX is set, but the build is using the fixture index. Set CONTENT_INDEX_PATH to the published site index.",
    );
  }
  return idx;
}

/** Where `pnpm --filter @smriti/content-publish publish:local` writes the index, from the repo root. */
export const PUBLISHER_INDEX = join("tools", "content-publish", "out", "site-index.json");

/**
 * The publisher's local output, found by walking up from `start` to the workspace root
 * (the folder with pnpm-workspace.yaml). Undefined when nothing has been published.
 */
export function findPublisherIndex(start: string = process.cwd()): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, PUBLISHER_INDEX);
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return undefined;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** The publisher's output folder (tools/content-publish/out), found like findPublisherIndex. */
export function findPublisherOut(start: string = process.cwd()): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, dirname(PUBLISHER_INDEX));
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return undefined;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** The index file to load: the configured path, `fixture` for the local fixture, else the publisher's output. */
export function resolveIndexPath(configured: string | undefined, start?: string): string | undefined {
  if (configured === "fixture") return undefined;
  return configured ?? findPublisherIndex(start);
}

/** What a build loads: a file, the local fixture, or nothing released (an empty index). */
export type IndexSource =
  | { kind: "file"; path: string }
  | { kind: "fixture" }
  | { kind: "unreleased"; report: string; publishedAt: string | undefined };

/**
 * Decides the source. A publish report that says `site_index: null` wins over any
 * site-index.json beside it (a leftover from an earlier run), so nothing unreleased ships.
 */
export function resolveIndexSource(configured: string | undefined, start: string = process.cwd()): IndexSource {
  if (configured === "fixture") return { kind: "fixture" };
  const unreleased = (dir: string): IndexSource | undefined => {
    const report = readPublishReport(dir);
    return report && report.site_index === null
      ? { kind: "unreleased", report: join(dir, "publish-report.json"), publishedAt: report.published_at }
      : undefined;
  };
  if (configured) {
    const file = isAbsolute(configured) ? configured : resolve(start, configured);
    return unreleased(dirname(file)) ?? { kind: "file", path: file };
  }
  const out = findPublisherOut(start);
  if (out) {
    const none = unreleased(out);
    if (none) return none;
    const file = join(out, "site-index.json");
    if (existsSync(file)) return { kind: "file", path: file };
  }
  return { kind: "fixture" };
}

/** Loads what resolveIndexSource chose. An unreleased build is real (not a fixture) and empty. */
export function loadIndex(source: IndexSource, requireReal = false): SiteIndex {
  if (source.kind === "unreleased") return emptyIndex(source.publishedAt);
  return loadIndexFrom({ path: source.kind === "file" ? source.path : undefined, requireReal });
}

let cached: SiteIndex | undefined;
export function getIndex(): SiteIndex {
  cached ??= loadIndex(resolveIndexSource(site.contentIndexPath), site.requireContentIndex);
  return cached;
}

// ---------- Selectors (pure, so they are unit tested against any index) ----------

export interface ExamSubject {
  subject: Subject;
  chapters: ExamChapter[];
}
export interface ExamChapter {
  chapter: Chapter;
  topics: Topic[];
}

/** The subjects of an exam, with only the chapters and topics tagged for that exam. */
export function subjectsForExam(idx: SiteIndex, exam: Exam): ExamSubject[] {
  const out: ExamSubject[] = [];
  for (const sid of exam.subjects) {
    const subject = idx.subjects.find((s) => s.id === sid);
    if (!subject) continue;
    const chapters = subject.chapters
      .filter((c) => c.exams.includes(exam.id))
      .map((chapter) => ({ chapter, topics: chapter.topics.filter((t) => t.exams.includes(exam.id)) }))
      .filter((c) => c.topics.length > 0);
    if (chapters.length > 0) out.push({ subject, chapters });
  }
  return out;
}

/**
 * The exam pattern block is shown only from a reviewed blueprint with an https source.
 * Anything else returns null and the section is hidden (never a guessed pattern).
 */
export function visibleBlueprint(exam: Exam): Blueprint | null {
  const bp = exam.blueprint;
  if (!bp) return null;
  if (!bp.source.url.startsWith("https://")) return null;
  if (!bp.reviewed_by.trim()) return null;
  const hasAnyNumber =
    bp.duration_min !== null ||
    bp.total_questions !== null ||
    bp.max_marks !== null ||
    bp.sections.some((s) => s.question_count !== null || s.marking !== null);
  return hasAnyNumber ? bp : null;
}

export interface TopicRef {
  exam: Exam;
  subject: Subject;
  chapter: Chapter;
  topic: Topic;
}

export function allTopicRefs(idx: SiteIndex): TopicRef[] {
  return idx.exams.flatMap((exam) =>
    subjectsForExam(idx, exam).flatMap(({ subject, chapters }) =>
      chapters.flatMap(({ chapter, topics }) => topics.map((topic) => ({ exam, subject, chapter, topic }))),
    ),
  );
}

/** Site paths (English form) for each level. */
export const paths = {
  exams: () => "/exams/",
  exam: (e: Exam) => `/exams/${e.slug}/`,
  subject: (e: Exam, s: Subject) => `/exams/${e.slug}/${s.slug}/`,
  chapter: (e: Exam, s: Subject, c: Chapter) => `/exams/${e.slug}/${s.slug}/${c.slug}/`,
  topic: (e: Exam, s: Subject, c: Chapter, t: Topic) => `/exams/${e.slug}/${s.slug}/${c.slug}/${t.slug}/`,
};

/** Every conducting body named in the index, for the "not affiliated" line. */
export function conductingBodies(idx: SiteIndex): string[] {
  return [...new Set(idx.exams.map((e) => e.conducting_body).filter((b): b is string => Boolean(b)))];
}
