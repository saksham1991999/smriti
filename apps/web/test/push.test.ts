import { describe, expect, it } from "vitest";
import { hhmm, openedDeepLink } from "../src/lib/push";

describe("push deep links", () => {
  it("maps the server's app paths onto web routes", () => {
    expect(openedDeepLink("/home")).toBe("/learn");
    expect(openedDeepLink("/review?set=rescue")).toBe("/review");
    expect(openedDeepLink("/challenge")).toBe("/practice/challenge");
    expect(openedDeepLink("/mock/bp:x:paper-1")).toBe("/practice/mock/bp:x:paper-1");
    expect(openedDeepLink("/mock/bp:x:paper-1/report")).toBe("/practice/mocks");
    expect(openedDeepLink("/duel/AB12CD")).toBe("/social/duel/AB12CD");
    expect(openedDeepLink("/pro/manage")).toBe("/me/plan");
    expect(openedDeepLink("/guardian/requests/1")).toBe("/guardian/link");
    expect(openedDeepLink(undefined)).toBe("/learn");
  });
  it("shows server times as hours and minutes", () => {
    expect(hhmm("19:00:00")).toBe("19:00");
    expect(hhmm(null)).toBeNull();
  });
});
