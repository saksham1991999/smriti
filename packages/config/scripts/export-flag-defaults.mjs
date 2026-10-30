// Writes flag-defaults.json from the registry in src/flags.ts (Node strips the TypeScript types).
// The API reads that file so the server and the apps share one set of defaults.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { FLAG_DEFAULTS_FILE, flagDefaultsDocument } = await import('../src/flags.ts');

const out = join(dirname(fileURLToPath(import.meta.url)), '..', FLAG_DEFAULTS_FILE);
writeFileSync(out, `${JSON.stringify(flagDefaultsDocument(), null, 2)}\n`);
console.log(`wrote ${out}`);
