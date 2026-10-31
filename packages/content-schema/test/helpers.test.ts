import { describe, expect, it } from "vitest";

import { blankIds, convertUnit, isI18nText, localize, MissingLocaleError, splitMath } from "../src/index.js";
import { findCycles } from "../src/check/index.js";

describe("localize", () => {
  it("resolves localised text, lists and refs, leaving other values", () => {
    const doc = {
      title: { en: "A", hi: "अ" },
      list: { en: ["x"], hi: ["य"] },
      ids: [{ id: "a", text: { en: "Option A", hi: "विकल्प A" } }],
      pairs: [{ item: "i1", bin: "b1" }],
      depth: 2,
    };
    expect(localize(doc, "hi")).toEqual({
      title: "अ",
      list: ["य"],
      ids: [{ id: "a", text: "विकल्प A" }],
      pairs: [{ item: "i1", bin: "b1" }],
      depth: 2,
    });
  });

  it("throws on a missing locale with its path", () => {
    expect(() => localize({ a: [{ t: { en: "x" } }] }, "hi")).toThrow(MissingLocaleError);
    try {
      localize({ a: [{ t: { en: "x" } }] }, "hi");
    } catch (e) {
      expect((e as MissingLocaleError).path).toBe("/a/0/t");
    }
  });

  it("only treats known locale keys as localised text", () => {
    expect(isI18nText({ en: "x" })).toBe(true);
    expect(isI18nText({ id: "x" })).toBe(false);
    expect(isI18nText({ item: "i1", bin: "b1" })).toBe(false);
  });
});

describe("splitMath", () => {
  it("splits inline and display maths", () => {
    expect(splitMath("a $x^2$ b $$y$$")).toEqual([
      { kind: "text", value: "a ", display: false, key: "a " },
      { kind: "math", value: "x^2", display: false, key: "$x^2$" },
      { kind: "text", value: " b ", display: false, key: " b " },
      { kind: "math", value: "y", display: true, key: "$$y$$" },
    ]);
  });

  it("keeps escaped and unclosed dollars as text", () => {
    expect(splitMath("costs \\$5")).toEqual([{ kind: "text", value: "costs $5", display: false, key: "costs $5" }]);
    expect(splitMath("a $ b")).toEqual([{ kind: "text", value: "a $ b", display: false, key: "a $ b" }]);
  });
});

describe("blanks and units", () => {
  it("finds blank tokens in order", () => {
    expect(blankIds("a {{blank:b1}} b {{blank:b2}}")).toEqual(["b1", "b2"]);
  });

  it("converts within a dimension only", () => {
    expect(convertUnit(150, "cm", "m")).toBeCloseTo(1.5);
    expect(convertUnit(1.5, "kg", "g")).toBeCloseTo(1500);
    expect(convertUnit(0, "°C", "K")).toBeCloseTo(273.15);
    expect(convertUnit(36, "km/h", "m/s")).toBeCloseTo(10);
    expect(convertUnit(1, "m", "s")).toBeUndefined();
    expect(convertUnit(1, "furlong", "m")).toBeUndefined();
  });

  it("converts the electricity units used by lessons", () => {
    expect(convertUnit(2, "mm^2", "m^2")).toBeCloseTo(2e-6, 12);
    expect(convertUnit(1, "m²", "cm^2")).toBeCloseTo(1e4);
    expect(convertUnit(3, "kV/m", "V/m")).toBeCloseTo(3000);
    expect(convertUnit(5, "N/C", "V/m")).toBeCloseTo(5);
    expect(convertUnit(1, "A/mm^2", "A/m^2")).toBeCloseTo(1e6);
    expect(convertUnit(1.7e-6, "Ω cm", "Ω m")).toBeCloseTo(1.7e-8, 14);
    expect(convertUnit(1, "S/cm", "S/m")).toBeCloseTo(100);
    expect(convertUnit(4e-3, "°C^-1", "K^-1")).toBeCloseTo(4e-3, 9);
    expect(convertUnit(1000, "cm^2/(V s)", "m^2/(V s)")).toBeCloseTo(0.1);
    expect(convertUnit(1, "Ω m", "S/m")).toBeUndefined();
    expect(convertUnit(1, "°C^-1", "°C")).toBeUndefined();
  });

  it("converts the chemical bonding units used by lessons", () => {
    expect(convertUnit(154, "pm", "nm")).toBeCloseTo(0.154, 12);
    expect(convertUnit(788, "kJ/mol", "J/mol")).toBeCloseTo(788000);
    expect(convertUnit(1, "kJ mol^-1", "kJ/mol")).toBeCloseTo(1);
    expect(convertUnit(4.9e-30, "C·m", "C m")).toBeCloseTo(4.9e-30, 36);
    expect(convertUnit(1, "kJ/mol", "kJ")).toBeUndefined();
    expect(convertUnit(1, "C m", "C")).toBeUndefined();
  });
});

describe("findCycles", () => {
  it("finds each cycle once", () => {
    const g = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", ["a"]],
      ["d", ["a"]],
    ]);
    expect(findCycles(g)).toEqual([["a", "b", "c", "a"]]);
  });

  it("returns nothing for a DAG", () => {
    expect(findCycles(new Map([["a", ["b"]], ["b", []]]))).toEqual([]);
  });
});
