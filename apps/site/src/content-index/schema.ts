// The site content index: the published, public slice of the content graph that the site
// builds its landing pages from (TRD §4.1, §7.2 step "Trigger Astro incremental build").
//
// The content-engine agent produces this file (CONTENT_INDEX_PATH). Until then the site uses
// a fixture in ./fixture that is clearly marked `"fixture": true` and holds placeholder names.
//
// Rules this schema enforces:
// - Every text a student reads is localised { en, hi } (AGENTS rule 7).
// - Exam pattern numbers exist only inside `blueprint`, and a blueprint must carry its official
//   source and a reviewer (AGENTS rule 3, skills/exam-blueprint). No blueprint: the section hides.
// - Minutes, counts and weightage are nullable and are never estimated: null hides them.

import { z } from "zod";

export const Localised = z.object({ en: z.string().min(1), hi: z.string().min(1) });
export type Localised = z.infer<typeof Localised>;

const id = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, "lowercase ASCII id with dots and hyphens");
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase URL slug");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const ExamAccent = z.enum(["all", "jee", "neet", "upsc", "ssc"]);
export type ExamAccent = z.infer<typeof ExamAccent>;

export const BlueprintSource = z.object({
  url: z.url(),
  title: z.string().min(1),
  published: isoDate,
  retrieved: isoDate,
  pages: z.string().nullable().optional(),
});

export const Marking = z.object({
  correct: z.number(),
  wrong: z.number(),
  unattempted: z.number(),
});

export const BlueprintSection = z.object({
  code: z.string().min(1),
  title: Localised,
  subject: id.nullable(),
  question_count: z.number().int().nonnegative().nullable(),
  marking: Marking.nullable(),
});

/** A site summary of one reviewed blueprint@1 file (content/blueprints/…). */
export const Blueprint = z.object({
  paper_code: z.string().min(1),
  version: z.number().int().positive(),
  effective_from: isoDate,
  title: Localised,
  source: BlueprintSource,
  reviewed_by: z.string().min(1),
  mode: z.enum(["cbt", "pen_paper"]).nullable(),
  duration_min: z.number().positive().nullable(),
  languages: z.array(z.string()).nullable(),
  total_questions: z.number().int().positive().nullable(),
  max_marks: z.number().positive().nullable(),
  sections: z.array(BlueprintSection),
});
export type Blueprint = z.infer<typeof Blueprint>;

export const QuizOption = z.object({ id: z.string().min(1), text: Localised });
export const QuizQuestion = z
  .object({
    id: z.string().min(1),
    stem: Localised,
    options: z.array(QuizOption).min(2).max(6),
    answer: z.string().min(1),
    explanation: Localised,
  })
  .refine((q) => q.options.some((o) => o.id === q.answer), { message: "answer must be one of the option ids" });
export type QuizQuestion = z.infer<typeof QuizQuestion>;

/** A short sample from a real lesson, for the "Try a lesson" island. */
export const TryLesson = z.object({
  topic_id: id,
  title: Localised,
  questions: z.array(QuizQuestion).min(1).max(5),
});
export type TryLesson = z.infer<typeof TryLesson>;

export const Exam = z.object({
  id,
  slug,
  accent: ExamAccent,
  name: Localised,
  short_name: Localised,
  category: z.string().min(1),
  conducting_body: z.string().min(1).nullable(),
  official_url: z.url().nullable(),
  summary: Localised.nullable(),
  /** Subject ids in display order. */
  subjects: z.array(id).min(1),
  blueprint: Blueprint.nullable(),
  try_lesson: TryLesson.nullable(),
});
export type Exam = z.infer<typeof Exam>;

const Mode = z.object({ minutes: z.number().positive().nullable() }).nullable();

export const Topic = z.object({
  id,
  slug,
  name: Localised,
  summary: Localised.nullable(),
  /** Exam ids this topic is part of. */
  exams: z.array(id),
  modes: z.object({ deep_dive: Mode, quick_revision: Mode }),
});
export type Topic = z.infer<typeof Topic>;

export const Chapter = z.object({
  id,
  slug,
  name: Localised,
  summary: Localised.nullable(),
  exams: z.array(id),
  /** True when the chapter's Deep Dives are in the free tier (PRD §11.1). Quick revision is always free (R9). */
  deep_dive_free: z.boolean(),
  topics: z.array(Topic),
});
export type Chapter = z.infer<typeof Chapter>;

export const Subject = z.object({
  id,
  slug,
  name: Localised,
  summary: Localised.nullable(),
  chapters: z.array(Chapter),
});
export type Subject = z.infer<typeof Subject>;

export const SiteIndex = z
  .object({
    schema: z.literal("site-index@1"),
    fixture: z.boolean().optional(),
    fixture_note: z.string().optional(),
    generated_at: z.string().min(1),
    exams: z.array(Exam).min(1),
    subjects: z.array(Subject),
    /** Shown on the home page when no exam is in context. */
    home_try_lesson: TryLesson.nullable(),
  })
  .superRefine((idx, ctx) => {
    const subjectIds = new Set(idx.subjects.map((s) => s.id));
    const examIds = new Set(idx.exams.map((e) => e.id));
    const seen = (kind: string, values: string[]) => {
      const dup = values.find((v, i) => values.indexOf(v) !== i);
      if (dup) ctx.addIssue({ code: "custom", message: `duplicate ${kind} "${dup}"` });
    };
    seen("exam id", idx.exams.map((e) => e.id));
    seen("exam slug", idx.exams.map((e) => e.slug));
    seen("subject slug", idx.subjects.map((s) => s.slug));
    for (const e of idx.exams) {
      for (const s of e.subjects) {
        if (!subjectIds.has(s)) ctx.addIssue({ code: "custom", message: `exam ${e.id} lists unknown subject ${s}` });
      }
    }
    for (const s of idx.subjects) {
      seen(`chapter slug in ${s.id}`, s.chapters.map((c) => c.slug));
      for (const c of s.chapters) {
        seen(`topic slug in ${c.id}`, c.topics.map((t) => t.slug));
        for (const ex of [...c.exams, ...c.topics.flatMap((t) => t.exams)]) {
          if (!examIds.has(ex)) ctx.addIssue({ code: "custom", message: `${c.id} references unknown exam ${ex}` });
        }
      }
    }
  });
export type SiteIndex = z.infer<typeof SiteIndex>;
