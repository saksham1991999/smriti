/**
 * The app's service graph, built once at boot: env and variant, storage (Dexie), the outbox and
 * sync client, auth, the shared app store, analytics, the API helper and billing. Screens reach it
 * through `useServices()`. Nothing here renders.
 */
import {
  AuthError,
  DevAuthClient,
  Outbox,
  SoftPromptBudget,
  SrsScheduler,
  SupabaseAuthClient,
  SyncClient,
  createAppStore,
  createSupabaseClientForProfile,
  createIdGenerator,
  hydrateAppStore,
  realScheduler,
  silentLogger,
  type AppStore,
  type AuthClient,
  type Fetch,
  type Logger,
  type NewOutboxRow,
  type StorageTables,
  type SyncEventPayloads,
  type SyncEventType,
} from "@smriti/app-core";
import { AnalyticsClient, MemoryTransport, audienceFromAgeBand, type Transport } from "@smriti/analytics";
import { createFlags, getVariant, parseClientEnv, type ClientEnv, type Flags, type Variant } from "@smriti/config";
import { DexieStorage } from "../platform/dexieStorage";
import { BrowserNetwork, LocalStorageKeyValueStore, createFetch, deviceId, prefs, timeZone, requestFetch, withDevLinkFlag, type RequestInterceptor } from "../platform/web";
import { createApi, type Api } from "../lib/api";
import { createApiClient, type ApiClient } from "@smriti/api-client";
import { createBillingProvider, type BillingProvider } from "../lib/billing";
import { contentBase } from "../lib/content";

export interface Services {
  env: ClientEnv;
  variant: Variant;
  flags: Flags;
  storage: DexieStorage;
  kv: LocalStorageKeyValueStore;
  outbox: Outbox;
  sync: SyncClient;
  auth: AuthClient;
  store: AppStore;
  analytics: AnalyticsClient;
  analyticsTransport: Transport;
  /** Our small REST helper (billing and account routes not in the OpenAPI document yet). */
  api: Api;
  /** The generated, typed client for apps/api (config, catalog, manifest, me). */
  client: ApiClient;
  fetch: Fetch;
  srs: SrsScheduler;
  softPrompt: SoftPromptBudget;
  billing: BillingProvider;
  logger: Logger;
  fakeApi: boolean;
  /** Where bundles and manifests are served: `{CDN_BASE_URL}/c/` (same origin /c/ in dev and e2e). */
  contentBaseUrl: string;
  /** Replaces the flags with the server's map from `GET /v1/config`. */
  applyServerFlags(map: Record<string, unknown> | undefined): void;
  /** Appends ready-made envelopes (lesson-core sessions) plus optional local rows in one transaction. */
  recordEnvelopes(events: readonly NewOutboxRow[], local?: (tx: StorageTables) => Promise<void>): Promise<void>;
  /** Writes an event (and optional local rows) in one transaction, then schedules a flush. */
  record<T extends SyncEventType>(type: T, payload: SyncEventPayloads[T], local?: (tx: StorageTables) => Promise<void>): Promise<void>;
  /** Makes sure there is a guest or signed-in session; never blocks the UI on failure. */
  ensureSession(): Promise<void>;
  /** Pull the full server state into storage and the store. */
  refreshState(full?: boolean): Promise<void>;
}

/** Console logger that only ever receives codes and counts (AGENTS.md rule 6). */
const devLogger: Logger = {
  debug: () => {},
  warn: (m, f) => console.warn(`[smriti] ${m}`, f ?? ""),
  error: (m, f) => console.error(`[smriti] ${m}`, f ?? ""),
};

export interface CreateServicesOptions {
  interceptor?: RequestInterceptor;
  rawEnv?: Record<string, string | undefined>;
  /** Local database name (tests use one per case). */
  dbName?: string;
}

export async function createServices(opts: CreateServicesOptions = {}): Promise<Services> {
  const env = parseClientEnv(opts.rawEnv ?? (import.meta.env as unknown as Record<string, string | undefined>));
  const variant = getVariant(env.APP_VARIANT);
  let flags = createFlags();
  const kv = new LocalStorageKeyValueStore();
  const storage = new DexieStorage(opts.dbName ?? "smriti-local");
  const fetchImpl = createFetch(opts.interceptor);
  const network = new BrowserNetwork();
  const clock = () => Date.now();
  const logger = env.APP_ENV === "production" ? silentLogger : devLogger;
  const store = createAppStore();
  const outbox = new Outbox({ crypto: globalThis.crypto, clock, timeZone });

  let auth: AuthClient;
  if (env.AUTH_MODE === "supabase" && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    auth = new SupabaseAuthClient(
      createSupabaseClientForProfile({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, storage: kv, storageKey: "smriti-web-auth", detectSessionInUrl: true }),
    );
  } else {
    auth = new DevAuthClient({ baseUrl: env.API_BASE_URL, fetch: withDevLinkFlag(fetchImpl), store: kv, clock });
  }

  const sync = new SyncClient({
    storage,
    fetch: fetchImpl,
    baseUrl: env.API_BASE_URL,
    network,
    tokens: { getAccessToken: () => auth.getAccessToken(), refresh: async () => (await auth.refreshSession())?.accessToken ?? null },
    deviceId: deviceId(),
    variant: variant.id,
    scheduler: realScheduler,
    clock,
    logger,
    headers: () => ({ "X-App-Platform": "web" }),
    onStateApplied: (state) => store.getState().applyServerState(state, new Date().toISOString()),
  });
  sync.onStatus((s) => store.getState().setSyncStatus(s));

  const api = createApi({ baseUrl: env.API_BASE_URL, fetch: fetchImpl, token: () => auth.getAccessToken(), variant: variant.id });
  const client = createApiClient({
    baseUrl: env.API_BASE_URL,
    getAccessToken: () => auth.getAccessToken(),
    appVariant: variant.id,
    deviceId: deviceId(),
    platform: "web",
    fetch: requestFetch(opts.interceptor),
  });

  const analyticsTransport: Transport = new MemoryTransport();
  const newId = createIdGenerator(globalThis.crypto, clock);
  const analytics = new AnalyticsClient({
    transport: analyticsTransport,
    clock,
    newId,
    policy: () => {
      const s = store.getState();
      return {
        audience: audienceFromAgeBand(s.profile?.age_band ?? null),
        productAnalyticsOptIn: prefs.get("analytics_opt_in") !== "0",
        deferUntilConsent: flags.get("minor.defer_sync_until_consent"),
        guardianConsent: false,
      };
    },
    context: () => {
      const s = store.getState();
      return {
        exam_profile: s.profile?.exam_profile_ids[0] ?? null,
        platform: "web",
        app_variant: variant.id,
        locale: s.profile?.locale ?? "en",
        is_guest: s.session.isGuest,
        tier: s.entitlement?.plan === "pro" ? "pro" : "free",
      };
    },
  });

  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleFlush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => void sync.flush(), 400);
  };

  const services: Services = {
    env,
    variant,
    flags,
    storage,
    kv,
    outbox,
    sync,
    auth,
    store,
    analytics,
    analyticsTransport,
    api,
    client,
    fetch: fetchImpl,
    srs: new SrsScheduler(),
    softPrompt: new SoftPromptBudget(kv),
    billing: createBillingProvider(env, api),
    logger,
    fakeApi: Boolean(opts.interceptor),
    contentBaseUrl: contentBase(env.CDN_BASE_URL),
    applyServerFlags(map) {
      flags = createFlags(map ?? {});
      services.flags = flags;
    },
    async recordEnvelopes(events, local) {
      await storage.transaction(async (tx) => {
        if (local) await local(tx);
        for (const e of events) await tx.outbox.append(e);
      });
      scheduleFlush();
    },
    async record(type, payload, local) {
      await storage.transaction(async (tx) => {
        if (local) await local(tx);
        await outbox.record(tx, type, payload);
      });
      scheduleFlush();
    },
    async ensureSession() {
      const existing = await auth.getSession().catch(() => null);
      if (existing) {
        store.getState().setSession({ status: existing.user.isAnonymous ? "guest" : "signed_in", userId: existing.user.id, isGuest: existing.user.isAnonymous });
        return;
      }
      try {
        const s = await auth.signInAnonymously();
        store.getState().setSession({ status: "guest", userId: s.user.id, isGuest: true });
        void sync.resume();
      } catch (err) {
        // Local-only guest: keep writing to the outbox and retry on the next network change.
        logger.warn("auth.anonymous_failed", { code: err instanceof AuthError ? err.code : "unknown" });
        store.getState().setSession({ status: "local_guest", isGuest: true });
      }
    },
    async refreshState(full = false) {
      try {
        await sync.pullState({ full });
      } catch {
        logger.warn("sync.pull_failed", { code: "refresh" });
      }
    },
  };

  await hydrateAppStore(store, storage).catch(() => undefined);
  return services;
}
