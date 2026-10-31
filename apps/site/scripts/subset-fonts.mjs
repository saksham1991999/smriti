#!/usr/bin/env node
// Post-build: replaces the two preloaded fonts in the build (Noto Sans Devanagari for Hindi, Plus
// Jakarta Sans latin) with subsets holding only the characters the built pages and scripts
// contain, then points every page at them. Preloaded fonts sit on the LCP path (TRD §15: LCP
// under 2.0 s on 4G), and the Hindi pages preload both.
//
//   node scripts/subset-fonts.mjs [distDir]
//
// Tooling: subset-font (BSD-3-Clause) on harfbuzzjs (MIT; HarfBuzz's hb-subset) and wawoff2
// (MIT). HarfBuzz keeps the layout closure of the kept characters, so Devanagari conjuncts,
// matras and reph still shape. Both fonts are under the SIL OFL 1.1 with no reserved font name,
// which allows subsetting; the licences ship in the @fontsource-variable packages.
//
// For each font, the characters kept are those inside its @font-face unicode-range (read from
// the built CSS) that appear in any .html, .js or .css file in dist. The weight axis is kept
// from 500 to 800, the weights the design tokens use (packages/tokens: body 500 to heading 800).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import subsetFont from "subset-font";

export const TARGETS = [
  { source: /^noto-sans-devanagari-devanagari-wght-normal\.[\w-]+\.woff2$/, name: "noto-sans-devanagari-site" },
  { source: /^plus-jakarta-sans-latin-wght-normal\.[\w-]+\.woff2$/, name: "plus-jakarta-sans-site" },
];
export const WEIGHT = { min: 500, max: 800 };
// Kept whenever in range: joiners, the dotted circle the shaper uses for a stray matra, the
// dandas, and the space, so an edge case never falls back to another font mid-word.
const ALWAYS = [0x20, 0xa0, 0x200c, 0x200d, 0x25cc, 0x0964, 0x0965];

/**
 * Parses a CSS unicode-range ("U+900-97F,U+20B9", or the wildcard form "U+??" that the CSS
 * minifier writes for U+0000-00FF) into [from, to] pairs.
 */
export function parseUnicodeRange(css) {
  return css.split(",").map((part) => {
    const [a = "", b] = part.trim().replace(/^U\+/i, "").split("-");
    if (b === undefined && a.includes("?")) {
      return [Number.parseInt(a.replace(/\?/g, "0"), 16), Number.parseInt(a.replace(/\?/g, "F"), 16)];
    }
    const from = Number.parseInt(a, 16);
    return [from, b === undefined ? from : Number.parseInt(b, 16)];
  });
}

/** The characters of `texts` inside `ranges`, plus the always-kept ones that are in range. */
export function usedCodepoints(texts, ranges) {
  const inRange = (cp) => ranges.some(([a, b]) => cp >= a && cp <= b);
  const set = new Set(ALWAYS.filter(inRange));
  for (const t of texts) for (const ch of t) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && inRange(cp)) set.add(cp);
  }
  return [...set].sort((a, b) => a - b);
}

/** The @font-face block that points at `file`, and its unicode-range. */
export function fontFaceFor(texts, file) {
  for (const t of texts) {
    for (const m of t.matchAll(/@font-face\s*\{[^}]*\}/g)) {
      if (!m[0].includes(file)) continue;
      const range = /unicode-range:\s*([^;}]+)/.exec(m[0]);
      if (range) return parseUnicodeRange(range[1]);
    }
  }
  return undefined;
}

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

async function main(dist) {
  const files = walk(dist);
  const textFiles = files.filter((f) => /\.(html|js|css)$/.test(f));
  const texts = textFiles.map((f) => readFileSync(f, "utf8"));
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

  for (const target of TARGETS) {
    const source = files.find((f) => target.source.test(basename(f)));
    if (!source) {
      console.log(`subset-fonts: ${target.name}: not in the build, skipped`);
      continue;
    }
    const from = basename(source);
    const ranges = fontFaceFor(texts, from);
    if (!ranges) throw new Error(`subset-fonts: no @font-face with a unicode-range points at ${from}`);
    const codepoints = usedCodepoints(texts, ranges);
    const original = readFileSync(source);
    const subset = await subsetFont(original, String.fromCodePoint(...codepoints), {
      targetFormat: "woff2",
      variationAxes: { wght: WEIGHT },
    });
    const hash = createHash("sha256").update(subset).digest("base64url").slice(0, 8);
    const name = `${target.name}.${hash}.woff2`;
    writeFileSync(join(source, "..", name), subset);

    let rewritten = 0;
    texts.forEach((t, i) => {
      if (!t.includes(from)) return;
      // The weight descriptor follows the clamped axis, so the browser never synthesises a weight.
      texts[i] = t
        .split(from)
        .join(name)
        .replace(/@font-face\s*\{[^}]*\}/g, (face) =>
          face.includes(name) ? face.replace(/font-weight:\s*100 900|font-weight:\s*200 800/, `font-weight:${WEIGHT.min} ${WEIGHT.max}`) : face,
        );
      writeFileSync(textFiles[i], texts[i]);
      rewritten++;
    });
    console.log(
      `subset-fonts: ${target.name}: ${codepoints.length} characters, ${kb(original.length)} -> ${kb(subset.length)}, ${rewritten} files updated`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv[2] ?? "dist");
