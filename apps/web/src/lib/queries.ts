import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@smriti/api-client";
import { useAppStore } from "@smriti/app-core/react";
import { localDate, todayActivity, type LessonProgressRow, type OutboxRow, type TopicStatusRow } from "@smriti/app-core";
import { useServices } from "../boot/context";
import { timeZone } from "../platform/web";
import { useOnboarding } from "./onboarding";

export const qk = {
  config: ["smriti", "config"] as const,
  exams: ["smriti", "catalog", "exams"] as const,
  topicStatus: ["local", "topic_status"] as const,
  lessonProgress: ["local", "lesson_progress"] as const,
  outbox: ["local", "outbox"] as const,
  srs: ["local", "srs"] as const,
};

/** Every local query, refreshed after a lesson or a sync pull. */
export const LOCAL_KEYS = [qk.topicStatus, qk.lessonProgress, qk.outbox, qk.srs];

export type AppConfig = Schemas["ConfigResponse"];
export type Exam = Schemas["ExamOut"];

/** `GET /v1/config` through the generated client; its flags replace the defaults. */
export function useConfig() {
  const s = useServices();
  const q = useQuery({ queryKey: qk.config, queryFn: () => unwrap(s.client.GET("/v1/config"), s.client), staleTime: 60 * 60_000 });
  useEffect(() => {
    if (q.data) s.applyServerFlags(q.data.flags);
  }, [q.data, s]);
  return q;
}

/** `GET /v1/catalog/exams`: exam names and their active profiles (onboarding and the exam switcher). */
export function useExams() {
  const s = useServices();
  return useQuery({ queryKey: qk.exams, queryFn: () => unwrap(s.client.GET("/v1/catalog/exams"), s.client), staleTime: 10 * 60_000 });
}

/**
 * Exam profile ids the student studies: the server profile, else the onboarding goals (which are
 * profile ids, as the API's `onboarding_answer` goal expects), else the variant's first profile.
 */
export function useProfileIds(): string[] {
  const serverIds = useAppStore((s) => s.profile?.exam_profile_ids);
  const goals = useOnboarding((s) => s.goals);
  const config = useConfig().data;
  const local = goals.filter((g) => g !== "curious");
  if (local.length) return [...new Set(local)];
  if (serverIds && serverIds.length) return [...new Set(serverIds)];
  const first = config?.variant.exam_profile_ids[0];
  return first ? [first] : [];
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

/** Recent events, sent (kept two days) and unsent, for today's local activity and minutes. */
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
