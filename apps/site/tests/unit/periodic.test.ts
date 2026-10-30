import { describe, expect, it } from "vitest";
import data from "../../src/data/elements.json";
import { gridPosition, moveFocus, type GridElement } from "../../src/islands/periodic-logic";

const els = data.elements as GridElement[];
const z = (sym: string) => els.find((e) => e.symbol === sym)!.z;

describe("periodic table data", () => {
  it("has 118 elements, numbered 1..118, each with a unique grid cell", () => {
    expect(els.length).toBe(118);
    expect(els.map((e) => e.z)).toEqual(Array.from({ length: 118 }, (_, i) => i + 1));
    const cells = new Set(els.map((e) => JSON.stringify(gridPosition(e))));
    expect(cells.size).toBe(118);
  });

  it("records its source and licence", () => {
    expect(data.$meta.source).toMatch(/PubChem/);
    expect(data.$meta.licence).toBeTruthy();
  });

  it("places the standard long form", () => {
    expect(gridPosition(els[0]!)).toEqual({ row: 1, col: 1 });
    expect(gridPosition(els[1]!)).toEqual({ row: 1, col: 18 });
    expect(gridPosition(els[z("La") - 1]!)).toEqual({ row: 9, col: 3 });
    expect(gridPosition(els[z("Lr") - 1]!)).toEqual({ row: 10, col: 17 });
    expect(gridPosition(els[z("Hf") - 1]!)).toEqual({ row: 6, col: 4 });
  });

  it("moves with arrow keys", () => {
    expect(moveFocus(els, z("Li"), "right")).toBe(z("Be"));
    expect(moveFocus(els, z("Be"), "right")).toBe(z("B"));
    expect(moveFocus(els, z("Li"), "down")).toBe(z("Na"));
    expect(moveFocus(els, z("Na"), "up")).toBe(z("Li"));
    expect(moveFocus(els, z("H"), "left")).toBe(z("H"));
    expect(moveFocus(els, z("Og"), "down")).not.toBe(z("Og"));
  });
});
