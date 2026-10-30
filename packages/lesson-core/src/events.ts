/**
 * Lesson events, typed to docs/contracts/sync.md (v1). lesson-core produces payloads; the session
 * wraps them in the sync envelope; app-core's outbox sends them.
 */
import type { EventResponse } from "./answers.js";

export type Confidence = "sure" | "fifty_fifty" | "guess";
export type EventLessonMode = "deep_dive" | "quick_revision" | "onboarding" | "quick_check";
export type AnswerContext = "lesson" | "practice" | "review" | "challenge" | "chapter_test";

export interface LessonStartedPayload {
  topic_id: string;
  mode: EventLessonMode;
  bundle_version: string;
  locale: string;
}

export interface LessonCardViewedPayload {
  topic_id: string;
  card_id: string;
  index: number;
  ms_on_card: number;
}

export type AnswerSubmittedPayload = {
  topic_id: string;
  context: AnswerContext;
  /** Option ids, a number or matched keys; null for "I don't know yet". Never typed text. */
  response: EventResponse;
  correct: boolean;
  attempt: 1 | 2;
  confidence: Confidence | null;
  ms_to_answer: number;
} & ({ card_id: string; question_id?: never } | { question_id: string; card_id?: never });

export interface LessonCompletedPayload {
  topic_id: string;
  mode: EventLessonMode;
  cards_seen: number;
  correct: number;
  total: number;
  ms_total: number;
  xp: number;
}

export type LessonEvent =
  | { type: "lesson_started"; payload: LessonStartedPayload }
  | { type: "lesson_card_viewed"; payload: LessonCardViewedPayload }
  | { type: "answer_submitted"; payload: AnswerSubmittedPayload }
  | { type: "lesson_completed"; payload: LessonCompletedPayload };

/** An event with the time it happened (ms since the epoch), before it gets an id. */
export type TimedEvent = LessonEvent & { at: number };

/** The sync envelope (sync.md "Envelope"). */
export interface EventEnvelope<E extends LessonEvent = LessonEvent> {
  event_id: string;
  type: E["type"];
  occurred_at: string;
  tz: string;
  payload: E["payload"];
}

/**
 * UUID version 7 (RFC 9562): 48-bit Unix ms timestamp, then random bits. Sortable by time, which
 * keeps the outbox and the server's event table in order.
 */
export function uuidv7(now: number, random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(16);
  let ts = Math.floor(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function defaultRandom(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto;
  if (!c) throw new Error("no crypto.getRandomValues: pass a random source");
  return c.getRandomValues(out);
}

export function envelope<E extends LessonEvent>(e: E & { at: number }, tz: string, id: string): EventEnvelope<E> {
  return { event_id: id, type: e.type, occurred_at: new Date(e.at).toISOString(), tz, payload: e.payload };
}
