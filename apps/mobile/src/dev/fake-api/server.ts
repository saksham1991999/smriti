/**
 * FAKE API, dev and test only. Never shipped as a backend and never reachable from a
 * production build (services pick it only with APP_ENV local/test and EXPO_PUBLIC_FAKE_API=1,
 * or when a test injects it).
 *
 * It implements the client-facing slice of `docs/contracts/sync.md` v1.2 so the app can run its
 * whole journey without apps/api: dev auth (anonymous, Google, refresh), `POST /v1/sync/events`,
 * `GET /v1/sync/state`, plus `GET /v1/config`, `GET /v1/billing/intro-eligibility` and a dev
 * purchase endpoint that plays RevenueCat's webhook. State is recomputed from the stored events
 * with app-core's own rules (streak, plant, pet), the way the server's roll-up does (TRD §10).
 */
import {
  CONTRACT_V1_EVENT_TYPES,
  DEFAULT_RULES,
  EMPTY_STREAK,
  NEW_PLANT,
  activityByDay,
  addDays,
  derivePetState,
  localDate,
  nextStageAt,
  qualifiesDay,
  rollPlant,
  rollStreak,
  stageForPoints,
  streakView,
  type AgeBand,
  type EntitlementSection,
  type Fetch,
  type HttpRequestInit,
  type HttpResponse,
  type SrsCardState,
  type SyncEventPayloads,
  type SyncStateResponse,
  type TopicProgress,
  type WireEvent,
} from '@smriti/app-core';

import { CATALOGUE_SNAPSHOT, type CatalogueExam } from '../../content/catalogue';

interface FakeUser {
  id: string;
  isAnonymous: boolean;
  email: string | null;
  displayName: string | null;
  events: WireEvent[];
  eventIds: Set<string>;
  stateVersion: number;
  entitlement: EntitlementSection;
  introUsed: boolean;
  createdAt: number;
}

interface FakeToken {
  userId: string;
  expiresAt: number;
}

export interface FakeApiOptions {
  clock?: () => number;
  /** Seconds an access token lives (tests shorten it to exercise refresh). */
  tokenTtlS?: number;
  /** Exams for ONB-02, normally from the live catalogue (R7). */
  catalogue?: FakeCatalogueExam[];
  /** Simulate an outage: every sync call answers this status. */
  failSyncWith?: number | null;
}

export type FakeCatalogueExam = CatalogueExam;

/** The dev catalogue is the app's build-time snapshot (src/content/catalogue.ts). */
export const DEV_CATALOGUE: FakeCatalogueExam[] = CATALOGUE_SNAPSHOT;

export interface FakeRequestLog {
  method: string;
  path: string;
  status: number;
}

const ACCEPTED_TYPES = new Set<string>(CONTRACT_V1_EVENT_TYPES);
const ANSWER_CONTEXTS = new Set(['lesson', 'check', 'fix', 'practice', 'review', 'challenge', 'chapter_test']);

export class FakeApiServer {
  readonly users = new Map<string, FakeUser>();
  readonly log: FakeRequestLog[] = [];
  private tokens = new Map<string, FakeToken>();
  private refreshTokens = new Map<string, string>();
  private byEmail = new Map<string, string>();
  private seq = 0;
  private readonly clock: () => number;
  private readonly ttl: number;
  failSyncWith: number | null;

  constructor(private readonly opts: FakeApiOptions = {}) {
    this.clock = opts.clock ?? (() => Date.now());
    this.ttl = opts.tokenTtlS ?? 3600;
    this.failSyncWith = opts.failSyncWith ?? null;
  }

  /** A `fetch` the app's platform layer can use in place of the network. */
  asFetch(): Fetch {
    return async (url: string, init?: HttpRequestInit) => this.handle(url, init ?? { method: 'GET' });
  }

  userByToken(token: string): FakeUser | null {
    const t = this.tokens.get(token);
    if (!t || t.expiresAt < this.clock() / 1000) return null;
    return this.users.get(t.userId) ?? null;
  }

  async handle(url: string, init: HttpRequestInit): Promise<HttpResponse> {
    const u = new URL(url, 'http://fake.local');
    const method = init.method ?? 'GET';
    const res = await this.route(method, u, init);
    this.log.push({ method, path: u.pathname, status: res.status });
    return res;
  }

  private async route(method: string, u: URL, init: HttpRequestInit): Promise<HttpResponse> {
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const bearer = (init.headers?.Authorization ?? init.headers?.authorization ?? '').replace(/^Bearer\s+/i, '') || null;
    const p = u.pathname;

    if (method === 'POST' && p === '/v1/dev/auth/anonymous') return json(200, this.issue(this.createUser(true)));
    if (method === 'POST' && p === '/v1/dev/auth/google') return this.google(body, bearer);
    if (method === 'POST' && p === '/v1/dev/auth/refresh') {
      const userId = this.refreshTokens.get(String(body.refresh_token ?? ''));
      const user = userId ? this.users.get(userId) : undefined;
      if (!user) return json(401, { code: 'session_ended' });
      this.refreshTokens.delete(String(body.refresh_token));
      return json(200, this.issue(user));
    }
    if (method === 'GET' && p === '/v1/config') return json(200, this.config());

    const user = bearer ? this.userByToken(bearer) : null;
    if (!user) return json(401, { code: 'unauthorized' });

    if (p.startsWith('/v1/sync/') && this.failSyncWith) return json(this.failSyncWith, { code: 'unavailable' });
    if (method === 'POST' && p === '/v1/sync/events') return this.events(user, body);
    if (method === 'GET' && p === '/v1/sync/state') return json(200, this.state(user));
    if (method === 'GET' && p === '/v1/billing/intro-eligibility') return json(200, { eligible: !user.introUsed && !user.isAnonymous });
    if (method === 'POST' && p === '/v1/dev/billing/purchase') {
      if (user.isAnonymous) return json(403, { code: 'sign_in_required' });
      const now = this.clock();
      const intro = !user.introUsed;
      user.introUsed = true;
      user.entitlement = {
        plan: 'pro',
        status: 'active',
        pro_until: new Date(now + 30 * 86_400_000).toISOString(),
        is_intro: intro,
        cancel_at_period_end: false,
        source: 'fake_store',
      };
      user.stateVersion = ++this.seq;
      return json(200, { transaction_id: `fake-${this.seq}` });
    }
    return json(404, { code: 'not_found' });
  }

  private google(body: Record<string, unknown>, bearer: string | null): HttpResponse {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!email.includes('@')) return json(400, { code: 'invalid_credentials' });
    const owner = this.byEmail.get(email);
    const current = bearer ? this.userByToken(bearer) : null;
    if (current && current.isAnonymous && !owner) {
      // Link: the same user is converted, so no data moves (TRD §6).
      current.isAnonymous = false;
      current.email = email;
      current.displayName = name || null;
      current.stateVersion = ++this.seq;
      this.byEmail.set(email, current.id);
      return json(200, this.issue(current));
    }
    if (owner) return json(200, this.issue(this.users.get(owner)!));
    const user = this.createUser(false);
    user.email = email;
    user.displayName = name || null;
    this.byEmail.set(email, user.id);
    return json(200, this.issue(user));
  }

  private createUser(anonymous: boolean): FakeUser {
    const id = fakeUuid(++this.seq);
    const user: FakeUser = {
      id,
      isAnonymous: anonymous,
      email: null,
      displayName: null,
      events: [],
      eventIds: new Set(),
      stateVersion: ++this.seq,
      entitlement: { plan: 'free', pro_until: null, status: 'active' },
      introUsed: false,
      createdAt: this.clock(),
    };
    this.users.set(id, user);
    return user;
  }

  private issue(user: FakeUser) {
    const exp = Math.floor(this.clock() / 1000) + this.ttl;
    const claims = { sub: user.id, role: 'authenticated', aud: 'authenticated', is_anonymous: user.isAnonymous, exp, amr: [{ method: user.isAnonymous ? 'anonymous' : 'oauth' }] };
    const access = `fakehdr.${b64url(JSON.stringify(claims))}.fakesig${++this.seq}`;
    const refresh = `fake-refresh-${this.seq}`;
    this.tokens.set(access, { userId: user.id, expiresAt: exp });
    this.refreshTokens.set(refresh, user.id);
    return { access_token: access, token_type: 'bearer', expires_in: this.ttl, refresh_token: refresh, user: { id: user.id, is_anonymous: user.isAnonymous } };
  }

  private events(user: FakeUser, body: Record<string, unknown>): HttpResponse {
    const events = body.events;
    if (!Array.isArray(events) || typeof body.device_id !== 'string') return json(422, { code: 'invalid_envelope' });
    if (events.length > 200) return json(413, { code: 'batch_too_large' });
    const accepted: string[] = [];
    const rejected: { event_id: string; code: string }[] = [];
    for (const raw of events as WireEvent[]) {
      const code = validate(raw);
      if (code) {
        rejected.push({ event_id: String(raw?.event_id ?? ''), code });
        continue;
      }
      accepted.push(raw.event_id);
      if (user.eventIds.has(raw.event_id)) continue; // idempotent replay
      user.eventIds.add(raw.event_id);
      user.events.push(raw);
    }
    if (accepted.length) user.stateVersion = ++this.seq;
    return json(200, { accepted, rejected, state_version: user.stateVersion });
  }

  /** The full state (the fake ignores `since` and always answers every section). */
  state(user: FakeUser): SyncStateResponse {
    const tz = user.events.at(-1)?.tz ?? 'Asia/Kolkata';
    const now = this.clock();
    const today = localDate(now, tz);
    const yesterday = addDays(today, -1);
    const days = activityByDay(
      user.events.map((e) => ({ type: e.type, occurred_at: e.occurred_at })),
      tz,
    );
    const inputs = [...days.entries()].map(([day, a]) => ({ day, qualified: qualifiesDay(a), rescue: a.rescueDone }));
    const past = inputs.filter((i) => i.day < today);
    const todayActivity = days.get(today);
    const todayQualified = todayActivity ? qualifiesDay(todayActivity) : false;

    const rolled = past.length ? rollStreak(EMPTY_STREAK, past, yesterday).state : EMPTY_STREAK;
    const view = streakView(rolled, today, { qualified: todayQualified });
    const plantRolled = past.length ? rollPlant(NEW_PLANT, past, yesterday).state : NEW_PLANT;
    const points = plantRolled.growthPoints + (todayQualified ? 1 : 0);
    const stageByPoints = stageForPoints(points);
    const pet = this.pet(user, plantRolled.health);

    const xp = user.events.filter((e) => e.type === 'lesson_completed') as WireEvent<'lesson_completed'>[];
    const xpToday = xp.filter((e) => localDate(e.occurred_at, tz) === today).reduce((s, e) => s + e.payload.xp, 0);
    const xpTotal = xp.reduce((s, e) => s + e.payload.xp, 0);

    return {
      state_version: user.stateVersion,
      profile: this.profile(user, tz),
      streak: {
        current: view.current,
        longest: view.longest,
        today_qualified: view.todayQualified,
        freezes_equipped: view.freezesEquipped,
        freezes_available: view.freezesEquipped,
        rest_day: null,
        at_risk: view.atRisk,
      },
      plant: {
        stage: stageByPoints,
        health: plantRolled.health,
        study_days: points,
        next_stage_at: nextStageAt(points),
        revival_progress: plantRolled.revivalProgress,
        revival_days: plantRolled.health === 'thriving' ? null : DEFAULT_RULES.plantRevivalDays[plantRolled.health],
      },
      pet,
      wallet: { xp_total: xpTotal, xp_today: xpToday, gems: 0 },
      srs: { cards: this.srs(user), deleted: [] },
      topic_progress: this.topics(user),
      entitlement: user.entitlement,
    };
  }

  private profile(user: FakeUser, tz: string) {
    const answers = user.events.filter((e) => e.type === 'onboarding_answer') as WireEvent<'onboarding_answer'>[];
    const last = (step: SyncEventPayloads['onboarding_answer']['step']) => [...answers].reverse().find((a) => a.payload.step === step)?.payload.value;
    const goal = last('goal');
    const goals = Array.isArray(goal) ? goal.map(String) : typeof goal === 'string' ? [goal] : [];
    const dailyGoal = Number(last('daily_goal') ?? 10);
    const settings = user.events.filter((e) => e.type === 'settings_changed') as WireEvent<'settings_changed'>[];
    const locale = [...settings].reverse().find((s) => s.payload.key === 'locale')?.payload.value;
    return {
      id: user.id,
      display_name: user.displayName,
      locale: locale === 'hi' ? ('hi' as const) : ('en' as const),
      is_guest: user.isAnonymous,
      age_band: ageBand(last('class'), last('birth_year'), this.clock()),
      exam_profile_ids: goals.filter((g) => g !== 'school' && g !== 'curious'),
      daily_goal_minutes: Number.isFinite(dailyGoal) ? dailyGoal : 10,
      timezone: tz,
    };
  }

  private pet(user: FakeUser, health: keyof typeof DEFAULT_RULES.plantRevivalDays | 'thriving') {
    const named = [...user.events].reverse().find((e) => e.type === 'pet_named') as WireEvent<'pet_named'> | undefined;
    if (!named) return null;
    const mood = health === 'thriving' ? 85 : health === 'droopy' ? 60 : health === 'dry' ? 45 : 30;
    const energy = 75;
    return { species: named.payload.species, name: named.payload.name, mood, energy, state: derivePetState({ mood, energy }) };
  }

  private srs(user: FakeUser): SrsCardState[] {
    const latest = new Map<string, WireEvent<'review_rated'>>();
    for (const e of user.events) if (e.type === 'review_rated') latest.set((e as WireEvent<'review_rated'>).payload.card_ref, e as WireEvent<'review_rated'>);
    return [...latest.values()].map((e) => ({
      card_ref: e.payload.card_ref,
      due: e.payload.fsrs_state.due,
      stability: e.payload.fsrs_state.stability,
      difficulty: e.payload.fsrs_state.difficulty,
      state: e.payload.fsrs_state.state,
      reps: e.payload.fsrs_state.reps,
      lapses: e.payload.fsrs_state.lapses,
      last_review: e.occurred_at,
      scheduled_days: e.payload.fsrs_state.scheduled_days,
      elapsed_days: e.payload.fsrs_state.elapsed_days,
    }));
  }

  private topics(user: FakeUser): TopicProgress[] {
    const out = new Map<string, TopicProgress>();
    for (const e of user.events) {
      if (e.type === 'lesson_started') {
        const p = (e as WireEvent<'lesson_started'>).payload;
        if (p.mode === 'quick_check') continue;
        if (!out.has(p.topic_id)) out.set(p.topic_id, { topic_id: p.topic_id, status: 'in_progress', percent: 0 });
      }
      if (e.type === 'lesson_completed') {
        const p = (e as WireEvent<'lesson_completed'>).payload;
        if (p.mode === 'quick_check') continue;
        // The real server knows each bite; the fake marks the topic learned on its first completion.
        out.set(p.topic_id, { topic_id: p.topic_id, status: 'learned', percent: 100, learned_via: 'lesson' });
      }
    }
    return [...out.values()];
  }

  private config() {
    return {
      exams: (this.opts.catalogue ?? DEV_CATALOGUE).filter((e) => e.phase <= 1),
      flags: {},
      min_version: '1.0.0',
      latest_version: '1.0.0',
      // PRD §11 and R33/R38: ₹1 for the first month, then ₹99/month, tax-inclusive.
      pricing: { intro_paise: 100, monthly_paise: 9900 },
      fake: true,
    };
  }
}

function validate(e: WireEvent | undefined): string | null {
  if (!e || typeof e.event_id !== 'string' || !e.event_id) return 'invalid_payload';
  if (typeof e.tz !== 'string' || !e.tz) return 'missing_tz';
  if (typeof e.occurred_at !== 'string' || Number.isNaN(Date.parse(e.occurred_at))) return 'invalid_payload';
  if (!ACCEPTED_TYPES.has(e.type)) return 'unknown_type';
  if (!e.payload || typeof e.payload !== 'object') return 'invalid_payload';
  if (e.type === 'answer_submitted') {
    const p = e.payload as SyncEventPayloads['answer_submitted'];
    if (!ANSWER_CONTEXTS.has(p.context)) return 'invalid_payload';
    if (typeof p.response === 'string' && p.response.length > 64) return 'free_text_not_allowed';
  }
  if (e.type === 'lesson_completed' && typeof (e.payload as { xp?: unknown }).xp !== 'number') return 'invalid_payload';
  return null;
}

function ageBand(cls: unknown, birthYear: unknown, now: number): AgeBand | null {
  const c = Number(cls);
  if (Number.isFinite(c) && c > 0) return c <= 5 ? 'u10' : c <= 7 ? '10_12' : '13_17';
  if (birthYear === 'declined') return '13_17';
  const y = Number(birthYear);
  if (!Number.isFinite(y) || y < 1900) return null;
  const age = new Date(now).getUTCFullYear() - y;
  // The year is ambiguous in the year the student turns 18: the younger option wins (onboarding §6.2).
  if (age > 18) return '18p';
  if (age >= 13) return '13_17';
  if (age >= 10) return '10_12';
  return 'u10';
}

function fakeUuid(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function b64url(text: string): string {
  const bytes: number[] = [];
  for (const ch of unescape(encodeURIComponent(text))) bytes.push(ch.charCodeAt(0));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += alphabet[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += alphabet[n & 63]!;
  }
  return out;
}

function json(status: number, data: unknown): HttpResponse {
  const text = JSON.stringify(data);
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
  };
}
