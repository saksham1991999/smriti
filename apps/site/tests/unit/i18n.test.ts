import { describe, expect, it } from "vitest";
import { en } from "../../src/i18n/en";
import { hi } from "../../src/i18n/hi";
import { fmt, list, listOr } from "../../src/i18n";

type Tree = { [k: string]: string | readonly string[] | Tree };

function leaves(t: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else if (Array.isArray(v)) v.forEach((s, i) => out.set(`${key}[${i}]`, s as string));
    else for (const [kk, vv] of leaves(v as Tree, key)) out.set(kk, vv);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("site catalogues", () => {
  const e = leaves(en as unknown as Tree);
  const h = leaves(hi as unknown as Tree);

  it("English and Hindi have exactly the same keys", () => {
    expect([...h.keys()].sort()).toEqual([...e.keys()].sort());
  });

  it("every Hindi string uses the same placeholders as English", () => {
    for (const [k, v] of e) expect(placeholders(h.get(k)!), k).toEqual(placeholders(v));
  });

  it("no string is empty", () => {
    for (const [k, v] of [...e, ...h]) expect(v.trim().length, k).toBeGreaterThan(0);
  });

  it("Hindi uses आप, never तुम (R3)", () => {
    for (const [k, v] of h) expect(/तुम/.test(v), k).toBe(false);
  });

  it("pricing copy has no countdowns or discount talk (R33)", () => {
    for (const [k, v] of [...e, ...h]) {
      if (!k.startsWith("pricing.") && !k.startsWith("faq.items.price")) continue;
      expect(/% ?off|हर दिन घटता|hurry|only today|limited time/i.test(v), k).toBe(false);
    }
  });

  it("states that prices include taxes (R38)", () => {
    expect(en.pricing.taxLine).toMatch(/taxes included/i);
    expect(hi.pricing.taxLine).toMatch(/टैक्स शामिल/);
  });
});

describe("formatting", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(fmt("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });
  it("joins lists without a serial comma", () => {
    expect(list("en", ["A", "B", "C"])).toBe("A, B and C");
    expect(list("hi", ["A", "B", "C"])).toBe("A, B और C");
    expect(listOr("en", ["NTA", "UPSC", "SSC"])).toBe("NTA, UPSC or SSC");
    expect(list("en", ["A"])).toBe("A");
    expect(list("en", [])).toBe("");
  });
});
