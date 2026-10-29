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
