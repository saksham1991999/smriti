/**
 * Practice, PYQs, mocks, attempts and the daily challenge (docs/flows/practice.md).
 *
 * Answers and submits that change progress send an `Idempotency-Key`, one per mutation call,
 * where the endpoint takes one. The mock runner saves answers often (`PUT …/answers` is
 * idempotent by design: it replaces the saved set).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { newIdempotencyKey, unwrap, type Schemas } from "./client";
import { invalidate, queryKeys, useApiClient, type QueryParams } from "./react-core";

// ── Practice ──────────────────────────────────────────────────────────────────

/** Today's free practice and tutor counts (PRC-01 limit meter). */
export function usePracticeLimits() {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.practiceLimits(),
    queryFn: () => unwrap(api.GET("/v1/practice/limits"), api),
  });
}

export function usePracticeHub(exam?: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.practiceHub(exam),
    queryFn: () => unwrap(api.GET("/v1/practice/hub", { params: { query: { exam } } }), api),
  });
}

export function useWeakSpots(exam?: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.weakSpots(exam),
    queryFn: () => unwrap(api.GET("/v1/practice/weak-spots", { params: { query: { exam } } }), api),
  });
}

/** What a concept drill would contain, before it starts (PRC-02). */
export function useDrillPreview(query: QueryParams<"/v1/practice/drill", "get">, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.drill(query),
    queryFn: () => unwrap(api.GET("/v1/practice/drill", { params: { query } }), api),
    enabled,
  });
}

export function usePracticeSessions(limit = 20) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.practiceSessions(),
    queryFn: () => unwrap(api.GET("/v1/practice/sessions", { params: { query: { limit } } }), api),
  });
}

export function usePracticeSession(sessionId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.practiceSession(sessionId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/v1/practice/sessions/{session_id}", {
          params: { path: { session_id: sessionId ?? "" } },
        }),
        api,
      ),
    enabled: Boolean(sessionId),
  });
}

export function useStartPracticeSession() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["smriti_api__schemas__practice__SessionCreate"]) =>
      unwrap(api.POST("/v1/practice/sessions", { body }), api),
    onSuccess: (session) => {
      qc.setQueryData(queryKeys.practiceSession(session.id), session);
      return invalidate(qc, queryKeys.practiceLimits(), queryKeys.practiceSessions());
    },
  });
}

export function useSubmitPracticeAnswer(sessionId: string) {
  const api = useApiClient();
  return useMutation({
    mutationFn: (body: Schemas["AnswerSubmit"]) =>
      unwrap(
        api.POST("/v1/practice/sessions/{session_id}/answers", {
          body,
          params: {
            path: { session_id: sessionId },
            header: { "Idempotency-Key": newIdempotencyKey() },
          },
        }),
        api,
      ),
  });
}

export function useCompletePracticeSession(sessionId: string) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["SessionComplete"]) =>
      unwrap(
        api.POST("/v1/practice/sessions/{session_id}/complete", {
          body,
          params: { path: { session_id: sessionId } },
        }),
        api,
      ),
    onSuccess: (session) => {
      qc.setQueryData(queryKeys.practiceSession(sessionId), session);
      return invalidate(qc, queryKeys.practiceAll(), queryKeys.summary(), queryKeys.syncState());
    },
  });
}

// ── PYQs ──────────────────────────────────────────────────────────────────────

export function usePyqPapers(query: QueryParams<"/v1/pyq/papers", "get"> = {}) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.pyqPapers(query),
    queryFn: () => unwrap(api.GET("/v1/pyq/papers", { params: { query } }), api),
    staleTime: 10 * 60_000,
  });
}

export function usePyqPaper(paperId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.pyqPaper(paperId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/v1/pyq/papers/{paper_id}", { params: { path: { paper_id: paperId ?? "" } } }),
        api,
      ),
    enabled: Boolean(paperId),
  });
}

export function usePyqQuestions(query: QueryParams<"/v1/pyq", "get"> = {}) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.pyq(query),
    queryFn: () => unwrap(api.GET("/v1/pyq", { params: { query } }), api),
  });
}

// ── Mocks and attempts ────────────────────────────────────────────────────────

export function useMocks(exam?: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.mocks(exam),
    queryFn: () => unwrap(api.GET("/v1/mocks", { params: { query: { exam } } }), api),
  });
}

export function useMock(mockId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.mock(mockId ?? ""),
    queryFn: () =>
      unwrap(api.GET("/v1/mocks/{mock_id}", { params: { path: { mock_id: mockId ?? "" } } }), api),
    enabled: Boolean(mockId),
  });
}

/** Starts a full or sectional mock. `attempt_id` is a client UUID, so a retry is safe. */
export function useStartMockAttempt(mockId: string) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["AttemptCreate"]) =>
      unwrap(
        api.POST("/v1/mocks/{mock_id}/attempts", { body, params: { path: { mock_id: mockId } } }),
        api,
      ),
    onSuccess: (attempt) => {
      qc.setQueryData(queryKeys.attempt(attempt.id), attempt);
      return invalidate(qc, queryKeys.attempts(), queryKeys.mocksAll(), queryKeys.practiceLimits());
    },
  });
}

/** A generated chapter or custom test (MOCK-26). */
export function useGenerateMock() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["GenerateMock"]) =>
      unwrap(api.POST("/v1/mocks/generate", { body }), api),
    onSuccess: (attempt) => {
      qc.setQueryData(queryKeys.attempt(attempt.id), attempt);
      return invalidate(qc, queryKeys.attempts(), queryKeys.practiceLimits());
    },
  });
}

export function useAttempts(limit = 20) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.attempts(),
    queryFn: () => unwrap(api.GET("/v1/attempts", { params: { query: { limit } } }), api),
  });
}

export function useAttempt(attemptId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.attempt(attemptId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/v1/attempts/{attempt_id}", { params: { path: { attempt_id: attemptId ?? "" } } }),
        api,
      ),
    enabled: Boolean(attemptId),
  });
}

/** Saves the runner's answers (replaces the saved set; safe to repeat). */
export function useSaveAttemptAnswers(attemptId: string) {
  const api = useApiClient();
  return useMutation({
    mutationFn: (body: Schemas["AnswersPut"]) =>
      unwrap(
        api.PUT("/v1/attempts/{attempt_id}/answers", {
          body,
          params: { path: { attempt_id: attemptId } },
        }),
        api,
      ),
  });
}

type AttemptAction = "pause" | "resume" | "takeover" | "abandon";

function useAttemptAction(attemptId: string, action: AttemptAction) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: Schemas["PauseIn"]) => {
      const params = { params: { path: { attempt_id: attemptId } } };
      switch (action) {
        case "pause":
          return unwrap(
            api.POST("/v1/attempts/{attempt_id}/pause", { ...params, body: body ?? {} }),
            api,
          );
        case "resume":
          return unwrap(api.POST("/v1/attempts/{attempt_id}/resume", params), api);
        case "takeover":
          return unwrap(api.POST("/v1/attempts/{attempt_id}/takeover", params), api);
        case "abandon":
          return unwrap(api.POST("/v1/attempts/{attempt_id}/abandon", params), api);
      }
    },
    onSuccess: (attempt) => {
      qc.setQueryData(queryKeys.attempt(attemptId), attempt);
      return invalidate(qc, queryKeys.attempts());
    },
  });
}

export const usePauseAttempt = (attemptId: string) => useAttemptAction(attemptId, "pause");
export const useResumeAttempt = (attemptId: string) => useAttemptAction(attemptId, "resume");
/** Moves an attempt open on another device to this one (MOCK-04). */
export const useTakeoverAttempt = (attemptId: string) => useAttemptAction(attemptId, "takeover");
export const useAbandonAttempt = (attemptId: string) => useAttemptAction(attemptId, "abandon");

export function useSubmitSection(attemptId: string) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sectionCode: string) =>
      unwrap(
        api.POST("/v1/attempts/{attempt_id}/sections/{section_code}/submit", {
          params: { path: { attempt_id: attemptId, section_code: sectionCode } },
        }),
        api,
      ),
    onSuccess: (attempt) => {
      qc.setQueryData(queryKeys.attempt(attemptId), attempt);
      return invalidate(qc, queryKeys.syncState());
    },
  });
}

/** Submits the whole attempt and returns the report (MOCK-10). */
export function useSubmitAttempt(attemptId: string) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/v1/attempts/{attempt_id}/submit", {
          params: {
            path: { attempt_id: attemptId },
            header: { "Idempotency-Key": newIdempotencyKey() },
          },
        }),
        api,
      ),
    onSuccess: (report) => {
      qc.setQueryData(queryKeys.report(attemptId), report);
      return invalidate(
        qc,
        queryKeys.attempt(attemptId),
        queryKeys.attempts(),
        queryKeys.mocksAll(),
        queryKeys.summary(),
        queryKeys.syncState(),
      );
    },
  });
}

export function useAttemptReport(attemptId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.report(attemptId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/v1/attempts/{attempt_id}/report", {
          params: { path: { attempt_id: attemptId ?? "" } },
        }),
        api,
      ),
    enabled: Boolean(attemptId),
  });
}

export function useAttemptSolutions(attemptId: string | undefined, locale?: "en" | "hi") {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.solutions(attemptId ?? "", locale),
    queryFn: () =>
      unwrap(
        api.GET("/v1/attempts/{attempt_id}/solutions", {
          params: { path: { attempt_id: attemptId ?? "" }, query: { locale } },
        }),
        api,
      ),
    enabled: Boolean(attemptId),
  });
}

// ── Daily challenge ───────────────────────────────────────────────────────────

export function useDailyChallenge(exam?: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.dailyChallenge(exam),
    queryFn: () =>
      unwrap(api.GET("/v1/daily-challenge/today", { params: { query: { exam } } }), api),
  });
}

export function useStartDailyChallenge(challengeId: string) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/v1/daily-challenge/{challenge_id}/start", {
          params: { path: { challenge_id: challengeId } },
        }),
        api,
      ),
    onSuccess: () => invalidate(qc, queryKeys.dailyChallengeAll()),
  });
}

export function useAnswerDailyChallenge(challengeId: string) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["DailyChallengeAnswer"]) =>
      unwrap(
        api.POST("/v1/daily-challenge/{challenge_id}/answer", {
          body,
          params: {
            path: { challenge_id: challengeId },
            header: { "Idempotency-Key": newIdempotencyKey() },
          },
        }),
        api,
      ),
    onSuccess: () =>
      invalidate(qc, queryKeys.dailyChallengeAll(), queryKeys.summary(), queryKeys.syncState()),
  });
}

export function useDailyLeaderboard(challengeId: string | undefined, limit = 50) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.dailyLeaderboard(challengeId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/v1/daily-challenge/{challenge_id}/leaderboard", {
          params: { path: { challenge_id: challengeId ?? "" }, query: { limit } },
        }),
        api,
      ),
    enabled: Boolean(challengeId),
  });
}
