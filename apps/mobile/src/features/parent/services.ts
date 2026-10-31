import type { components } from '@smriti/api-client';

import { unwrap } from '../../services/api';
import type { SmritiApp } from '../../services/app';
import { deviceLimits } from './limits';
import { parentSession } from './session';

export type Dashboard = components['schemas']['Dashboard'];
export type ChildCard = components['schemas']['ChildCard'];
export type WeekReport = components['schemas']['WeekReport'];
export type ControlsOut = components['schemas']['ControlsOut'];
export type Controls = components['schemas']['Controls'];
export type DailyLimit = NonNullable<Controls['daily_limit_min']>;

/** Guardian calls go out with the parent's token (`parentSession(app).api`), never the child's. */
const api = (app: SmritiApp) => parentSession(app).api;

export function loadDashboard(app: SmritiApp): Promise<Dashboard> {
  return unwrap(api(app).GET('/v1/guardian/dashboard'));
}

export function loadReport(app: SmritiApp, learnerId: string, week?: string): Promise<WeekReport> {
  return unwrap(api(app).GET('/v1/guardian/learners/{learner_id}/report', { params: { path: { learner_id: learnerId }, query: week ? { week } : {} } }));
}

export function loadControls(app: SmritiApp, learnerId: string): Promise<ControlsOut> {
  return unwrap(api(app).GET('/v1/guardian/learners/{learner_id}/controls', { params: { path: { learner_id: learnerId } } }));
}

export function toControls(c: ControlsOut): Controls {
  const { learner_user_id: _l, updated_at: _u, ...rest } = c;
  return rest;
}

export async function saveControls(app: SmritiApp, learnerId: string, body: Controls): Promise<ControlsOut> {
  const out = await unwrap(api(app).PUT('/v1/guardian/learners/{learner_id}/controls', { params: { path: { learner_id: learnerId } }, body, headers: { 'Idempotency-Key': app.newId() } }));
  // A child on this phone picks the new limits up at once (SET-16 "on the child's device").
  if (learnerId === app.store.getState().session.userId) await deviceLimits(app).refresh();
  return out;
}

export async function decideTimeRequest(app: SmritiApp, requestId: string, allow: boolean) {
  app.track('time_request_decided', { decision: allow ? 'allowed' : 'declined' });
  const out = await unwrap(api(app).POST('/v1/guardian/time-requests/{request_id}/decision', { params: { path: { request_id: requestId } }, body: { allow }, headers: { 'Idempotency-Key': app.newId() } }));
  // Decided on the child's own phone: the extra minutes apply here at once.
  if (out.learner_user_id === app.store.getState().session.userId) await deviceLimits(app).checkRequest();
  return out;
}

/** "Most on Saturday, 42 minutes" for the mini chart (SET-14 accessibility). */
export function busiestDay(days: { day: string; minutes: number }[]): { day: string; minutes: number } | null {
  const top = days.reduce<{ day: string; minutes: number } | null>((best, d) => (d.minutes > (best?.minutes ?? 0) ? d : best), null);
  return top && top.minutes > 0 ? top : null;
}

export function weekdayShort(day: string, locale: 'en' | 'hi'): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

export function weekdayLong(day: string, locale: 'en' | 'hi'): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

export function dateRange(start: string, end: string, locale: 'en' | 'hi'): string {
  const f = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${f.format(new Date(`${start}T00:00:00Z`))} – ${f.format(new Date(`${end}T00:00:00Z`))}`;
}
