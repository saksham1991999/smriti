/**
 * Home's inputs (HOME-01): the review queue, the bite in progress and the next topics, all from
 * the local snapshot so Home never waits for the network; `selectHero` picks the one main action.
 */
import { useMemo } from "react";
import { buildDailyQueue, localDate, selectHero, selectSecondary, type BiteInProgress, type DailyQueue, type Hero, type SecondaryRow, type TopicRef } from "@smriti/app-core";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../boot/context";
import { timeZone } from "../platform/web";
import { useCatalog, type CatalogSubject, type CatalogTopic } from "./content";
import { useTodayMinutes } from "./daily";
import { useOnboarding } from "./onboarding";
import { useLessonProgress, useSrsCards, useTodayActivity, useTopicStatuses } from "./queries";

/** Today's capped review queue (R22): Home shows `cards.length`, never the raw backlog. */
export function useReviewQueue(): DailyQueue | null {
  const s = useServices();
  const cards = useSrsCards().data;
  const activity = useTodayActivity();
  return useMemo(() => {
    if (!cards) return null;
    return buildDailyQueue({
      cards,
      now: Date.now(),
      timeZone: timeZone(),
      scheduler: s.srs,
      reviewedToday: activity.reviews,
      newIntroducedToday: 0,
      config: { newCardsPerDay: s.flags.get("memory.new_cards_per_day"), dailyReviewCap: s.flags.get("memory.daily_review_cap") },
    });
  }, [cards, s, activity.reviews]);
}

export interface HomeModel {
  hero: Hero;
  secondary: SecondaryRow | null;
  queue: DailyQueue | null;
  topics: Map<string, { topic: CatalogTopic; subject: CatalogSubject; chapterId: string; chapterName: string }>;
  nextInChapter: { chapterId: string; chapterName: string; topics: CatalogTopic[] } | null;
  todayMinutes: number;
  dailyGoal: number | null;
}

function quietStartHour(raw: unknown): number {
  const adult = (raw as { adult?: { start?: string } } | undefined)?.adult?.start ?? "22:00";
  return Number(adult.split(":")[0] ?? 22);
}

export function useHomeModel(): HomeModel | null {
  const s = useServices();
  const catalog = useCatalog();
  const statuses = useTopicStatuses().data;
  const progress = useLessonProgress().data;
  const queue = useReviewQueue();
  const streak = useAppStore((x) => x.streak);
  const plant = useAppStore((x) => x.plant);
  const profileGoal = useAppStore((x) => x.profile?.daily_goal_minutes ?? null);
  const ob = useOnboarding();
  const todayMinutes = useTodayMinutes();
  const activity = useTodayActivity();

  return useMemo(() => {
    if (!catalog.manifest || !statuses || !progress) return null;
    const tz = timeZone();
    const today = localDate(Date.now(), tz);
    const topics = new Map<string, { topic: CatalogTopic; subject: CatalogSubject; chapterId: string; chapterName: string }>();
    for (const subject of catalog.subjects) for (const ch of subject.chapters) for (const topic of ch.topics) topics.set(topic.id, { topic, subject, chapterId: ch.id, chapterName: ch.name });
    const ref = (t: CatalogTopic, mode: TopicRef["mode"] = "deep_dive"): TopicRef => ({ topicId: t.id, mode, minutes: t.minutes });
    const all = [...topics.values()];
    const notLearned = all.filter((x) => statuses.get(x.topic.id)?.status !== "learned");
    const learned = all.filter((x) => statuses.get(x.topic.id)?.status === "learned");
    const latest = [...progress.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    const latestChapter = latest ? topics.get(latest.topic_id)?.chapterId : undefined;
    const inChapter = notLearned.find((x) => x.chapterId === latestChapter) ?? notLearned[0];
    let bite: BiteInProgress | null = null;
    for (const p of progress.values()) {
      if (p.completed_at || p.last_card_index <= 0) continue;
      const info = topics.get(p.topic_id);
      if (!info) continue;
      const left = Math.max(1, Math.round(((info.topic.cardCount || 1) - p.last_card_index) * (20 / 60)));
      if (!bite || p.updated_at > (bite.openedOn ?? "")) bite = { topicId: p.topic_id, mode: p.mode === "quick_revision" ? "quick_revision" : "deep_dive", openedOn: localDate(p.updated_at, tz), minutesLeft: left };
    }
    const dailyGoal = ob.dailyGoal ?? profileGoal;
    const input = {
      today,
      hour: new Date().getHours(),
      lessonsBeyondOnboarding: Math.max(0, ob.lessonsCompleted - (ob.firstWinAt ? 1 : 0)),
      todayQualified: streak?.today_qualified ?? false,
      restDayToday: streak?.rest_day === today,
      streakRiskHour: s.flags.get("home.streak_risk_hour"),
      quietHoursStartHour: quietStartHour(s.flags.get("notify.quiet_hours")),
      reviewsDueToday: queue?.cards.length ?? 0,
      reviewHeroMinCards: s.flags.get("home.review_hero_min_cards"),
      reviewsToQualify: s.flags.get("streak.reviews_to_qualify"),
      todayReviewDone: (queue?.cards.length ?? 0) === 0 && activity.reviews > 0,
      comebackChunkWaiting: false,
      dailyChallengeOpen: false,
      dailyChallengeDone: false,
      biteInProgress: bite,
      continueMaxAgeDays: s.flags.get("home.continue_max_age_days"),
      goalRingFull: dailyGoal !== null && todayMinutes >= dailyGoal,
      planDone: notLearned.length === 0,
      planTopic: notLearned[0] ? ref(notLearned[0].topic) : null,
      nextTopicInChapter: inChapter ? ref(inChapter.topic) : null,
      learnedTopicForRevision: learned[0] ? ref(learned[0].topic, "quick_revision") : null,
      shortestFreeBite: (() => {
        const free = notLearned.filter((x) => x.topic.deepDiveFree).sort((a, b) => a.topic.minutes - b.topic.minutes)[0];
        return free ? ref(free.topic) : null;
      })(),
      plantResting: plant?.health === "dormant",
    };
    const hero = selectHero(input);
    const chapterId = inChapter?.chapterId ?? null;
    return {
      hero,
      secondary: selectSecondary(input, hero),
      queue,
      topics,
      nextInChapter: chapterId
        ? { chapterId, chapterName: inChapter?.chapterName ?? "", topics: all.filter((x) => x.chapterId === chapterId).map((x) => x.topic) }
        : null,
      todayMinutes,
      dailyGoal,
    };
  }, [catalog.manifest, catalog.subjects, statuses, progress, queue, streak, plant, profileGoal, ob, todayMinutes, activity.reviews, s]);
}
