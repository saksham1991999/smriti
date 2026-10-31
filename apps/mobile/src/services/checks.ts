import { lessonProgressKey, type TopicStatusRow } from '@smriti/app-core';
import type { TypedBundle } from '@smriti/content-schema/runtime';
import { evaluateTestOut, planCheck, selectTestOut, type CheckQuestion, type LessonConfig, type LessonPlan, type LessonState, type TestOutResult } from '@smriti/lesson-core';

import type { ChapterView, TopicView } from '../content/repo';
import type { SmritiApp } from './app';
import { lessonConfigFrom } from './lessons';

/**
 * Test out (learn §6.4; LRN-06, LES-12, LES-13): a hint-free check from the practice bundles on
 * the device that can only mark topics learned, never failed. The selection and the pass rule are
 * lesson-core's (`selectTestOut`, `evaluateTestOut`); this file gathers inputs and saves marks.
 */

export interface PreparedCheck {
  plan: LessonPlan;
  /** The practice bundles merged, so the player finds every question's maths and pictures. */
  bundle: TypedBundle;
  config: LessonConfig;
  subject: string | undefined;
  chapter: ChapterView;
  /** The topics this check covers, in chapter order (one for "Mark as learned"). */
  topics: TopicView[];
  /** Topics with questions in this check; the rest show "Not in this check" on LES-13. */
  checked: Set<string>;
}

/** Questions per topic: the flag when the owner has set it, else every checkable one on the device. */
function perTopic(app: SmritiApp): number {
  return app.flags.get('learn.test_out_questions_per_topic') ?? Number.POSITIVE_INFINITY;
}

function practiceBundles(app: SmritiApp, topics: TopicView[]): TypedBundle[] {
  const locale = app.ui.getState().locale;
  const exam = app.examProfileId();
  return topics.map((t) => app.deps.content.load(locale, t.id, 'practice', exam)?.bundle).filter((b): b is TypedBundle => Boolean(b));
}

export function testOutQuestions(app: SmritiApp, chapter: ChapterView, topicId?: string): CheckQuestion[] {
  const topics = topicId ? chapter.topics.filter((t) => t.id === topicId) : chapter.topics;
  return selectTestOut(practiceBundles(app, topics), perTopic(app));
}

/**
 * "About {minutes} min" for LRN-06, only when every question has an `ideal_time_s` from content
 * (never a guessed per-question time).
 */
export function checkMinutes(questions: CheckQuestion[]): number | null {
  if (!questions.length) return null;
  let seconds = 0;
  for (const q of questions) {
    const s = (q.question as { ideal_time_s?: number }).ideal_time_s;
    if (typeof s !== 'number') return null;
    seconds += s;
  }
  return Math.max(1, Math.round(seconds / 60));
}

function mergeBundles(bundles: TypedBundle[]): TypedBundle {
  const [first, ...rest] = bundles as [TypedBundle, ...TypedBundle[]];
  const out: TypedBundle = { ...first, math: { ...first.math }, media: { ...first.media }, questions: { ...first.questions } };
  for (const b of rest) {
    Object.assign(out.math, b.math);
    Object.assign(out.media, b.media);
    Object.assign(out.questions, b.questions);
  }
  return out;
}

/** LES-12 for a chapter, or for one topic ("Mark as learned"). Null when there is nothing to ask. */
export function prepareTestOut(app: SmritiApp, chapterId: string, topicId?: string): PreparedCheck | null {
  const locale = app.ui.getState().locale;
  const exam = app.examProfileId();
  const subject = app.deps.content.subjects(locale, exam).find((s) => s.chapters.some((c) => c.id === chapterId));
  const chapter = subject?.chapters.find((c) => c.id === chapterId);
  if (!subject || !chapter) return null;
  const topics = topicId ? chapter.topics.filter((t) => t.id === topicId) : chapter.topics;
  const bundles = practiceBundles(app, topics);
  const questions = selectTestOut(bundles, perTopic(app));
  if (!questions.length || !bundles.length) return null;
  const scopeId = topicId ?? chapterId;
  const plan = planCheck(questions, { scopeId, bundleVersion: bundles.length === 1 ? (app.deps.content.manifest(locale, exam).topics[scopeId]?.bundles.practice?.hash ?? '') : `check:${scopeId}`, locale });
  return {
    plan,
    bundle: mergeBundles(bundles),
    config: lessonConfigFrom(app),
    subject: subject.colorFamily,
    chapter,
    topics,
    checked: new Set(questions.map((q) => q.topicId)),
  };
}

/** One topic this check marked, with the row it replaced, so "Undo this" restores it exactly. */
export interface TestOutMark {
  topicId: string;
  previous: TopicStatusRow | null;
}

export interface TestOutOutcome {
  result: TestOutResult;
  correct: number;
  total: number;
  /** XP as lesson-core counted it during the check (the server recomputes it from the same events). */
  xp: number;
  /** Topics newly marked learned by this check (already-learned ones are left as they were). */
  marks: TestOutMark[];
}

/**
 * Marks the passed topics learned (`learned_via: test_out`) on the device. A topic that is already
 * learned keeps its row. Reported under contract changes: the sync contract has no event that
 * carries the mark, so a pulled `topic_progress` replaces it until the server derives it.
 */
export async function saveTestOut(app: SmritiApp, prepared: PreparedCheck, state: LessonState): Promise<TestOutOutcome> {
  const result = evaluateTestOut(state);
  const outcomes = prepared.plan.cards.map((c) => state.outcomes[c.key]);
  const correct = outcomes.filter((o) => o?.correct === true).length;
  const total = prepared.plan.cards.length;
  const marks: TestOutMark[] = [];
  if (!result.unfinished) {
    const { storage } = app.deps.stores;
    const now = new Date(app.now()).toISOString();
    await storage.transaction(async (tx) => {
      for (const topicId of result.passed) {
        const previous = (await tx.topic_status.get(topicId)) ?? null;
        if (previous?.status === 'learned') continue;
        await tx.topic_status.put({ topic_id: topicId, status: 'learned', learned_via: 'test_out', percent: 100, updated_at: now });
        marks.push({ topicId, previous });
      }
    });
    for (const m of marks) app.track('topic_learned', { topic_id: m.topicId, learned_via: 'test_out' });
    app.track('check_completed', { kind: 'test_out', subject_id: prepared.chapter.subjectId, correct, total, topics_passed: String(result.passed.length) });
  }
  return { result, correct, total, xp: state.xp, marks };
}

/** LES-13 "Undo this": clears only the marks this check made. */
export async function undoTestOut(app: SmritiApp, marks: TestOutMark[]): Promise<void> {
  const { storage } = app.deps.stores;
  await storage.transaction(async (tx) => {
    for (const m of marks) {
      if (m.previous) await tx.topic_status.put(m.previous);
      else await tx.topic_status.delete(m.topicId);
    }
  });
}

/**
 * LRN-02 "Reset chapter progress": topics go back to not started, including ones learned by Test
 * out or Find my level. Review cards, XP and the streak stay. Local only for now (contract change:
 * no sync event resets topic progress on the server).
 */
export async function resetChapter(app: SmritiApp, chapter: ChapterView): Promise<void> {
  const { storage } = app.deps.stores;
  const progress = await storage.lesson_progress.all();
  const ids = new Set(chapter.topics.map((t) => t.id));
  await storage.transaction(async (tx) => {
    for (const id of ids) await tx.topic_status.delete(id);
    for (const p of progress) if (ids.has(p.topic_id)) await tx.lesson_progress.delete(lessonProgressKey(p.topic_id, p.mode));
  });
  app.track('chapter_progress_reset', { chapter_id: chapter.id });
}

/** LRN-06's default (flow §6.4): Test out while most topics are not learned yet, Practise after. */
export function defaultChapterChoice(learned: number, total: number): 'test_out' | 'practise' {
  return total > 0 && learned * 2 > total ? 'practise' : 'test_out';
}
