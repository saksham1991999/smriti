#!/usr/bin/env node
// Builds design/mocks/index.html: the screen gallery of Smriti UI mocks.
//
//   cd tools/mocks && npm install && node build.mjs
//
// Inputs
//   design/mocks/kit.css            the mock component kit (tokens + DESIGN.md §5 components)
//   design/mocks/shell.html         page chrome (header, intro, nav); {{NAV}} {{SECTIONS}} {{KIT}} {{SPRITE}} placeholders
//   design/mocks/screens/NN-*.html  one fragment per area, in file-name order
//   design/mocks/assets/*.webp      Agnes illustrations (see assets/README.md)
// Icons: any <use href="#ph-NAME"> in a fragment is resolved from @phosphor-icons/core (MIT),
// where NAME is the file name without .svg, e.g. "house-fill" or "fire-bold".
// The output is self-contained except for the images in assets/ and Google Fonts.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const mocks = join(root, "design", "mocks");
const phosphor = join(here, "node_modules", "@phosphor-icons", "core", "assets");

const read = (p) => readFileSync(p, "utf8");
const shell = read(join(mocks, "shell.html"));
const kit = read(join(mocks, "kit.css"));

const files = readdirSync(join(mocks, "screens")).filter((f) => /^\d\d-.*\.html$/.test(f)).sort();
const sections = files.map((f) => ({ file: f, html: read(join(mocks, "screens", f)) }));

// Nav from each fragment's first <section id="..." data-title="...">
const nav = sections
  .map(({ html }) => html.match(/<section[^>]*\bid="([^"]+)"[^>]*\bdata-title="([^"]+)"/))
  .filter(Boolean)
  .map(([, id, title]) => `<a href="#${id}">${title}</a>`)
  .join("\n");

const all = sections.map((s) => s.html).join("\n");

// Icon sprite
const names = [...new Set([...all.matchAll(/href="#ph-([a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
const missing = [];
const symbols = names.map((name) => {
  const weight = (name.match(/-(bold|fill|duotone|light|thin)$/) || [, "regular"])[1];
  const path = join(phosphor, weight, `${name}.svg`);
  if (!existsSync(path)) { missing.push(name); return ""; }
  const svg = read(path);
  const vb = (svg.match(/viewBox="([^"]+)"/) || [, "0 0 256 256"])[1];
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return `<symbol id="ph-${name}" viewBox="${vb}">${inner}</symbol>`;
});
if (missing.length) console.warn(`Missing Phosphor icons: ${missing.join(", ")}`);

// The Google "G" mark, as published in Google's sign-in branding guidelines.
const googleG = `<symbol id="g-logo" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></symbol>`;

const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${googleG}${symbols.join("")}</svg>`;

const out = shell
  .replace("{{KIT}}", () => kit)
  .replace("{{NAV}}", () => nav)
  .replace("{{SPRITE}}", () => sprite)
  .replace("{{SECTIONS}}", () => all)
  .replace("{{COUNT}}", () => String((all.match(/<figure class="mock/g) || []).length));

writeFileSync(join(mocks, "index.html"), out);
const imgs = [...new Set([...out.matchAll(/src="(assets\/[^"]+)"/g)].map((m) => m[1]))];
const absent = imgs.filter((p) => !existsSync(join(mocks, p)));
console.log(`index.html: ${files.length} areas, ${names.length} icons, ${imgs.length} images${absent.length ? `, MISSING: ${absent.join(", ")}` : ""}`);
