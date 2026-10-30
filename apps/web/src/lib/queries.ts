import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@smriti/app-core/react";
import { localDate, todayActivity, type LessonProgressRow, type OutboxRow, type TopicStatusRow } from "@smriti/app-core";
import { useServices } from "../boot/context";
import { timeZone } from "../platform/web";
import { profileIdsFor, useOnboarding } from "./onboarding";
import type { ConfigResponse } from "./contentTypes";

export const qk = {
  config: ["config"] as const,
  topicStatus: ["local", "topic_status"] as const,
  lessonProgress: ["local", "lesson_progress"] as const,
  outbox: ["local", "outbox"] as const,
  srs: ["local", "srs"] as const,
};

/** Every local query, refreshed after a lesson or a sync pull. */
export const LOCAL_KEYS = [qk.topicStatus, qk.lessonProgress, qk.outbox, qk.srs];

export function useConfig() {
  const s = useServices();
  const q = useQuery({ queryKey: qk.config, queryFn: () => s.api.get<ConfigResponse>("/v1/config"), staleTime: 60 * 60_000 });
  useEffect(() => {
    if (q.data) s.applyServerFlags(q.data.flags);
  }, [q.data, s]);
  return q;
}

/** Exam profile ids the student studies: from the server profile, else the onboarding answers. */
export function useProfileIds(): string[] {
  const serverIds = useAppStore((s) => s.profile?.exam_profile_ids);
  const goals = useOnboarding((s) => s.goals);
  const config = useConfig().data;
  const exams = config?.exams ?? [];
  const ids = serverIds && serverIds.length ? profileIdsFor(serverIds, exams) : profileIdsFor(goals, exams);
  if (ids.length) return [...new Set(ids)];
  // Before a goal is chosen (or for "curious"), the first published profile.
  return exams[0] ? [exams[0].profileId] : [];
}

export function useTopicStatuses() {
  const { storage } = useServices();
  return useQuery({
    queryKey: qk.topicStatus,
    queryFn: async () => new Map((await storage.topic_status.all()).map((r: TopicStatusRow) => [r.topic_id, r])),
  });
}

export function useLessonProgress() {
  const { storage } = useServices();
  return useQuery({
    queryKey: qk.lessonProgress,
    queryFn: async () => new Map((await storage.lesson_progress.all()).map((r: LessonProgressRow) => [`${r.topic_id}|${r.mode}`, r])),
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
