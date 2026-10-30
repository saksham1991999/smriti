import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@smriti/app-core/react";
import { localDate, todayActivity, type OutboxRow, type TopicStatusRow } from "@smriti/app-core";
import type { Lesson } from "@smriti/lesson-player-web";
import { useServices } from "../boot/context";
import { timeZone } from "../platform/web";
import { useI18n } from "./i18n";
import { profileIdsFor, useOnboarding } from "./onboarding";
import type { CatalogResponse, Chapter, ConfigResponse, PracticeQuestion, Subject, TopicRow } from "./contentTypes";

export const qk = {
  config: ["config"] as const,
  catalog: (profiles: string[]) => ["catalog", ...profiles] as const,
  lesson: (topicId: string, locale: string) => ["lesson", topicId, locale] as const,
  topicStatus: ["local", "topic_status"] as const,
  outbox: ["local", "outbox"] as const,
  srs: ["local", "srs"] as const,
};

export function useConfig() {
  const { api } = useServices();
  return useQuery({ queryKey: qk.config, queryFn: () => api.get<ConfigResponse>("/v1/config"), staleTime: 60 * 60_000 });
}

/** Exam profile ids the student studies: from the server profile, else the onboarding answers. */
export function useProfileIds(): string[] {
  const serverIds = useAppStore((s) => s.profile?.exam_profile_ids);
  const goals = useOnboarding((s) => s.goals);
  const config = useConfig().data;
  if (serverIds && serverIds.length) return profileIdsFor(serverIds, config?.exams ?? []);
  return profileIdsFor(goals, config?.exams ?? []);
}

export function useCatalog() {
  const { api } = useServices();
  const profiles = useProfileIds();
  return useQuery({
    queryKey: qk.catalog(profiles),
    queryFn: () => api.get<CatalogResponse>("/v1/content/catalog", { profile: profiles }),
    staleTime: 10 * 60_000,
  });
}

export interface TopicLocation {
  subject: Subject;
  chapter: Chapter;
  topic: TopicRow;
  topicIndex: number;
}

export function findTopic(catalog: CatalogResponse | undefined, topicId: string): TopicLocation | null {
  for (const subject of catalog?.subjects ?? [])
    for (const chapter of subject.chapters) {
      const i = chapter.topics.findIndex((t) => t.id === topicId);
      const topic = chapter.topics[i];
      if (topic) return { subject, chapter, topic, topicIndex: i };
    }
  return null;
}

export function useLesson(topicId: string) {
  const { api } = useServices();
  const { locale } = useI18n();
  return useQuery({
    queryKey: qk.lesson(topicId, locale),
    queryFn: () => api.get<Lesson>(`/v1/content/lessons/${encodeURIComponent(topicId)}`, { locale }),
    staleTime: Infinity,
    retry: 1,
  });
}

export function usePracticeQuestions(subjectId: string, count: number) {
  const { api } = useServices();
  return useQuery({
    queryKey: ["practice", subjectId, count],
    queryFn: () => api.get<{ questions: PracticeQuestion[] }>("/v1/practice/questions", { subject: subjectId, count }),
    staleTime: Infinity,
  });
}

export function useTopicStatuses() {
  const { storage } = useServices();
  return useQuery({
    queryKey: qk.topicStatus,
    queryFn: async () => new Map((await storage.topic_status.all()).map((r: TopicStatusRow) => [r.topic_id, r])),
  });
}

/** Unsent events (for today's local activity and the unsynced warning). */
export function useOutboxRows() {
  const { storage } = useServices();
  return useQuery({ queryKey: qk.outbox, queryFn: () => storage.outbox.all(), refetchInterval: 5_000 });
}

/** Today's activity from local events (the store's streak says whether the server has counted it). */
export function useTodayActivity() {
  const rows = useOutboxRows().data ?? ([] as OutboxRow[]);
  const tz = timeZone();
  return todayActivity(undefined, rows, localDate(Date.now(), tz), tz);
}

export function useSrsCards() {
  const { storage } = useServices();
  return useQuery({ queryKey: qk.srs, queryFn: () => storage.srs_cards.all() });
}
