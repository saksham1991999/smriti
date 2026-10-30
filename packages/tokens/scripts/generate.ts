// Writes dist/tokens.css from tokens.json. Run with `pnpm --filter @smriti/tokens build`.
// The Tailwind preset (tailwind-preset.ts) and the React Native theme (native.ts) are TypeScript modules
// computed from the same typed tokens at import time, so they can never drift from tokens.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTokensCss } from "../src/css";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
mkdirSync(dist, { recursive: true });
const css = buildTokensCss();
writeFileSync(join(dist, "tokens.css"), css);
console.log(`tokens: wrote dist/tokens.css (${css.length} bytes)`);
