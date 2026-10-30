import { webcrypto } from 'node:crypto';

import type { CryptoLike, Fetch, HttpRequestInit, HttpResponse } from '../src';

export const nodeCrypto = webcrypto as unknown as CryptoLike;

/** Deterministic `getRandomValues` (a tiny LCG) for golden outputs. */
export function seededCrypto(seed = 1): CryptoLike {
  let s = seed >>> 0;
  return {
    getRandomValues<T extends Uint8Array>(a: T): T {
      for (let i = 0; i < a.length; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        a[i] = s >>> 24;
      }
      return a;
    },
    subtle: nodeCrypto.subtle,
  };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  };
}

export interface RecordedRequest {
  url: string;
  init: HttpRequestInit | undefined;
  body: unknown;
}

/** A fake `fetch` that routes to a handler and records every request. */
export function fakeFetch(handler: (url: string, init: HttpRequestInit | undefined, body: unknown) => HttpResponse | Promise<HttpResponse>) {
  const calls: RecordedRequest[] = [];
  const fetch: Fetch = async (url, init) => {
    const body = init?.body ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, init, body });
    return handler(url, init, body);
  };
  return { fetch, calls };
}
