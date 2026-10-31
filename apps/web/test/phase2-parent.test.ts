import { describe, expect, it } from "vitest";
import type { Schemas } from "@smriti/api-client";
import { barHeights, busiestDay, canGoNext, changes, consentRows, friendName, hoursValid, isLittle, limitBucket, needs, shiftWeek, toControls, toForm, weekStart, type ChildCard } from "../src/screens/phase2/parent/logic";

const controls = (over: Partial<Schemas["ControlsOut"]> = {}): Schemas["ControlsOut"] => ({
  learner_user_id: "c1",
  daily_limit_min: null,
  allowed_from: null,
  allowed_to: null,
  break_reminders: false,
  ask_before_switching: false,
  picture_rhymes: false,
  tutor_button: false,
  tutor_enabled: true,
  social_enabled: false,
  weekly_report: true,
  ...over,
});

describe("weeks (SET-15)", () => {
  it("starts weeks on Monday and moves a week at a time", () => {
    expect(weekStart(new Date(2026, 9, 31))).toBe("2026-10-26"); // a Saturday
    expect(weekStart(new Date(2026, 10, 1))).toBe("2026-10-26"); // a Sunday
    expect(weekStart(new Date(2026, 10, 2))).toBe("2026-11-02"); // a Monday
    expect(shiftWeek("2026-10-26", -1)).toBe("2026-10-19");
    expect(shiftWeek("2026-12-28", 1)).toBe("2027-01-04");
  });

  it("doesn't go past the current week", () => {
    const today = new Date(2026, 9, 31);
    expect(canGoNext("2026-10-19", today)).toBe(true);
    expect(canGoNext("2026-10-26", today)).toBe(false);
  });

  it("summarises the chart by its busiest day and scales bars to it", () => {
    const days = [
      { day: "2026-10-26", minutes: 10 },
      { day: "2026-10-27", minutes: 40 },
      { day: "2026-10-28", minutes: 0 },
    ];
    expect(busiestDay(days)).toEqual({ day: "2026-10-27", minutes: 40 });
    expect(barHeights(days)).toEqual([25, 100, 0]);
    expect(busiestDay([{ day: "2026-10-26", minutes: 0 }])).toBeNull();
    expect(barHeights([{ day: "2026-10-26", minutes: 0 }])).toEqual([0]);
  });
});

describe("dashboard (SET-14)", () => {
  const card = (over: Partial<ChildCard>): ChildCard => ({ user_id: "c", first_name: "A", kind: "managed", age_band: "u10", is_pro: false, needs_you: false, consent_pending: false, practice_questions: 0, streak: 0, week_minutes: 0, ...over });
  it("lists pending time requests and consent requests, and nothing already decided", () => {
    const tr = (id: string, status: Schemas["TimeRequestOut"]["status"]) => ({ id, learner_user_id: "a", minutes: 15, for_date: "2026-10-31", status, created_at: "" });
    const list = needs([card({ user_id: "a", time_requests: [tr("r1", "pending"), tr("r2", "allowed")] }), card({ user_id: "b", consent_pending: true })]);
    expect(list.map((n) => [n.kind, n.child.user_id, n.kind === "time" ? n.requestId : null])).toEqual([
      ["time", "a", "r1"],
      ["consent", "b", null],
    ]);
  });
  it("treats only class 1 to 5 as little learners", () => {
    expect(isLittle("u10")).toBe(true);
    expect(isLittle("10_12")).toBe(false);
    expect(isLittle(null)).toBe(false);
  });
});

describe("time limits (SET-16)", () => {
  it("round-trips the controls and keeps consent switches as they were", () => {
    const base = controls({ daily_limit_min: 45, allowed_from: "07:00:00", allowed_to: "20:30:00", break_reminders: true });
    const f = toForm(base);
    expect(f).toMatchObject({ limit: 45, hoursOn: true, from: "07:00", to: "20:30", breaks: true });
    expect(toControls({ ...f, hoursOn: false, limit: null }, base)).toEqual({
      daily_limit_min: null,
      allowed_from: null,
      allowed_to: null,
      break_reminders: true,
      ask_before_switching: false,
      picture_rhymes: false,
      tutor_button: false,
      weekly_report: true,
      tutor_enabled: true,
      social_enabled: false,
    });
  });
  it("needs the start before the end when hours are on", () => {
    expect(hoursValid({ hoursOn: false, from: "", to: "" })).toBe(true);
    expect(hoursValid({ hoursOn: true, from: "07:00", to: "21:00" })).toBe(true);
    expect(hoursValid({ hoursOn: true, from: "21:00", to: "07:00" })).toBe(false);
    expect(hoursValid({ hoursOn: true, from: "", to: "07:00" })).toBe(false);
  });
  it("reports what changed in buckets, never exact times", () => {
    const before = toForm(controls());
    const after = { ...before, limit: 60 as const, hoursOn: true, from: "06:00", to: "22:00", pictureRhymes: true };
    expect(changes(before, after)).toEqual([
      { limit_type: "daily_limit", value_bucket: "45_60" },
      { limit_type: "allowed_hours", value_bucket: "on" },
      { limit_type: "picture_rhymes", value_bucket: "on" },
    ]);
    expect(changes(before, before)).toEqual([]);
    expect([null, 15, 30, 45, 90, 120].map((l) => limitBucket(l as never))).toEqual(["off", "15_30", "15_30", "45_60", "90_120", "90_120"]);
  });
});

describe("consents (SET-17)", () => {
  const consent = (scopes: Schemas["ConsentOut"]["scopes"], revoked: string | null = null): Schemas["ConsentOut"] => ({ id: "k", learner_user_id: "c", scopes, consented_at: "2026-09-01T00:00:00Z", revoked_at: revoked, method: "m", notice_version: "v", age_assurance: "a" });
  it("shows every scope for a teen, and the saved account can't be turned off", () => {
    const rows = consentRows(consent(["account", "social"]), "13_17");
    expect(rows.map((r) => [r.scope, r.allowed, r.canTurnOff])).toEqual([
      ["account", true, false],
      ["social", true, true],
      ["community", false, false],
      ["voice", false, false],
      ["uploads", false, false],
    ]);
    expect(rows[1]?.since).toBe("2026-09-01T00:00:00Z");
  });
  it("hides social and sharing for under-13s and treats a revoked consent as none", () => {
    expect(consentRows(consent(["account", "voice"]), "u10").map((r) => r.scope)).toEqual(["account", "voice", "uploads"]);
    expect(consentRows(consent(["account"], "2026-10-01T00:00:00Z"), "13_17").every((r) => !r.allowed)).toBe(true);
    expect(consentRows(null, "13_17").every((r) => !r.allowed)).toBe(true);
  });
  it("names friends by their shown name only", () => {
    const p = (kind: Schemas["Name"]["kind"], text: string | null) => ({ user_id: "f", name: { kind, text }, can_add_friend: false, is_self: false });
    expect(friendName(p("nickname", "Nick"))).toBe("Nick");
    expect(friendName(p("hidden", "Secret"))).toBeNull();
    expect(friendName(p("deleted", null))).toBeNull();
  });
});
