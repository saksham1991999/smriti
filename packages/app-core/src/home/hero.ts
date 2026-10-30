import { daysBetween, type LocalDate } from '../time';

/**
 * `selectHero()` for HOME-01 (learn flow §2.2, §5.2, R10, R22, R23). Runs from the local snapshot
 * so Home never waits for the network; web and mobile call the same function.
 */

export type HeroKind = 'start_here' | 'streak_saver' | 'review' | 'continue' | 'next_topic' | 'goal_met';

export interface TopicRef {
  topicId: string;
  mode: 'deep_dive' | 'quick_revision';
  /** Estimated minutes for the bite or revision. */
  minutes?: number;
}

export interface BiteInProgress {
  topicId: string;
  mode: 'deep_dive' | 'quick_revision';
  /** Local day the bite was last opened. */
  openedOn: LocalDate;
  minutesLeft: number;
}

export interface HeroInput {
  today: LocalDate;
  /** Local hour now (0–23). */
  hour: number;
  /** Lessons completed besides the onboarding lesson. */
  lessonsBeyondOnboarding: number;
  todayQualified: boolean;
  restDayToday: boolean;
  incidentActive?: boolean;
  /** `home.streak_risk_hour`; null falls back to one hour before quiet hours start. */
  streakRiskHour: number | null;
  quietHoursStartHour: number;
  /** Today's capped review count (R22): never the raw backlog. */
  reviewsDueToday: number;
  /** `home.review_hero_min_cards`; null means any due card. */
  reviewHeroMinCards: number | null;
  /** `streak.reviews_to_qualify` (10). */
  reviewsToQualify: number;
  todayReviewDone: boolean;
  comebackChunkWaiting: boolean;
  dailyChallengeOpen: boolean;
  dailyChallengeDone: boolean;
  biteInProgress: BiteInProgress | null;
  /** `home.continue_max_age_days`; null means no limit. */
  continueMaxAgeDays: number | null;
  goalRingFull: boolean;
  planDone: boolean;
  /** The plan's new topic (first unfinished item). */
  planTopic: TopicRef | null;
  /** The next topic in the current chapter (the chapter of the latest lesson, else the plan's). */
  nextTopicInChapter: TopicRef | null;
  /** A learned topic for a quick revision (streak saver). */
  learnedTopicForRevision: TopicRef | null;
  /** The shortest free bite available on the device. */
  shortestFreeBite: TopicRef | null;
  plantResting: boolean;
  /** Secondary rows from Phase 2 jobs (optional). */
  fadingTopic?: { topicId: string; cards: number } | null;
  weakSpot?: { conceptId: string } | null;
}

export type HeroAction =
  | { type: 'lesson'; topic: TopicRef }
  | { type: 'resume'; bite: BiteInProgress }
  | { type: 'review'; route: 'MEM-02' | 'MEM-03'; count: number }
  | { type: 'daily_challenge' }
  | { type: 'none' };

export interface Hero {
  kind: HeroKind;
  action: HeroAction;
  /** For `streak_saver`: which fastest qualifier was picked. */
  saver?: 'reviews' | 'daily_challenge' | 'finish_bite' | 'quick_revision' | 'shortest_bite';
  /** For `next_topic` chosen because the plant is resting (revival). */
  reason?: 'revival';
}

export type SecondaryRow =
  | { kind: 'continue'; bite: BiteInProgress }
  | { kind: 'reviews'; count: number; route: 'MEM-02' | 'MEM-03' }
  | { kind: 'topic'; topic: TopicRef }
  | { kind: 'fading'; topicId: string; cards: number }
  | { kind: 'weak_spot'; conceptId: string };

export function streakRiskHour(input: Pick<HeroInput, 'streakRiskHour' | 'quietHoursStartHour'>): number {
  return input.streakRiskHour ?? (input.quietHoursStartHour + 23) % 24;
}

function biteFresh(input: HeroInput): BiteInProgress | null {
  const b = input.biteInProgress;
  if (!b) return null;
  if (input.continueMaxAgeDays !== null && daysBetween(b.openedOn, input.today) > input.continueMaxAgeDays) return null;
  return b;
}

const reviewRoute = (i: HeroInput): 'MEM-02' | 'MEM-03' => (i.comebackChunkWaiting ? 'MEM-02' : 'MEM-03');

/** Picks the single main action on Home. */
export function selectHero(input: HeroInput): Hero {
  const topic = input.planTopic ?? input.nextTopicInChapter;

  if (input.lessonsBeyondOnboarding === 0) {
    const t = topic ?? input.shortestFreeBite;
    return { kind: 'start_here', action: t ? { type: 'lesson', topic: t } : { type: 'none' } };
  }

  if (input.plantResting && input.shortestFreeBite) {
    return { kind: 'next_topic', action: { type: 'lesson', topic: input.shortestFreeBite }, reason: 'revival' };
  }

  const protectedToday = input.restDayToday || Boolean(input.incidentActive);
  if (!input.todayQualified && !protectedToday && input.hour >= streakRiskHour(input)) {
    if (input.reviewsDueToday >= input.reviewsToQualify) {
      return { kind: 'streak_saver', saver: 'reviews', action: { type: 'review', route: reviewRoute(input), count: input.reviewsToQualify } };
    }
    if (input.dailyChallengeOpen && !input.dailyChallengeDone) {
      return { kind: 'streak_saver', saver: 'daily_challenge', action: { type: 'daily_challenge' } };
    }
    const bite = input.biteInProgress;
    if (bite) return { kind: 'streak_saver', saver: 'finish_bite', action: { type: 'resume', bite } };
    if (input.learnedTopicForRevision) {
      return { kind: 'streak_saver', saver: 'quick_revision', action: { type: 'lesson', topic: input.learnedTopicForRevision } };
    }
    if (input.shortestFreeBite) {
      return { kind: 'streak_saver', saver: 'shortest_bite', action: { type: 'lesson', topic: input.shortestFreeBite } };
    }
  }

  const minCards = input.reviewHeroMinCards ?? 1;
  if ((input.reviewsDueToday >= minCards && !input.todayReviewDone) || input.comebackChunkWaiting) {
    return { kind: 'review', action: { type: 'review', route: reviewRoute(input), count: input.reviewsDueToday } };
  }

  const bite = biteFresh(input);
  if (bite) return { kind: 'continue', action: { type: 'resume', bite } };

  if (input.goalRingFull && input.planDone) {
    const t = topic ?? input.learnedTopicForRevision;
    return { kind: 'goal_met', action: t ? { type: 'lesson', topic: t } : { type: 'none' } };
  }

  return { kind: 'next_topic', action: topic ? { type: 'lesson', topic } : { type: 'none' } };
}

/**
 * At most one quiet secondary row: the second-best hero candidate ("Or continue …", or reviews
 * below the hero threshold), then a fading-topic alert, then a weak-spot drill.
 */
export function selectSecondary(input: HeroInput, hero: Hero): SecondaryRow | null {
  const bite = biteFresh(input);
  if (bite && hero.action.type !== 'resume') return { kind: 'continue', bite };
  if (input.reviewsDueToday > 0 && hero.action.type !== 'review' && !input.todayReviewDone) {
    return { kind: 'reviews', count: input.reviewsDueToday, route: reviewRoute(input) };
  }
  const topic = input.planTopic ?? input.nextTopicInChapter;
  if (topic && !(hero.action.type === 'lesson' && hero.action.topic.topicId === topic.topicId)) {
    return { kind: 'topic', topic };
  }
  if (input.fadingTopic) return { kind: 'fading', ...input.fadingTopic };
  if (input.weakSpot) return { kind: 'weak_spot', conceptId: input.weakSpot.conceptId };
  return null;
}
