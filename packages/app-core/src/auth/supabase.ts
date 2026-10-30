import { createClient, type AuthChangeEvent, type Session, type SupabaseClient } from '@supabase/supabase-js';

import type { KeyValueStore } from '../storage/types';
import {
  AuthError,
  type AuthClient,
  type AuthErrorCode,
  type AuthEvent,
  type AuthSession,
  type IdTokenCredential,
  type LinkResult,
} from './types';

type SupabaseAuth = Pick<
  SupabaseClient['auth'],
  'getSession' | 'signInAnonymously' | 'linkIdentity' | 'signInWithIdToken' | 'refreshSession' | 'signOut' | 'onAuthStateChange'
>;

function toSession(s: Session | null | undefined): AuthSession | null {
  if (!s) return null;
  return {
    accessToken: s.access_token,
    refreshToken: s.refresh_token ?? null,
    expiresAt: s.expires_at ?? null,
    user: { id: s.user.id, isAnonymous: Boolean(s.user.is_anonymous) },
  };
}

/** Maps Supabase Auth error codes to our fixed list. */
export function mapSupabaseError(err: { code?: string | undefined; status?: number | undefined; message?: string; name?: string }): AuthError {
  const code = err.code ?? '';
  const byCode: Record<string, AuthErrorCode> = {
    identity_already_exists: 'identity_already_exists',
    over_request_rate_limit: 'rate_limited',
    over_email_send_rate_limit: 'rate_limited',
    refresh_token_not_found: 'session_ended',
    refresh_token_already_used: 'session_ended',
    session_expired: 'session_ended',
    session_not_found: 'session_ended',
    user_banned: 'user_banned',
    bad_jwt: 'session_ended',
    invalid_credentials: 'invalid_credentials',
  };
  let mapped: AuthErrorCode = byCode[code] ?? 'unknown';
  if (mapped === 'unknown') {
    if (err.name === 'AuthRetryableFetchError' || err.status === 0) mapped = 'network';
    else if (/nonce/i.test(err.message ?? '')) mapped = 'nonce_mismatch';
    else if (err.status === 429) mapped = 'rate_limited';
  }
  return new AuthError(mapped, code || err.message, err.status);
}

const EVENT_MAP: Partial<Record<AuthChangeEvent, AuthEvent>> = {
  SIGNED_IN: 'SIGNED_IN',
  SIGNED_OUT: 'SIGNED_OUT',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  USER_UPDATED: 'USER_UPDATED',
  INITIAL_SESSION: 'SIGNED_IN',
};

/**
 * `AuthClient` on Supabase Auth: anonymous sign-in, `linkIdentity` with an ID token and raw
 * nonce (manual linking on in the project), `signInWithIdToken`, refresh and sign-out (TRD §6).
 */
export class SupabaseAuthClient implements AuthClient {
  private readonly auth: SupabaseAuth;

  constructor(client: Pick<SupabaseClient, 'auth'>) {
    this.auth = client.auth;
  }

  async getSession() {
    const { data, error } = await this.auth.getSession();
    if (error) throw mapSupabaseError(error);
    return toSession(data.session);
  }

  async getAccessToken() {
    return (await this.getSession())?.accessToken ?? null;
  }

  async signInAnonymously(opts: { captchaToken?: string } = {}) {
    const { data, error } = await this.auth.signInAnonymously(
      opts.captchaToken ? { options: { captchaToken: opts.captchaToken } } : undefined,
    );
    if (error) throw mapSupabaseError(error);
    const s = toSession(data.session);
    if (!s) throw new AuthError('unknown', 'no session');
    return s;
  }

  async linkIdentity(c: IdTokenCredential): Promise<LinkResult> {
    const { data, error } = await this.auth.linkIdentity({
      provider: c.provider,
      token: c.idToken,
      nonce: c.nonce,
      ...(c.accessToken ? { access_token: c.accessToken } : {}),
    });
    if (error) {
      const mapped = mapSupabaseError(error);
      if (mapped.code === 'identity_already_exists') return { status: 'identity_already_exists' };
      throw mapped;
    }
    // Refresh so the JWT carries is_anonymous = false (auth flow §6.3).
    const refreshed = await this.refreshSession();
    const s = refreshed ?? toSession(data.session);
    if (!s) throw new AuthError('unknown', 'no session after link');
    return { status: 'linked', session: s };
  }

  async signInWithIdToken(c: IdTokenCredential) {
    const { data, error } = await this.auth.signInWithIdToken({
      provider: c.provider,
      token: c.idToken,
      nonce: c.nonce,
      ...(c.accessToken ? { access_token: c.accessToken } : {}),
    });
    if (error) throw mapSupabaseError(error);
    const s = toSession(data.session);
    if (!s) throw new AuthError('unknown', 'no session');
    return s;
  }

  async refreshSession() {
    const { data, error } = await this.auth.refreshSession();
    if (error) {
      const mapped = mapSupabaseError(error);
      // Never sign out for a network error (auth flow §6.9).
      if (mapped.code === 'network') return this.getSession();
      throw mapped;
    }
    return toSession(data.session);
  }

  async signOut(opts: { scope?: 'local' | 'global' } = {}) {
    const { error } = await this.auth.signOut({ scope: opts.scope ?? 'local' });
    if (error) throw mapSupabaseError(error);
  }

  onAuthStateChange(listener: (event: AuthEvent, session: AuthSession | null) => void) {
    const { data } = this.auth.onAuthStateChange((event, session) => {
      const mapped = EVENT_MAP[event];
      if (mapped) listener(mapped, toSession(session));
    });
    return () => data.subscription.unsubscribe();
  }
}

/** Adapts our `KeyValueStore` (encrypted MMKV, localStorage) to supabase-js's storage. */
export function supabaseStorageAdapter(store: KeyValueStore) {
  return {
    getItem: (key: string) => store.get(key),
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
}

type SupabaseFetch = NonNullable<NonNullable<NonNullable<Parameters<typeof createClient>[2]>['global']>['fetch']>;

/** Creates the Supabase client the app uses for one profile (its own storage key). */
export function createSupabaseClientForProfile(opts: {
  url: string;
  anonKey: string;
  storage: KeyValueStore;
  storageKey: string;
  /** Web only: read `#access_token` from the OAuth redirect. */
  detectSessionInUrl?: boolean;
  /** A custom fetch (tests, or a platform fetch with tracing headers). */
  fetch?: SupabaseFetch;
}): SupabaseClient {
  return createClient(opts.url, opts.anonKey, {
    ...(opts.fetch ? { global: { fetch: opts.fetch } } : {}),
    auth: {
      storage: supabaseStorageAdapter(opts.storage),
      storageKey: opts.storageKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: opts.detectSessionInUrl ?? false,
      flowType: 'pkce',
    },
  });
}
