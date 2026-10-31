import {
  AuthError,
  DevAuthClient,
  SupabaseAuthClient,
  createNonce,
  createSupabaseClientForProfile,
  hashParentPin,
  parentGateSteps,
  verifyParentPin,
  type AuthClient,
  type DevIdentity,
  type KeyValueStore,
  type ParentGateStep,
  type PinAttempts,
  type StoredParentPin,
} from '@smriti/app-core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { withDevLinkFlag } from '../../auth/devLinkFetch';
import { createMobileApiClient, type ApiClient } from '../../services/api';
import type { SmritiApp } from '../../services/app';
import { experienceFor } from '../little/experience';

const PIN_KEY = 'parent.pin.v1';
const ATTEMPTS_KEY = 'parent.pin.attempts.v1';
const NAME_KEY = 'parent.name.v1';
/** proposed (R56): 5 wrong tries lock the PIN for 5 minutes. */
const PIN_LIMITS = { maxFailures: 5, lockMs: 5 * 60_000 };

/** Keys under a prefix, so the parent's session never touches the child's in the same store. */
class PrefixedStore implements KeyValueStore {
  constructor(
    private readonly inner: KeyValueStore,
    private readonly prefix: string,
  ) {}
  get(k: string) {
    return this.inner.get(this.prefix + k);
  }
  set(k: string, v: string) {
    return this.inner.set(this.prefix + k, v);
  }
  delete(k: string) {
    return this.inner.delete(this.prefix + k);
  }
}

export interface ParentState {
  ready: boolean;
  /** The parent has signed in on this device before (SET-13 "returning"). */
  linked: boolean;
  pinSet: boolean;
  /** The parent's first name for [Continue as {parent}], when known. */
  name: string | null;
  /** Parent mode is open (until [Exit] or the app restarts). */
  unlocked: boolean;
}

export type SignInResult = 'ok' | 'cancelled' | 'offline' | 'error';
export type PinResult = { kind: 'ok' } | { kind: 'wrong' } | { kind: 'locked'; minutes: number };

/**
 * Parent mode's own sign-in (SET-13, AUTH-24). On a child's device (a little learner or a
 * managed child) the parent signs in with their own Google account in a separate session, so the
 * guardian calls (`/v1/guardian/*`) carry the parent's token while the child stays signed in. On
 * the parent's own device the app's session is the parent's, and parent mode uses it.
 * The optional 4-digit PIN is hashed with a per-device salt in secure storage (never synced).
 */
export class ParentSession {
  readonly store: StoreApi<ParentState> = createStore<ParentState>()(() => ({ ready: false, linked: false, pinSet: false, name: null, unlocked: false }));
  private readonly separateAuth: AuthClient;
  private readonly separateApi: ApiClient;
  private readonly secure: KeyValueStore;
  private loading: Promise<void> | null = null;

  constructor(private readonly app: SmritiApp) {
    const { env, variant, stores } = app.deps;
    this.secure = stores.secure;
    const scoped = new PrefixedStore(stores.secure, 'parent.');
    if (env.AUTH_MODE === 'supabase' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      this.separateAuth = new SupabaseAuthClient(
        createSupabaseClientForProfile({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, storage: stores.secure, storageKey: `smriti-${variant.id}-parent-auth`, fetch: app.deps.fetch as never }),
      );
    } else {
      this.separateAuth = new DevAuthClient({ baseUrl: env.API_BASE_URL, fetch: withDevLinkFlag(app.deps.fetch), store: scoped, clock: app.deps.clock });
    }
    this.separateApi = createMobileApiClient({
      baseUrl: env.API_BASE_URL,
      fetch: app.deps.fetch,
      getAccessToken: () => this.separateAuth.getAccessToken(),
      variant: variant.id,
      platform: app.deps.platform,
      deviceId: app.deps.deviceId,
      ...(app.deps.appVersion ? { appVersion: app.deps.appVersion } : {}),
    });
  }

  /** `own` on the parent's own device, `separate` on a child's (me-money §4.7). */
  mode(): 'own' | 'separate' {
    const exp = experienceFor(this.app);
    return exp.littleLearner || exp.timeLimits || exp.signIn === 'parent' ? 'separate' : 'own';
  }

  get api(): ApiClient {
    return this.mode() === 'own' ? this.app.api : this.separateApi;
  }

  load(): Promise<void> {
    if (!this.loading) this.loading = this.reload();
    return this.loading;
  }

  async reload(): Promise<void> {
    const pin = await this.secure.get(PIN_KEY);
    let linked: boolean;
    let name = await this.secure.get(NAME_KEY);
    if (this.mode() === 'own') {
      const s = this.app.store.getState();
      linked = s.session.status === 'signed_in' && !s.session.isGuest;
      name = s.profile?.display_name?.split(' ')[0] ?? name;
    } else {
      linked = (await this.separateAuth.getSession().catch(() => null)) !== null;
    }
    this.store.setState({ ready: true, linked, pinSet: pin !== null, name });
  }

  steps(): ParentGateStep[] {
    const s = this.store.getState();
    return parentGateSteps({ parentLinked: s.linked, pinSet: s.pinSet });
  }

  /** [Continue with Google] (first time on this device) or [Continue as {parent}] (re-confirm). */
  async signIn(dev?: DevIdentity): Promise<SignInResult> {
    if (!this.app.deps.network.isOnline()) return 'offline';
    if (this.mode() === 'own') {
      const out = await this.app.continueWithGoogle(dev);
      if (out.status !== 'linked' && out.status !== 'restored') return out.status === 'cancelled' ? 'cancelled' : 'error';
    } else {
      try {
        const nonce = await createNonce(this.app.deps.crypto);
        const credential = await this.app.deps.google.signIn(nonce, dev);
        if (!credential) return 'cancelled';
        await this.separateAuth.signInWithIdToken(credential);
      } catch (err) {
        return err instanceof AuthError && err.code === 'network' ? 'offline' : 'error';
      }
    }
    const first = dev?.name?.trim().split(/\s+/)[0];
    if (first) await this.secure.set(NAME_KEY, first);
    await this.reload();
    this.open('device');
    return 'ok';
  }

  /** Re-confirm a returning parent. The dev build has no account picker, so it confirms at once. */
  async confirm(): Promise<SignInResult> {
    if (this.app.deps.google.kind === 'native') return this.signIn();
    this.open(this.mode() === 'own' ? 'own_account' : 'device');
    return 'ok';
  }

  async setPin(pin: string): Promise<void> {
    await this.secure.set(PIN_KEY, JSON.stringify(await hashParentPin(this.app.deps.crypto, pin)));
    await this.secure.delete(ATTEMPTS_KEY);
    this.store.setState({ pinSet: true });
  }

  async checkPin(pin: string): Promise<PinResult> {
    const raw = await this.secure.get(PIN_KEY);
    if (!raw) return { kind: 'wrong' };
    const stored = JSON.parse(raw) as StoredParentPin;
    const attempts = JSON.parse((await this.secure.get(ATTEMPTS_KEY)) ?? '{"failures":0,"lockedUntilMs":null}') as PinAttempts;
    const now = this.app.now();
    const r = await verifyParentPin(this.app.deps.crypto, stored, pin, attempts, now, PIN_LIMITS);
    await this.secure.set(ATTEMPTS_KEY, JSON.stringify(r.attempts));
    if (r.ok) {
      this.open('device');
      return { kind: 'ok' };
    }
    if (r.locked) return { kind: 'locked', minutes: Math.max(1, Math.ceil(((r.attempts.lockedUntilMs ?? now) - now) / 60_000)) };
    return { kind: 'wrong' };
  }

  /** Remaining lock in minutes, or 0. */
  async lockedMinutes(): Promise<number> {
    const a = JSON.parse((await this.secure.get(ATTEMPTS_KEY)) ?? '{"failures":0,"lockedUntilMs":null}') as PinAttempts;
    const left = (a.lockedUntilMs ?? 0) - this.app.now();
    return left > 0 ? Math.ceil(left / 60_000) : 0;
  }

  private open(entry: 'device' | 'own_account') {
    this.store.setState({ unlocked: true });
    this.app.track('parent_mode_opened', { entry });
  }

  /** SET-14 [Exit]: back to the child's view. The parent stays signed in for next time. */
  exit(): void {
    this.store.setState({ unlocked: false });
  }

  /** Signs the parent out of this device (the child's session is untouched). */
  async forget(): Promise<void> {
    if (this.mode() === 'separate') await this.separateAuth.signOut({ scope: 'local' }).catch(() => undefined);
    for (const k of [PIN_KEY, ATTEMPTS_KEY, NAME_KEY]) await this.secure.delete(k);
    this.store.setState({ linked: false, pinSet: false, name: null, unlocked: false });
  }
}

const perApp = new WeakMap<SmritiApp, ParentSession>();

export function parentSession(app: SmritiApp): ParentSession {
  let s = perApp.get(app);
  if (!s) {
    s = new ParentSession(app);
    perApp.set(app, s);
  }
  return s;
}
