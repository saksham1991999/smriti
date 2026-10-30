/**
 * FAKE API, dev and test only. Never shipped as a backend and never reachable from a
 * production build (services pick it only with APP_ENV local/test and EXPO_PUBLIC_FAKE_API=1,
 * or when a test injects it).
 *
 * It implements the client-facing slice of `docs/contracts/sync.md` v1.2 so the app can run its
 * whole journey without apps/api: dev auth (anonymous, Google, refresh), `POST /v1/sync/events`,
 * `GET /v1/sync/state`, plus `GET /v1/config`, `GET /v1/catalog/exams`,
 * `GET /v1/billing/intro-eligibility`, `POST /v1/devices` and `POST /v1/webhooks/revenuecat`. State is recomputed from the stored events
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
  /** Last answer and version per state section, for `?since=`. */
  sections: Record<string, { json: string; version: number }>;
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
  /** The Authorization value `/v1/webhooks/revenuecat` accepts (FakeBilling sends it). */
  revenuecatWebhookAuth?: string;
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
  /** Every refused event, by type and code (tests assert this stays empty). */
  readonly rejections: { type: string; code: string }[] = [];
  private tokens = new Map<string, FakeToken>();
  private refreshTokens = new Map<string, string>();
  private byEmail = new Map<string, string>();
  private seq = 0;
  private readonly clock: () => number;
  private readonly ttl: number;
  private readonly revenuecatAuth: string;
  /** Outbox ids reported to `POST /v1/notifications/opened` (null for a plain app open). */
  readonly opened: (string | null)[] = [];
  /** Devices registered with `POST /v1/devices`, by user id. */
  readonly devices = new Map<string, { pushToken: string | null; permission: string }>();
  failSyncWith: number | null;

  constructor(private readonly opts: FakeApiOptions = {}) {
    this.clock = opts.clock ?? (() => Date.now());
    this.ttl = opts.tokenTtlS ?? 3600;
    this.revenuecatAuth = opts.revenuecatWebhookAuth ?? '';
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
    if (method === 'GET' && p === '/v1/catalog/exams') return json(200, this.exams());

    if (method === 'POST' && p === '/v1/webhooks/revenuecat') return this.revenuecat(body, init.headers?.Authorization ?? init.headers?.authorization ?? '');

    const user = bearer ? this.userByToken(bearer) : null;
    if (!user) return json(401, { code: 'unauthorized' });

    if (p.startsWith('/v1/sync/') && this.failSyncWith) return json(this.failSyncWith, { code: 'unavailable' });
    if (method === 'POST' && p === '/v1/sync/events') return this.events(user, body);
    if (method === 'GET' && p === '/v1/sync/state') return json(200, this.stateSince(user, u.searchParams.get('since')));
    if (method === 'GET' && p === '/v1/billing/intro-eligibility') {
      // As the server: null for a guest (only the hint is known until sign-in).
      const eligible = user.isAnonymous ? null : !user.introUsed;
      return json(200, {
        eligible,
        eligible_hint: !user.introUsed,
        reason: user.isAnonymous ? 'guest' : user.introUsed ? 'had_subscription' : null,
        intro_price_paise: eligible === false ? null : 100,
        price_paise: 9900,
      });
    }
    if (method === 'POST' && p === '/v1/devices') {
      const id = `dev-${user.id.slice(0, 8)}`;
      this.devices.set(user.id, { pushToken: typeof body.push_token === 'string' ? body.push_token : null, permission: String(body.notif_permission ?? 'not_asked') });
      return json(200, { id, has_push_token: typeof body.push_token === 'string', has_web_push: false, notif_permission: body.notif_permission ?? 'not_asked' });
    }
    if (method === 'POST' && p === '/v1/notifications/opened') {
      this.opened.push(typeof body.id === 'string' ? body.id : null);
      return raw(204, '', 'application/json');
    }
    // Practice, mocks and the tutor, shaped as apps/api returns them for a student with no
    // practice history and no published question bank. Quotas are unlimited: the fake invents
    // no limits (the real ones come from the API's flags).
    if (method === 'GET' && p === '/v1/practice/hub') {
      const unlimited = { used: 0, limit: null, remaining: null, unlimited: true };
      const day = new Date(this.clock()).toISOString().slice(0, 10);
      return json(200, {
        exam: u.searchParams.get('exam') ?? '',
        limits: { day, is_pro: user.entitlement.plan === 'pro', practice_questions: unlimited, sectional_mocks: unlimited, tutor_messages: unlimited },
        weak_spots: [],
        daily_challenge: { challenge_id: null, day, state: 'unavailable' },
        mock_in_progress: null,
        recent_sessions: [],
      });
    }
    if (method === 'GET' && p === '/v1/mocks') return json(200, []);
    if (method === 'GET' && p === '/v1/daily-challenge/today') return json(404, { code: 'not_found' });
    if (method === 'POST' && p === '/v1/tutor/sessions') {
      return json(200, {
        id: `00000000-0000-7000-8000-${user.id.replace(/-/g, '').slice(0, 12)}`,
        context: null,
        exam_profile_id: typeof body.exam === 'string' ? body.exam : null,
        last_message_at: null,
        locale: 'en',
        message_count: 0,
        messages: [],
        mode: 'chat',
        quota: { used: 0, limit: null, remaining: null, unlimited: true },
        resumed: false,
        started_at: new Date(this.clock()).toISOString(),
      });
    }
    if (method === 'POST' && /^\/v1\/tutor\/sessions\/[^/]+\/messages$/.test(p)) {
      const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      // Marked like the API's FakeLLMProvider so it can never pass for a real answer.
      const text = sse('delta', { text: `[fake] ${String(body.text ?? '')}` }) + sse('quota', { used: 0, limit: null, remaining: null, unlimited: true }) + sse('done', {});
      return raw(200, text, 'text/event-stream');
    }
    return json(404, { code: 'not_found' });
  }

  /** As the server's RevenueCat webhook: the exact Authorization value, then INITIAL_PURCHASE → Pro. */
  private revenuecat(body: Record<string, unknown>, authorization: string): HttpResponse {
    if (!this.revenuecatAuth || authorization !== this.revenuecatAuth) return json(401, { code: 'invalid_signature' });
    const ev = (body.event ?? {}) as Record<string, unknown>;
    const user = this.users.get(String(ev.app_user_id ?? ''));
    if (!user) return json(200, { status: 'ignored' });
    if (ev.type !== 'INITIAL_PURCHASE') return json(200, { status: 'ignored' });
    const intro = ev.period_type === 'INTRO' && !user.introUsed;
    if (intro) user.introUsed = true;
    user.entitlement = {
      plan: 'pro',
      status: intro ? 'trialing' : 'active',
      pro_until: new Date(Number(ev.expiration_at_ms ?? this.clock() + 30 * 86_400_000)).toISOString(),
      is_intro: intro,
      cancel_at_period_end: false,
      source: ev.store === 'APP_STORE' ? 'app_store' : 'play',
    };
    user.stateVersion = ++this.seq;
    return json(200, { status: 'applied' });
  }

  private google(body: Record<string, unknown>, bearer: string | null): HttpResponse {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!email.includes('@')) return json(400, { code: 'invalid_credentials' });
    const owner = this.byEmail.get(email);
    if (body.link === true) {
      // As the real API: linking needs the guest's bearer; an owned identity is a 409 (merge path).
      const current = bearer ? this.userByToken(bearer) : null;
      if (!current) return json(401, { code: 'unauthorized' });
      if (!current.isAnonymous) return json(409, { code: 'not_a_guest' });
      if (owner && owner !== current.id) return json(409, { code: 'identity_already_exists' });
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
      sections: {},
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
        this.rejections.push({ type: String(raw?.type ?? ''), code });
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

  /**
   * As the API: with `since`, only sections whose version is newer are sent; null sections are
   * left out, except `pet: null` in a full read (the student has no pet yet).
   */
  stateSince(user: FakeUser, since: string | null): Partial<SyncStateResponse> {
    const full = this.state(user) as unknown as Record<string, unknown>;
    const after = since === null ? null : Number(since);
    const out: Record<string, unknown> = { state_version: user.stateVersion };
    for (const [k, v] of Object.entries(full)) {
      if (k === 'state_version') continue;
      const json = JSON.stringify(v);
      const prev = user.sections[k];
      if (!prev || prev.json !== json) user.sections[k] = { json, version: user.stateVersion };
      const version = user.sections[k]!.version;
      if (after !== null && version <= after) continue;
      if (v === null && !(k === 'pet' && after === null)) continue;
      out[k] = v;
    }
    return out as Partial<SyncStateResponse>;
  }

  /** Every section, computed from the user's events with app-core's rules. */
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
    const xpToday = xp.filter((e) => localDate(e.occurred_at, tz) === today).reduce((s, e) => s + (e.payload.xp ?? 0), 0);
    const xpTotal = xp.reduce((s, e) => s + (e.payload.xp ?? 0), 0);

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
    const locale = [...settings].reverse().find((s) => s.payload.key === 'content_locale')?.payload.value;
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
    // The subset of the API's ConfigResponse the app reads. Prices: PRD §11 and R33/R38.
    const product = (platform: string, intro: boolean) => ({
      product_id: `pro_monthly${intro ? '_intro' : ''}_${platform}_fake`,
      platform,
      variant_id: null,
      store_product_id: 'fake',
      price_paise: 9900,
      intro_price_paise: intro ? 100 : null,
      period: 'month',
      entitlement: 'pro',
    });
    return {
      app_version: { min_version: '0.1.0', latest_version: '0.1.0', update_required: null },
      flags: {},
      free_limits: {},
      pricing: ['ios', 'android', 'web'].flatMap((p) => [product(p, true), product(p, false)]),
      content_base_url: 'http://fake.local/content',
      server_time: new Date(this.clock()).toISOString(),
      variants: ['all', 'jee', 'neet', 'upsc', 'ssc'],
    };
  }

  /** The API's `ExamOut[]` shape, built from the catalogue. */
  private exams() {
    return (this.opts.catalogue ?? DEV_CATALOGUE).map((e) => ({
      id: e.exam_id,
      category: e.category,
      conducting_body: null,
      official_url: null,
      is_active: true,
      name: e.name,
      profiles: [{ id: e.exam_profile_id, cycle: '2027', name: e.name, locales: ['en', 'hi'], schedule: null, is_active: true }],
    }));
  }
}

function validate(e: WireEvent | undefined): string | null {
  if (!e || typeof e.event_id !== 'string' || !e.event_id) return 'invalid_payload';
  if (typeof e.tz !== 'string' || !e.tz) return 'missing_tz';
  if (typeof e.occurred_at !== 'string' || Number.isNaN(Date.parse(e.occurred_at))) return 'invalid_payload';
  if (!ACCEPTED_TYPES.has(e.type)) return 'unknown_type';
  if (!e.payload || typeof e.payload !== 'object') return 'invalid_payload';
  // The rules below follow apps/api (schemas/sync.py, services/profile_rules.py).
  if (e.type === 'answer_submitted') {
    const p = e.payload as SyncEventPayloads['answer_submitted'] & { response: unknown };
    if (!ANSWER_CONTEXTS.has(p.context)) return 'invalid_payload';
    if (!p.card_id && !p.question_id) return 'invalid_payload';
    if (!isResponse(p.response)) return 'invalid_payload';
  }
  if (e.type === 'onboarding_answer') {
    const { step, value } = e.payload as { step: string; value: unknown };
    if (!ONBOARDING_RULES[step]?.(value)) return 'invalid_payload';
  }
  if (e.type === 'settings_changed' && !SETTINGS_KEYS.has((e.payload as { key: string }).key)) return 'invalid_payload';
  return null;
}

const RESPONSE_KEY = /^[A-Za-z0-9_.:-]{0,64}$/;
/** "The option ids, number or text key, never free text": a key, a list of keys, a number or null. */
function isResponse(r: unknown): boolean {
  if (r === null || r === undefined || typeof r === 'number') return true;
  if (typeof r === 'string') return RESPONSE_KEY.test(r);
  return Array.isArray(r) && r.every((k) => typeof k === 'string' && RESPONSE_KEY.test(k));
}

const SETTINGS_KEYS = new Set(['sound', 'haptics', 'reduced_motion', 'theme', 'mock_dark_mode', 'content_locale', 'tutor_locale', 'analytics_opt_out', 'start_mode', 'name_display']);

const ONBOARDING_RULES: Record<string, (v: unknown) => boolean> = {
  goal: (v) => v === null || v === 'curious' || typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')),
  class: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 12,
  birth_year: (v) => v === null || (typeof v === 'number' && v >= 1900),
  exam_date: (v) => v === null || typeof v === 'string',
  level: (v) => v === 'starting' || v === 'basics' || v === 'revising',
  daily_goal: (v) => v === 5 || v === 10 || v === 20 || v === 30,
  reminder: (v) => v === null || (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v)),
};

function ageBand(cls: unknown, birthYear: unknown, now: number): AgeBand | null {
  const c = Number(cls);
  if (Number.isFinite(c) && c > 0) return c <= 5 ? 'u10' : c <= 7 ? '10_12' : '13_17';
  if (birthYear === null || birthYear === undefined) return null;
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

function raw(status: number, text: string, contentType: string): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? contentType : null) },
  };
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
