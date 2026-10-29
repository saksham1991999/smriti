#!/usr/bin/env node
// Site lint: project rules that TypeScript cannot check.
//   1. No raw colour values in components, islands, layouts, pages or CSS (tokens only).
//   2. No model identifiers or provider SDKs in site code (AGENTS rule 4).
//   3. No cookies or third-party sign-in scripts on the site (auth §5.4).
//   4. Every <img> in source has an alt attribute (or is an Art component).
// Exits 1 on any finding.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const src = join(root, "src");

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = walk(src).filter((f) => /\.(astro|tsx?|css|mjs)$/.test(f));
const findings = [];
const report = (file, line, msg) => findings.push(`${relative(root, file)}:${line}: ${msg}`);

const HEX = /#[0-9a-fA-F]{3,8}\b(?![\w-])/;
const RGB = /\brgba?\(\s*\d/;
const ALLOW_COLOUR = new Set([join(src, "styles", "tokens.ts")]);
const FORBIDDEN = [
  [/document\.cookie/, "cookies are not allowed on the site"],
  [/accounts\.google\.com\/gsi|google\.accounts\.id/, "no Google sign-in script on the site (auth §5.4)"],
  [/from ["'](openai|@anthropic-ai\/sdk|@google\/genai)["']/, "no AI provider SDKs"],
  [/\b(gpt-[0-9]|claude-[a-z0-9]|gemini-[0-9]|agnes-image-[0-9])/i, "no model identifiers in code"],
];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((text, i) => {
    const n = i + 1;
    const code = text.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    if (!ALLOW_COLOUR.has(file) && (HEX.test(code.replace(/href="#[^"]*"|`#\$\{[^}]*\}`|"#(?![0-9a-fA-F]{3,8}")[a-z][\w-]*"/g, "")) || RGB.test(code))) {
      report(file, n, "raw colour value; use a token variable");
    }
    for (const [re, msg] of FORBIDDEN) if (re.test(code)) report(file, n, msg);
  });
  const whole = lines.join("\n");
  for (const m of whole.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(m[0])) report(file, whole.slice(0, m.index).split("\n").length, "<img> without alt");
  }
}

if (findings.length) {
  console.error(findings.join("\n"));
  console.error(`lint: ${findings.length} finding(s)`);
  process.exit(1);
}
console.log(`lint: ${files.length} files clean`);
