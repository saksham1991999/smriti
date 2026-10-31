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

/** The manifest file exactly as written: pretty JSON plus a final newline. */
export function manifestText(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Total size in bytes of a built sim: the other files plus the manifest itself, counted as UTF-8 bytes
 * (Hindi strings take more bytes than characters). The manifest counts toward the size it reports, so
 * iterate until the number stops changing; it settles in two or three rounds.
 */
export function settleSizeBytes(withoutManifest: number, source: Record<string, unknown>): number {
  let size = 0;
  for (let i = 0; i < 10; i += 1) {
    const next = withoutManifest + Buffer.byteLength(manifestText({ ...source, size_bytes: size }), 'utf8');
    if (next === size) return size;
    size = next;
  }
  throw new Error('size_bytes did not settle');
}

function manifestAndBudget(simDir: string, outDir: string): Plugin {
  return {
    name: 'smriti-sim-manifest',
    apply: 'build',
    closeBundle() {
      const sourcePath = join(simDir, 'manifest.json');
      const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as Record<string, unknown>;
      const size = settleSizeBytes(dirSize(outDir), source);
      const built = { ...source, size_bytes: size };
      writeFileSync(join(outDir, 'manifest.json'), manifestText(built));
      if (source.size_bytes !== size) {
        writeFileSync(sourcePath, manifestText(built));
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
