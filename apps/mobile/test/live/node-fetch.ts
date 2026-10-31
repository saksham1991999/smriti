import type { Fetch } from '@smriti/app-core';
import http from 'node:http';

/** jest-expo replaces the global fetch with a mock, so live runs use node:http directly. */
export const nodeFetch: Fetch = (url, init) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { method: init?.method ?? 'GET', headers: init?.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          json: async () => JSON.parse(text) as unknown,
          text: async () => text,
          headers: { get: (n: string) => (res.headers[n.toLowerCase()] as string | undefined) ?? null },
        });
      });
    });
    req.on('error', reject);
    if (init?.body) req.write(init.body);
    req.end();
  });
