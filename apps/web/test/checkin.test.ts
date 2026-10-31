import { describe, expect, it } from "vitest";
import { chooseCheckin, dayDiff, type CheckinFacts } from "../src/lib/checkin";

const base: CheckinFacts = {
  today: "2026-10-20",
  lastOpen: "2026-10-17",
  lastShown: null,
  onboardedOn: "2026-09-01",
  health: "dry",
  restDay: null,
  longGapDays: 30,
};

describe("ENT-08 check-in choice", () => {
  it("counts whole days", () => {
    expect(dayDiff("2026-10-17", "2026-10-20")).toBe(3);
    expect(dayDiff("2026-02-27", "2026-03-02")).toBe(3);
  });

  it("shows comeback for a droopy or dry plant after a missed day", () => {
    expect(chooseCheckin(base)).toEqual({ variant: "comeback", tone: "comeback", daysAway: 3 });
    expect(chooseCheckin({ ...base, health: "droopy", lastOpen: "2026-10-18" })?.variant).toBe("comeback");
  });

  it("shows resting for a wilted or dormant plant", () => {
    expect(chooseCheckin({ ...base, health: "wilted" })?.variant).toBe("resting");
    expect(chooseCheckin({ ...base, health: "dormant" })?.tone).toBe("resting");
  });

  it("shows the long break variant from the long-gap flag, keeping the plant's tone", () => {
    expect(chooseCheckin({ ...base, lastOpen: "2026-09-20", health: "dormant" })).toEqual({ variant: "long_break", tone: "resting", daysAway: 30 });
    expect(chooseCheckin({ ...base, lastOpen: "2026-09-21", health: "dormant" })?.variant).toBe("resting");
  });

  it("stays quiet when nothing was missed, it was shown today, on onboarding day, or a thriving plant", () => {
    expect(chooseCheckin({ ...base, lastOpen: null })).toBeNull();
    expect(chooseCheckin({ ...base, lastOpen: "2026-10-19" })).toBeNull();
    expect(chooseCheckin({ ...base, lastShown: "2026-10-20" })).toBeNull();
    expect(chooseCheckin({ ...base, onboardedOn: "2026-10-20" })).toBeNull();
    expect(chooseCheckin({ ...base, health: "thriving" })).toBeNull();
    expect(chooseCheckin({ ...base, health: null })).toBeNull();
  });

  it("never shows for a planned rest day (R28)", () => {
    expect(chooseCheckin({ ...base, lastOpen: "2026-10-18", restDay: "2026-10-19" })).toBeNull();
    expect(chooseCheckin({ ...base, lastOpen: "2026-10-17", restDay: "2026-10-19" })?.variant).toBe("comeback");
  });
});
