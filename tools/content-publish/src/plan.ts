/** Which subjects, chapters and topics each exam profile publishes, in display order. */
import type { ChapterFile, ExamMapFile, SubjectFile } from "@smriti/content-schema";
import type { ContentSet } from "@smriti/content-schema/check";

/** PRD §11.1: Deep Dives of the first chapters of every subject are free. */
export const FREE_DEEP_DIVE_CHAPTERS_PER_SUBJECT = 2;

export interface PlannedChapter {
  chapter: ChapterFile;
  sort: number;
  /** Deep Dives are free (first chapters of the subject in this profile's order). */
  freeDeepDive: boolean;
  topics: string[];
}

export interface PlannedSubject {
  subject: SubjectFile;
  chapters: PlannedChapter[];
}

export interface ProfilePlan {
  profileId: string;
  examId: string;
  locales: string[];
  examMap: ExamMapFile;
  subjects: PlannedSubject[];
  /** topic id -> concept id -> exam depth */
  depth: Map<string, Record<string, number>>;
}

export function examMapFor(set: ContentSet, profileId: string): ExamMapFile | undefined {
  return set.examMaps.find((m) => m.doc.exam_profile === profileId)?.doc;
}

/**
 * Plan one profile. `subjectFilter` limits it to some subjects (released subjects for a remote
 * target); null publishes every subject the exam map touches.
 */
export function planProfile(set: ContentSet, profileId: string, subjectFilter: Set<string> | null): ProfilePlan | null {
  const p = set.profiles.get(profileId);
  const examMap = examMapFor(set, profileId);
  if (!p || !examMap) return null;
  const depth = new Map<string, Record<string, number>>();
  for (const c of examMap.concepts) {
    const entry = set.concepts.get(set.aliases.get(c.id) ?? c.id);
    if (!entry) continue;
    const topicId = entry.topic.id;
    const d = depth.get(topicId) ?? {};
    d[entry.concept.id] = c.depth;
    depth.set(topicId, d);
  }
  const subjects: PlannedSubject[] = [];
  const sortedSubjects = [...set.subjects].sort((a, b) => a.doc.sort - b.doc.sort || a.doc.id.localeCompare(b.doc.id));
  for (const { doc: subject } of sortedSubjects) {
    if (subjectFilter && !subjectFilter.has(subject.id)) continue;
    const chapters: PlannedChapter[] = [];
    for (const chapterId of subject.chapters) {
      const chapter = set.chapters.find((c) => c.doc.id === chapterId)?.doc;
      if (!chapter) continue;
      const topics = chapter.topics.map((t) => t.id).filter((t) => depth.has(t));
      if (topics.length === 0) continue;
      chapters.push({ chapter, sort: chapters.length + 1, freeDeepDive: false, topics });
    }
    chapters.forEach((c, i) => {
      c.freeDeepDive = i < FREE_DEEP_DIVE_CHAPTERS_PER_SUBJECT;
    });
    if (chapters.length) subjects.push({ subject, chapters });
  }
  return { profileId, examId: p.exam.id, locales: p.profile.locales, examMap, subjects, depth };
}

/** Subjects marked for release in any exam map. */
export function releasedSubjects(set: ContentSet): Set<string> {
  const out = new Set<string>();
  for (const m of set.examMaps) for (const s of m.doc.released_subjects ?? []) out.add(s);
  return out;
}

/** Is a chapter's Deep Dive free in the subject's own order (used for content.content_items.is_free)? */
export function freeInSubjectOrder(set: ContentSet, chapterId: string): boolean {
  for (const { doc } of set.subjects) {
    const i = doc.chapters.indexOf(chapterId);
    if (i >= 0) return i < FREE_DEEP_DIVE_CHAPTERS_PER_SUBJECT;
  }
  return false;
}

/** Compare dotted versions numerically: -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
