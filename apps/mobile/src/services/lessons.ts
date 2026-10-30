import type { TypedBundle } from '@smriti/content-schema';
import { LessonSession, lessonConfig, nextBite, planLesson, uuidv7, type EventEnvelope, type LessonConfig, type LessonPlan } from '@smriti/lesson-core';

import type { SmritiApp } from './app';

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

/**
 * Opens a lesson from the bundle on the device and wires lesson-core's session to the outbox.
 * Every envelope goes to the outbox in order; the caller awaits `drain()` before reading progress.
 */
export function openLesson(
  app: SmritiApp,
  opts: { topicId: string; mode: LessonRunMode; biteId?: string; completedBites?: string[] },
): LessonRun | null {
  const locale = app.ui.getState().locale;
  const loaded = app.deps.content.load(locale, opts.topicId, opts.mode === 'quick_revision' ? 'quick_revision' : 'deep_dive', app.examProfileId());
  if (!loaded) return null;
  const config = lessonConfigFrom(app);
  const topic = app.deps.content.topic(locale, opts.topicId, app.examProfileId());
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
  let chain: Promise<void> = Promise.resolve();
  const session = new LessonSession({
    config,
    clock: () => app.now(),
    tz: app.deps.timeZone(),
    newId: (now) => uuidv7(now),
    onEvent: (env: EventEnvelope) => {
      chain = chain.then(() => app.recordEnvelope(env)).catch(() => undefined);
    },
  });
  return { session, plan, bundle: loaded.bundle, config, drain: () => chain };
}
