// Pure helpers for the quiz island (unit tested).
import type { Locale } from "../config/site";
import type { TryLesson } from "../content-index/schema";

export type Confidence = "sure" | "fifty" | "guess" | "none";

export function scoreQuiz(results: readonly boolean[]): { correct: number; total: number } {
  return { correct: results.filter(Boolean).length, total: results.length };
}

/** Flattens a localised try_lesson into the island's props for one language. */
export function localiseLesson(lesson: TryLesson, lang: Locale) {
  return {
    title: lesson.title[lang],
    questions: lesson.questions.map((q) => ({
      id: q.id,
      stem: q.stem[lang],
      answer: q.answer,
      explanation: q.explanation[lang],
      options: q.options.map((o) => ({ id: o.id, text: o.text[lang] })),
    })),
  };
}
