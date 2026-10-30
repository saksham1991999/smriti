import type { TypedBundle } from '@smriti/content-schema';
import { LessonSession, lessonConfig, nextBite, planLesson, uuidv7, type EventEnvelope, type LessonConfig, type LessonPlan, type LessonSummary } from '@smriti/lesson-core';

import type { LessonEnd, SmritiApp } from './app';
import { loadTopicStates, nextBiteFor, saveLessonResult } from './progress';

export type LessonRunMode = 'deep_dive' | 'quick_revision' | 'onboarding';

export interface LessonRun {
  session: LessonSession;
  plan: LessonPlan;
  bundle: TypedBundle;
  config: LessonConfig;
  /** Resolves when every event the session emitted so far is in the outbox. */
  drain(): Promise<void>;
}

function toPlanLevel(level: 'starting' | 'basics' | 'revising' | null): 'new' | 'basics' | 'revising' | undefined {
  if (level === null) return undefined;
  return level === 'starting' ? 'new' : level;
}

/** lesson-core settings from the live flags (XP amounts are `xp.*`, preview size is R16). */
export function lessonConfigFrom(app: SmritiApp): LessonConfig {
  const f = app.flags;
  return lessonConfig(
    {
      firstTry: f.get('xp.lesson_first_try'),
      secondTry: f.get('xp.lesson_second_try'),
      attempt: f.get('xp.lesson_attempt'),
      complete: f.get('xp.lesson_complete'),
      combo: f.get('xp.combo_bonus'),
    },
    {
      previewCards: f.get('free.deep_dive_preview_cards'),
      comboStreakLen: f.get('learn.combo_streak_len'),
      findLevelQuestions: f.get('learn.find_level_questions'),
      fixMistakesMax: f.get('learn.fix_mistakes_max') ?? null,
      testOutQuestionsPerTopic: f.get('learn.test_out_questions_per_topic') ?? null,
      resumeRestartDays: f.get('learn.resume_restart_days') ?? null,
    },
  );
}

/** The first topic for the onboarding lesson: the first topic of the student's exam in syllabus order. */
export function firstTopicId(app: SmritiApp): string | null {
  const locale = app.ui.getState().locale;
  return app.deps.content.topics(locale, app.examProfileId()).find((t) => t.hasDeepDive)?.id ?? null;
}

export interface PreparedLesson {
  plan: LessonPlan;
  bundle: TypedBundle;
  config: LessonConfig;
  subject: string | undefined;
  topicTitle: string;
}

/** Plans a lesson from the bundle on the device (lesson-core `planLesson`), or null when it is not here. */
export function prepareLesson(app: SmritiApp, opts: { topicId: string; mode: LessonRunMode; biteId?: string; completedBites?: string[] }): PreparedLesson | null {
  const locale = app.ui.getState().locale;
  const exam = app.examProfileId();
  const loaded = app.deps.content.load(locale, opts.topicId, opts.mode === 'quick_revision' ? 'quick_revision' : 'deep_dive', exam);
  if (!loaded) return null;
  const config = lessonConfigFrom(app);
  const topic = app.deps.content.topic(locale, opts.topicId, exam);
  const previewLimited = opts.mode === 'deep_dive' && !app.isPro() && !(topic?.freeDeepDive ?? true);
  const biteId = opts.biteId ?? (opts.mode === 'deep_dive' && opts.completedBites ? nextBite(loaded.bundle, loaded.examDepth, opts.completedBites)?.id : undefined);
  const plan = planLesson(loaded.bundle, {
    mode: opts.mode,
    bundleVersion: loaded.hash,
    examDepth: loaded.examDepth,
    biteId,
    previewLimited,
    // ONB-07 "Just starting" is lesson-core's "new".
    level: toPlanLevel(app.ui.getState().onboarding.level),
    config,
  });
  const subject = app.deps.content.subjectOf(locale, opts.topicId, exam)?.colorFamily;
  return { plan, bundle: loaded.bundle, config, subject, topicTitle: topic?.name ?? loaded.bundle.topic.name };
}

/** Writes lesson envelopes to the outbox one after another; `drain()` waits for the last one. */
export function eventSink(app: SmritiApp): { push: (env: EventEnvelope) => void; drain: () => Promise<void> } {
  let chain: Promise<void> = Promise.resolve();
  // The host may hand over the same envelope twice (exit after LES-05 re-reads `session.emitted`).
  const seen = new Set<string>();
  return {
    push: (env) => {
      if (seen.has(env.event_id)) return;
      seen.add(env.event_id);
      chain = chain.then(() => app.recordEnvelope(env)).catch(() => undefined);
    },
    drain: () => chain,
  };
}

/**
 * Opens a lesson without a screen (tests and the live journey): lesson-core's session wired to
 * the outbox. The caller awaits `drain()` before reading progress.
 */
export function openLesson(
  app: SmritiApp,
  opts: { topicId: string; mode: LessonRunMode; biteId?: string; completedBites?: string[] },
): LessonRun | null {
  const prepared = prepareLesson(app, opts);
  if (!prepared) return null;
  const sink = eventSink(app);
  const session = new LessonSession({
    config: prepared.config,
    clock: () => app.now(),
    tz: app.deps.timeZone(),
    newId: (now) => uuidv7(now),
    onEvent: sink.push,
  });
  return { session, plan: prepared.plan, bundle: prepared.bundle, config: prepared.config, drain: sink.drain };
}

/**
 * After the player reaches `complete`: every event in the outbox, local progress saved, then the
 * optimistic Home header and the one extra prompt (`app.completeLesson`). Returns what LES-08 shows.
 */
export async function finishLesson(app: SmritiApp, prepared: Pick<PreparedLesson, 'plan' | 'bundle' | 'topicTitle'>, summary: LessonSummary, sink: { drain: () => Promise<void> }): Promise<LessonEnd> {
  await sink.drain();
  await saveLessonResult(app, prepared.plan, summary);
  const onboarding = prepared.plan.mode === 'onboarding';
  const r = await app.completeLesson(summary, { onboarding });
  const states = await loadTopicStates(app);
  const done = states.get(prepared.plan.topicId)?.bitesCompleted ?? [];
  const nextId = nextBiteFor(app, prepared.plan.topicId, done);
  const nextBiteTitle = nextId && nextId !== prepared.plan.biteId ? (prepared.bundle.bites.find((b) => b.id === nextId)?.title ?? null) : null;
  const end: LessonEnd = {
    topicId: prepared.plan.topicId,
    topicTitle: prepared.topicTitle,
    mode: prepared.plan.mode === 'quick_revision' ? 'quick_revision' : onboarding ? 'onboarding' : 'deep_dive',
    summary,
    extra: r.extra,
    streakUp: r.streakUp,
    stageUp: r.stageUp,
    nextBiteTitle,
  };
  app.ui.setState({ lessonEnd: end });
  return end;
}
