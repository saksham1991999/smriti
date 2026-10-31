/**
 * The AI tutor on the server (`/v1/tutor`, tutor-social §A): a chat session per context, answers
 * streamed as server-sent events, the free daily limit counted there, and safety (refusals and
 * the crisis card, with helplines from the server's config only) decided there.
 */
import { create } from "zustand";
import { unwrap, type Schemas } from "@smriti/api-client";
import type { Services } from "../boot/services";

export type TutorSession = Schemas["TutorSession"];
export type TutorQuota = Schemas["QuotaOut"];

/** What the tutor is asked about: `card:{topic}:{mode}:{n}`, `question:{id}`, `topic:{id}`, `lab:{id}`. */
export interface TutorContext {
  ref: string;
  kind: "card" | "question" | "topic" | "concept" | "lab";
  /** Shown on the context chip ("Asking about: …"). */
  title: string;
}

interface TutorUI {
  open: boolean;
  context: TutorContext | null;
  /** Text placed in the field, never sent until the student taps Send (HOME-05). */
  prefill: string;
  /** Screens that show AI-01 register their context here; the panel opens on it. */
  available: TutorContext | null | undefined;
  openTutor(context?: TutorContext | null, prefill?: string): void;
  close(): void;
  setAvailable(context: TutorContext | null | undefined): void;
}

export const useTutorUI = create<TutorUI>((set, get) => ({
  open: false,
  context: null,
  prefill: "",
  available: undefined,
  openTutor(context, prefill = "") {
    set({ open: true, context: context === undefined ? (get().available ?? null) : context, prefill });
  },
  close() {
    set({ open: false, prefill: "" });
  },
  setAvailable(available) {
    set({ available });
  },
}));

export interface Helpline {
  name: string;
  number: string;
  [key: string]: string;
}

export type TutorEvent =
  | { type: "session"; session_id: string; resumed: boolean }
  | { type: "delta"; text: string }
  | { type: "replace"; text: string }
  | { type: "error"; code: string; retry?: boolean }
  | { type: "citations"; items: { kind: string; id: string; title?: string | null }[] }
  | { type: "chips"; items: string[] }
  | { type: "quota"; quota: TutorQuota }
  | { type: "quota_exhausted"; quota: TutorQuota; tier: "free" | "pro_fair_use"; paywall_trigger: string | null }
  | { type: "safety"; kind: "crisis"; helplines: Helpline[] }
  | { type: "safety"; kind: "refusal"; category: string; chips: string[] }
  | { type: "safety"; kind: "redirect" | "pii_removed" }
  | { type: "done"; message_id?: string; user_message_id: string; status?: string };

/** One SSE frame (`event:` and `data:` lines) → a typed event, or null for anything else. */
export function parseFrame(frame: string): TutorEvent | null {
  let name = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(data.join("\n")) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (name) {
    case "quota":
      return { type: "quota", quota: body as unknown as TutorQuota };
    case "quota_exhausted": {
      const { tier, paywall_trigger, ...quota } = body;
      return { type: "quota_exhausted", quota: quota as unknown as TutorQuota, tier: tier === "pro_fair_use" ? "pro_fair_use" : "free", paywall_trigger: (paywall_trigger as string | null) ?? null };
    }
    case "session":
    case "delta":
    case "replace":
    case "error":
    case "citations":
    case "chips":
    case "safety":
    case "done":
      return { type: name, ...body } as TutorEvent;
    default:
      return null;
  }
}

/** Splits a byte stream into SSE frames and hands each parsed event to `onEvent`. */
export async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (e: TutorEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let cut = buf.indexOf("\n\n");
    while (cut >= 0) {
      const ev = parseFrame(buf.slice(0, cut));
      buf = buf.slice(cut + 2);
      if (ev) onEvent(ev);
      cut = buf.indexOf("\n\n");
    }
  }
  const last = parseFrame(buf);
  if (last) onEvent(last);
}

export async function openSession(s: Services, context: TutorContext | null, exam: string | null): Promise<TutorSession> {
  return unwrap(s.client.POST("/v1/tutor/sessions", { body: { mode: "chat", context_ref: context?.ref ?? null, exam } }), s.client);
}

/** Sends a message and streams the answer. Throws on a network or HTTP failure before the stream. */
export async function sendMessage(
  s: Services,
  sessionId: string,
  body: { client_message_id: string; text: string; input: "typed" | "chip" | "prefill"; chip_id?: string | null },
  onEvent: (e: TutorEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await s.client.POST("/v1/tutor/sessions/{session_id}/messages", {
    params: { path: { session_id: sessionId } },
    body,
    parseAs: "stream",
    signal,
  });
  if (!res.response.ok || !res.data) {
    const code = (res.error as { code?: string } | undefined)?.code ?? `http_${res.response.status}`;
    throw Object.assign(new Error(code), { code });
  }
  await readEvents(res.data as unknown as ReadableStream<Uint8Array>, onEvent);
}

export async function sendFeedback(s: Services, messageId: string, rating: "up" | "down", reasons: Schemas["FeedbackIn"]["reasons"] = []): Promise<boolean> {
  try {
    await unwrap(s.client.POST("/v1/tutor/messages/{message_id}/feedback", { params: { path: { message_id: messageId } }, body: { rating, reasons } }), s.client);
    return true;
  } catch {
    return false;
  }
}
