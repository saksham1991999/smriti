import { describe, expect, it } from 'vitest';

import {
  AuthError,
  DevAuthClient,
  MemoryKeyValueStore,
  SupabaseAuthClient,
  createNonce,
  createSupabaseClientForProfile,
  decodeJwtClaims,
  devIdToken,
  mapSupabaseError,
  sha256Hex,
} from '../src';
import { fakeFetch, jsonResponse, nodeCrypto } from './helpers';

const NOW = Date.UTC(2026, 9, 29, 6, 0, 0);

function b64url(s: string) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function jwt(claims: Record<string, unknown>) {
  return `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(claims))}.sig`;
}

describe('decodeJwtClaims', () => {
  it('decodes base64url claims, including non-ASCII', () => {
    expect(decodeJwtClaims(jwt({ sub: 'u1', name: 'आप', is_anonymous: true }))).toEqual({ sub: 'u1', name: 'आप', is_anonymous: true });
    expect(decodeJwtClaims('nope')).toBeNull();
    expect(decodeJwtClaims('a.%%%.c')).toBeNull();
  });
});

describe('DevAuthClient', () => {
  function setup() {
    const accounts = new Map<string, string>(); // email → user id
    let n = 0;
    const server = fakeFetch((url, init, body) => {
      if (url.endsWith('/v1/dev/auth/anonymous')) {
        const id = `anon-${++n}`;
        return jsonResponse(200, { access_token: jwt({ sub: id, is_anonymous: true }), expires_in: 3600, user: { id, is_anonymous: true } });
      }
      if (url.endsWith('/v1/dev/auth/google')) {
        const { email } = body as { email: string };
        const bearer = init?.headers?.Authorization?.replace('Bearer ', '');
        const owner = accounts.get(email);
        if (owner) return jsonResponse(200, { access_token: jwt({ sub: owner, is_anonymous: false }), expires_in: 3600 });
        const current = bearer ? (decodeJwtClaims(bearer)?.['sub'] as string) : `user-${++n}`;
        accounts.set(email, current);
        return jsonResponse(200, { access_token: jwt({ sub: current, is_anonymous: false }), expires_in: 3600 });
      }
      return jsonResponse(404, {});
    });
    let now = NOW;
    const store = new MemoryKeyValueStore();
    const client = new DevAuthClient({ baseUrl: 'http://localhost:8000', fetch: server.fetch, store, clock: () => now });
    return { client, server, store, setNow: (t: number) => (now = t), accounts };
  }

  it('signs in anonymously, persists the session and reads it back', async () => {
    const { client, store, server } = setup();
    const events: string[] = [];
    client.onAuthStateChange((e) => events.push(e));
    const s = await client.signInAnonymously();
    expect(s.user).toEqual({ id: 'anon-1', isAnonymous: true });
    expect(s.expiresAt).toBe(Math.floor(NOW / 1000) + 3600);
    const again = new DevAuthClient({ baseUrl: 'http://localhost:8000', fetch: server.fetch, store, clock: () => NOW });
    expect((await again.getSession())?.user.id).toBe('anon-1');
    expect(events).toEqual(['SIGNED_IN']);
  });

  it('links a dev identity to the current guest in place', async () => {
    const { client, server } = setup();
    const guest = await client.signInAnonymously();
    const res = await client.linkIdentity({ provider: 'google', idToken: devIdToken({ email: 'a@test.dev', name: 'A' }), nonce: 'n' });
    expect(res).toMatchObject({ status: 'linked', session: { user: { id: guest.user.id, isAnonymous: false } } });
    expect(server.calls.at(-1)?.init?.headers?.Authorization).toBe(`Bearer ${guest.accessToken}`);
    expect(server.calls.at(-1)?.body).toEqual({ email: 'a@test.dev', name: 'A' });
  });

  it('returns identity_already_exists when the identity belongs to another account', async () => {
    const { client } = setup();
    await client.signInWithIdToken({ provider: 'google', idToken: devIdToken({ email: 'b@test.dev', name: 'B' }), nonce: 'n' });
    await client.signOut();
    await client.signInAnonymously();
    const res = await client.linkIdentity({ provider: 'google', idToken: devIdToken({ email: 'b@test.dev', name: 'B' }), nonce: 'n' });
    expect(res).toEqual({ status: 'identity_already_exists' });
  });

  it('maps a 409 to identity_already_exists and a 429 to rate_limited', async () => {
    const store = new MemoryKeyValueStore();
    let status = 409;
    const server = fakeFetch((url) =>
      url.endsWith('/anonymous') ? jsonResponse(200, { access_token: jwt({ sub: 'g' }), user: { id: 'g', is_anonymous: true } }) : jsonResponse(status, {}),
    );
    const client = new DevAuthClient({ baseUrl: '', fetch: server.fetch, store, clock: () => NOW });
    await client.signInAnonymously();
    expect(await client.linkIdentity({ provider: 'google', idToken: devIdToken({ email: 'x@y', name: 'x' }), nonce: '' })).toEqual({ status: 'identity_already_exists' });
    status = 429;
    await expect(client.signInWithIdToken({ provider: 'google', idToken: devIdToken({ email: 'x@y', name: 'x' }), nonce: '' })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('expired sessions read as signed out; sign-out clears storage', async () => {
    const { client, setNow, store } = setup();
    await client.signInAnonymously();
    setNow(NOW + 3601_000);
    expect(await client.getAccessToken()).toBeNull();
    await client.signOut();
    expect(await store.get('auth.dev.session')).toBeNull();
  });

  it('rejects a non-dev id token and linking while signed out', async () => {
    const { client } = setup();
    await expect(client.linkIdentity({ provider: 'google', idToken: 'x', nonce: '' })).rejects.toBeInstanceOf(AuthError);
    await client.signInAnonymously();
    await expect(client.linkIdentity({ provider: 'google', idToken: 'real.google.jwt', nonce: '' })).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('a network failure is AuthError(network)', async () => {
    const client = new DevAuthClient({
      baseUrl: '',
      fetch: async () => {
        throw new TypeError('offline');
      },
      store: new MemoryKeyValueStore(),
      clock: () => NOW,
    });
    await expect(client.signInAnonymously()).rejects.toMatchObject({ code: 'network' });
  });
});

describe('mapSupabaseError', () => {
  it('maps codes, network errors and nonce problems', () => {
    expect(mapSupabaseError({ code: 'identity_already_exists', status: 422 }).code).toBe('identity_already_exists');
    expect(mapSupabaseError({ code: 'over_request_rate_limit', status: 429 }).code).toBe('rate_limited');
    expect(mapSupabaseError({ code: 'refresh_token_not_found' }).code).toBe('session_ended');
    expect(mapSupabaseError({ name: 'AuthRetryableFetchError', status: 0 }).code).toBe('network');
    expect(mapSupabaseError({ message: 'Nonces mismatch', status: 400 }).code).toBe('nonce_mismatch');
    expect(mapSupabaseError({ status: 500 }).code).toBe('unknown');
  });
});

/** Runs the real supabase-js client against a fake GoTrue, to pin the request shapes. */
describe('SupabaseAuthClient (real supabase-js, fake GoTrue)', () => {
  function gotrue(opts: { linkConflict?: boolean } = {}) {
    const calls: { url: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
    let anon = true;
    const session = (isAnonymous: boolean, token: string) => ({
      access_token: jwt({ sub: 'u-1', is_anonymous: isAnonymous, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' }),
      refresh_token: `refresh-${token}`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u-1', aud: 'authenticated', role: 'authenticated', is_anonymous: isAnonymous, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    });
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ url, body, auth: headers.get('Authorization') });
      const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/auth/v1/signup')) return json(200, session(true, 'a'));
      if (url.includes('grant_type=id_token') && body?.['link_identity']) {
        if (opts.linkConflict) return json(422, { code: 422, error_code: 'identity_already_exists', msg: 'Identity is already linked to another user' });
        anon = false;
        return json(200, session(false, 'b'));
      }
      if (url.includes('grant_type=id_token')) return json(200, session(false, 'c'));
      if (url.includes('grant_type=refresh_token')) return json(200, session(anon, 'r'));
      if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
      return json(404, { msg: 'not found' });
    };
    return { calls, fetch };
  }

  function make(opts: { linkConflict?: boolean } = {}) {
    const g = gotrue(opts);
    const sb = createSupabaseClientForProfile({ url: 'https://proj.supabase.test', anonKey: 'anon-key', storage: new MemoryKeyValueStore(), storageKey: 'sb-profile-1', fetch: g.fetch });
    return { ...g, client: new SupabaseAuthClient(sb) };
  }

  it('anonymous sign-in, then linkIdentity with the raw nonce, then refresh', async () => {
    const { client, calls } = make();
    const guest = await client.signInAnonymously({ captchaToken: 'ts-token' });
    expect(guest.user).toEqual({ id: 'u-1', isAnonymous: true });
    expect(calls[0]?.body?.['gotrue_meta_security']).toEqual({ captcha_token: 'ts-token' });

    const nonce = await createNonce(nodeCrypto);
    expect(nonce.hashed).toBe(await sha256Hex(nodeCrypto, nonce.raw));
    const res = await client.linkIdentity({ provider: 'google', idToken: 'google-id-token', nonce: nonce.raw });
    expect(res).toMatchObject({ status: 'linked', session: { user: { id: 'u-1', isAnonymous: false } } });
    const link = calls.find((c) => c.body?.['link_identity'] === true);
    expect(link?.body).toMatchObject({ provider: 'google', id_token: 'google-id-token', nonce: nonce.raw, link_identity: true });
    expect(link?.auth).toBe(`Bearer ${guest.accessToken}`);
    expect(calls.some((c) => c.url.includes('grant_type=refresh_token'))).toBe(true);
    expect((await client.getSession())?.user.isAnonymous).toBe(false);
  });

  it('identity_already_exists is a result, not an error', async () => {
    const { client } = make({ linkConflict: true });
    await client.signInAnonymously();
    expect(await client.linkIdentity({ provider: 'apple', idToken: 't', nonce: 'n' })).toEqual({ status: 'identity_already_exists' });
  });

  it('signInWithIdToken and sign-out', async () => {
    const { client, calls } = make();
    const s = await client.signInWithIdToken({ provider: 'google', idToken: 'tok', nonce: 'raw' });
    expect(s.user.isAnonymous).toBe(false);
    expect(calls.at(-1)?.body).toMatchObject({ provider: 'google', id_token: 'tok', nonce: 'raw' });
    const events: string[] = [];
    client.onAuthStateChange((e) => events.push(e));
    await client.signOut();
    expect(await client.getSession()).toBeNull();
    expect(events).toContain('SIGNED_OUT');
  });
});
