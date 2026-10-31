import type { FileStore } from '@smriti/app-core';

const CACHE = 'smriti-content-v1';
// Cache Storage keys are URLs; this origin-local prefix never reaches the network.
const keyFor = (path: string) => `/__content/${path}`;

/**
 * Web preview: downloaded bundles in Cache Storage (TRD §4.2). The browser may clear it unless
 * the app is installed, which LRN-15's web note says. Where Cache Storage is missing (private
 * windows in some browsers) files live in memory for the session.
 */
export function deviceBundleFiles(): FileStore {
  const memory = new Map<string, Uint8Array>();
  const open = async (): Promise<Cache | null> => {
    try {
      return typeof caches === 'undefined' ? null : await caches.open(CACHE);
    } catch {
      return null;
    }
  };
  return {
    async read(path) {
      const c = await open();
      if (!c) return memory.get(path) ?? null;
      const res = await c.match(keyFor(path));
      return res ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    async write(path, data) {
      const c = await open();
      if (!c) {
        memory.set(path, data);
        return;
      }
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      await c.put(keyFor(path), new Response(copy.buffer, { headers: { 'Content-Type': 'application/json' } }));
    },
    async delete(path) {
      const c = await open();
      if (!c) memory.delete(path);
      else await c.delete(keyFor(path));
    },
    async exists(path) {
      const c = await open();
      if (!c) return memory.has(path);
      return Boolean(await c.match(keyFor(path)));
    },
  };
}
