import { describe, expect, it } from "vitest";
import { backoff, clockOffset, countdown, hm, hms, ics, lateMinutes, phase, splitBoard, titleIn, toLiveEvent } from "../src/screens/phase2/live/logic";

const T = Date.parse("2026-11-01T10:00:00Z");
const min = (n: number) => n * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const room = (over: Partial<Parameters<typeof phase>[0]> = {}) => ({
  status: "scheduled" as const,
  attempt_status: null,
  ranks_published: false,
  window_start: iso(T + min(60)),
  window_end: iso(T + min(300)),
  ...over,
});

describe("server clock (MOCK-03)", () => {
  it("measures the offset between the server and this device", () => {
    expect(clockOffset(iso(T + 90_000), T)).toBe(90_000);
    expect(clockOffset(iso(T - 5_000), T)).toBe(-5_000);
  });

  it("formats the start countdown with hours and the close countdown as hh:mm", () => {
    expect(hms(min(135) + 7_400)).toBe("02:15:07");
    expect(hms(-10)).toBe("00:00:00");
    expect(hm(min(61) + 1)).toBe("01:02");
    expect(hm(0)).toBe("00:00");
  });

  it("counts down to the start, then to the close, then stops", () => {
    const r = room();
    expect(countdown(r, T)).toEqual({ kind: "starts", ms: min(60) });
    expect(countdown(r, T + min(70))).toEqual({ kind: "closes", ms: min(230) });
    expect(countdown(r, T + min(300))).toEqual({ kind: "none" });
  });
});

describe("room phase", () => {
  it("moves from scheduled to open to closed on the server clock", () => {
    expect(phase(room(), T)).toBe("scheduled");
    expect(phase(room(), T + min(60))).toBe("open");
    expect(phase(room({ status: "live" }), T)).toBe("open");
    expect(phase(room(), T + min(300))).toBe("closed");
  });

  it("puts a submitted attempt before the clock, and published ranks before everything", () => {
    expect(phase(room({ attempt_status: "submitted" }), T + min(70))).toBe("taken");
    expect(phase(room({ attempt_status: "auto_submitted" }), T + min(400))).toBe("taken");
    expect(phase(room({ ranks_published: true, attempt_status: "submitted" }), T)).toBe("results");
    expect(phase(room({ status: "results" }), T)).toBe("results");
  });

  it("shows the late-start minutes only after the last full-time start", () => {
    const r = { full_duration_until: iso(T), deadline_if_started_now: iso(T + min(40) + 30_000) };
    expect(lateMinutes(r, T)).toBeNull();
    expect(lateMinutes(r, T + 1)).toBe(40);
    expect(lateMinutes({ full_duration_until: null, deadline_if_started_now: null }, T)).toBeNull();
  });
});

describe("live events", () => {
  it("types known events and drops the rest", () => {
    expect(toLiveEvent({ event: "hello", data: '{"server_time":"2026-11-01T10:00:00Z"}' })).toEqual({ type: "hello", serverTime: "2026-11-01T10:00:00Z" });
    expect(toLiveEvent({ event: "clock", data: '{"server_time":"x","remaining_s":12}' })).toEqual({ type: "clock", serverTime: "x", remainingS: 12 });
    expect(toLiveEvent({ event: "clock", data: '{"server_time":"x"}' })).toEqual({ type: "clock", serverTime: "x", remainingS: null });
    expect(toLiveEvent({ event: "noise", data: '{"server_time":"x"}' })).toBeNull();
    expect(toLiveEvent({ event: "start", data: "{not json" })).toBeNull();
    expect(toLiveEvent({ event: "start", data: "{}" })).toBeNull();
  });

  it("backs off 2, 4, 8 … up to 30 seconds", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoff)).toEqual([2, 2, 4, 8, 16, 30, 30]);
  });
});

describe("calendar and board", () => {
  it("writes an iCalendar event with escaped text and UTC times", () => {
    const file = ics({ id: "m1", title: "Mock, part; one", start: iso(T), end: iso(T + min(240)), now: T, url: "https://example.test/m1" });
    const lines = file.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("DTSTART:20261101T100000Z");
    expect(lines).toContain("DTEND:20261101T140000Z");
    expect(lines).toContain("SUMMARY:Mock\\, part\\; one");
    expect(lines).toContain("URL:https://example.test/m1");
    expect(file.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("splits the board into the top three and the rest, by rank", () => {
    const rows = [5, 1, 4, 2, 3].map((rank) => ({ rank }));
    expect(splitBoard(rows)).toEqual({ top: [{ rank: 1 }, { rank: 2 }, { rank: 3 }], rest: [{ rank: 4 }, { rank: 5 }] });
    expect(splitBoard([])).toEqual({ top: [], rest: [] });
  });

  it("picks the title in the reader's language, falling back to English", () => {
    expect(titleIn({ en: "A", hi: "अ" }, "hi")).toBe("अ");
    expect(titleIn({ en: "A" }, "hi")).toBe("A");
    expect(titleIn(undefined, "en")).toBe("");
  });
});
