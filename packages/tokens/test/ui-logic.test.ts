import { describe, expect, it } from "vitest";
import {
  applyKeypadKey,
  createTranslator,
  formatClock,
  formatScore,
  heatCell,
  isCompleteNumber,
  keypadKeyFromKeyboard,
  limitState,
  meterAmountKey,
  paletteShapePoints,
  petImageNames,
  plantImageNames,
  ringGeometry,
  timerState,
  truncateEmailMiddle,
  uiStringsEn,
  uiStringsHi,
} from "../src/ui";

describe("strings", () => {
  it("Hindi has every English key, and nothing is empty", () => {
    expect(Object.keys(uiStringsHi).sort()).toEqual(Object.keys(uiStringsEn).sort());
    for (const v of [...Object.values(uiStringsEn), ...Object.values(uiStringsHi)]) expect(v.trim()).not.toBe("");
  });

  it("keeps the same placeholders in both languages", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of Object.keys(uiStringsEn) as (keyof typeof uiStringsEn)[]) expect(ph(uiStringsHi[k]), k).toBe(ph(uiStringsEn[k]));
  });

  it("uses the approved Google labels and the canonical trust line (R29, R40)", () => {
    expect(uiStringsEn["google.continue"]).toBe("Continue with Google");
    expect(uiStringsHi["google.continue"]).toBe("Google के साथ जारी रखें");
    expect(uiStringsEn["auth.trust"]).toBe("We never call you or share your email.");
  });

  it("formats with overrides", () => {
    const t = createTranslator("en", { "rating.again": "Redo" });
    expect(t("rating.again")).toBe("Redo");
    expect(t("limit.of", { used: 3, limit: 30 })).toBe("3 of 30");
  });
});

describe("timer", () => {
  const start = 1_000_000;
  it("counts down through warning and final", () => {
    const base = { mode: "countdown" as const, startedAt: start, endsAt: start + 600_000, warnAtMs: 300_000, finalAtMs: 60_000 };
    expect(timerState({ ...base, now: start }).phase).toBe("default");
    expect(timerState({ ...base, now: start + 400_000 }).phase).toBe("warning");
    expect(timerState({ ...base, now: start + 550_000 }).phase).toBe("final");
    expect(timerState({ ...base, now: start + 700_000 })).toMatchObject({ phase: "done", text: "00:00" });
  });
  it("count-up never warns", () => {
    expect(timerState({ mode: "countup", startedAt: start, now: start + 9_000_000, warnAtMs: 1 }).phase).toBe("default");
  });
  it("freezes while paused", () => {
    expect(timerState({ mode: "countdown", endsAt: start + 10, now: start, paused: true, pausedMs: 65_000 })).toMatchObject({ phase: "paused", text: "01:05" });
  });
  it("formats clocks", () => {
    expect(formatClock(4_360_000)).toBe("01:12:40");
    expect(formatClock(65_000, true)).toBe("00:01:05");
  });
});

describe("keypad", () => {
  const o = { allowDecimal: true, allowNegative: true, maxLength: 6 };
  it("builds numbers and rejects invalid keys", () => {
    let v = "";
    for (const k of ["-", ".", "5"] as const) v = applyKeypadKey(v, k, o);
    expect(v).toBe("-0.5");
    expect(applyKeypadKey("1.5", ".", o)).toBe("1.5");
    expect(applyKeypadKey("12", ".", { ...o, allowDecimal: false })).toBe("12");
    expect(applyKeypadKey("123456", "7", o)).toBe("123456");
    expect(applyKeypadKey("0", "4", o)).toBe("4");
    expect(applyKeypadKey("42", "backspace", o)).toBe("4");
    expect(applyKeypadKey("42", "clear", o)).toBe("");
  });
  it("maps hardware keys and validates", () => {
    expect(keypadKeyFromKeyboard("7")).toBe("7");
    expect(keypadKeyFromKeyboard("Backspace")).toBe("backspace");
    expect(keypadKeyFromKeyboard("a")).toBeNull();
    expect(isCompleteNumber("-0.5")).toBe(true);
    expect(isCompleteNumber("3.", "decimal")).toBe(false);
    expect(isCompleteNumber("3.5", "integer")).toBe(false);
  });
});

describe("display helpers", () => {
  it("limit meter phases", () => {
    expect(limitState(3, 30).phase).toBe("in_range");
    expect(limitState(26, 30)).toMatchObject({ phase: "last_few", remaining: 4 });
    expect(limitState(30, 30).phase).toBe("full");
    expect(limitState(40, 30).used).toBe(30);
  });
  it("meter words", () => {
    expect(meterAmountKey(5)).toBe("meter.empty");
    expect(meterAmountKey(50)).toBe("meter.half");
    expect(meterAmountKey(100)).toBe("meter.full");
  });
  it("truncates emails in the middle", () => {
    expect(truncateEmailMiddle("a@b.co", 20)).toBe("a@b.co");
    expect(truncateEmailMiddle("rahul.sharma@gmail.com", 14)).toBe("rah…@gmail.com");
  });
  it("heat cells need enough answers", () => {
    expect(heatCell(72, 3, 5)).toEqual({ kind: "tooFew" });
    expect(heatCell(null, 9, 5)).toEqual({ kind: "tooFew" });
    expect(heatCell(72, 9, 5)).toEqual({ kind: "filled", percent: 72, step: 3 });
    expect(heatCell(100, 9, 5)).toMatchObject({ step: 4 });
  });
  it("ring geometry and scores", () => {
    const g = ringGeometry(56, 8, 0.5);
    expect(g.dashOffset).toBeCloseTo(g.circumference / 2);
    expect(formatScore(-12)).toBe("−12");
    expect(paletteShapePoints("square")).toBeNull();
    expect(paletteShapePoints("pentagon-up")?.[0]).toEqual([0.5, 0]);
  });
  it("pet and plant image names", () => {
    expect(petImageNames("dog", "proud")).toEqual(["dog-proud", "dog-base"]);
    expect(petImageNames("cat", "excited")).toEqual(["cat-excited", "cat-celebrate", "cat-base"]);
    expect(petImageNames("cat", "sadButHopeful", true)[0]).toBe("cat-happy");
    expect(plantImageNames("sapling", "dry")).toEqual(["plant-sapling-dry", "plant-sapling"]);
    expect(plantImageNames("tree")).toEqual(["plant-tree"]);
  });
});
