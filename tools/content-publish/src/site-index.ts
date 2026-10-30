/**
 * The marketing site's content index (`site-index@1`, apps/site/src/content-index/schema.ts): the
 * public slice of the graph the Astro site builds its exam, subject and topic pages from.
 *
 * Rules carried over from the site schema:
 * - Every student-facing text is { en, hi }.
 * - Exam pattern numbers go out only inside `blueprint`, and a blueprint goes out only with its
 *   official citation (url, title, published, retrieved) and a named reviewer. Otherwise null.
 * - Minutes and counts are never estimated: missing means null.
 * - Topic ids are the graph ids (lowercase ASCII, dots and hyphens), stable and URL-safe; the
 *   site's `topic` hand-off parameter carries them as they are.
 */
import type { BlueprintFile, I18NText, Question } from "@smriti/content-schema";
import type { ContentSet } from "@smriti/content-schema/check";

import { findLesson } from "./bundle.js";
import { PublishError } from "./errors.js";
import { freeInSubjectOrder, type ProfilePlan } from "./plan.js";

export interface Localised {
  en: string;
  hi: string;
}

export interface SiteQuizQuestion {
  id: string;
  stem: Localised;
  options: { id: string; text: Localised }[];
  answer: string;
  explanation: Localised;
}

export interface SiteTryLesson {
  topic_id: string;
  title: Localised;
  questions: SiteQuizQuestion[];
}

export interface SiteBlueprint {
  paper_code: string;
  version: number;
  effective_from: string;
  title: Localised;
  source: { url: string; title: string; published: string; retrieved: string; pages?: string | null };
  reviewed_by: string;
  mode: "cbt" | "pen_paper" | null;
  duration_min: number | null;
  languages: string[] | null;
  total_questions: number | null;
  max_marks: number | null;
  sections: {
    code: string;
    title: Localised;
    subject: string | null;
    question_count: number | null;
    marking: { correct: number; wrong: number; unattempted: number } | null;
  }[];
}

export interface SiteExam {
  id: string;
  slug: string;
  accent: "all" | "jee" | "neet" | "upsc" | "ssc";
  name: Localised;
  short_name: Localised;
  category: string;
  conducting_body: string | null;
  official_url: string | null;
  summary: Localised | null;
  subjects: string[];
  blueprint: SiteBlueprint | null;
  try_lesson: SiteTryLesson | null;
}

export interface SiteTopic {
  id: string;
  slug: string;
  name: Localised;
  summary: Localised | null;
  exams: string[];
  modes: { deep_dive: { minutes: number | null } | null; quick_revision: { minutes: number | null } | null };
}

export interface SiteChapter {
  id: string;
  slug: string;
  name: Localised;
  summary: Localised | null;
  exams: string[];
  deep_dive_free: boolean;
  topics: SiteTopic[];
}

export interface SiteSubject {
  id: string;
  slug: string;
  name: Localised;
  summary: Localised | null;
  chapters: SiteChapter[];
}

export interface SiteIndex {
  schema: "site-index@1";
  fixture?: boolean;
  fixture_note?: string;
  generated_at: string;
  exams: SiteExam[];
  subjects: SiteSubject[];
  home_try_lesson: SiteTryLesson | null;
}

export const SITE_INDEX_KEY = "site-index.json";
const URL_SAFE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const TRY_LESSON_MAX = 5;

function bi(text: I18NText | undefined | null, where: string): Localised {
  const en = text?.en;
  const hi = text?.hi;
  if (!en || !hi) throw new PublishError("site_index_locale", `${where} needs en and hi text`);
  return { en, hi };
}

/** The last segment of a dotted id: a URL slug unique within its parent. */
export function slugOf(id: string): string {
  return id.slice(id.lastIndexOf(".") + 1);
}

function accentOf(examId: string): SiteExam["accent"] {
  for (const a of ["jee", "neet", "upsc", "ssc"] as const) if (examId === a || examId.startsWith(`${a}-`)) return a;
  return "all";
}

/** A site blueprint, only when the file carries its official citation and a reviewer. */
export function siteBlueprint(bp: BlueprintFile, title: Localised): SiteBlueprint | null {
  const src = bp.source;
  if (!src?.url || !src.title || !src.published || !src.retrieved || !bp.reviewed_by) return null;
  return {
    paper_code: bp.paper_code,
    version: bp.version,
    effective_from: bp.effective_from,
    title,
    source: { url: src.url, title: src.title, published: src.published, retrieved: src.retrieved, pages: src.pages ?? null },
    reviewed_by: bp.reviewed_by,
    mode: bp.mode ?? null,
    duration_min: bp.duration_min ?? null,
    languages: bp.languages ?? null,
    total_questions: bp.question_count ?? null,
    max_marks: bp.max_marks ?? null,
    sections: bp.sections.map((s) => {
      const rules = Object.values(s.marking).filter((r): r is NonNullable<typeof r> => !!r);
      const first = rules[0];
      const uniform =
        first &&
        rules.every((r) => r.correct === first.correct && r.wrong === first.wrong && r.unattempted === first.unattempted);
      return {
        code: s.code,
        title: bi(s.title, `${bp.paper_code} section ${s.code}`),
        subject: s.subject ?? null,
        question_count: s.question_count ?? null,
        marking: uniform ? { correct: first.correct, wrong: first.wrong, unattempted: first.unattempted } : null,
      };
    }),
  };
}

function plainText(...texts: (string | undefined)[]): boolean {
  // The site renders plain text: no maths to typeset and no blanks to fill.
  return texts.every((t) => t !== undefined && !t.includes("$") && !t.includes("{{"));
}

function quizQuestion(q: Question): SiteQuizQuestion | null {
  if (q.type !== "mcq_single") return null;
  if (!q.use.some((u) => u === "lesson" || u === "practice")) return null;
  const answer = q.answer.option_ids[0];
  const feynman = q.solution?.feynman;
  if (!answer || !feynman?.en || !feynman.hi || !q.stem.en || !q.stem.hi) return null;
  const texts = [q.stem.en, q.stem.hi, feynman.en, feynman.hi, ...q.options.flatMap((o) => [o.text.en, o.text.hi])];
  if (!plainText(...texts)) return null;
  return {
    id: q.id,
    stem: { en: q.stem.en, hi: q.stem.hi },
    options: q.options.map((o) => ({ id: o.id, text: bi(o.text, `${q.id} option ${o.id}`) })),
    answer,
    explanation: { en: feynman.en, hi: feynman.hi },
  };
}

function tryLesson(set: ContentSet, plan: ProfilePlan): SiteTryLesson | null {
  for (const s of plan.subjects) {
    for (const c of s.chapters) {
      for (const topicId of c.topics) {
        const qs = [...set.questions.values()]
          .filter((e) => !e.parent && e.topic === topicId)
          .map((e) => quizQuestion(e.question))
          .filter((q): q is SiteQuizQuestion => q !== null)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, TRY_LESSON_MAX);
        const topic = set.topics.get(topicId);
        if (qs.length && topic) return { topic_id: topicId, title: bi(topic.topic.name, topicId), questions: qs };
      }
    }
  }
  return null;
}

export interface SiteIndexInputs {
  set: ContentSet;
  plans: ProfilePlan[];
  fixture: boolean;
  now: Date;
}

export function buildSiteIndex({ set, plans, fixture, now }: SiteIndexInputs): SiteIndex | null {
  const today = now.toISOString().slice(0, 10);
  const plansByExam = new Map<string, ProfilePlan[]>();
  for (const p of plans) {
    if (!p.subjects.length) continue;
    const list = plansByExam.get(p.examId) ?? [];
    list.push(p);
    plansByExam.set(p.examId, list);
  }

  const exams: SiteExam[] = [];
  for (const { doc: exam } of [...set.exams].sort((a, b) => a.doc.id.localeCompare(b.doc.id))) {
    const examPlans = plansByExam.get(exam.id);
    if (!examPlans) continue;
    // The current cycle: the latest active profile.
    const current = [...examPlans].sort((a, b) => {
      const ca = set.profiles.get(a.profileId)?.profile.cycle ?? "";
      const cb = set.profiles.get(b.profileId)?.profile.cycle ?? "";
      return cb.localeCompare(ca);
    })[0] as ProfilePlan;
    const prof = set.profiles.get(current.profileId);
    if (!prof) continue;
    const examName = bi(exam.name, exam.id);
    const profileTitle: Localised = prof.profile.name
      ? bi(prof.profile.name, current.profileId)
      : { en: `${examName.en} ${prof.profile.cycle}`, hi: `${examName.hi} ${prof.profile.cycle}` };

    const paper = prof.profile.papers[0];
    const candidates = set.blueprints
      .map((b) => b.doc)
      .filter((b) => b.exam_profile === current.profileId && b.paper_code === paper)
      .sort((a, b) => b.version - a.version);
    const inForce = candidates.find((b) => b.effective_from <= today) ?? candidates[0];
    const blueprint = inForce ? siteBlueprint(inForce, profileTitle) : null;

    const subjects: string[] = [];
    for (const p of examPlans) for (const s of p.subjects) if (!subjects.includes(s.subject.id)) subjects.push(s.subject.id);

    exams.push({
      id: exam.id,
      slug: exam.id.replace(/\./g, "-"),
      accent: accentOf(exam.id),
      name: examName,
      short_name: examName,
      category: exam.category,
      conducting_body: exam.conducting_body ?? null,
      official_url: exam.official_url ?? null,
      summary: null,
      subjects,
      blueprint,
      try_lesson: tryLesson(set, current),
    });
  }
  if (exams.length === 0) return null;

  // Subjects, chapters and topics across every exam, each tagged with the exams that include it.
  const chapterExams = new Map<string, Set<string>>();
  const topicExams = new Map<string, Set<string>>();
  const subjectOrder: string[] = [];
  const chapterOrder = new Map<string, string[]>();
  const topicOrder = new Map<string, string[]>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => m.set(k, (m.get(k) ?? new Set()).add(v));
  for (const p of plans) {
    for (const s of p.subjects) {
      if (!subjectOrder.includes(s.subject.id)) subjectOrder.push(s.subject.id);
      const chapters = chapterOrder.get(s.subject.id) ?? [];
      for (const c of s.chapters) {
        if (!chapters.includes(c.chapter.id)) chapters.push(c.chapter.id);
        add(chapterExams, c.chapter.id, p.examId);
        const topics = topicOrder.get(c.chapter.id) ?? [];
        for (const t of c.topics) {
          if (!topics.includes(t)) topics.push(t);
          add(topicExams, t, p.examId);
        }
        topicOrder.set(c.chapter.id, topics);
      }
      chapterOrder.set(s.subject.id, chapters);
    }
  }
  const sortedIds = (ids: Set<string> | undefined) => [...(ids ?? [])].sort();

  const subjects: SiteSubject[] = subjectOrder.map((subjectId) => {
    const subject = set.subjects.find((s) => s.doc.id === subjectId)?.doc;
    if (!subject) throw new PublishError("site_index_subject", subjectId);
    return {
      id: subject.id,
      slug: subject.id.replace(/\./g, "-"),
      name: bi(subject.name, subject.id),
      summary: null,
      chapters: (chapterOrder.get(subjectId) ?? []).map((chapterId) => {
        const chapter = set.chapters.find((c) => c.doc.id === chapterId)?.doc;
        if (!chapter) throw new PublishError("site_index_chapter", chapterId);
        return {
          id: chapter.id,
          slug: slugOf(chapter.id),
          name: bi(chapter.name, chapter.id),
          summary: null,
          exams: sortedIds(chapterExams.get(chapterId)),
          deep_dive_free: freeInSubjectOrder(set, chapterId),
          topics: (topicOrder.get(chapterId) ?? []).map((topicId) => {
            if (!URL_SAFE_ID.test(topicId)) throw new PublishError("site_index_topic_id", `${topicId} is not URL-safe`);
            const topic = set.topics.get(topicId)?.topic;
            if (!topic) throw new PublishError("site_index_topic", topicId);
            const dd = findLesson(set, topicId, "deep_dive");
            const qr = findLesson(set, topicId, "quick_revision");
            return {
              id: topicId,
              slug: slugOf(topicId),
              name: bi(topic.name, topicId),
              summary: topic.summary ? bi(topic.summary, topicId) : null,
              exams: sortedIds(topicExams.get(topicId)),
              modes: {
                deep_dive: dd ? { minutes: dd.estimated_minutes ?? null } : null,
                quick_revision: qr ? { minutes: qr.estimated_minutes ?? null } : null,
              },
            };
          }),
        };
      }),
    };
  });

  return {
    schema: "site-index@1",
    ...(fixture
      ? {
          fixture: true,
          fixture_note:
            "FIXTURE. Built by tools/content-publish from content/fixtures (test data, placeholder text). Never ship it to production.",
        }
      : {}),
    generated_at: now.toISOString(),
    exams,
    subjects,
    home_try_lesson: exams.find((e) => e.try_lesson)?.try_lesson ?? null,
  };
}
