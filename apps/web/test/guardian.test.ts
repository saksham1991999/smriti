import { describe, expect, it } from "vitest";
import { scopeAllowed, type MyConsent } from "../src/lib/guardian";
import { mergeAddedSomething, mergeResult, parseStats } from "../src/lib/merge";

const consent = (over: Partial<MyConsent>): MyConsent => ({
  age_band: "13_17",
  consent_id: null,
  consented_at: null,
  needs_consent: true,
  pending_request_id: null,
  pending_link_requests: 0,
  retry_at: null,
  scopes: [],
  state: "required",
  ...over,
});

describe("scopeAllowed", () => {
  it("lets adults through without a consent record", () => {
    expect(scopeAllowed(consent({ age_band: "18p", state: "not_required" }), "social")).toBe(true);
  });
  it("needs a granted consent with the scope for a teen", () => {
    expect(scopeAllowed(consent({}), "social")).toBe(false);
    const granted = consent({
      state: "granted",
      needs_consent: false,
      scopes: ["account", "social"],
    });
    expect(scopeAllowed(granted, "social")).toBe(true);
    expect(scopeAllowed(granted, "voice")).toBe(false);
  });
  it("is closed while the consent is still loading", () => {
    expect(scopeAllowed(undefined, "social")).toBe(false);
  });
});

describe("merge notice", () => {
  it("reads the server's stats and hides an empty merge", () => {
    const done = mergeResult("m1", {
      status: "done",
      stats: { lessons_added: 3, xp_added: 40, streak_after: 5, pet_kept: "account" },
    });
    expect(done.stats).toEqual({
      lessonsAdded: 3,
      xpAdded: 40,
      streakAfter: 5,
      petKept: "account",
    });
    expect(mergeAddedSomething(done)).toBe(true);
    const empty = mergeResult("m2", {
      status: "done",
      stats: { lessons_added: 0, xp_added: 0, streak_after: 2, pet_kept: "account" },
    });
    expect(mergeAddedSomething(empty)).toBe(false);
  });
  it("shows a running or failed merge as pending", () => {
    expect(mergeResult("m3", { status: "running", stats: null }).status).toBe("pending");
    expect(mergeResult("m4", { status: "failed", stats: null }).status).toBe("pending");
    expect(mergeResult("m5", null).status).toBe("pending");
  });
  it("ignores unknown stat values", () => {
    expect(parseStats({ lessons_added: "3", pet_kept: "robot" })).toEqual({
      lessonsAdded: 0,
      xpAdded: 0,
      streakAfter: 0,
      petKept: null,
    });
  });
});
