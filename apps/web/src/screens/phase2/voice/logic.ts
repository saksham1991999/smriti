/**
 * G-2 voice tutor logic (AI-13 to AI-15), free of the DOM so it can be tested: captions from the
 * live transcription, the time left, end reasons and the reconnect window.
 */
import type { Schemas } from "@smriti/api-client";

export type VoiceQuota = Schemas["VoiceQuota"];
export type VoiceSessionOut = Schemas["VoiceSessionOut"];
export type ApiEndReason = Schemas["VoiceSessionEnd"]["end_reason"];
/** Why a call ended, as the screen knows it. */
export type EndCause = "user" | "session_cap" | "daily_cap" | "network" | "background" | "phone_call" | "error";
export type PetState = "listening" | "thinking" | "speaking" | "interrupted";

export interface CaptionLine {
  role: "student" | "tutor";
  text: string;
  /** Still being spoken (fragments are appended to it). */
  open: boolean;
  /** The tutor was interrupted: the line ends with "…". */
  cut: boolean;
  at_ms: number;
}

export type CaptionEvent = { type: "input"; text: string; at_ms: number } | { type: "output"; text: string; at_ms: number } | { type: "interrupted" } | { type: "turn_complete" };

const join = (a: string, b: string) => (a && b && !/\s$/.test(a) && !/^[\s.,!?।]/.test(b) ? `${a} ${b}` : a + b);

/** Appends live transcription fragments to the open line of the same speaker, or starts a new one. */
export function captionsReduce(lines: CaptionLine[], e: CaptionEvent): CaptionLine[] {
  const last = lines[lines.length - 1];
  switch (e.type) {
    case "input":
    case "output": {
      const role = e.type === "input" ? "student" : "tutor";
      const text = e.text.replace(/\s+/g, " ");
      if (!text.trim()) return lines;
      if (last && last.open && last.role === role) return [...lines.slice(0, -1), { ...last, text: join(last.text, text) }];
      const closed = last?.open ? [...lines.slice(0, -1), { ...last, open: false }] : lines;
      return [...closed, { role, text: text.trim(), open: true, cut: false, at_ms: e.at_ms }];
    }
    case "interrupted":
      return last && last.role === "tutor" && last.open ? [...lines.slice(0, -1), { ...last, open: false, cut: true }] : lines;
    case "turn_complete":
      return lines.map((l) => (l.open ? { ...l, open: false } : l));
  }
}

/** The last `n` lines for the captions panel; a cut tutor line ends with "…". */
export function visibleCaptions(lines: CaptionLine[], n = 4): { role: CaptionLine["role"]; text: string }[] {
  return lines.slice(-n).map((l) => ({ role: l.role, text: l.cut ? `${l.text.replace(/[.…\s]+$/, "")}…` : l.text }));
}

/** What the server keeps as the transcript (turns with text only). */
export function transcriptTurns(lines: CaptionLine[]): Schemas["TranscriptTurn"][] {
  return lines.filter((l) => l.text.trim()).map((l) => ({ role: l.role, text: (l.cut ? `${l.text}…` : l.text).slice(0, 4000), at_ms: Math.max(0, Math.min(86_400_000, Math.round(l.at_ms))) }));
}

/** "{n} min of voice left today": whole minutes, rounded down, never negative. */
export function minutesLeft(remainingSeconds: number | null | undefined): number | null {
  if (remainingSeconds === null || remainingSeconds === undefined) return null;
  return Math.max(0, Math.floor(remainingSeconds / 60));
}

/** The API's end reason and the analytics catalogue's for a cause. */
export function endReasons(cause: EndCause): { api: ApiEndReason; analytics: "user" | "cap" | "network" | "background" | "call" | "error" } {
  switch (cause) {
    case "session_cap":
    case "daily_cap":
      return { api: cause, analytics: "cap" };
    case "phone_call":
      return { api: "phone_call", analytics: "call" };
    case "error":
      return { api: "network", analytics: "error" };
    default:
      return { api: cause, analytics: cause };
  }
}

/** AI-15's variant: a dropped call and a time cap both lead with Continue in text. */
export function endKind(cause: EndCause): "normal" | "dropped" | "time_cap" {
  if (cause === "network" || cause === "error") return "dropped";
  if (cause === "session_cap" || cause === "daily_cap") return "time_cap";
  return "normal";
}

/** Still inside the reconnect window (`voice.reconnect_seconds`, from the quota or the flag). */
export function canReconnect(droppedAt: number, now: number, reconnectSeconds: number): boolean {
  return now - droppedAt < reconnectSeconds * 1000;
}

/** The session ends at whichever comes first: this session's cap or today's remaining time. */
export function capCause(elapsedSeconds: number, session: Pick<VoiceSessionOut, "max_seconds" | "quota">): "session_cap" | "daily_cap" | null {
  if (elapsedSeconds < session.max_seconds) return null;
  const daily = session.quota.remaining_seconds;
  return daily !== null && daily <= session.max_seconds ? "daily_cap" : "session_cap";
}

/** "6:05" for the session timer (tabular figures in the UI). */
export function timer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The reset time as the student's clock shows it ("12:00 am"). */
export function resetTime(iso: string | null | undefined, locale: "en" | "hi"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { hour: "numeric", minute: "2-digit" }).format(d);
}

/** Gemini Live's model path: the server sends the configured name; the socket wants `models/…`. */
export function modelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}
