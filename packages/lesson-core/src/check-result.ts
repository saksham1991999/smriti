/**
 * Results of a check (LES-13): Test out and Find my level (learn §6.4, §6.5). Both only ever
 * mark things as learned; nothing is marked failed.
 */
import type { LessonState } from "./machine.js";

export interface TestOutResult {
  kind: "test_out";
  /** Topics passed: every question right on the first try and none tagged Guess. */
  passed: string[];
  /** Topics that are "Worth a lesson". */
  worthALesson: string[];
  /** The check was left before the end: it marks nothing (learn §6.4). */
  unfinished: boolean;
}

export interface PlacementResult {
  kind: "placement";
  /** First topics of chapters answered right and tagged Sure: pre-marked learned (learned_via = placement). */
  premarkTopics: string[];
  /** The first chapter with a wrong or unsure answer: the suggested start. */
  suggestedChapter: string | null;
  unfinished: boolean;
}

export function evaluateTestOut(s: LessonState): TestOutResult {
  const plan = s.plan;
  const unfinished = s.phase !== "complete";
  if (!plan || unfinished) return { kind: "test_out", passed: [], worthALesson: [], unfinished: true };
  const byTopic = new Map<string, boolean>();
  for (const c of plan.cards) {
    const o = s.outcomes[c.key];
    const ok = !!o && o.correct === true && o.firstTry && o.confidence !== "guess";
    byTopic.set(c.topicId, (byTopic.get(c.topicId) ?? true) && ok);
  }
  const passed = [...byTopic].filter(([, ok]) => ok).map(([t]) => t);
  const worth = [...byTopic].filter(([, ok]) => !ok).map(([t]) => t);
  return { kind: "test_out", passed, worthALesson: worth, unfinished: false };
}

/**
 * `firstTopicOfChapter` maps a chapter to its first topic in the profile's order (from the
 * manifest), since placement marks that topic, not the question's own topic.
 */
export function evaluatePlacement(s: LessonState, firstTopicOfChapter: (chapterId: string) => string | null): PlacementResult {
  const plan = s.plan;
  if (!plan || s.phase !== "complete") return { kind: "placement", premarkTopics: [], suggestedChapter: null, unfinished: true };
  const premark: string[] = [];
  let suggested: string | null = null;
  for (const c of plan.cards) {
    const o = s.outcomes[c.key];
    const sure = !!o && o.correct === true && o.confidence === "sure";
    if (sure && c.chapterId) {
      const t = firstTopicOfChapter(c.chapterId);
      if (t && !premark.includes(t)) premark.push(t);
    } else if (!suggested && c.chapterId) {
      suggested = c.chapterId;
    }
  }
  return { kind: "placement", premarkTopics: premark, suggestedChapter: suggested, unfinished: false };
}
