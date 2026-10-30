/**
 * Shared Vite build for sims. Output per sim (`sims/{id}/dist/`):
 *
 *   index.html          strict CSP, no network
 *   assets/sim.js       one classic (non-module) script
 *   assets/index.css    styles with the fonts inlined
 *   licences/*.txt      third-party licences (fonts, icons)
 *   manifest.json       the source manifest with the real `size_bytes`
 *
 * Classic scripts and inlined fonts matter: module scripts and font files are
 * CORS requests, which fail from a sandboxed iframe (opaque origin) and from
 * file:// pages in Android WebViews.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, UserConfig } from 'vite';

const kitDir = dirname(fileURLToPath(import.meta.url));

/** sim-builder budget: under 2 MB total. */
export const SIM_BUDGET_BYTES = 2 * 1024 * 1024;

const LICENCES: Array<{ file: string; from: string }> = [
  { file: 'licences/plus-jakarta-sans-OFL-1.1.txt', from: 'node_modules/@fontsource/plus-jakarta-sans/LICENSE' },
  { file: 'licences/noto-sans-devanagari-OFL-1.1.txt', from: 'node_modules/@fontsource/noto-sans-devanagari/LICENSE' },
  { file: 'licences/phosphor-icons-MIT.txt', from: 'node_modules/@phosphor-icons/core/LICENSE' },
];

function classicScript(): Plugin {
  return {
    name: 'smriti-sim-classic-script',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(/<script type="module" crossorigin src="/g, '<script defer src="')
          .replace(/<script type="module" src="/g, '<script defer src="')
          .replace(/<link rel="stylesheet" crossorigin href="/g, '<link rel="stylesheet" href="');
      },
    },
  };
}

function licences(): Plugin {
  return {
    name: 'smriti-sim-licences',
    apply: 'build',
    generateBundle() {
      for (const l of LICENCES) {
        this.emitFile({ type: 'asset', fileName: l.file, source: readFileSync(join(kitDir, l.from), 'utf8') });
      }
    },
  };
}

function dirSize(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? dirSize(p) : st.size;
  }
  return total;
}

function manifestAndBudget(simDir: string, outDir: string): Plugin {
  return {
    name: 'smriti-sim-manifest',
    apply: 'build',
    closeBundle() {
      const sourcePath = join(simDir, 'manifest.json');
      const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as Record<string, unknown>;
      const withoutManifest = dirSize(outDir);
      const draft = { ...source, size_bytes: 0 };
      // The manifest counts toward the size it reports; two passes settle it.
      let size = withoutManifest + JSON.stringify(draft, null, 2).length + 1;
      size = withoutManifest + JSON.stringify({ ...source, size_bytes: size }, null, 2).length + 1;
      const built = { ...source, size_bytes: size };
      writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(built, null, 2)}\n`);
      if (source.size_bytes !== size) {
        writeFileSync(sourcePath, `${JSON.stringify(built, null, 2)}\n`);
      }
      if (size > SIM_BUDGET_BYTES) {
        throw new Error(`${String(source.id)} is ${size} bytes, over the ${SIM_BUDGET_BYTES} byte budget`);
      }
    },
  };
}

export function simConfig(simDir: string): UserConfig {
  const outDir = resolve(simDir, 'dist');
  return {
    root: simDir,
    base: './',
    publicDir: false,
    plugins: [classicScript(), licences(), manifestAndBudget(simDir, outDir)],
    build: {
      outDir,
      emptyOutDir: true,
      target: 'es2020',
      modulePreload: false,
      cssCodeSplit: false,
      assetsInlineLimit: 256 * 1024,
      sourcemap: false,
      reportCompressedSize: false,
      rolldownOptions: {
        output: {
          format: 'iife',
          entryFileNames: 'assets/sim.js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
    test: {
      include: ['test/**/*.test.ts'],
      environment: 'node',
    },
  } as UserConfig;
}
