import {
  NO_TIME_LIMITS,
  canAskForMoreTime,
  grantMoreTime,
  timeLimitState,
  timeUseFor,
  type MoreTimeAnswer,
  type ParentSettings,
  type TimeLimitState,
  type TimeLimits,
  type TimeUse,
} from '@smriti/app-core';
import type { components } from '@smriti/api-client';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { unwrap } from '../../services/api';
import type { SmritiApp } from '../../services/app';

export type MyLimits = components['schemas']['MyLimits'];
export type TimeRequest = components['schemas']['TimeRequestOut'];

const LIMITS_KEY = 'parent.limits.v1';
const USE_KEY = 'parent.time_use.v1';

export interface DeviceLimitsState {
  /** The last `/v1/me/limits` answer (cached so limits apply offline, SET-16). */
  limits: MyLimits | null;
  use: TimeUse | null;
  /** SET-19's request, while one is open today. */
  request: TimeRequest | null;
}

/** "16:00:00" → "16:00". */
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

/** SET-16 values as app-core's time-limit rules take them. */
export function toTimeLimits(l: MyLimits | null): TimeLimits {
  if (!l || !l.controlled) return NO_TIME_LIMITS;
  const from = hhmm(l.allowed_from);
  const to = hhmm(l.allowed_to);
  return { dailyMinutes: l.daily_limit_min ?? 0, allowedHours: from && to ? { start: from, end: to } : null };
}

/** The little learner settings a parent turns on in SET-14 (both off by default, R14). */
export function parentSettingsFrom(l: MyLimits | null): ParentSettings {
  return { tutorButton: l?.tutor_button === true, pictureRhymes: l?.picture_rhymes === true };
}

/**
 * The child's side of parent mode on this device: the limits the parent set, today's minutes
 * counted here, and SET-19's "Ask for 15 more minutes". The time limit is enforced on the device
 * with app-core's `timeLimitState`, so it holds offline (me-money §4.7).
 */
export class DeviceLimits {
  readonly store: StoreApi<DeviceLimitsState> = createStore<DeviceLimitsState>()(() => ({ limits: null, use: null, request: null }));
  private loaded: Promise<void> | null = null;

  constructor(private readonly app: SmritiApp) {}

  load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        const kv = this.app.deps.stores.kv;
        const limits = parse<MyLimits>(await kv.get(LIMITS_KEY));
        const use = parse<TimeUse>(await kv.get(USE_KEY));
        this.store.setState({ limits, use: timeUseFor(use, this.app.today()), request: limits?.request ?? null });
      })();
    }
    return this.loaded;
  }

  /** `GET /v1/me/limits`. Offline keeps the cached answer. */
  async refresh(): Promise<MyLimits | null> {
    await this.load();
    try {
      const limits = await unwrap(this.app.api.GET('/v1/me/limits'));
      const use = timeUseFor(this.store.getState().use, this.app.today());
      // The server counts synced minutes from every device; the device counts unsynced ones.
      const merged: TimeUse = {
        ...use,
        usedMinutes: Math.max(use.usedMinutes, limits.minutes_today),
        extraMinutes: Math.max(use.extraMinutes, limits.extra_minutes),
      };
      await this.app.deps.stores.kv.set(LIMITS_KEY, JSON.stringify(limits));
      await this.saveUse(merged);
      this.store.setState({ limits, request: limits.request ?? null });
      return limits;
    } catch {
      return this.store.getState().limits;
    }
  }

  timeLimits(): TimeLimits {
    return toTimeLimits(this.store.getState().limits);
  }

  use(): TimeUse {
    return timeUseFor(this.store.getState().use, this.app.today());
  }

  /** One more active minute on this device. */
  async addMinutes(minutes: number): Promise<void> {
    const u = this.use();
    await this.saveUse({ ...u, usedMinutes: u.usedMinutes + minutes });
  }

  state(inActivity: boolean): TimeLimitState {
    return timeLimitState(this.timeLimits(), this.use(), { now: this.app.now(), timeZone: this.app.deps.timeZone(), inActivity });
  }

  canAsk(): MoreTimeAnswer {
    return canAskForMoreTime(this.use(), this.app.deps.network.isOnline(), this.app.flags.get('parent.time_requests_per_day'));
  }

  /** SET-19 [Ask for 15 more minutes] → `POST /v1/me/time-requests`. */
  async ask(): Promise<{ kind: 'sent'; request: TimeRequest } | { kind: 'declined_today' } | MoreTimeAnswer> {
    const can = this.canAsk();
    if (can.kind !== 'can_ask') return can;
    const res = await this.app.api.POST('/v1/me/time-requests', { headers: { 'Idempotency-Key': this.app.newId() } });
    if (res.error || !res.data) {
      const code = (res.error as { code?: string } | undefined)?.code;
      return code === 'declined_today' ? { kind: 'declined_today' } : { kind: 'needs_internet' };
    }
    const u = this.use();
    await this.saveUse({ ...u, requestsToday: u.requestsToday + 1 });
    this.store.setState({ request: res.data });
    this.app.track('time_request_sent', { decision: 'sent' });
    return { kind: 'sent', request: res.data };
  }

  /** Polls the open request: an approval extends today's budget at once. */
  async checkRequest(): Promise<TimeRequest | null> {
    const limits = await this.refresh();
    const req = limits?.request ?? null;
    if (req?.status === 'allowed') {
      const u = this.use();
      if (u.extraMinutes < (limits?.extra_minutes ?? 0)) await this.saveUse(grantMoreTime(u, (limits?.extra_minutes ?? 0) - u.extraMinutes));
    }
    return req;
  }

  private async saveUse(use: TimeUse): Promise<void> {
    await this.app.deps.stores.kv.set(USE_KEY, JSON.stringify(use));
    this.store.setState({ use });
  }
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const perApp = new WeakMap<SmritiApp, DeviceLimits>();

export function deviceLimits(app: SmritiApp): DeviceLimits {
  let d = perApp.get(app);
  if (!d) {
    d = new DeviceLimits(app);
    perApp.set(app, d);
  }
  return d;
}
