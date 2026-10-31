import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const dir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dir,
  base: './',
  publicDir: false,
  build: {
    outDir: resolve(dir, 'dist'),
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 256 * 1024,
    reportCompressedSize: false,
  },
});
