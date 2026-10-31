/**
 * TanStack Query hooks over the typed client (AGENTS.md: TanStack Query for server data).
 *
 * ```tsx
 * <ApiProvider client={api}><App /></ApiProvider>
 * const { data: pet } = usePet();
 * ```
 *
 * Progress itself (lessons, reviews, the streak, plant and pet state) flows through
 * app-core's outbox and `/v1/sync/*`; these hooks cover the REST reads and actions around it.
 * Mutations that touch progress or money send an `Idempotency-Key`, one per mutation call.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { newIdempotencyKey, unwrap, type Schemas } from "./client";
import { invalidate, queryKeys, useApiClient } from "./react-core";

export { ApiProvider, invalidate, queryKeys, useApiClient } from "./react-core";
export * from "./react-practice";
export * from "./react-tutor";
export * from "./react-account";

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useConfig(variant?: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.config(variant),
    queryFn: () => unwrap(api.GET("/v1/config", { params: { query: { variant } } }), api),
    staleTime: 60_000,
  });
}

export function useMe() {
  const api = useApiClient();
  return useQuery({ queryKey: queryKeys.me(), queryFn: () => unwrap(api.GET("/v1/me"), api) });
}

export function useSummary() {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.summary(),
    queryFn: () => unwrap(api.GET("/v1/me/summary"), api),
  });
}

export function useExams() {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.exams(),
    queryFn: () => unwrap(api.GET("/v1/catalog/exams"), api),
    staleTime: 10 * 60_000,
  });
}

export function useSubjects(exam?: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.subjects(exam),
    queryFn: () => unwrap(api.GET("/v1/catalog/subjects", { params: { query: { exam } } }), api),
    staleTime: 10 * 60_000,
  });
}

export function useChapter(chapterId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.chapter(chapterId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/v1/catalog/chapters/{chapter_id}", {
          params: { path: { chapter_id: chapterId ?? "" } },
        }),
        api,
      ),
    enabled: Boolean(chapterId),
  });
}

export function useTopic(topicId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.topic(topicId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/v1/catalog/topics/{topic_id}", { params: { path: { topic_id: topicId ?? "" } } }),
        api,
      ),
    enabled: Boolean(topicId),
  });
}

export function useManifest(exam: string | undefined, locale?: "en" | "hi") {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.manifest(exam ?? "", locale),
    queryFn: () =>
      unwrap(
        api.GET("/v1/content/manifest", { params: { query: { exam: exam ?? "", locale } } }),
        api,
      ),
    enabled: Boolean(exam),
  });
}

export function usePet() {
  const api = useApiClient();
  return useQuery({ queryKey: queryKeys.pet(), queryFn: () => unwrap(api.GET("/v1/pet"), api) });
}

export function usePlant() {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.plant(),
    queryFn: () => unwrap(api.GET("/v1/plant"), api),
  });
}

export function useShop() {
  const api = useApiClient();
  return useQuery({ queryKey: queryKeys.shop(), queryFn: () => unwrap(api.GET("/v1/shop"), api) });
}

export function useQuests() {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.quests(),
    queryFn: () => unwrap(api.GET("/v1/quests"), api),
  });
}

export function useBadges() {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.badges(),
    queryFn: () => unwrap(api.GET("/v1/badges"), api),
  });
}

/** The gem ledger, newest first, a page at a time (cursor pagination). */
export function useGemLedger(limit = 20) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: queryKeys.gemLedger(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(api.GET("/v1/gems/ledger", { params: { query: { cursor: pageParam, limit } } }), api),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

/** Polls a guest merge until it is done or failed (auth flow §6.4). */
export function useMergeStatus(mergeId: string | undefined, intervalMs = 1500) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.merge(mergeId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/v1/account/merges/{merge_id}", { params: { path: { merge_id: mergeId ?? "" } } }),
        api,
      ),
    enabled: Boolean(mergeId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "failed" ? false : intervalMs;
    },
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

export function usePatchMe() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["MePatch"]) => unwrap(api.PATCH("/v1/me", { body }), api),
    onSuccess: (me) => {
      qc.setQueryData(queryKeys.me(), me);
      return invalidate(qc, queryKeys.summary(), queryKeys.syncState());
    },
  });
}

export function usePutExams() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["ExamsPut"]) => unwrap(api.PUT("/v1/me/exams", { body }), api),
    onSuccess: () => invalidate(qc, queryKeys.me(), queryKeys.summary(), queryKeys.syncState()),
  });
}

export function usePetCare() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["PetCareRequest"]) =>
      unwrap(
        api.POST("/v1/pet/care", {
          body,
          params: { header: { "Idempotency-Key": newIdempotencyKey() } },
        }),
        api,
      ),
    onSuccess: (pet) => {
      qc.setQueryData(queryKeys.pet(), pet);
      return invalidate(qc, queryKeys.shop(), queryKeys.syncState());
    },
  });
}

export function usePurchase() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["PurchaseRequest"]) =>
      unwrap(
        api.POST("/v1/shop/purchase", {
          body,
          params: { header: { "Idempotency-Key": newIdempotencyKey() } },
        }),
        api,
      ),
    onSuccess: () =>
      invalidate(
        qc,
        queryKeys.shop(),
        queryKeys.gemLedger(),
        queryKeys.pet(),
        queryKeys.syncState(),
      ),
  });
}

export function useEquipFreeze() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["StreakFreezeRequest"]) =>
      unwrap(
        api.POST("/v1/streak/freeze", {
          body,
          params: { header: { "Idempotency-Key": newIdempotencyKey() } },
        }),
        api,
      ),
    onSuccess: () => invalidate(qc, queryKeys.summary(), queryKeys.shop(), queryKeys.syncState()),
  });
}

export function useSetRestDay() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["RestDayRequest"]) =>
      unwrap(api.POST("/v1/streak/rest-day", { body }), api),
    onSuccess: () => invalidate(qc, queryKeys.summary(), queryKeys.syncState()),
  });
}

export function useClearRestDay() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (day: string) =>
      unwrap(api.DELETE("/v1/streak/rest-day/{day}", { params: { path: { day } } }), api),
    onSuccess: () => invalidate(qc, queryKeys.summary(), queryKeys.syncState()),
  });
}

export function useClaimQuest() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (questId: string) =>
      unwrap(
        api.POST("/v1/quests/{quest_id}/claim", {
          params: {
            path: { quest_id: questId },
            header: { "Idempotency-Key": newIdempotencyKey() },
          },
        }),
        api,
      ),
    onSuccess: () =>
      invalidate(
        qc,
        queryKeys.quests(),
        queryKeys.shop(),
        queryKeys.gemLedger(),
        queryKeys.syncState(),
      ),
  });
}
