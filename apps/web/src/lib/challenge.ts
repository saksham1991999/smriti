/**
 * The daily challenge and the PYQ bank on the server (`/v1/daily-challenge`, `/v1/pyq`). The
 * question stays hidden until the student starts (`question: null`), the clock runs from the
 * server's `started_at`, and one answer is accepted.
 */
import { useQuery } from "@tanstack/react-query";
import { newIdempotencyKey, unwrap, type Schemas } from "@smriti/api-client";
import type { Answer } from "@smriti/lesson-core";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../boot/context";
import type { Services } from "../boot/services";
import { toAnswerIn } from "./practice";

export type DailyChallenge = Schemas["DailyChallenge"];
export type DailyLeaderboard = Schemas["DailyLeaderboard"];
export type PyqPaper = Schemas["PyqPaper"];
export type PyqQuestion = Schemas["PyqQuestion"];
export type Confidence = "sure" | "half" | "guess";

export function useDailyChallenge(exam: string | null) {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["challenge", "today", userId, exam],
    enabled: !!userId && !!exam && !s.fakeApi,
    retry: false,
    staleTime: 30_000,
    queryFn: () => unwrap(s.client.GET("/v1/daily-challenge/today", { params: { query: { exam: exam ?? "" } } }), s.client),
  });
}

export function useChallengeLeaderboard(id: string | null, enabled: boolean) {
  const s = useServices();
  return useQuery({
    queryKey: ["challenge", "leaderboard", id],
    enabled: !!id && enabled && !s.fakeApi,
    retry: false,
    staleTime: 30_000,
    queryFn: () => unwrap(s.client.GET("/v1/daily-challenge/{challenge_id}/leaderboard", { params: { path: { challenge_id: id ?? "" } } }), s.client),
  });
}

export async function startChallenge(s: Services, id: string): Promise<DailyChallenge | null> {
  try {
    return await unwrap(s.client.POST("/v1/daily-challenge/{challenge_id}/start", { params: { path: { challenge_id: id } }, headers: { "Idempotency-Key": newIdempotencyKey() } }), s.client);
  } catch (err) {
    s.logger.warn("challenge.start_failed", { code: (err as { code?: string }).code ?? "network" });
    return null;
  }
}

export async function answerChallenge(s: Services, id: string, body: { answer: Answer | null; confidence: Confidence | null; ms: number; tz: string }, key: string): Promise<DailyChallenge | null> {
  try {
    return await unwrap(
      s.client.POST("/v1/daily-challenge/{challenge_id}/answer", {
        params: { path: { challenge_id: id }, header: { "Idempotency-Key": key } },
        body: {
          answer: body.answer ? (toAnswerIn(body.answer) as Schemas["DailyChallengeAnswer"]["answer"]) : null,
          confidence: body.confidence === "half" ? "fifty_fifty" : body.confidence,
          client_time_ms: Math.max(0, Math.round(body.ms)),
          tz: body.tz,
        },
      }),
      s.client,
    );
  } catch (err) {
    s.logger.warn("challenge.answer_failed", { code: (err as { code?: string }).code ?? "network" });
    return null;
  }
}

export function usePyqPapers(exam: string | null) {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["pyq", "papers", userId, exam],
    enabled: !!userId && !!exam && !s.fakeApi,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => unwrap(s.client.GET("/v1/pyq/papers", { params: { query: { exam: exam ?? "" } } }), s.client),
  });
}

export function usePyqQuestions(exam: string | null) {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["pyq", "questions", userId, exam],
    enabled: !!userId && !!exam && !s.fakeApi,
    retry: false,
    staleTime: 60_000,
    queryFn: () => unwrap(s.client.GET("/v1/pyq", { params: { query: { exam: exam ?? "" } } }), s.client),
  });
}

/** m:ss for a duration in milliseconds. */
export function mss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
