import { lessonProgressKey, selectHero, selectSecondary, type Hero, type HeroInput, type LessonProgressRow, type SecondaryRow, type TopicRef } from '@smriti/app-core';
import { nextBite } from '@smriti/lesson-core';
import type { LessonPlan, LessonSummary } from '@smriti/lesson-core';

import type { ChapterView, SubjectView, TopicView } from '../content/repo';
import type { SmritiApp } from './app';

/**
 * Local lesson progress (`lesson_progress`, `topic_status`) and the Home model. The rules come
 * from app-core (`selectHero`) and lesson-core (`nextBite`); this file only gathers their inputs.
 */

export async function saveLessonResult(app: SmritiApp, plan: LessonPlan, summary: LessonSummary): Promise<void> {
  if (plan.mode !== 'deep_dive' && plan.mode !== 'quick_revision' && plan.mode !== 'onboarding') return;
  const mode = plan.mode === 'quick_revision' ? 'quick_revision' : 'deep_dive';
  const { storage } = app.deps.stores;
  const now = new Date(app.now()).toISOString();
  const prev = await storage.lesson_progress.get(lessonProgressKey(plan.topicId, mode));
  const bites = new Set(prev?.bites_completed ?? []);
  if (plan.biteId) bites.add(plan.biteId);
  const row: LessonProgressRow = {
    topic_id: plan.topicId,
    mode,
    bundle_hash: plan.bundleVersion,
    last_card_index: 0,
    cards_seen: (prev?.cards_seen ?? 0) + summary.cardsSeen,
    bites_completed: [...bites],
    best_score: Math.max(prev?.best_score ?? 0, summary.accuracy ?? 0),
    completed_at: now,
    updated_at: now,
  };
  const percent = plan.biteCount > 0 ? Math.round((bites.size / plan.biteCount) * 100) : 100;
  await storage.transaction(async (tx) => {
    await tx.lesson_progress.put(row);
    await tx.topic_status.put({
      topic_id: plan.topicId,
      status: mode === 'quick_revision' || percent >= 100 ? 'learned' : 'in_progress',
      learned_via: percent >= 100 ? 'lesson' : null,
      percent,
      updated_at: now,
    });
  });
}

export interface TopicState {
  topic: TopicView;
  percent: number;
  status: 'not_started' | 'in_progress' | 'learned';
  bitesCompleted: string[];
}

export interface HomeModel {
  hero: Hero;
  secondary: SecondaryRow | null;
  subjects: (SubjectView & { percent: number; next: TopicView | null })[];
  chapter: ChapterView | null;
  /** Topics of the current chapter with their status, for the "Up next" strip. */
  strip: TopicState[];
  topicsLeft: number;
}

export async function loadTopicStates(app: SmritiApp): Promise<Map<string, TopicState>> {
  const locale = app.ui.getState().locale;
  const topics = app.deps.content.topics(locale, app.examProfileId());
  const rows = await app.deps.stores.storage.topic_status.all();
  const progress = await app.deps.stores.storage.lesson_progress.all();
  const out = new Map<string, TopicState>();
  for (const t of topics) {
    const r = rows.find((x) => x.topic_id === t.id);
    const p = progress.find((x) => x.topic_id === t.id && x.mode === 'deep_dive');
    out.set(t.id, { topic: t, percent: r?.percent ?? 0, status: r?.status ?? 'not_started', bitesCompleted: p?.bites_completed ?? [] });
  }
  return out;
}

/** HOME-01 from the local snapshot only (Home never waits for the network). */
export async function loadHome(app: SmritiApp): Promise<HomeModel> {
  const locale = app.ui.getState().locale;
  const exam = app.examProfileId();
  const subjects = app.deps.content.subjects(locale, exam);
  const states = await loadTopicStates(app);
  const ordered = [...states.values()];
  const firstOpen = ordered.find((s) => s.status !== 'learned') ?? null;
  const inProgress = ordered.find((s) => s.status === 'in_progress') ?? null;
  const chapter = firstOpen ? (app.deps.content.chapterOf(locale, firstOpen.topic.id, exam) ?? null) : (subjects[0]?.chapters[0] ?? null);
  const toRef = (s: TopicState | null): TopicRef | null => (s ? { topicId: s.topic.id, mode: 'deep_dive', ...(s.topic.minutes ? { minutes: s.topic.minutes } : {}) } : null);
  const st = app.store.getState();
  const flags = app.flags;
  const learned = ordered.find((s) => s.status === 'learned' && s.topic.hasQuickRevision) ?? null;
  const input: HeroInput = {
    today: app.today(),
    hour: new Date(app.now()).getHours(),
    lessonsBeyondOnboarding: Math.max(0, app.ui.getState().lessonsCompleted - 1),
    todayQualified: st.streak?.today_qualified ?? false,
    restDayToday: false,
    streakRiskHour: flags.get('home.streak_risk_hour') ?? null,
    quietHoursStartHour: 22,
    reviewsDueToday: 0,
    reviewHeroMinCards: flags.get('home.review_hero_min_cards') ?? null,
    reviewsToQualify: flags.get('streak.reviews_to_qualify'),
    todayReviewDone: false,
    comebackChunkWaiting: false,
    dailyChallengeOpen: false,
    dailyChallengeDone: false,
    biteInProgress: inProgress ? { topicId: inProgress.topic.id, mode: 'deep_dive', openedOn: app.today(), minutesLeft: inProgress.topic.minutes ?? 5 } : null,
    continueMaxAgeDays: flags.get('home.continue_max_age_days') ?? null,
    goalRingFull: st.streak?.today_qualified ?? false,
    planDone: false,
    planTopic: toRef(firstOpen),
    nextTopicInChapter: toRef(firstOpen),
    learnedTopicForRevision: learned ? { topicId: learned.topic.id, mode: 'quick_revision' } : null,
    shortestFreeBite: toRef(ordered.find((s) => s.topic.freeDeepDive) ?? null),
    plantResting: false,
  };
  const hero = selectHero(input);
  const strip = chapter ? chapter.topics.map((t) => states.get(t.id)!).filter(Boolean) : [];
  return {
    hero,
    secondary: selectSecondary(input, hero),
    subjects: subjects.map((s) => {
      const topics = s.chapters.flatMap((c) => c.topics);
      const pct = topics.length ? Math.round(topics.reduce((n, t) => n + (states.get(t.id)?.percent ?? 0), 0) / topics.length) : 0;
      return { ...s, percent: pct, next: topics.find((t) => states.get(t.id)?.status !== 'learned') ?? null };
    }),
    chapter,
    strip,
    topicsLeft: strip.filter((s) => s.status !== 'learned').length,
  };
}

/** The next bite to play for a topic (Deep Dive), or the first bite when all are done. */
export function nextBiteFor(app: SmritiApp, topicId: string, completed: string[]): string | undefined {
  const locale = app.ui.getState().locale;
  const loaded = app.deps.content.load(locale, topicId, 'deep_dive', app.examProfileId());
  if (!loaded) return undefined;
  return nextBite(loaded.bundle, loaded.examDepth, completed)?.id;
}
