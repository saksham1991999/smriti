/**
 * Mocks on the server (`/v1/mocks`, `/v1/attempts`, mocks §5). The server builds every paper from
 * the exam blueprint, keeps the clock (`server_deadline_at`), stores each saved answer and scores
 * the attempt. The page keeps answers it could not save yet in `mock_local` and retries them.
 */
import { useQuery } from "@tanstack/react-query";
import { newIdempotencyKey, unwrap, type Schemas } from "@smriti/api-client";
import type { MarkingRule, TypedBundle } from "@smriti/content-schema";
import { wrongMarks, type AnyQuestion } from "@smriti/lesson-core";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../boot/context";
import type { Services } from "../boot/services";

export type MockCard = Schemas["MockCard"];
export type MockDetail = Schemas["MockDetail"];
export type Attempt = Schemas["Attempt"];
export type AttemptQuestion = Schemas["AttemptQuestion"];
export type AttemptSection = Schemas["AttemptSection"];
export type AnswerSave = Schemas["AnswerSave"];
export type SaveResult = Schemas["SaveResult"];
export type Report = Schemas["Report"];
export type SolutionItem = Schemas["SolutionItem"];
export type PaletteStatus = AnswerSave["palette_status"];
export type Locale = "en" | "hi";

/** The mock routes read the key from the request headers; it is not in their OpenAPI params. */
const idem = () => ({ headers: { "Idempotency-Key": newIdempotencyKey() } });

/** `{en, hi}` (or a plain string) → the reader's language, falling back to English. */
export function pickText(v: unknown, locale: Locale): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const s = o[locale] ?? o.en;
    if (typeof s === "string") return s;
  }
  return "";
}

const isLocalized = (o: Record<string, unknown>): boolean => {
  const keys = Object.keys(o);
  return keys.length > 0 && keys.every((k) => k === "en" || k === "hi") && keys.every((k) => o[k] === null || typeof o[k] === "string");
};

/**
 * A server question body (every text as `{en, hi}`) → the single-language question the player
 * renders, the same shape as a published bundle's question.
 */
export function localizeQuestion(body: unknown, locale: Locale): AnyQuestion {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (isLocalized(o)) return pickText(o, locale);
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(body) as AnyQuestion;
}

/**
 * The player reads maths and media from a bundle. Server bodies carry neither, so maths falls
 * back to KaTeX on the page and media refs show nothing (reported as a gap).
 */
export function stubBundle(locale: Locale, questions: AnyQuestion[]): TypedBundle {
  return {
    id: "mock",
    locale,
    schema: "bundle",
    mode: "practice",
    min_app_version: "0.0.0",
    fixture: false,
    topic: { id: "mock", name: "" },
    concepts: [],
    bites: [],
    cards: [],
    questions: Object.fromEntries(questions.map((q) => [q.id, q])),
    media: {},
    math: {},
    mnemonics: {},
    sheets: {},
  } as unknown as TypedBundle;
}

/** Marking from the API, with the "not stated in the notice" cases the blueprint now allows. */
export type Marking = Omit<MarkingRule, "correct" | "wrong"> & { correct: number | null; wrong: MarkingRule["wrong"] };

export function asRule(m: Schemas["MarkingOut"] | undefined | null): MarkingRule | null {
  return m ? (m as unknown as MarkingRule) : null;
}

/** "+4 / −1", or null when the notice does not state the marks. */
export function markingLabel(m: Schemas["MarkingOut"] | undefined | null): { correct: number; wrong: number } | null {
  const rule = asRule(m);
  if (!rule || rule.correct === null) return null;
  const wrong = wrongMarks(rule);
  if (wrong === null) return null;
  return { correct: rule.correct, wrong };
}

/** Server time minus this device's clock, so the countdown follows the server's deadline. */
export function clockOffset(serverTime: string): number {
  return Date.parse(serverTime) - Date.now();
}

export function useMocks(exam: string | null) {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["mocks", "list", userId, exam],
    enabled: !!userId && !!exam && !s.fakeApi,
    retry: false,
    staleTime: 30_000,
    queryFn: () => unwrap(s.client.GET("/v1/mocks", { params: { query: { exam: exam ?? "" } } }), s.client),
  });
}

export function useMock(mockId: string) {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["mocks", "detail", userId, mockId],
    enabled: !!userId && !s.fakeApi,
    retry: false,
    queryFn: () => unwrap(s.client.GET("/v1/mocks/{mock_id}", { params: { path: { mock_id: mockId } } }), s.client),
  });
}

/** MOCK-25: the student's past attempts. */
export function usePastAttempts() {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["mocks", "attempts", userId],
    enabled: !!userId && !s.fakeApi,
    retry: false,
    staleTime: 30_000,
    queryFn: () => unwrap(s.client.GET("/v1/attempts", {}), s.client),
  });
}

export function useAttempt(attemptId: string) {
  const s = useServices();
  return useQuery({
    queryKey: ["mocks", "attempt", attemptId],
    enabled: !s.fakeApi,
    retry: false,
    staleTime: Infinity,
    queryFn: () => unwrap(s.client.GET("/v1/attempts/{attempt_id}", { params: { path: { attempt_id: attemptId } } }), s.client),
  });
}

export function useReport(attemptId: string) {
  const s = useServices();
  return useQuery({
    queryKey: ["mocks", "report", attemptId],
    enabled: !s.fakeApi,
    retry: false,
    queryFn: () => unwrap(s.client.GET("/v1/attempts/{attempt_id}/report", { params: { path: { attempt_id: attemptId } } }), s.client),
  });
}

export function useSolutions(attemptId: string) {
  const s = useServices();
  return useQuery({
    queryKey: ["mocks", "solutions", attemptId],
    enabled: !s.fakeApi,
    retry: false,
    queryFn: () => unwrap(s.client.GET("/v1/attempts/{attempt_id}/solutions", { params: { path: { attempt_id: attemptId } } }), s.client),
  });
}

export async function startAttempt(s: Services, mockId: string, language: Locale): Promise<Attempt | null> {
  try {
    return await unwrap(
      s.client.POST("/v1/mocks/{mock_id}/attempts", {
        params: { path: { mock_id: mockId } },
        ...idem(),
        body: { attempt_id: s.newId(), language, time_policy: "practice" },
      }),
      s.client,
    );
  } catch (err) {
    s.logger.warn("mock.start_failed", { code: (err as { code?: string }).code ?? "network" });
    return null;
  }
}

/** Sends the rows; on a network failure keeps them in `mock_local` for the next try. */
export async function saveAnswers(s: Services, attemptId: string, rows: AnswerSave[]): Promise<SaveResult | null> {
  if (rows.length === 0) return null;
  try {
    const res = await unwrap(
      s.client.PUT("/v1/attempts/{attempt_id}/answers", { params: { path: { attempt_id: attemptId } }, ...idem(), body: { answers: rows } }),
      s.client,
    );
    await s.storage.mock_local.delete(attemptId);
    return res;
  } catch (err) {
    s.logger.warn("mock.save_failed", { code: (err as { code?: string }).code ?? "network", count: rows.length });
    await s.storage.mock_local.put({ attempt_id: attemptId, data: { pending: rows } as never, updated_at: new Date().toISOString() });
    return null;
  }
}

export async function pendingSaves(s: Services, attemptId: string): Promise<AnswerSave[]> {
  const row = await s.storage.mock_local.get(attemptId);
  const data = row?.data as { pending?: AnswerSave[] } | undefined;
  return data?.pending ?? [];
}

export async function submitAttempt(s: Services, attemptId: string): Promise<Report | null> {
  try {
    return await unwrap(s.client.POST("/v1/attempts/{attempt_id}/submit", { params: { path: { attempt_id: attemptId } }, ...idem() }), s.client);
  } catch (err) {
    s.logger.warn("mock.submit_failed", { code: (err as { code?: string }).code ?? "network" });
    return null;
  }
}
