import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const pkg = resolve(__dirname, '..');

describe('plain Node ESM (dist)', () => {
  it('imports @smriti/config without a TypeScript loader', () => {
    const script = [
      "import { getVariant, defaultFlags, VARIANT_IDS, parseClientEnv } from '@smriti/config';",
      "const env = parseClientEnv({ API_BASE_URL: 'http://localhost:8000' });",
      "console.log(JSON.stringify({ id: getVariant('neet').id, ids: VARIANT_IDS, days: defaultFlags.get('notify.plan_days'), auth: env.AUTH_MODE }));",
    ].join('\n');
    // Self-reference by package name resolves through `exports` with Node's conditions.
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: pkg, encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual({ id: 'neet', ids: ['all', 'jee', 'neet', 'upsc', 'ssc'], days: 7, auth: 'dev' });
  });

  it('dist is up to date with src', () => {
    expect(() => execFileSync(process.execPath, [join(pkg, 'scripts', 'build.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('TypeScript and bundler consumers keep the source', () => {
    const exp = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).exports['.'] as Record<string, string>;
    expect(Object.keys(exp)).toEqual(['types', 'development', 'react-native', 'browser', 'node', 'default']);
    for (const c of ['types', 'development', 'react-native', 'browser', 'default']) expect(exp[c]).toBe('./src/index.ts');
    expect(exp.node).toBe('./dist/index.js');
  });
});
