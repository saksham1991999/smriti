/**
 * Practice on the server (`/v1/practice/*`, practice §5): the session is sized there to the free
 * questions left, each answer is checked and counted there, and the quota comes back with it.
 * When the server can't be reached (offline, or the in-process fake API in tests) the drill runs
 * on the device from the downloaded bundle and its answers go through the outbox instead.
 */
import { useQuery } from "@tanstack/react-query";
import { newIdempotencyKey, unwrap, type Schemas } from "@smriti/api-client";
import type { Answer } from "@smriti/lesson-core";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../boot/context";
import type { Services } from "../boot/services";

export type ServerSession = Schemas["PracticeSession"];
export type ServerAnswerResult = Schemas["AnswerResult"];
export type ServerQuota = Schemas["QuotaOut"];

const idem = () => ({ header: { "Idempotency-Key": newIdempotencyKey() } });

/** lesson-core's answer → the API's `AnswerIn` (ids, a number or matched keys; never free text kept). */
export function toAnswerIn(a: Answer): NonNullable<Schemas["AnswerSubmit"]["answer"]> {
  switch (a.kind) {
    case "options":
      return { kind: "options", option_ids: a.optionIds };
    case "number":
      return { kind: "number", value: a.value, unit: a.unit ?? null };
    case "pairs":
      return { kind: "pairs", pairs: a.pairs };
    case "matrix":
      return { kind: "matrix", rows: a.rows };
    case "blanks":
      return { kind: "blanks", blanks: a.blanks.map((b) => ({ blank: b.blank, choice_id: b.choiceId ?? null, text: b.text ?? null })) };
    case "order":
      return { kind: "order", order: a.order };
  }
}

/** PRC-01's meter: the server's counters (null until it answers, or with the fake API). */
export function usePracticeLimits() {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["practice", "limits", userId],
    enabled: !!userId && !s.fakeApi,
    retry: false,
    staleTime: 30_000,
    queryFn: () => unwrap(s.client.GET("/v1/practice/limits", {}), s.client),
  });
}

/** PRC-01's weak spots, from mastery on the server (`GET /v1/practice/weak-spots`). Empty with the fake API. */
export function useWeakSpots(exam: string | null) {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["practice", "weak-spots", userId, exam],
    enabled: !!userId && !!exam && !s.fakeApi,
    retry: false,
    staleTime: 60_000,
    queryFn: () => unwrap(s.client.GET("/v1/practice/weak-spots", { params: { query: { exam: exam ?? "" } } }), s.client),
  });
}

export async function startServerSession(s: Services, input: { sessionId: string; topicId: string; count: number; exam: string | null }): Promise<ServerSession | null> {
  if (s.fakeApi) return null;
  try {
    return await unwrap(
      s.client.POST("/v1/practice/sessions", {
        body: { session_id: input.sessionId, topic_id: input.topicId, count: Math.max(1, Math.min(100, input.count)), exam: input.exam, mode: "drill", difficulty: "adaptive", source: "topic" },
      }),
      s.client,
    );
  } catch (err) {
    s.logger.warn("practice.session_start_failed", { code: (err as { code?: string }).code ?? "network" });
    return null;
  }
}

export async function submitServerAnswer(
  s: Services,
  sessionId: string,
  body: { questionId: string; answer: Answer | null; timeMs: number; locale: "en" | "hi" },
): Promise<ServerAnswerResult | null> {
  try {
    return await unwrap(
      s.client.POST("/v1/practice/sessions/{session_id}/answers", {
        params: { path: { session_id: sessionId }, ...idem() },
        body: { question_id: body.questionId, answer: body.answer ? toAnswerIn(body.answer) : null, attempt: 1, time_ms: Math.round(Math.min(3_600_000, body.timeMs)), locale: body.locale },
      }),
      s.client,
    );
  } catch (err) {
    s.logger.warn("practice.answer_failed", { code: (err as { code?: string }).code ?? "network" });
    return null;
  }
}

export async function completeServerSession(s: Services, sessionId: string, endedBy: "finished" | "closed" | "time_up"): Promise<ServerSession | null> {
  try {
    return await unwrap(s.client.POST("/v1/practice/sessions/{session_id}/complete", { params: { path: { session_id: sessionId } }, body: { ended_by: endedBy } }), s.client);
  } catch {
    return null;
  }
}
