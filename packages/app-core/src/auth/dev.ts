import type { Clock, Fetch } from '../platform';
import type { KeyValueStore } from '../storage/types';
import {
  AuthError,
  decodeJwtClaims,
  type AuthClient,
  type AuthEvent,
  type AuthSession,
  type IdTokenCredential,
  type LinkResult,
} from './types';

/**
 * A dev identity used in place of a Google ID token. Locally there is no Google: the dev API's
 * `POST /v1/dev/auth/google` takes `{ email, name }` (sync contract "Dev auth").
 */
export interface DevIdentity {
  email: string;
  name: string;
}

/**
 * Encodes a dev identity as the `idToken` of an `IdTokenCredential`, so screens call the same
 * `linkIdentity` / `signInWithIdToken` as with Supabase.
 */
export function devIdToken(identity: DevIdentity): string {
  return `dev:${JSON.stringify(identity)}`;
}

function parseDevIdToken(token: string): DevIdentity {
  if (!token.startsWith('dev:')) throw new AuthError('invalid_credentials', 'DevAuthClient needs devIdToken()');
  const parsed = JSON.parse(token.slice(4)) as Partial<DevIdentity>;
  if (typeof parsed.email !== 'string' || typeof parsed.name !== 'string') throw new AuthError('invalid_credentials');
  return { email: parsed.email, name: parsed.name };
}

interface DevTokenResponse {
  /** The contract says the endpoints "return a JWT"; the field name is not fixed yet. */
  access_token?: string;
  token?: string;
  jwt?: string;
  refresh_token?: string | null;
  expires_in?: number;
  expires_at?: number;
  user?: { id: string; is_anonymous?: boolean };
}

const SESSION_KEY = 'auth.dev.session';

/**
 * `AuthClient` against the API's dev endpoints (`APP_ENV=local` or `test` only). The JWTs it
 * gets are shaped like Supabase access tokens, so the rest of the app cannot tell the
 * difference. There is no refresh endpoint: an expired dev session ends and the app signs in again.
 */
export class DevAuthClient implements AuthClient {
  private listeners = new Set<(event: AuthEvent, session: AuthSession | null) => void>();
  private cached: AuthSession | null | undefined;

  constructor(
    private readonly opts: { baseUrl: string; fetch: Fetch; store: KeyValueStore; clock: Clock },
  ) {}

  async getSession(): Promise<AuthSession | null> {
    if (this.cached === undefined) {
      const raw = await this.opts.store.get(SESSION_KEY);
      this.cached = raw ? (JSON.parse(raw) as AuthSession) : null;
    }
    const s = this.cached;
    if (s && s.expiresAt !== null && s.expiresAt * 1000 <= this.opts.clock()) return null;
    return s;
  }

  async getAccessToken() {
    return (await this.getSession())?.accessToken ?? null;
  }

  async signInAnonymously() {
    const session = await this.request('/v1/dev/auth/anonymous', {}, null);
    await this.store(session, 'SIGNED_IN');
    return session;
  }

  async linkIdentity(c: IdTokenCredential): Promise<LinkResult> {
    const current = await this.getSession();
    if (!current) throw new AuthError('not_signed_in');
    let session: AuthSession;
    try {
      session = await this.request('/v1/dev/auth/google', parseDevIdToken(c.idToken), current.accessToken);
    } catch (err) {
      if (err instanceof AuthError && err.code === 'identity_already_exists') return { status: 'identity_already_exists' };
      throw err;
    }
    if (session.user.id !== current.user.id) {
      // The dev identity belongs to another account: same branch as Supabase's identity_already_exists.
      return { status: 'identity_already_exists' };
    }
    await this.store(session, 'USER_UPDATED');
    return { status: 'linked', session };
  }

  async signInWithIdToken(c: IdTokenCredential) {
    const session = await this.request('/v1/dev/auth/google', parseDevIdToken(c.idToken), null);
    await this.store(session, 'SIGNED_IN');
    return session;
  }

  async refreshSession() {
    return this.getSession();
  }

  async signOut() {
    this.cached = null;
    await this.opts.store.delete(SESSION_KEY);
    this.emit('SIGNED_OUT', null);
  }

  onAuthStateChange(listener: (event: AuthEvent, session: AuthSession | null) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AuthEvent, session: AuthSession | null) {
    for (const l of [...this.listeners]) l(event, session);
  }

  private async store(session: AuthSession, event: AuthEvent) {
    this.cached = session;
    await this.opts.store.set(SESSION_KEY, JSON.stringify(session));
    this.emit(event, session);
  }

  private async request(path: string, body: object, bearer: string | null): Promise<AuthSession> {
    let res;
    try {
      res = await this.opts.fetch(`${this.opts.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AuthError('network');
    }
    if (res.status === 429) throw new AuthError('rate_limited', undefined, 429);
    if (res.status === 409) throw new AuthError('identity_already_exists', undefined, 409);
    if (!res.ok) throw new AuthError('unknown', `http_${res.status}`, res.status);
    return this.toSession((await res.json()) as DevTokenResponse);
  }

  private toSession(r: DevTokenResponse): AuthSession {
    const accessToken = r.access_token ?? r.token ?? r.jwt;
    if (!accessToken) throw new AuthError('unknown', 'no token in response');
    const claims = decodeJwtClaims(accessToken) ?? {};
    const id = r.user?.id ?? (typeof claims['sub'] === 'string' ? claims['sub'] : undefined);
    if (!id) throw new AuthError('unknown', 'token has no sub');
    const exp =
      r.expires_at ??
      (r.expires_in !== undefined ? Math.floor(this.opts.clock() / 1000) + r.expires_in : undefined) ??
      (typeof claims['exp'] === 'number' ? claims['exp'] : null);
    return {
      accessToken,
      refreshToken: r.refresh_token ?? null,
      expiresAt: exp ?? null,
      user: { id, isAnonymous: r.user?.is_anonymous ?? claims['is_anonymous'] === true },
    };
  }
}
