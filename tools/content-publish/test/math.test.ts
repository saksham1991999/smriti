import { describe, expect, it } from "vitest";

import { buildMathMap, collectMath, MathError, renderMath } from "../src/math.js";

describe("maths rendering", () => {
  it("renders TeX to a self-contained currentColor SVG", () => {
    const m = renderMath("x = \\frac{y - 1}{2}", true);
    expect(m.svg.startsWith("<svg")).toBe(true);
    expect(m.svg).toContain("currentColor");
    expect(m.svg).not.toContain("<use");
    expect(m.width_ex).toBeGreaterThan(0);
    expect(m.height_ex).toBeGreaterThan(0);
  });

  it("supports chemistry through mhchem", () => {
    expect(renderMath("\\ce{H2O}", false).svg).toContain("<svg");
  });

  it("refuses TeX that KaTeX cannot parse", () => {
    expect(() => renderMath("\\frac{1}{", false)).toThrow(MathError);
    expect(() => renderMath("\\notacommand", false)).toThrow(MathError);
  });

  it("collects maths from text, latex fields and formula symbols", () => {
    const keys = [
      ...collectMath({
        body: "a $x^2$ and $$y$$",
        latex: "E = mc^2",
        symbols: [{ symbol: "v", meaning: "speed" }],
        id: "$not-maths$",
      }).keys(),
    ].sort();
    expect(keys).toEqual(["$$E = mc^2$$", "$$y$$", "$v$", "$x^2$"]);
    expect(Object.keys(buildMathMap({ t: "$a$" }))).toEqual(["$a$"]);
  });
});
