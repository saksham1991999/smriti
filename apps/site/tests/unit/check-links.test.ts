import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(__dirname, "..", "..", "scripts", "check-links.mjs");
const SITE = "https://s.example";

function page(alts: { en: string; hi: string }, body: string) {
  return `<!doctype html><html><head>
<link rel="alternate" hreflang="en" href="${SITE}${alts.en}">
<link rel="alternate" hreflang="hi" href="${SITE}${alts.hi}">
<link rel="alternate" hreflang="x-default" href="${SITE}${alts.en}">
</head><body>${body}</body></html>`;
}

function site(enBody: string) {
  const dir = mkdtempSync(join(tmpdir(), "links-"));
  mkdirSync(join(dir, "hi"));
  mkdirSync(join(dir, "about"));
  writeFileSync(join(dir, "index.html"), page({ en: "/", hi: "/hi/" }, enBody));
  writeFileSync(join(dir, "hi", "index.html"), page({ en: "/", hi: "/hi/" }, `<a href="/">en</a>`));
  writeFileSync(join(dir, "about", "index.html"), page({ en: "/about/", hi: "/about/" }, `<h2 id="team">x</h2>`));
  return dir;
}

const run = (dir: string) => spawnSync(process.execPath, [script, dir, `--site=${SITE}`], { encoding: "utf8" });

describe("check-links", () => {
  it("passes a site whose links all resolve", () => {
    const r = run(site(`<a href="/about/#team">a</a><a href="https://app.example/start">ext</a>`));
    expect(r.stdout).toContain("no broken internal links");
    expect(r.status).toBe(0);
  });

  it("fails on a missing page", () => {
    const r = run(site(`<a href="/missing/">x</a>`));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("/missing/: no such page");
  });

  it("fails on a missing fragment", () => {
    const r = run(site(`<a href="/about/#nope">x</a>`));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("missing #nope");
  });
});
