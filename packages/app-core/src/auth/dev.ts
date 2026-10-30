import type { Clock, Fetch } from '../platform';
import type { KeyValueStore } from '../storage/types';
import {
  AuthError,
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

/** The dev token response (sync contract v1.1 "Dev auth"), shaped like Supabase's token endpoint. */
export interface DevTokenResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  refresh_token: string;
  user: { id: string; is_anonymous: boolean };
}

const SESSION_KEY = 'auth.dev.session';
/** Refresh this many seconds before expiry, as supabase-js does. */
const REFRESH_MARGIN_S = 60;

/**
 * `AuthClient` against the API's dev endpoints (`APP_ENV=local` or `test` only). The tokens are
 * shaped like Supabase's, so the rest of the app cannot tell the difference. An expiring session
 * is refreshed through `POST /v1/dev/auth/refresh`; a refused refresh ends the session.
 */
export class DevAuthClient implements AuthClient {
  private listeners = new Set<(event: AuthEvent, session: AuthSession | null) => void>();
  private cached: AuthSession | null | undefined;
  private refreshing: Promise<AuthSession | null> | null = null;

  constructor(
    private readonly opts: { baseUrl: string; fetch: Fetch; store: KeyValueStore; clock: Clock },
  ) {}

  async getSession(): Promise<AuthSession | null> {
    const s = await this.load();
    if (!s) return null;
    const nowS = this.opts.clock() / 1000;
    if (s.expiresAt === null || s.expiresAt - REFRESH_MARGIN_S > nowS) return s;
    try {
      return await this.refreshSession();
    } catch (err) {
      // Offline: keep using the token until it actually expires.
      if (err instanceof AuthError && err.code === 'network') return s.expiresAt > nowS ? s : null;
      throw err;
    }
  }

  async getAccessToken() {
    return (await this.getSession())?.accessToken ?? null;
  }

  async signInAnonymously() {
    const session = await this.request('/v1/dev/auth/anonymous', {}, null);
    await this.save(session, 'SIGNED_IN');
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
    await this.save(session, 'USER_UPDATED');
    return { status: 'linked', session };
  }

  async signInWithIdToken(c: IdTokenCredential) {
    const session = await this.request('/v1/dev/auth/google', parseDevIdToken(c.idToken), null);
    await this.save(session, 'SIGNED_IN');
    return session;
  }

  /** Refreshes now (one request shared by concurrent callers). A 400 or 401 ends the session. */
  refreshSession(): Promise<AuthSession | null> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async signOut() {
    await this.clear();
    this.emit('SIGNED_OUT', null);
  }

  onAuthStateChange(listener: (event: AuthEvent, session: AuthSession | null) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async doRefresh(): Promise<AuthSession | null> {
    const s = await this.load();
    if (!s?.refreshToken) return null;
    let session: AuthSession;
    try {
      session = await this.request('/v1/dev/auth/refresh', { refresh_token: s.refreshToken }, null);
    } catch (err) {
      if (err instanceof AuthError && err.code === 'session_ended') {
        await this.clear();
        this.emit('SIGNED_OUT', null);
        return null;
      }
      throw err;
    }
    await this.save(session, 'TOKEN_REFRESHED');
    return session;
  }

  private async load(): Promise<AuthSession | null> {
    if (this.cached === undefined) {
      const raw = await this.opts.store.get(SESSION_KEY);
      this.cached = raw ? (JSON.parse(raw) as AuthSession) : null;
    }
    return this.cached;
  }

  private async clear() {
    this.cached = null;
    await this.opts.store.delete(SESSION_KEY);
  }

  private emit(event: AuthEvent, session: AuthSession | null) {
    for (const l of [...this.listeners]) l(event, session);
  }

  private async save(session: AuthSession, event: AuthEvent) {
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
    if (res.status === 400 || res.status === 401) throw new AuthError('session_ended', undefined, res.status);
    if (!res.ok) throw new AuthError('unknown', `http_${res.status}`, res.status);
    return this.toSession((await res.json()) as DevTokenResponse);
  }

  private toSession(r: DevTokenResponse): AuthSession {
    if (typeof r.access_token !== 'string' || typeof r.user?.id !== 'string' || typeof r.expires_in !== 'number') {
      throw new AuthError('unknown', 'bad dev token response');
    }
    return {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? null,
      expiresAt: Math.floor(this.opts.clock() / 1000) + r.expires_in,
      user: { id: r.user.id, isAnonymous: r.user.is_anonymous === true },
    };
  }
}
