import { createApiClient, unwrap, type ApiClient } from '@smriti/api-client';
import type { Fetch, HttpRequestInit } from '@smriti/app-core';

/**
 * openapi-fetch calls `fetch(request: Request)`. The app passes app-core's smaller `Fetch`
 * everywhere (so tests can swap in the dev fake), so this adapts one to the other.
 */
export function toGlobalFetch(fetch: Fetch): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const method = req.method.toUpperCase() as HttpRequestInit['method'];
    const body = method === 'GET' || method === 'DELETE' ? undefined : await req.text();
    const res = await fetch(req.url, { method, headers, ...(body ? { body } : {}) });
    const text = await res.text();
    const contentType = res.headers.get('content-type') ?? 'application/json';
    return new Response(res.status === 204 ? null : text, { status: res.status, headers: { 'content-type': contentType } });
  };
}

export function createMobileApiClient(opts: {
  baseUrl: string;
  fetch: Fetch;
  getAccessToken: () => Promise<string | null>;
  variant: string;
  platform: 'ios' | 'android' | 'web';
  /** The per-install id (`X-Device-Id`); `/v1/devices` and the sync calls need it. */
  deviceId: string;
  appVersion?: string;
}): ApiClient {
  return createApiClient({
    baseUrl: opts.baseUrl,
    fetch: toGlobalFetch(opts.fetch),
    getAccessToken: opts.getAccessToken,
    appVariant: opts.variant,
    platform: opts.platform,
    deviceId: opts.deviceId,
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}),
  });
}

export { unwrap, type ApiClient };
