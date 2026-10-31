/**
 * Live mock rules (MOCK-03, MOCK-24), free of React. All times are the server's: the room's
 * `server_time` (and each SSE `hello` and `clock`) gives the offset between the server clock and
 * this device, and every countdown runs on `Date.now() + offset`, so a wrong device clock never
 * moves a window (practice §6.11).
 */
import type { Schemas } from "@smriti/api-client";

export type Room = Schemas["LiveRoom"];

/** Server minus device, in ms. */
export const clockOffset = (serverIso: string, deviceNow: number) => Date.parse(serverIso) - deviceNow;

/** "01:02:03" for the start countdown (hours always shown), "02:03" (hh:mm) for the closing one. */
export function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
export function hm(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export type Countdown = { kind: "starts"; ms: number } | { kind: "closes"; ms: number } | { kind: "none" };

/** What the window card counts down to at server time `now`. */
export function countdown(room: Pick<Room, "window_start" | "window_end">, now: number): Countdown {
  const start = Date.parse(room.window_start);
  const end = Date.parse(room.window_end);
  if (now < start) return { kind: "starts", ms: start - now };
  if (now < end) return { kind: "closes", ms: end - now };
  return { kind: "none" };
}

/** The phase the room shows, from the server's status, the student's attempt and the clock. */
export type Phase = "scheduled" | "open" | "taken" | "closed" | "results";
export function phase(room: Pick<Room, "status" | "attempt_status" | "window_start" | "window_end" | "ranks_published">, now: number): Phase {
  if (room.status === "results" || room.ranks_published) return "results";
  const taken = room.attempt_status === "submitted" || room.attempt_status === "auto_submitted";
  if (taken) return "taken";
  if (room.status === "closed" || now >= Date.parse(room.window_end)) return "closed";
  if (room.status === "live" || now >= Date.parse(room.window_start)) return "open";
  return "scheduled";
}

/** Minutes a start now would get, when that's less than the full paper (MOCK-03 late start). */
export function lateMinutes(room: Pick<Room, "full_duration_until" | "deadline_if_started_now">, now: number): number | null {
  if (!room.full_duration_until || !room.deadline_if_started_now) return null;
  if (now <= Date.parse(room.full_duration_until)) return null;
  return Math.max(0, Math.floor((Date.parse(room.deadline_if_started_now) - now) / 60_000));
}

/** One live-mock SSE event, typed. Unknown events are dropped. */
export type LiveEvent =
  | { type: "hello"; serverTime: string }
  | { type: "start"; serverTime: string }
  | { type: "clock"; serverTime: string; remainingS: number | null }
  | { type: "closed"; serverTime: string }
  | { type: "results"; serverTime: string };

export function toLiveEvent(e: { event: string; data: string }): LiveEvent | null {
  let p: Record<string, unknown>;
  try {
    const v: unknown = e.data ? JSON.parse(e.data) : {};
    p = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return null;
  }
  const serverTime = typeof p.server_time === "string" ? p.server_time : "";
  if (!serverTime) return null;
  switch (e.event) {
    case "hello":
    case "start":
    case "closed":
    case "results":
      return { type: e.event, serverTime };
    case "clock":
      return { type: "clock", serverTime, remainingS: typeof p.remaining_s === "number" ? p.remaining_s : null };
    default:
      return null;
  }
}

/** Seconds to wait before reconnecting the event stream: 2, 4, 8 … up to 30. */
export const backoff = (attempt: number) => Math.min(30, 2 ** Math.max(1, attempt));

/** An iCalendar file for the window (MOCK-03 web: "Add to calendar" downloads it). */
export function ics(args: { id: string; title: string; start: string; end: string; now: number; url?: string }): string {
  const stamp = (iso: string | number) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Smriti//Live mock//EN",
    "BEGIN:VEVENT",
    `UID:${args.id}@live-mock`,
    `DTSTAMP:${stamp(args.now)}`,
    `DTSTART:${stamp(args.start)}`,
    `DTEND:${stamp(args.end)}`,
    `SUMMARY:${esc(args.title)}`,
    ...(args.url ? [`URL:${args.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Board rows split for MOCK-24: the top three as cards, the rest as a table. */
export function splitBoard<T extends { rank: number }>(rows: readonly T[]): { top: T[]; rest: T[] } {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  return { top: sorted.slice(0, 3), rest: sorted.slice(3) };
}

/** A localised title from the server's `{en, hi}` map. */
export const titleIn = (t: Record<string, string> | undefined, locale: string) => t?.[locale] ?? t?.en ?? Object.values(t ?? {})[0] ?? "";
