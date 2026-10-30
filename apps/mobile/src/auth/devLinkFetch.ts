import type { Fetch } from '@smriti/app-core';

/**
 * The API's `POST /v1/dev/auth/google` links Google to the guest only when the body says
 * `link: true` (DevGoogleRequest). app-core's DevAuthClient sends `{ email, name }` with the
 * guest's bearer for `linkIdentity`, so without this the server signs in a new user instead.
 * This adapter adds the flag when a bearer is present. Remove it once DevAuthClient sends `link`
 * itself (reported under "Contract changes").
 */
export function withDevLinkFlag(fetch: Fetch): Fetch {
  return (url, init) => {
    if (init?.method === 'POST' && String(url).endsWith('/v1/dev/auth/google') && typeof init.body === 'string') {
      const headers = (init.headers ?? {}) as Record<string, string>;
      const hasBearer = Object.keys(headers).some((k) => k.toLowerCase() === 'authorization');
      if (hasBearer) {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if (body.link === undefined) return fetch(url, { ...init, body: JSON.stringify({ ...body, link: true }) });
      }
    }
    return fetch(url, init);
  };
}
