// Repository rules tsc cannot check (AGENTS.md): no raw hex colours in screens or components
// (tokens only), no model identifiers (they come from AI_TIER_*_MODEL on the server), and no
// provider SDKs called from the app. Exits 1 and lists every hit.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dirs = ['app', 'src'];
const skip = /(?:\.generated\.|\/seed\/|\/i18n\/pending)/;

const rules = [
  { name: 'raw hex colour (use theme tokens)', re: /(?<![\w&])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?![\w-])/ },
  { name: 'model identifier (config only)', re: /\b(?:gpt-[0-9]|gemini-[0-9]|claude-[0-9a-z]|llama-?[0-9]|mistral-[a-z]|nova-[0-9])/i },
  { name: 'provider SDK import (use the API gateway)', re: /from ['"](?:openai|@anthropic-ai\/sdk|@google\/generative-ai|@google\/genai|@deepgram\/sdk)['"]/ },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(?:ts|tsx|mjs|js)$/.test(name)) yield p;
  }
}

const hits = [];
for (const d of dirs) {
  for (const f of files(join(root, d))) {
    const rel = relative(root, f);
    if (skip.test(rel)) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(?:\/\/|\*)/.test(line)) return;
      for (const r of rules) if (r.re.test(line)) hits.push(`${rel}:${i + 1}  ${r.name}: ${line.trim().slice(0, 100)}`);
    });
  }
}

if (hits.length) {
  console.error(hits.join('\n'));
  console.error(`\n${hits.length} rule violation(s)`);
  process.exit(1);
}
console.log('lint-rules: ok');
