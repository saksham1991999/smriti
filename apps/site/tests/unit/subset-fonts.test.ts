import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(__dirname, "..", "..", "scripts", "subset-fonts.mjs");
const req = createRequire(join(__dirname, "..", "..", "package.json"));
const DEVA = "noto-sans-devanagari-devanagari-wght-normal.AbC123.woff2";
const LATIN = "plus-jakarta-sans-latin-wght-normal.XyZ789.woff2";

function fakeDist(): string {
  const dist = mkdtempSync(join(tmpdir(), "subset-fonts-"));
  const astro = join(dist, "_astro");
  mkdirSync(astro);
  copyFileSync(req.resolve("@fontsource-variable/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-wght-normal.woff2"), join(astro, DEVA));
  copyFileSync(req.resolve("@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2"), join(astro, LATIN));
  // As the build writes it: minified, inlined, with the wildcard range for U+0000-00FF.
  const css =
    `@font-face{font-family:Noto Sans Devanagari Variable;font-display:swap;font-weight:100 900;src:url(/_astro/${DEVA})format("woff2-variations");unicode-range:U+900-97F,U+200C-200D,U+20B9,U+25CC}` +
    `@font-face{font-family:Plus Jakarta Sans Variable;font-display:swap;font-weight:200 800;src:url(/_astro/${LATIN})format("woff2-variations");unicode-range:U+??,U+2000-206F}`;
  writeFileSync(
    join(dist, "index.html"),
    `<html><head><link rel="preload" href="/_astro/${DEVA}" as="font"><style>${css}</style></head><body>स्मृति, क्विक रिविज़न. Hello</body></html>`,
  );
  return dist;
}

describe("subset-fonts", () => {
  it("subsets both preloaded fonts to the characters used and rewrites every reference", () => {
    const dist = fakeDist();
    const r = spawnSync(process.execPath, [script, dist], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const files = readdirSync(join(dist, "_astro"));
    const deva = files.find((f) => f.startsWith("noto-sans-devanagari-site."))!;
    const latin = files.find((f) => f.startsWith("plus-jakarta-sans-site."))!;
    expect(deva).toMatch(/^noto-sans-devanagari-site\.[\w-]{8}\.woff2$/);
    expect(statSync(join(dist, "_astro", deva)).size).toBeLessThan(statSync(join(dist, "_astro", DEVA)).size / 2);
    // The wildcard range was understood: the Latin subset keeps real glyphs, not an empty font.
    expect(statSync(join(dist, "_astro", latin)).size).toBeGreaterThan(2000);
    const html = readFileSync(join(dist, "index.html"), "utf8");
    expect(html).not.toContain(DEVA);
    expect(html).not.toContain(LATIN);
    expect(html).toContain(`<link rel="preload" href="/_astro/${deva}"`);
    expect(html.match(/font-weight:500 800/g)).toHaveLength(2);
    expect(r.stdout).toMatch(/noto-sans-devanagari-site: \d+ characters/);
  });

  it("is a no-op when the build has no such fonts", () => {
    const dist = mkdtempSync(join(tmpdir(), "subset-fonts-"));
    writeFileSync(join(dist, "index.html"), "<html></html>");
    const r = spawnSync(process.execPath, [script, dist], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not in the build");
  });
});
