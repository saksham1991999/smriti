#!/usr/bin/env node
// Internal link checker for the built site (no network, no dependencies).
//
//   node scripts/check-links.mjs [distDir] [--site=https://www.smriti.example]
//
// For every HTML file in dist it checks that:
//   - every internal href / src / srcset target exists as a built file,
//   - every #fragment on an internal link exists as an id on the target page,
//   - canonical and hreflang URLs on the site's origin resolve, and hreflang pairs are reciprocal.
// External links (the web app, official sources) are listed by host but not fetched.
// Exits 1 when anything is broken.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const dist = resolve(args.find((a) => !a.startsWith("--")) ?? "dist");
const siteArg = args.find((a) => a.startsWith("--site="))?.slice(7);
const siteOrigin = new URL(siteArg ?? process.env.SITE_URL ?? "https://www.smriti.example").origin;

if (!existsSync(dist)) {
  console.error(`check-links: ${dist} does not exist. Run the build first.`);
  process.exit(2);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const htmlFiles = walk(dist).filter((f) => f.endsWith(".html"));
const pageUrl = (file) => {
  const rel = "/" + relative(dist, file).split(sep).join("/");
  return rel.endsWith("/index.html") ? rel.slice(0, -"index.html".length) : rel;
};

const cache = new Map();
const read = (file) => {
  if (!cache.has(file)) cache.set(file, readFileSync(file, "utf8"));
  return cache.get(file);
};

/** Maps a site path to the built file that serves it, or null. */
function resolvePath(pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = join(dist, ...p.split("/").filter(Boolean));
  if (existsSync(file) && statSync(file).isFile()) return file;
  if (existsSync(join(file, "index.html"))) return join(file, "index.html");
  return null;
}

const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

const broken = [];
const external = new Map();
let checked = 0;
const hreflangs = new Map(); // page url -> { lang: url }

for (const file of htmlFiles) {
  const html = read(file);
  const from = pageUrl(file);
  const refs = [];
  for (const m of html.matchAll(/<(a|link|img|script|source)\b[^>]*>/gi)) {
    const tag = m[0];
    for (const name of ["href", "src"]) {
      const v = attr(tag, name);
      if (v) refs.push({ v, tag });
    }
    const set = attr(tag, "srcset");
    if (set) for (const part of set.split(",")) refs.push({ v: part.trim().split(/\s+/)[0], tag });
    if (/^<link\b/i.test(tag) && attr(tag, "rel") === "alternate" && attr(tag, "hreflang")) {
      const h = hreflangs.get(from) ?? {};
      h[attr(tag, "hreflang")] = attr(tag, "href");
      hreflangs.set(from, h);
    }
  }
  for (const { v } of refs) {
    if (!v || v.startsWith("data:") || v.startsWith("mailto:") || v.startsWith("tel:") || v.startsWith("javascript:")) continue;
    let url;
    try {
      url = new URL(v, `${siteOrigin}${from}`);
    } catch {
      broken.push({ from, ref: v, why: "unparseable URL" });
      continue;
    }
    if (url.origin !== siteOrigin) {
      external.set(url.host, (external.get(url.host) ?? 0) + 1);
      continue;
    }
    checked++;
    const target = resolvePath(url.pathname);
    if (!target) {
      broken.push({ from, ref: v, why: "no such page or file" });
      continue;
    }
    if (url.hash && url.hash.length > 1 && target.endsWith(".html")) {
      const id = decodeURIComponent(url.hash.slice(1));
      if (!ids(read(target)).has(id)) broken.push({ from, ref: v, why: `missing #${id}` });
    }
  }
}

// hreflang reciprocity: if page A (language X) says its "hi" twin is B, B must say its X twin is A.
for (const [from, h] of hreflangs) {
  const own = Object.entries(h).find(([l, href]) => l !== "x-default" && new URL(href).pathname === from)?.[0];
  if (!own) {
    broken.push({ from, ref: from, why: "hreflang links do not include the page itself" });
    continue;
  }
  for (const [lang, href] of Object.entries(h)) {
    if (lang === "x-default" || lang === own) continue;
    const twin = new URL(href).pathname;
    const back = hreflangs.get(twin);
    if (!back) {
      broken.push({ from, ref: href, why: `hreflang ${lang} target has no hreflang links` });
    } else if (!back[own] || new URL(back[own]).pathname !== from) {
      broken.push({ from, ref: href, why: `hreflang ${lang} is not reciprocal` });
    }
  }
}

console.log(`check-links: ${htmlFiles.length} pages, ${checked} internal references checked, ${hreflangs.size} pages with hreflang.`);
if (external.size) {
  console.log(`  external hosts (not fetched): ${[...external].map(([h, n]) => `${h} (${n})`).join(", ")}`);
}
if (broken.length) {
  console.error(`check-links: ${broken.length} broken:`);
  for (const b of broken.slice(0, 100)) console.error(`  ${b.from} -> ${b.ref}: ${b.why}`);
  process.exit(1);
}
console.log("check-links: no broken internal links.");
