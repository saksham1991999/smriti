import { describe, expect, it } from "vitest";
import { band, bandsFrom, countWords, gapsOf, overall, sinceLastTime, type FeynmanResult } from "../src/screens/phase2/feynman/logic";
import { gapCardId } from "../src/screens/phase2/feynman/gaps";
import { helplinesFrom } from "../src/screens/phase2/shared/Safety";
import { createPhase2Handlers } from "../src/dev/fake-api/phase2";
import { getResponse } from "msw";

const bands = { getting_there: 40, clear: 70 };
const kp = (index: number, status: "covered" | "missing" | "misconception") => ({ index, status, text: { en: `Fixture key point ${index}`, hi: `फ़िक्स्चर ${index}` }, note: null });

describe("Feynman bands (AI-11)", () => {
  it("reads the server's thresholds and falls back on bad values", () => {
    expect(bandsFrom({ getting_there: 30, clear: 60 })).toEqual({ getting_there: 30, clear: 60 });
    expect(bandsFrom({ getting_there: 80, clear: 60 })).toEqual(bands);
    expect(bandsFrom("nonsense")).toEqual(bands);
  });

  it("puts a score in a band at the thresholds", () => {
    expect(band(39, bands)).toBe("needs_work");
    expect(band(40, bands)).toBe("getting_there");
    expect(band(69, bands)).toBe("getting_there");
    expect(band(70, bands)).toBe("clear");
  });

  it("reacts to the weakest meter", () => {
    expect(overall({ clarity: 90, completeness: 80, accuracy: 75 }, bands)).toBe("all_clear");
    expect(overall({ clarity: 90, completeness: 50, accuracy: 75 }, bands)).toBe("mixed");
    expect(overall({ clarity: 90, completeness: 10, accuracy: 75 }, bands)).toBe("needs_work");
  });
});

describe("Feynman text and history", () => {
  it("counts English and Hindi words, a word with vowel signs once", () => {
    expect(countWords("Force equals mass times acceleration.")).toBe(5);
    expect(countWords("बल द्रव्यमान और त्वरण का गुणनफल है")).toBe(7);
    expect(countWords("  ")).toBe(0);
  });

  it("shows a rise since last time only when the average went up", () => {
    const now = { clarity: 70, completeness: 60, accuracy: 80 };
    expect(sinceLastTime({ ...now, previous: { clarity: 50, completeness: 50, accuracy: 50 } })).toBe(20);
    expect(sinceLastTime({ ...now, previous: { clarity: 90, completeness: 90, accuracy: 90 } })).toBeNull();
    expect(sinceLastTime({ ...now, previous: null })).toBeNull();
  });

  it("splits missed points from misconceptions", () => {
    const g = gapsOf({ key_points: [kp(0, "covered"), kp(1, "missing"), kp(2, "misconception")] });
    expect(g.missed.map((k) => k.index)).toEqual([1]);
    expect(g.wrong.map((k) => k.index)).toEqual([2]);
  });

  it("gives each gap a stable, UUID-shaped card id", () => {
    const a = gapCardId("0190f3b2-6a1c-7d2e-9f00-112233445566", 2);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(gapCardId("0190f3b2-6a1c-7d2e-9f00-112233445566", 2)).toBe(a);
    expect(gapCardId("0190f3b2-6a1c-7d2e-9f00-112233445566", 3)).not.toBe(a);
  });

  it("keeps only helpline rows with a name and a number", () => {
    expect(helplinesFrom([{ name: "Line", number: "123" }, { name: "No number" }, "x"])).toEqual([{ name: "Line", number: "123", description: null }]);
    expect(helplinesFrom(null)).toEqual([]);
  });
});

describe("fake API: Feynman grading", () => {
  const user = { id: "u1", isAnonymous: false, email: null, name: null, createdAt: 0, deletedAt: null, version: 1, locale: "en" as const, events: [], entitlement: { plan: "pro", pro_until: null }, introClaimed: false, guardianConsent: false };
  const content: Record<string, unknown> = {
    "manifests/fx-exam-2027.en.json": { topics: { "fx.chapter-a.topic-a": { bundles: { deep_dive: { path: "bundles/en.json" } } } } },
    "manifests/fx-exam-2027.hi.json": { topics: { "fx.chapter-a.topic-a": { bundles: { deep_dive: { path: "bundles/hi.json" } } } } },
    "bundles/en.json": { concepts: [{ id: "fx.chapter-a.topic-a.sub-1.concept-1", key_points: ["Fixture key point A1.1", "Fixture key point A1.2"] }] },
    "bundles/hi.json": { concepts: [{ id: "fx.chapter-a.topic-a.sub-1.concept-1", key_points: ["फ़िक्स्चर 1", "फ़िक्स्चर 2"] }] },
  };
  const handlers = createPhase2Handlers({
    url: (p) => `http://api.test${p}`,
    authed: () => user as never,
    unauthorized: () => new Response(null, { status: 401 }),
    now: () => 0,
    loadContent: async (p) => content[p],
    users: () => ({}),
  });
  const post = (body: unknown) => getResponse(handlers, new Request("http://api.test/v1/feynman/attempts", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

  it("rejects a short explanation with the minimum", async () => {
    const res = await post({ client_attempt_id: crypto.randomUUID(), concept_id: "fx.chapter-a.topic-a.sub-1.concept-1", explanation: "too short", input_mode: "text" });
    expect(res?.status).toBe(422);
    expect(await res?.json()).toMatchObject({ code: "too_short", min_words: 30 });
  });

  it("grades from the bundle's key points and remembers the last score", async () => {
    const first = (await (await post({ client_attempt_id: crypto.randomUUID(), concept_id: "fx.chapter-a.topic-a.sub-1.concept-1", explanation: words(40), input_mode: "text" }))?.json()) as FeynmanResult;
    expect(first.key_points.map((k) => k.status)).toEqual(["covered", "missing"]);
    expect(first.key_points[1]?.text.hi).toBe("फ़िक्स्चर 2");
    expect(first.previous).toBeNull();
    const second = (await (await post({ client_attempt_id: crypto.randomUUID(), concept_id: "fx.chapter-a.topic-a.sub-1.concept-1", explanation: words(90), input_mode: "text" }))?.json()) as FeynmanResult;
    expect(second.completeness).toBe(100);
    expect(second.previous).toMatchObject({ completeness: first.completeness });
  });
});
