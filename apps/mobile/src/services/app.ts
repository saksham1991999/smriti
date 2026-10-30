import { AnalyticsClient, audienceFromAgeBand, type EventName, type EventProps, type Transport } from '@smriti/analytics';
import {
  AuthError,
  DevAuthClient,
  Outbox,
  SoftPromptBudget,
  SyncClient,
  SupabaseAuthClient,
  createAppStore,
  createIdGenerator,
  createNonce,
  decideSoftPrompt,
  createSupabaseClientForProfile,
  defaultQuietHours,
  hydrateAppStore,
  isPro,
  lessonEndExtra,
  localDate,
  notifyConfigFromFlags,
  planLocalNotifications,
  priceValues,
  silentLogger,
  stageForPoints,
  nextStageAt,
  widgetSnapshot,
  healthByMissedDays,
  type AppStore,
  type AuthClient,
  type Clock,
  type CryptoLike,
  type DevIdentity,
  type Fetch,
  type KeyedBlobRow,
  type Json,
  type LessonEndExtra,
  type Logger,
  type Network,
  type NotifyAudience,
  type Scheduler,
  type SyncEventPayloads,
  type SyncEventType,
  type SyncStateResponse,
  type StorageTables,
  type SnapshotSection,
} from '@smriti/app-core';
import { createFlags, defaultFlags, type ClientEnv, type Flags, type Variant } from '@smriti/config';
import { createI18n, type MessageKey, type MessageValues, type Translator } from '@smriti/i18n';
import type { EventEnvelope, LessonSummary } from '@smriti/lesson-core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { withDevLinkFlag } from '../auth/devLinkFetch';
import type { AppleSignInProvider, GoogleSignInProvider } from '../auth/providers';
import { FakeBilling, RevenueCatBilling, type IntroEligibility } from '../billing/fake';
import type { BillingProvider, PurchaseResult } from '../billing/types';
import { CATALOGUE_SNAPSHOT, catalogueFromApi, type CatalogueExam } from '../content/catalogue';
import type { ContentRepo } from '../content/repo';
import { addPendingStrings } from '../i18n/pending';
import type { MobileSwitches } from '../env';
import { applyNotificationPlan, type LocalNotifier } from '../platform/notifications';
import type { ProfileStores } from '../platform/profileDb';
import { NativeWidgetBridge, type WidgetBridge } from '../platform/widget';
import { createMobileApiClient, unwrap, type ApiClient } from './api';
import { widgetData } from './widgetData';
import { goalAnswer, toWireEnvelope } from './wire';
import {
  ageBandFrom,
  nextStep,
  readOnboarding,
  writeOnboarding,
  type OnboardingState,
  type OnboardingStep,
  type SelfLevel,
} from './onboarding';

export type ThemePref = 'system' | 'light' | 'dark';

export interface RemoteConfig {
  exams: CatalogueExam[];
  pricing: { intro_paise: number; monthly_paise: number };
  flags: Record<string, unknown>;
}

/** App UI state that is not server data: onboarding answers, preferences, prompts. */
export interface UiState {
  ready: boolean;
  onboarding: OnboardingState;
  locale: 'en' | 'hi';
  themePref: ThemePref;
  haptics: boolean;
  lessonsCompleted: number;
  config: RemoteConfig;
  /** The last sign-in result, for AUTH-06 and AUTH-08. */
  lastAuth: { kind: 'linked' | 'restored' | 'merge_needed'; at: string } | null;
  /** Purchase flow (PAY-08 confirming, PAY-09 welcome). */
  purchase: { status: 'idle' | 'confirming' | 'done' | 'pending' | 'failed' | 'cancelled'; code?: string };
  upsellsToday: { day: string; count: number };
  /** The lesson that just ended, for LES-08 (memory only). */
  lessonEnd: LessonEnd | null;
}

export interface LessonEnd {
  topicId: string;
  topicTitle: string;
  mode: 'deep_dive' | 'quick_revision' | 'onboarding';
  summary: LessonSummary;
  extra: LessonEndExtra;
  streakUp: boolean;
  stageUp: boolean;
  /** The next bite of the same topic, if there is one. */
  nextBiteTitle: string | null;
}

export interface AppDeps {
  env: ClientEnv;
  variant: Variant;
  switches: MobileSwitches;
  stores: ProfileStores;
  fetch: Fetch;
  network: Network;
  crypto: CryptoLike;
  clock: Clock;
  scheduler: Scheduler;
  timeZone: () => string;
  notifier: LocalNotifier;
  google: GoogleSignInProvider;
  apple: AppleSignInProvider;
  content: ContentRepo;
  platform: 'ios' | 'android' | 'web';
  billing?: BillingProvider;
  widget?: WidgetBridge;
  /** Per-install UUID (sync `device_id`), from `installDeviceId`. */
  deviceId: string;
  analyticsTransport?: Transport;
  logger?: Logger;
  appVersion?: string;
}

/**
 * The API takes null for "declined" and "not now" (profile_rules); app-core's payload type has no
 * null yet (reported under "Contract changes"), so those values are cast.
 */
type OnboardingValue = SyncEventPayloads['onboarding_answer']['value'];

const PREFS_KEY = 'prefs.v1';
const LESSONS_KEY = 'lessons.completed.v1';
const UPSELL_KEY = 'upsell.today.v1';

/** PRD §11 and R33/R38 until /v1/config answers: ₹1 for the first month, then ₹99/month. */
const DEFAULT_PRICING = { intro_paise: 100, monthly_paise: 9900 };

export type LinkOutcome =
  | { status: 'linked' }
  | { status: 'restored' }
  | { status: 'merge_needed' }
  | { status: 'cancelled' }
  | { status: 'error'; code: string };

/**
 * The app's composition root: one per profile. Screens call these methods and read the stores;
 * the business rules themselves live in app-core and lesson-core (AGENTS.md: web and mobile parity).
 */
export class SmritiApp {
  readonly store: AppStore;
  readonly ui: StoreApi<UiState>;
  readonly auth: AuthClient;
  readonly outbox: Outbox;
  readonly sync: SyncClient;
  readonly softPrompt: SoftPromptBudget;
  readonly billing: BillingProvider;
  readonly analytics: AnalyticsClient;
  readonly widget: WidgetBridge;
  /** Typed REST client for non-sync calls (@smriti/api-client). */
  readonly api: ApiClient;
  /** UUIDv7 ids for client-made records (tutor message ids, idempotency). */
  readonly newId: () => string;
  flags: Flags = defaultFlags;
  i18n: Translator;
  private readonly logger: Logger;
  private unsubs: (() => void)[] = [];
  private sessionPromise: Promise<void> | null = null;
  private flushTimer: unknown = null;

  constructor(readonly deps: AppDeps) {
    this.logger = deps.logger ?? silentLogger;
    const { stores, env, variant } = deps;
    this.store = createAppStore();
    const now = new Date(deps.clock()).toISOString();
    this.ui = createStore<UiState>()(() => ({
      ready: false,
      onboarding: { ...emptyState(now) },
      locale: 'en',
      themePref: 'system',
      haptics: true,
      lessonsCompleted: 0,
      config: { exams: CATALOGUE_SNAPSHOT, pricing: DEFAULT_PRICING, flags: {} },
      lastAuth: null,
      purchase: { status: 'idle' },
      upsellsToday: { day: '', count: 0 },
      lessonEnd: null,
    }));
    this.i18n = createI18n({ locale: 'en', brand: variant.appName.en });
    addPendingStrings(this.i18n);

    if (env.AUTH_MODE === 'supabase' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      const client = createSupabaseClientForProfile({
        url: env.SUPABASE_URL,
        anonKey: env.SUPABASE_ANON_KEY,
        storage: stores.secure,
        storageKey: `smriti-${variant.id}-auth`,
        fetch: deps.fetch as never,
      });
      this.auth = new SupabaseAuthClient(client);
    } else {
      this.auth = new DevAuthClient({ baseUrl: env.API_BASE_URL, fetch: withDevLinkFlag(deps.fetch), store: stores.secure, clock: deps.clock });
    }

    this.api = createMobileApiClient({
      baseUrl: env.API_BASE_URL,
      fetch: deps.fetch,
      getAccessToken: () => this.auth.getAccessToken(),
      variant: variant.id,
      platform: deps.platform,
      deviceId: deps.deviceId,
      ...(deps.appVersion ? { appVersion: deps.appVersion } : {}),
    });
    this.outbox = new Outbox({ crypto: deps.crypto, clock: deps.clock, timeZone: deps.timeZone });
    this.sync = new SyncClient({
      storage: stores.storage,
      fetch: deps.fetch,
      baseUrl: env.API_BASE_URL,
      network: deps.network,
      tokens: { getAccessToken: () => this.auth.getAccessToken(), refresh: async () => (await this.auth.refreshSession())?.accessToken ?? null },
      deviceId: deps.deviceId,
      variant: variant.id,
      scheduler: deps.scheduler,
      clock: deps.clock,
      logger: this.logger,
      headers: () => ({ 'X-App-Version': deps.appVersion ?? '1.0.0' }),
      onStateApplied: (state) => this.onServerState(state),
    });
    this.softPrompt = new SoftPromptBudget(stores.kv);
    this.widget =
      deps.widget ??
      new NativeWidgetBridge(stores.kv, () => ({
        t: (key, values) => this.t(key, values),
        scheme: variant.scheme,
        goalMinutes: this.store.getState().profile?.daily_goal_minutes ?? this.ui.getState().onboarding.dailyGoalMinutes ?? 10,
      }));
    this.billing =
      deps.billing ??
      (deps.switches.billing === 'fake'
        ? new FakeBilling({
            fetch: deps.fetch,
            baseUrl: env.API_BASE_URL,
            platform: deps.platform,
            products: variant.products,
            introEligibility: () => this.introEligibility(),
            ...(deps.switches.devRevenueCatWebhookAuth ? { devWebhookAuth: deps.switches.devRevenueCatWebhookAuth } : {}),
            clock: deps.clock,
          })
        : new RevenueCatBilling({
            apiKey: deps.platform === 'ios' ? deps.switches.revenuecatAppleKey : deps.switches.revenuecatGoogleKey,
            offeringId: variant.revenuecatOfferingId,
          }));
    const newId = createIdGenerator(deps.crypto, deps.clock);
    this.newId = newId;
    this.analytics = new AnalyticsClient({
      transport: deps.analyticsTransport ?? { send: async () => undefined },
      clock: deps.clock,
      newId,
      scheduler: deps.scheduler,
      policy: () => ({
        audience: audienceFromAgeBand(this.ageBand()),
        productAnalyticsOptIn: true,
        deferUntilConsent: this.flags.get('minor.defer_sync_until_consent') === true,
        guardianConsent: false,
      }),
      context: () => ({
        exam_profile: this.examProfileId(),
        platform: deps.platform,
        app_variant: variant.id,
        app_version: deps.appVersion ?? '1.0.0',
        locale: this.ui.getState().locale,
        is_guest: this.store.getState().session.isGuest,
        tier: this.isPro() ? 'pro' : 'free',
      }),
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  /** Local boot only (onboarding §4 rule 1: the splash never waits for the network). */
  async boot(): Promise<void> {
    const { kv, storage } = this.deps.stores;
    const nowIso = new Date(this.deps.clock()).toISOString();
    await hydrateAppStore(this.store, storage);
    const onboarding = await readOnboarding(kv, nowIso);
    if (!(await kv.get('onboarding.v1'))) await writeOnboarding(kv, onboarding);
    const prefs = JSON.parse((await kv.get(PREFS_KEY)) ?? '{}') as Partial<Pick<UiState, 'themePref' | 'haptics' | 'locale'>>;
    const lessons = Number((await kv.get(LESSONS_KEY)) ?? '0');
    const upsell = JSON.parse((await kv.get(UPSELL_KEY)) ?? '{"day":"","count":0}') as UiState['upsellsToday'];
    const locale = onboarding.locale ?? prefs.locale ?? 'en';
    await this.i18n.setLocale(locale);
    const session = await this.auth.getSession().catch(() => null);
    this.store.getState().setSession({
      status: session ? (session.user.isAnonymous ? 'guest' : 'signed_in') : 'local_guest',
      userId: session?.user.id ?? null,
      isGuest: session ? session.user.isAnonymous : true,
    });
    this.ui.setState({
      ready: true,
      onboarding,
      locale,
      themePref: prefs.themePref ?? 'system',
      haptics: prefs.haptics ?? true,
      lessonsCompleted: Number.isFinite(lessons) ? lessons : 0,
      upsellsToday: upsell,
    });
    this.ensureLocalSections();
    this.unsubs.push(this.sync.onStatus((s) => this.store.getState().setSyncStatus(s)));
    this.unsubs.push(
      this.deps.network.subscribe((online) => {
        if (online) void this.ensureSession();
      }),
    );
    this.sync.start();
    void this.ensureSession();
    void this.loadConfig();
    if (onboarding.completedAt) {
      void this.registerDevice();
      void this.notificationOpened(null);
    }
  }

  stop(): void {
    this.sync.stop();
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.flushTimer !== null) this.deps.scheduler.clearTimeout(this.flushTimer);
  }

  /** The anonymous session (TRD §6). Onboarding never waits for it; failures retry on reconnect. */
  ensureSession(): Promise<void> {
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        try {
          let session = await this.auth.getSession();
          if (!session) {
            if (!this.deps.network.isOnline()) return;
            session = await this.auth.signInAnonymously();
          }
          this.store.getState().setSession({
            status: session.user.isAnonymous ? 'guest' : 'signed_in',
            userId: session.user.id,
            isGuest: session.user.isAnonymous,
          });
          await this.sync.resume();
        } catch (err) {
          this.logger.warn('auth.anonymous_failed', { code: err instanceof AuthError ? err.code : 'unknown' });
        } finally {
          this.sessionPromise = null;
        }
      })();
    }
    return this.sessionPromise;
  }

  /** `GET /v1/config`: the live goal catalogue (R7), flags and pricing. Cached; never blocks. */
  async loadConfig(): Promise<void> {
    const prev = this.ui.getState().config;
    let next: RemoteConfig = prev;
    try {
      const body = await unwrap(this.api.GET('/v1/config'));
      // The store product for this platform and variant; the intro product carries both prices.
      const mine = body.pricing.filter((p) => p.platform === this.deps.platform && (p.variant_id === this.deps.variant.id || p.variant_id === null));
      const intro = mine.find((p) => p.intro_price_paise !== null);
      const monthly = mine.find((p) => p.intro_price_paise === null) ?? intro;
      next = {
        ...next,
        flags: body.flags,
        pricing: {
          intro_paise: intro?.intro_price_paise ?? DEFAULT_PRICING.intro_paise,
          monthly_paise: monthly?.price_paise ?? DEFAULT_PRICING.monthly_paise,
        },
      };
      this.flags = createFlags(body.flags);
    } catch {
      /* offline or older server: keep the cached values */
    }
    try {
      const exams = catalogueFromApi(await unwrap(this.api.GET('/v1/catalog/exams')));
      if (exams.length) next = { ...next, exams };
    } catch {
      /* offline: keep the snapshot */
    }
    if (next !== prev) this.ui.setState({ config: next });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** `{price}` and `{intro_price}` default to the `/v1/config` pricing; screens with an eligibility offer pass their own. */
  t = (key: MessageKey, values?: MessageValues): string =>
    this.i18n.t(key, { app_name: this.appName(), brand: this.appName(), ...priceValues(this.ui.getState().config.pricing), ...values });

  /** A language's own name ("English", "हिन्दी"): the catalogue's switch button names the other language. */
  languageName = (l: 'en' | 'hi'): string => this.i18n.i18n.t('learn:WEB-01.language_button', { lng: l === 'en' ? 'hi' : 'en' }) as string;

  /** Only for the keys in `src/i18n/pending-learn.json` (not yet in the shared catalogue's types). */
  tPending = (key: `learn:WEB-01.${string}` | `learn:WEB-02.${string}`, values?: MessageValues): string => this.t(key as MessageKey, values);

  appName(): string {
    return this.deps.variant.appName[this.ui.getState().locale];
  }

  now(): number {
    return this.deps.clock();
  }

  today(): string {
    return localDate(this.deps.clock(), this.deps.timeZone());
  }

  examProfileId(): string | null {
    const goals = this.ui.getState().onboarding.goals.filter((g) => g !== 'school' && g !== 'curious');
    return goals[0] ?? this.store.getState().profile?.exam_profile_ids[0] ?? this.deps.variant.examProfileIds[0] ?? null;
  }

  ageBand(): 'u10' | '10_12' | '13_17' | '18p' | null {
    return this.store.getState().profile?.age_band ?? ageBandFrom(this.ui.getState().onboarding, this.deps.clock());
  }

  isPro(): boolean {
    return isPro(this.store.getState().entitlement, {
      now: this.deps.clock(),
      online: this.deps.network.isOnline(),
      offlineGraceDays: this.flags.get('billing.offline_grace_days'),
    });
  }

  isLittleLearner(): boolean {
    const c = this.ui.getState().onboarding.schoolClass;
    return c !== null && c <= 5;
  }

  track<N extends EventName>(name: N, props?: EventProps<N>): void {
    try {
      this.analytics.track(name, props);
    } catch {
      /* analytics never breaks the app */
    }
  }

  /** Appends one learning event in a transaction, then flushes soon. */
  async record<T extends SyncEventType>(type: T, payload: SyncEventPayloads[T], also?: (tx: StorageTables) => Promise<void>): Promise<void> {
    await this.deps.stores.storage.transaction(async (tx) => {
      await this.outbox.record(tx, type, payload);
      if (also) await also(tx);
    });
    this.scheduleFlush();
  }

  /** Lesson events from lesson-core's `LessonSession`, already in the sync envelope. */
  async recordEnvelope(event: EventEnvelope, also?: (tx: StorageTables) => Promise<void>): Promise<void> {
    const env = toWireEnvelope(event);
    await this.deps.stores.storage.transaction(async (tx) => {
      await tx.outbox.append({ event_id: env.event_id, type: env.type, payload: env.payload as never, occurred_at: env.occurred_at, tz: env.tz });
      if (also) await also(tx);
    });
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer !== null) return;
    this.flushTimer = this.deps.scheduler.setTimeout(() => {
      this.flushTimer = null;
      void this.sync.flush();
    }, 250);
  }

  /** Flushes now and pulls state (tests and the "Saving…" chip). */
  async syncNow(): Promise<void> {
    if (this.flushTimer !== null) {
      this.deps.scheduler.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.ensureSession();
    await this.sync.flush();
    if (await this.auth.getAccessToken()) {
      try {
        await this.sync.pullState();
      } catch {
        /* offline: the next flush pulls */
      }
    }
  }

  private onServerState(state: SyncStateResponse) {
    this.store.getState().applyServerState(state, new Date(this.deps.clock()).toISOString());
    // Server sections replace local ones; keep the local pet until the server knows it.
    if (state.pet === null) this.ensureLocalSections();
    void this.refreshReminders();
    void this.writeWidget();
  }

  private async saveSection<K extends SnapshotSection>(key: K, value: unknown) {
    const row: KeyedBlobRow = { key, data: value as Json, updated_at: new Date(this.deps.clock()).toISOString() };
    await this.deps.stores.storage.profile_snapshot.put(row);
  }

  /** Local copies of the Home header sections before the first sync (offline first launch). */
  private ensureLocalSections() {
    const st = this.store.getState();
    const ob = this.ui.getState().onboarding;
    const patch: Partial<ReturnType<AppStore['getState']>> = {};
    if (!st.streak) patch.streak = { current: 0, longest: 0, today_qualified: false, freezes_equipped: 0, freezes_available: 0, rest_day: null, at_risk: false };
    if (!st.plant && ob.seedPlanted) patch.plant = { stage: 'seed', health: 'thriving', study_days: 0, next_stage_at: 1 };
    if (!st.pet && ob.pet) patch.pet = { species: ob.pet.species, name: ob.pet.name, mood: 80, energy: 80, state: 'happy' };
    if (!st.wallet) patch.wallet = { xp_total: 0, xp_today: 0, gems: 0 };
    if (!st.entitlement) patch.entitlement = { plan: 'free', pro_until: null };
    if (Object.keys(patch).length) this.store.setState(patch);
  }

  // ── Onboarding ────────────────────────────────────────────────────────────

  private async updateOnboarding(patch: Partial<OnboardingState>, advanceFrom?: OnboardingStep): Promise<OnboardingState> {
    const cur = this.ui.getState().onboarding;
    let next: OnboardingState = { ...cur, ...patch };
    if (advanceFrom) next = { ...next, step: nextStep(advanceFrom, next) };
    await writeOnboarding(this.deps.stores.kv, next);
    this.ui.setState({ onboarding: next });
    return next;
  }

  async chooseLocale(locale: 'en' | 'hi'): Promise<void> {
    await this.i18n.setLocale(locale);
    this.ui.setState({ locale });
    await this.savePrefs({ locale });
    await this.updateOnboarding({ locale }, 'welcome');
    await this.record('settings_changed', { key: 'content_locale', value: locale });
    this.track('onboarding_step_completed', { step: 'ONB-01' });
  }

  async setLocale(locale: 'en' | 'hi'): Promise<void> {
    await this.i18n.setLocale(locale);
    this.ui.setState({ locale });
    await this.savePrefs({ locale });
    await this.record('settings_changed', { key: 'content_locale', value: locale });
  }

  /** Skips Goal in a per-exam app with one exam profile (onboarding §5.1). */
  async skipGoalIfSingleProfile(): Promise<boolean> {
    const ids = this.deps.variant.examProfileIds;
    if (ids.length !== 1) return false;
    await this.updateOnboarding({ goals: [ids[0]!] }, 'goal');
    await this.record('onboarding_answer', { step: 'goal', value: [ids[0]!] });
    return true;
  }

  async answerGoal(goals: string[], schoolClass: number | null): Promise<OnboardingState> {
    const s = await this.updateOnboarding({ goals, schoolClass }, 'goal');
    await this.record('onboarding_answer', { step: 'goal', value: goalAnswer(goals) as OnboardingValue });
    if (schoolClass !== null) await this.record('onboarding_answer', { step: 'class', value: schoolClass });
    return s;
  }

  async answerBirthYear(year: number | 'declined'): Promise<OnboardingState> {
    const s = await this.updateOnboarding({ birthYear: year }, 'birth_year');
    await this.record('onboarding_answer', { step: 'birth_year', value: (year === 'declined' ? null : year) as OnboardingValue });
    return s;
  }

  async answerLevel(level: SelfLevel): Promise<OnboardingState> {
    const s = await this.updateOnboarding({ level }, 'level');
    await this.record('onboarding_answer', { step: 'level', value: level });
    return s;
  }

  async nameBuddy(species: 'cat' | 'dog', name: string): Promise<OnboardingState> {
    const s = await this.updateOnboarding({ pet: { species, name } }, 'buddy');
    this.store.setState({ pet: { species, name, mood: 80, energy: 80, state: 'happy' } });
    await this.saveSection('pet', this.store.getState().pet);
    await this.record('pet_named', { species, name });
    return s;
  }

  async plantSeed(): Promise<OnboardingState> {
    const s = await this.updateOnboarding({ seedPlanted: true }, 'seed');
    if (!this.store.getState().plant) this.store.setState({ plant: { stage: 'seed', health: 'thriving', study_days: 0, next_stage_at: 1 } });
    await this.saveSection('plant', this.store.getState().plant);
    await this.record('plant_seeded', {});
    return s;
  }

  async finishFirstLesson(result: OnboardingState['firstLesson']): Promise<OnboardingState> {
    return this.updateOnboarding({ firstLesson: result }, 'first_lesson');
  }

  async leaveFirstWin(): Promise<OnboardingState> {
    return this.updateOnboarding({}, 'first_win');
  }

  async setDailyGoal(minutes: number, inOnboarding: boolean): Promise<void> {
    if (inOnboarding) await this.updateOnboarding({ dailyGoalMinutes: minutes }, 'daily_goal');
    else await this.updateOnboarding({ dailyGoalMinutes: minutes });
    const profile = this.store.getState().profile;
    if (profile) this.store.getState().patch('profile', { daily_goal_minutes: minutes });
    await this.record('onboarding_answer', { step: 'daily_goal', value: minutes });
  }

  /** ONB-15: `time` is local HH:MM, or null for "Not now". Finishes onboarding. */
  async answerReminder(time: string | null): Promise<{ granted: boolean }> {
    let granted = false;
    if (time) granted = await this.deps.notifier.requestPermission();
    this.track('os_notification_result', { result: time ? (granted ? 'granted' : 'denied') : 'not_now' } as never);
    await this.updateOnboarding({ reminderAt: time && granted ? time : null, completedAt: new Date(this.deps.clock()).toISOString() }, 'reminder');
    await this.record('onboarding_answer', { step: 'reminder', value: (time && granted ? time : null) as OnboardingValue });
    await this.refreshReminders();
    void this.registerDevice();
    return { granted };
  }

  // ── Lessons ───────────────────────────────────────────────────────────────

  /**
   * After LES-08 renders: the optimistic Home header (streak +1 on the first lesson of the day,
   * the plant's study day, XP) and the one extra prompt (R15). Server state replaces the
   * optimistic values on the next sync.
   */
  async completeLesson(summary: Pick<LessonSummary, 'xp'>, opts: { onboarding?: boolean } = {}): Promise<{ extra: LessonEndExtra; streakUp: boolean; stageUp: boolean }> {
    const st = this.store.getState();
    const streak = st.streak ?? { current: 0, longest: 0, today_qualified: false, freezes_equipped: 0, freezes_available: 0, rest_day: null, at_risk: false };
    const plant = st.plant ?? { stage: 'seed' as const, health: 'thriving' as const, study_days: 0, next_stage_at: 1 };
    const streakUp = !streak.today_qualified;
    let stageUp = false;
    if (streakUp) {
      const current = streak.current + 1;
      this.store.setState({ streak: { ...streak, current, longest: Math.max(streak.longest, current), today_qualified: true, at_risk: false } });
      const days = plant.study_days + 1;
      const stage = stageForPoints(days);
      stageUp = stage !== plant.stage;
      this.store.setState({ plant: { ...plant, study_days: days, stage, next_stage_at: nextStageAt(days) } });
    }
    const wallet = st.wallet ?? { xp_total: 0, xp_today: 0, gems: 0 };
    this.store.setState({ wallet: { ...wallet, xp_total: wallet.xp_total + summary.xp, xp_today: wallet.xp_today + summary.xp } });
    for (const k of ['streak', 'plant', 'wallet'] as const) await this.saveSection(k, this.store.getState()[k]);

    const lessonsCompleted = this.ui.getState().lessonsCompleted + 1;
    this.ui.setState({ lessonsCompleted });
    await this.deps.stores.kv.set(LESSONS_KEY, String(lessonsCompleted));
    this.scheduleFlush();
    void this.writeWidget();
    void this.refreshReminders();
    if (opts.onboarding) return { extra: 'none', streakUp, stageUp };

    const session = this.store.getState().session;
    const signedIn = session.status === 'signed_in';
    const decision = await this.softPrompt.read();
    const soft = decideSoftPrompt(decision, 'lesson_3', { now: this.deps.clock(), signedIn, managed: false, midActivity: false });
    const today = this.today();
    const upsells = this.ui.getState().upsellsToday;
    const extra = lessonEndExtra({
      lessonsCompleted,
      deferredOnboardingPending: false,
      isGuest: !signedIn,
      littleLearner: this.isLittleLearner(),
      ageBand: this.ageBand(),
      isPro: this.isPro(),
      softPromptAllowed: soft.show,
      daysSinceInstall: Math.floor((this.deps.clock() - Date.parse(this.ui.getState().onboarding.installedAt)) / 86_400_000),
      upsellsShownToday: upsells.day === today ? upsells.count : 0,
    });
    if (extra === 'soft_login') await this.softPrompt.tryShow('lesson_3', { now: this.deps.clock(), signedIn, managed: false, midActivity: false });
    if (extra === 'upsell') {
      const next = { day: today, count: (upsells.day === today ? upsells.count : 0) + 1 };
      this.ui.setState({ upsellsToday: next });
      await this.deps.stores.kv.set(UPSELL_KEY, JSON.stringify(next));
    }
    return { extra, streakUp, stageUp };
  }

  // ── Sign-in (AUTH-01, AUTH-04, AUTH-06, AUTH-08) ──────────────────────────

  /** [Later] on a soft login sheet (R29: two Laters pause pop-ups for 14 days). */
  async softLater(): Promise<void> {
    await this.softPrompt.later(this.deps.clock());
  }

  /** Links Google to the guest in place (no data moves), or restores an existing account. */
  async continueWithGoogle(dev?: DevIdentity): Promise<LinkOutcome> {
    const nonce = await createNonce(this.deps.crypto);
    let credential;
    try {
      credential = await this.deps.google.signIn(nonce, dev);
    } catch (err) {
      return { status: 'error', code: err instanceof AuthError ? err.code : 'unknown' };
    }
    if (!credential) return { status: 'cancelled' };
    return this.finishIdToken(credential);
  }

  async continueWithApple(): Promise<LinkOutcome> {
    const nonce = await createNonce(this.deps.crypto);
    const credential = await this.deps.apple.signIn(nonce).catch(() => null);
    if (!credential) return { status: 'cancelled' };
    return this.finishIdToken(credential);
  }

  private async finishIdToken(credential: Parameters<AuthClient['linkIdentity']>[0]): Promise<LinkOutcome> {
    try {
      await this.ensureSession();
      const session = await this.auth.getSession();
      let outcome: LinkOutcome;
      if (session?.user.isAnonymous) {
        const r = await this.auth.linkIdentity(credential);
        if (r.status === 'identity_already_exists') {
          // AUTH-07/08: the identity owns another account. The merge (merge-intents + merges,
          // auth flow §6.4) needs the API; until then the student chooses on AUTH-08.
          this.ui.setState({ lastAuth: { kind: 'merge_needed', at: new Date(this.deps.clock()).toISOString() } });
          return { status: 'merge_needed' };
        }
        outcome = { status: 'linked' };
      } else {
        await this.auth.signInWithIdToken(credential);
        outcome = { status: 'restored' };
      }
      const s = await this.auth.getSession();
      this.store.getState().setSession({ status: 'signed_in', userId: s?.user.id ?? null, isGuest: false });
      this.store.getState().patch('profile', { is_guest: false });
      await this.softPrompt.clear();
      if (s) await this.billing.identify(s.user.id).catch(() => undefined);
      this.ui.setState({ lastAuth: { kind: outcome.status === 'linked' ? 'linked' : 'restored', at: new Date(this.deps.clock()).toISOString() } });
      await this.sync.resume();
      await this.sync.pullState({ full: true }).catch(() => undefined);
      return outcome;
    } catch (err) {
      return { status: 'error', code: err instanceof AuthError ? err.code : 'unknown' };
    }
  }

  /** AUTH-12: sign out wipes this profile's local data and starts a fresh guest (TRD §6). */
  async signOut(): Promise<void> {
    this.sync.stop();
    await this.auth.signOut({ scope: 'local' });
    await this.deps.google.signOut();
    await this.billing.logOut();
    this.analytics.clear();
    await this.deps.stores.storage.wipe();
    await this.widget.clear();
    for (const k of ['onboarding.v1', PREFS_KEY, LESSONS_KEY, UPSELL_KEY]) await this.deps.stores.kv.delete(k);
    await this.softPrompt.clear();
    this.store.getState().reset();
    await this.boot();
  }

  // ── Pro (PAY-01, PAY-08, PAY-09) ──────────────────────────────────────────

  /**
   * Buys Pro through the BillingProvider, then waits for the server to confirm (PAY-08). Pro is
   * never unlocked from the store result alone: the entitlement comes from `/v1/sync/state`.
   */
  async purchasePro(opts: { confirmTimeoutMs?: number; pollMs?: number } = {}): Promise<UiState['purchase']> {
    const session = await this.auth.getSession();
    if (!session || session.user.isAnonymous) return this.setPurchase({ status: 'failed', code: 'sign_in_required' });
    await this.billing.identify(session.user.id).catch(() => undefined);
    const offers = await this.billing.offers();
    const offer = offers[0];
    if (!offer) return this.setPurchase({ status: 'failed', code: 'no_offer' });
    const result: PurchaseResult = await this.billing.purchase(offer.productId);
    if (result.status === 'cancelled') return this.setPurchase({ status: 'cancelled' });
    if (result.status === 'pending') return this.setPurchase({ status: 'pending' });
    if (result.status === 'failed') return this.setPurchase({ status: 'failed', code: result.code });
    this.setPurchase({ status: 'confirming' });
    const deadline = this.deps.clock() + (opts.confirmTimeoutMs ?? 30_000);
    for (;;) {
      await this.sync.pullState({ full: true }).catch(() => undefined);
      if (this.store.getState().entitlement?.plan === 'pro') return this.setPurchase({ status: 'done' });
      if (this.deps.clock() >= deadline) return this.setPurchase({ status: 'pending' });
      await new Promise<void>((r) => this.deps.scheduler.setTimeout(r, opts.pollMs ?? 1500));
    }
  }

  /**
   * `/v1/billing/intro-eligibility`: the ₹1 month is offered only when the server says so (R38).
   * Offline or as a guest before the first session, the price from `/v1/config` stands and no
   * intro is promised.
   */
  async introEligibility(): Promise<IntroEligibility> {
    const pricing = this.ui.getState().config.pricing;
    try {
      await this.ensureSession();
      const e = await unwrap(this.api.GET('/v1/billing/intro-eligibility'));
      return { eligible: e.eligible, eligibleHint: e.eligible_hint, introPricePaise: e.intro_price_paise, pricePaise: e.price_paise };
    } catch {
      return { eligible: false, eligibleHint: false, introPricePaise: null, pricePaise: pricing.monthly_paise };
    }
  }

  /**
   * Registers this install with `/v1/devices` (push token, permission, locale, time zone) so the
   * server can send pushes the local plan cannot (TRD §12). Safe to call often; it is an upsert.
   */
  async registerDevice(): Promise<boolean> {
    try {
      await this.ensureSession();
      if (!(await this.auth.getAccessToken())) return false;
      const permission = await this.deps.notifier.permission();
      const token = await this.deps.notifier.pushToken();
      await unwrap(
        this.api.POST('/v1/devices', {
          body: {
            app_version: this.deps.appVersion ?? '1.0.0',
            platform: this.deps.platform,
            locale: this.ui.getState().locale,
            timezone: this.deps.timeZone(),
            notif_permission: permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'not_asked',
            push_enabled: permission === 'granted' && token !== null,
            push_token: token,
          },
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * `/v1/notifications/opened`: an app open resets the ignored-push count and any auto-pause
   * (R34); a tapped server push also passes its outbox id. Best effort.
   */
  async notificationOpened(outboxId: string | null): Promise<void> {
    try {
      await this.ensureSession();
      if (!(await this.auth.getAccessToken())) return;
      await unwrap(this.api.POST('/v1/notifications/opened', { body: { id: outboxId } }));
    } catch {
      // Offline or signed out: the next open reports again.
    }
  }

  private setPurchase(p: UiState['purchase']): UiState['purchase'] {
    this.ui.setState({ purchase: p });
    return p;
  }

  // ── Preferences, reminders and the widget ─────────────────────────────────

  async savePrefs(patch: Partial<Pick<UiState, 'themePref' | 'haptics' | 'locale'>>): Promise<void> {
    const cur = this.ui.getState();
    const next = { themePref: cur.themePref, haptics: cur.haptics, locale: cur.locale, ...patch };
    this.ui.setState(patch);
    await this.deps.stores.kv.set(PREFS_KEY, JSON.stringify(next));
  }

  audience(): NotifyAudience {
    const b = this.ageBand();
    return b === '18p' ? 'adult' : b === '13_17' ? 'teen' : b === null ? 'teen' : 'child';
  }

  /** Rebuilds the 7-day local notification plan (app open, after each sync). */
  async refreshReminders(): Promise<number> {
    const ob = this.ui.getState().onboarding;
    const audience = this.audience();
    const quiet = defaultQuietHours(audience, this.flags);
    const st = this.store.getState();
    const plan = planLocalNotifications({
      now: this.deps.clock(),
      timeZone: this.deps.timeZone(),
      audience,
      prefs: {
        reminderEnabled: ob.reminderAt !== null,
        dailyReminderAt: ob.reminderAt,
        smartTiming: false,
        streakSaver: audience === 'adult',
        quietStart: quiet.start,
        quietEnd: quiet.end,
        schoolHours: audience !== 'adult',
      },
      config: notifyConfigFromFlags(audience, this.flags),
      todayQualified: st.streak?.today_qualified ?? false,
      streak: st.streak?.current ?? 0,
      lastActivityDay: null,
      dueCards: 0,
      rescueAvailable: false,
      mockRunnerOpen: false,
    });
    const pet = st.pet?.name ?? '';
    const minutes = st.profile?.daily_goal_minutes ?? ob.dailyGoalMinutes ?? 10;
    return applyNotificationPlan(this.deps.notifier, plan, (item) => ({
      title: this.appName(),
      body:
        item.kind === 'streak_risk'
          ? this.t('me_money:NTF-01.streak_risk_streak_saver_pool_1_adults', { streak: st.streak?.current ?? 0 })
          : item.kind === 'reminders_paused'
            ? this.t('me_money:NTF-01.reminders_paused')
            : this.t('me_money:NTF-01.daily_reminder_pool_1', { pet, min: minutes }),
    }));
  }

  async writeWidget(): Promise<void> {
    const st = this.store.getState();
    const quiet = defaultQuietHours(this.audience(), this.flags);
    const live = await widgetData(this);
    const snapshot = widgetSnapshot({
      now: this.deps.clock(),
      timeZone: this.deps.timeZone(),
      locale: this.ui.getState().locale,
      themePref: this.ui.getState().themePref,
      signedIn: st.session.status === 'signed_in',
      isUnder10: this.ageBand() === 'u10',
      streak: st.streak?.current ?? 0,
      goalProgress: st.streak?.today_qualified ? 1 : 0,
      freezeHeld: (st.streak?.freezes_equipped ?? 0) > 0,
      restDayToday: false,
      lastActivityDay: st.streak?.today_qualified ? this.today() : null,
      plant: { species: 'default', skin: null, stage: st.plant?.stage ?? 'seed', health: st.plant?.health ?? 'thriving' },
      pet: st.pet ? { species: st.pet.species, name: st.pet.name, state: live.petState, outfit: null } : null,
      healthByMissedDays: healthByMissedDays(),
      dueCards: live.dueCards,
      planItems: live.planItems,
      exam: live.exam,
      quietStart: quiet.start,
      quietEnd: quiet.end,
      eveningHour: null,
    });
    await this.widget.write(snapshot);
  }
}

function emptyState(nowIso: string): OnboardingState {
  return {
    step: 'welcome',
    locale: null,
    goals: [],
    schoolClass: null,
    birthYear: null,
    level: null,
    pet: null,
    seedPlanted: false,
    firstLesson: null,
    dailyGoalMinutes: null,
    reminderAt: null,
    completedAt: null,
    installedAt: nowIso,
  };
}

export type { SyncStateResponse };
