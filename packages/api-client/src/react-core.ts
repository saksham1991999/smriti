/** Provider, query keys and helpers shared by the hook modules (see `react.ts`). */
import { type QueryClient } from "@tanstack/react-query";
import { createContext, createElement, useContext, type ReactNode } from "react";

import { type ApiClient } from "./client";
import type { paths } from "./schema";

/** The query parameters of an operation, e.g. `QueryParams<"/v1/pyq", "get">`. */
export type QueryParams<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  parameters: { query?: infer Q };
}
  ? NonNullable<Q>
  : never;

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider(props: { client: ApiClient; children?: ReactNode }) {
  return createElement(ApiContext.Provider, { value: props.client }, props.children);
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error("useApiClient: wrap the app in <ApiProvider client={…}>");
  return client;
}

/** Query keys, so screens can invalidate exactly what changed. */
export const queryKeys = {
  all: ["smriti"] as const,
  config: (variant?: string) => ["smriti", "config", variant ?? null] as const,
  me: () => ["smriti", "me"] as const,
  summary: () => ["smriti", "me", "summary"] as const,
  syncState: () => ["smriti", "sync-state"] as const,
  exams: () => ["smriti", "catalog", "exams"] as const,
  subjects: (exam?: string) => ["smriti", "catalog", "subjects", exam ?? null] as const,
  chapter: (id: string) => ["smriti", "catalog", "chapter", id] as const,
  topic: (id: string) => ["smriti", "catalog", "topic", id] as const,
  manifest: (exam: string, locale?: string) =>
    ["smriti", "content", "manifest", exam, locale ?? null] as const,
  pet: () => ["smriti", "pet"] as const,
  plant: () => ["smriti", "plant"] as const,
  shop: () => ["smriti", "shop"] as const,
  gemLedger: () => ["smriti", "gems", "ledger"] as const,
  quests: () => ["smriti", "quests"] as const,
  badges: () => ["smriti", "badges"] as const,
  merge: (id: string) => ["smriti", "account", "merge", id] as const,
  // Practice, PYQs, mocks and attempts (practice flow)
  /** Prefixes: invalidating one covers every query under it (any exam, any filter). */
  practiceAll: () => ["smriti", "practice"] as const,
  mocksAll: () => ["smriti", "mocks"] as const,
  dailyChallengeAll: () => ["smriti", "daily-challenge"] as const,
  practiceLimits: () => ["smriti", "practice", "limits"] as const,
  practiceHub: (exam?: string) => ["smriti", "practice", "hub", exam ?? null] as const,
  weakSpots: (exam?: string) => ["smriti", "practice", "weak-spots", exam ?? null] as const,
  drill: (query: object) => ["smriti", "practice", "drill", query] as const,
  practiceSessions: () => ["smriti", "practice", "sessions"] as const,
  practiceSession: (id: string) => ["smriti", "practice", "sessions", id] as const,
  pyqPapers: (query: object) => ["smriti", "pyq", "papers", query] as const,
  pyqPaper: (id: string) => ["smriti", "pyq", "paper", id] as const,
  pyq: (query: object) => ["smriti", "pyq", "questions", query] as const,
  mocks: (exam?: string) => ["smriti", "mocks", exam ?? null] as const,
  mock: (id: string) => ["smriti", "mocks", "detail", id] as const,
  attempts: () => ["smriti", "attempts"] as const,
  attempt: (id: string) => ["smriti", "attempts", id] as const,
  report: (id: string) => ["smriti", "attempts", id, "report"] as const,
  solutions: (id: string, locale?: string) =>
    ["smriti", "attempts", id, "solutions", locale ?? null] as const,
  dailyChallenge: (exam?: string) => ["smriti", "daily-challenge", "today", exam ?? null] as const,
  dailyLeaderboard: (id: string) => ["smriti", "daily-challenge", id, "leaderboard"] as const,
  // Tutor
  tutorSessions: () => ["smriti", "tutor", "sessions"] as const,
  tutorSession: (id: string) => ["smriti", "tutor", "sessions", id] as const,
  // Billing, guardian, devices and notifications
  entitlement: () => ["smriti", "billing", "entitlement"] as const,
  introEligibility: () => ["smriti", "billing", "intro-eligibility"] as const,
  subscription: () => ["smriti", "billing", "subscription"] as const,
  myConsent: () => ["smriti", "guardian", "consent"] as const,
  consentRequest: (ref: string) => ["smriti", "guardian", "consent-requests", ref] as const,
  learners: () => ["smriti", "guardian", "learners"] as const,
  notificationPrefs: () => ["smriti", "notification-prefs"] as const,
  webPushKey: () => ["smriti", "notifications", "web-push-key"] as const,
};

export function invalidate(qc: QueryClient, ...keys: ReadonlyArray<readonly unknown[]>) {
  return Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
}
