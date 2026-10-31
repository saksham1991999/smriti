/**
 * FAKE API, dev and test only: parent mode as apps/api `parent_mode` answers it (me-money §4.7,
 * SET-14 to SET-19). Links between a guardian and a child are made by a test or the dev demo
 * (`link`), standing in for AUTH-24 and SET-18. Minutes, lessons, reviews and the streak come
 * from the child's own synced events, as the server reads them from the child's rows.
 */
import { activityByDay, addDays, localDate, type HttpResponse, type LocalDate, type WireEvent } from '@smriti/app-core';

import type { FeatureContext, FeatureModule, FeatureRequest } from './features';
import { json, type FakeUser } from './server';

type DailyLimit = 15 | 30 | 45 | 60 | 90 | 120;
const DAILY_LIMITS: readonly number[] = [15, 30, 45, 60, 90, 120];

export interface FakeControls {
  daily_limit_min: DailyLimit | null;
  allowed_from: string | null;
  allowed_to: string | null;
  break_reminders: boolean;
  ask_before_switching: boolean;
  tutor_button: boolean;
  picture_rhymes: boolean;
  tutor_enabled: boolean;
  social_enabled: boolean;
  weekly_report: boolean;
  updated_at: string | null;
}

/** The API's `Controls` defaults (schemas/parent.py). */
const DEFAULT_CONTROLS: FakeControls = {
  daily_limit_min: null,
  allowed_from: null,
  allowed_to: null,
  break_reminders: false,
  ask_before_switching: false,
  tutor_button: false,
  picture_rhymes: false,
  tutor_enabled: true,
  social_enabled: true,
  weekly_report: true,
  updated_at: null,
};

export interface FakeTimeRequest {
  id: string;
  learner_user_id: string;
  minutes: number;
  status: 'pending' | 'allowed' | 'declined' | 'expired';
  for_date: LocalDate;
  created_at: string;
  decided_at: string | null;
}

interface Link {
  childId: string;
  firstName: string;
  kind: 'managed' | 'consent';
  ageBand: 'u10' | '10_12' | '13_17';
}

const TZ = 'Asia/Kolkata';

export class ParentFakes implements FeatureModule {
  /** Guardian id → linked children. */
  readonly links = new Map<string, Link[]>();
  /** Child id → controls (a row exists once a guardian saves, as `app.learner_controls`). */
  readonly controls = new Map<string, FakeControls>();
  readonly requests: FakeTimeRequest[] = [];
  /** Child id → preset cheers sent from SET-15. */
  readonly cheers = new Map<string, number>();
  private seq = 0;

  constructor(private readonly ctx: FeatureContext) {}

  /** Stands in for AUTH-24 / SET-18: links a child to a guardian with an active consent. */
  link(guardianId: string, childId: string, firstName: string, opts: { kind?: Link['kind']; ageBand?: Link['ageBand'] } = {}): void {
    const list = this.links.get(guardianId) ?? [];
    if (!list.some((l) => l.childId === childId)) list.push({ childId, firstName, kind: opts.kind ?? 'managed', ageBand: opts.ageBand ?? 'u10' });
    this.links.set(guardianId, list);
  }

  /** Sets a child's controls directly (tests, demos). */
  setControls(childId: string, patch: Partial<FakeControls>): void {
    this.controls.set(childId, { ...(this.controls.get(childId) ?? DEFAULT_CONTROLS), ...patch, updated_at: new Date(this.ctx.clock()).toISOString() });
  }

  route(req: FeatureRequest): HttpResponse | null {
    const { method, path: p, user } = req;
    if (method === 'GET' && p === '/v1/guardian/dashboard') return json(200, { learners: (this.links.get(user.id) ?? []).map((l) => this.card(l)) });
    let m = /^\/v1\/guardian\/learners\/([^/]+)\/(report|controls|friends)$/.exec(p);
    if (m) {
      const link = this.linkOf(user, m[1]!);
      if (!link) return json(404, { code: 'learner_not_found', message: "This child isn't linked to your account" });
      if (m[2] === 'report' && method === 'GET') return json(200, this.report(link, req.url.searchParams.get('week')));
      if (m[2] === 'friends' && method === 'GET') return json(200, []);
      if (m[2] === 'controls' && method === 'GET') return json(200, this.controlsOut(link.childId));
      if (m[2] === 'controls' && method === 'PUT') {
        const b = req.body;
        const limit = b.daily_limit_min ?? null;
        if (limit !== null && !DAILY_LIMITS.includes(Number(limit))) return json(422, { code: 'validation_error' });
        if ((b.allowed_from == null) !== (b.allowed_to == null)) return json(422, { code: 'validation_error' });
        this.setControls(link.childId, {
          daily_limit_min: limit as DailyLimit | null,
          allowed_from: (b.allowed_from as string | null) ?? null,
          allowed_to: (b.allowed_to as string | null) ?? null,
          break_reminders: b.break_reminders === true,
          ask_before_switching: b.ask_before_switching === true,
          tutor_button: b.tutor_button === true,
          picture_rhymes: b.picture_rhymes === true,
          tutor_enabled: b.tutor_enabled !== false,
          social_enabled: b.social_enabled !== false,
          weekly_report: b.weekly_report !== false,
        });
        return json(200, this.controlsOut(link.childId));
      }
    }
    m = /^\/v1\/guardian\/time-requests\/([^/]+)\/decision$/.exec(p);
    if (m && method === 'POST') {
      const r = this.requests.find((x) => x.id === m![1]);
      if (!r || !this.linkOf(user, r.learner_user_id)) return json(404, { code: 'not_found' });
      if (r.for_date !== this.today()) return json(409, { code: 'request_expired' });
      if (r.status === 'pending') {
        r.status = req.body.allow === true ? 'allowed' : 'declined';
        r.decided_at = new Date(this.ctx.clock()).toISOString();
      }
      return json(200, r);
    }
    if (method === 'GET' && p === '/v1/me/limits') return json(200, this.limits(user));
    if (method === 'POST' && p === '/v1/me/time-requests') return this.ask(user);
    return null;
  }

  private today(): LocalDate {
    return localDate(this.ctx.clock(), TZ);
  }

  private linkOf(guardian: FakeUser, childId: string): Link | null {
    return (this.links.get(guardian.id) ?? []).find((l) => l.childId === childId) ?? null;
  }

  private guardiansOf(childId: string): string[] {
    return [...this.links.entries()].filter(([, ls]) => ls.some((l) => l.childId === childId)).map(([g]) => g);
  }

  private controlsOut(childId: string) {
    return { ...(this.controls.get(childId) ?? DEFAULT_CONTROLS), learner_user_id: childId };
  }

  /** Minutes, lessons and reviews per local day from the child's synced events. */
  private days(child: FakeUser | null): Map<LocalDate, { minutes: number; lessons: number; reviews: number }> {
    const out = new Map<LocalDate, { minutes: number; lessons: number; reviews: number }>();
    if (!child) return out;
    for (const [day, a] of activityByDay(child.events, TZ)) out.set(day, { minutes: 0, lessons: a.lessonsCompleted, reviews: a.reviews });
    for (const e of child.events) {
      if (e.type !== 'lesson_completed') continue;
      const day = localDate(e.occurred_at, TZ);
      const row = out.get(day) ?? { minutes: 0, lessons: 0, reviews: 0 };
      row.minutes += Math.round((e as WireEvent<'lesson_completed'>).payload.ms_total / 60_000);
      out.set(day, row);
    }
    return out;
  }

  private weekStart(day: LocalDate): LocalDate {
    const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
    return addDays(day, -dow);
  }

  private card(l: Link) {
    const child = this.ctx.user(l.childId);
    const state = child ? this.ctx.state(child) : null;
    const days = this.days(child);
    const start = this.weekStart(this.today());
    let week = 0;
    for (let i = 0; i < 7; i++) week += days.get(addDays(start, i))?.minutes ?? 0;
    const pending = this.requests.filter((r) => r.learner_user_id === l.childId && r.status === 'pending' && r.for_date === this.today());
    return {
      user_id: l.childId,
      first_name: l.firstName,
      kind: l.kind,
      age_band: l.ageBand,
      consent_pending: false,
      is_pro: child?.entitlement.plan === 'pro',
      needs_you: pending.length > 0,
      pet: state?.pet ? { name: state.pet.name, species: state.pet.species, state: state.pet.state } : null,
      practice_questions: 0,
      streak: state?.streak?.current ?? 0,
      week_minutes: week,
      last_mock: null,
      time_requests: pending,
    };
  }

  private report(l: Link, week: string | null) {
    const child = this.ctx.user(l.childId);
    const state = child ? this.ctx.state(child) : null;
    const days = this.days(child);
    const start = this.weekStart(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : this.today());
    const rows = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => ({ day, ...(days.get(day) ?? { minutes: 0, lessons: 0, reviews: 0 }) }));
    return {
      user_id: l.childId,
      first_name: l.firstName,
      week_start: start,
      week_end: addDays(start, 6),
      minutes: rows.reduce((n, r) => n + r.minutes, 0),
      lessons: rows.reduce((n, r) => n + r.lessons, 0),
      reviews: rows.reduce((n, r) => n + r.reviews, 0),
      streak: state?.streak?.current ?? 0,
      practice_questions: 0,
      days: rows.map((r) => ({ day: r.day, minutes: r.minutes })),
      subjects: [],
      mocks: [],
      coming_up: [],
    };
  }

  private minutesToday(childId: string): number {
    return this.days(this.ctx.user(childId)).get(this.today())?.minutes ?? 0;
  }

  private limits(child: FakeUser) {
    const today = this.today();
    const row = this.controls.get(child.id);
    const base = { today, minutes_today: 0, extra_minutes: 0, controlled: false, within_hours: true, ...DEFAULT_CONTROLS };
    if (!row) return base;
    const used = this.minutesToday(child.id);
    const extra = this.requests.filter((r) => r.learner_user_id === child.id && r.for_date === today && r.status === 'allowed').reduce((n, r) => n + r.minutes, 0);
    const limit = row.daily_limit_min !== null ? row.daily_limit_min + extra : null;
    const latest = this.requests.filter((r) => r.learner_user_id === child.id && r.for_date === today).at(-1) ?? null;
    return {
      ...base,
      ...row,
      controlled: true,
      minutes_today: used,
      extra_minutes: extra,
      limit_today: limit,
      remaining_minutes: limit !== null ? Math.max(limit - used, 0) : null,
      within_hours: this.within(row.allowed_from, row.allowed_to),
      request: latest,
    };
  }

  private within(from: string | null, to: string | null): boolean {
    if (!from || !to) return true;
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(this.ctx.clock());
    const hh = parts.find((x) => x.type === 'hour')?.value ?? '00';
    const mm = parts.find((x) => x.type === 'minute')?.value ?? '00';
    const now = `${hh}:${mm}`;
    const f = from.slice(0, 5);
    const t = to.slice(0, 5);
    return f <= t ? now >= f && now < t : now >= f || now < t;
  }

  /** As `parent_mode.ask_for_time`: one open ask at a time, none after a "Not today". */
  private ask(child: FakeUser): HttpResponse {
    const today = this.today();
    const row = this.controls.get(child.id);
    if (!row || row.daily_limit_min === null || this.guardiansOf(child.id).length === 0) return json(409, { code: 'no_time_limit', message: 'There is no time limit to extend' });
    const todays = this.requests.filter((r) => r.learner_user_id === child.id && r.for_date === today);
    const pending = todays.find((r) => r.status === 'pending');
    if (pending) return json(200, pending);
    if (todays.some((r) => r.status === 'declined')) return json(409, { code: 'declined_today', message: 'Not today. See you tomorrow!' });
    const r: FakeTimeRequest = {
      id: `00000000-0000-7000-9000-${String(++this.seq).padStart(12, '0')}`,
      learner_user_id: child.id,
      minutes: 15,
      status: 'pending',
      for_date: today,
      created_at: new Date(this.ctx.clock()).toISOString(),
      decided_at: null,
    };
    this.requests.push(r);
    return json(201, r);
  }
}
