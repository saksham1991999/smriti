/**
 * Guardian consent on `/v1/guardian` (auth flow §6.10) and the parent's view of linked learners
 * (SET-14). The guardian always signs in on a second, separate auth client: in memory for the
 * same-phone handoff and the link landing (the teen's or the browser's own session is never
 * touched), and in this browser's storage only when a parent ticks "Stay signed in" on AUTH-24.
 */
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import {
  DevAuthClient,
  MemoryKeyValueStore,
  devIdToken,
  type AuthClient,
  type DevIdentity,
  type KeyValueStore,
} from "@smriti/app-core";
import { useAppStore } from "@smriti/app-core/react";
import {
  ApiError,
  createApiClient,
  newIdempotencyKey,
  unwrap,
  type ApiClient,
  type Schemas,
} from "@smriti/api-client";
import { useServices } from "../boot/context";
import type { Services } from "../boot/services";
import { LazySupabaseAuthClient } from "../platform/lazyAuth";
import {
  LocalStorageKeyValueStore,
  createFetch,
  deviceId,
  prefs,
  requestFetch,
  withDevLinkFlag,
} from "../platform/web";

export type Scope = Schemas["ConsentRequestCreate"]["scopes"][number];
export type MyConsent = Schemas["MyConsentOut"];
export type ConsentCreated = Schemas["ConsentRequestCreated"];
export type ConsentStatus = Schemas["ConsentRequestStatus"];
export type ConsentForGuardian = Schemas["ConsentRequestForGuardian"];
export type ConsentDecision = Schemas["ConsentDecision"];
export type Learner = Schemas["LearnerOut"];
export type Consent = Schemas["ConsentOut"];

/** Every scope in AUTH-20's order. `account` is always asked and can't be switched off there. */
export const SCOPES: readonly Scope[] = ["account", "social", "community", "voice", "uploads"];
/** Scopes a teen asks for from a gated feature (AUTH-18 `{feature}`). */
export const FEATURE_SCOPES: readonly Scope[] = ["social", "community", "voice", "uploads"];

/**
 * The notice version recorded with a consent (`app.guardian_consents.notice_version`). The API has
 * no published notice yet, so this names the AUTH-20 copy the guardian read. Replace it with the
 * server's notice version once legal publishes one (reported).
 */
export const CONSENT_NOTICE_VERSION = "auth-20.copy-1";

const idem = () => ({ "Idempotency-Key": newIdempotencyKey() });

export function isScope(v: unknown): v is Scope {
  return typeof v === "string" && (SCOPES as readonly string[]).includes(v);
}

/** The caller's own consent (`GET /v1/guardian/consent`): state, scopes, a pending request. */
export function useMyConsent(enabled = true) {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["guardian", "consent", userId],
    enabled: enabled && !!userId && !s.fakeApi,
    retry: false,
    staleTime: 15_000,
    queryFn: () => unwrap(s.client.GET("/v1/guardian/consent"), s.client),
  });
}

/** True when the learner may use a scoped feature: adults, or a teen whose guardian allowed it. */
export function scopeAllowed(c: MyConsent | undefined, scope: Scope): boolean {
  if (!c) return false;
  // `needs_consent` only says no consent record is active; the age band says who needs one.
  if (c.age_band === "18p" || c.state === "not_required") return true;
  return c.state === "granted" && c.scopes.includes(scope);
}

/** The request this device made last, kept so AUTH-21 can keep waiting after a reload. */
export interface HeldRequest {
  id: string;
  code: string;
  link: string;
  channel: "handoff" | "link";
  expires_at: string;
  scopes: Scope[];
  from: string;
}

interface ConsentFlow {
  request: HeldRequest | null;
  hold(r: HeldRequest | null): void;
}

const HELD_KEY = "guardian_request";

function readHeld(): HeldRequest | null {
  try {
    const raw = prefs.get(HELD_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as HeldRequest;
    return Date.parse(r.expires_at) > Date.now() ? r : null;
  } catch {
    return null;
  }
}

export const useConsentFlow = create<ConsentFlow>((set) => ({
  request: readHeld(),
  hold(r) {
    prefs.set(HELD_KEY, r ? JSON.stringify(r) : null);
    set({ request: r });
  },
}));

/** AUTH-18: ask for a guardian's OK (`account` always included). */
export async function createConsentRequest(
  s: Services,
  channel: "handoff" | "link",
  scopes: Scope[],
  locale: "en" | "hi",
  from: string,
): Promise<HeldRequest> {
  const asked = Array.from(new Set<Scope>(["account", ...scopes]));
  const r = await unwrap(
    s.client.POST("/v1/guardian/consent-requests", {
      params: { header: idem() },
      body: { channel, locale, scopes: asked },
    }),
    s.client,
  );
  const held: HeldRequest = {
    id: r.id,
    code: r.code,
    link: r.link,
    channel: r.channel,
    expires_at: r.expires_at,
    scopes: r.scopes,
    from,
  };
  useConsentFlow.getState().hold(held);
  return held;
}

/** The teen's poll of their own request (AUTH-21 every 5 s, AUTH-19 after the handoff). */
export function useRequestStatus(id: string | null, pollMs: number | false) {
  const s = useServices();
  return useQuery({
    queryKey: ["guardian", "request", id],
    enabled: !!id && !s.fakeApi,
    retry: false,
    refetchInterval: pollMs,
    queryFn: async () => {
      const r = await unwrap(
        s.client.GET("/v1/guardian/consent-requests/{ref}", {
          params: { path: { ref: id ?? "" } },
        }),
        s.client,
      );
      return r as ConsentStatus;
    },
  });
}

/** A guardian's own signed-in session on a separate auth client and API client. */
export interface GuardianSession {
  auth: AuthClient;
  client: ApiClient;
  /** Signs the guardian in (dev identity locally; a Google ID token with AUTH_MODE=supabase). */
  signIn(identity: DevIdentity): Promise<{ userId: string }>;
  /** Ends the guardian session on this device only (flow §6.10 step 5). */
  signOut(): Promise<void>;
}

/** `persist` keeps the parent signed in on this browser (AUTH-24 "Stay signed in", off by default). */
export function createGuardianSession(
  s: Services,
  opts: { persist?: boolean } = {},
): GuardianSession {
  const store: KeyValueStore = opts.persist
    ? new LocalStorageKeyValueStore("smriti.parent.")
    : new MemoryKeyValueStore();
  const env = s.env;
  const auth: AuthClient =
    env.AUTH_MODE === "supabase" && env.SUPABASE_URL && env.SUPABASE_ANON_KEY
      ? new LazySupabaseAuthClient({
          url: env.SUPABASE_URL,
          anonKey: env.SUPABASE_ANON_KEY,
          storage: store,
          storageKey: "smriti-guardian-auth",
          detectSessionInUrl: false,
        })
      : new DevAuthClient({
          baseUrl: env.API_BASE_URL,
          fetch: withDevLinkFlag(createFetch(s.interceptor)),
          store,
          clock: () => Date.now(),
        });
  const client = createApiClient({
    baseUrl: env.API_BASE_URL,
    getAccessToken: () => auth.getAccessToken(),
    appVariant: s.variant.id,
    deviceId: deviceId(),
    platform: "web",
    fetch: requestFetch(s.interceptor),
  });
  return {
    auth,
    client,
    async signIn(identity) {
      const session = await auth.signInWithIdToken({
        provider: "google",
        idToken: devIdToken(identity),
        nonce: crypto.randomUUID(),
      });
      return { userId: session.user.id };
    },
    async signOut() {
      await auth.signOut({ scope: "local" }).catch(() => undefined);
    },
  };
}

/** AUTH-20 as the guardian: what the teen asked for, by code. */
export async function readRequestAsGuardian(
  g: GuardianSession,
  code: string,
): Promise<ConsentForGuardian> {
  const r = await unwrap(
    g.client.GET("/v1/guardian/consent-requests/{ref}", { params: { path: { ref: code } } }),
    g.client,
  );
  return r as ConsentForGuardian;
}

export async function confirmConsent(
  g: GuardianSession,
  code: string,
  scopes: Scope[],
  method: "google_same_device" | "google_own_device",
  appVersion: string,
): Promise<ConsentDecision> {
  return unwrap(
    g.client.POST("/v1/guardian/consent-requests/{code}/confirm", {
      params: { path: { code }, header: idem() },
      body: {
        declaration: true,
        method,
        notice_version: CONSENT_NOTICE_VERSION,
        scopes,
        platform: "web",
        app_version: appVersion,
      },
    }),
    g.client,
  );
}

export async function declineConsent(g: GuardianSession, code: string): Promise<ConsentDecision> {
  return unwrap(
    g.client.POST("/v1/guardian/consent-requests/{code}/decline", {
      params: { path: { code }, header: idem() },
    }),
    g.client,
  );
}

/** SET-14: the teens and children linked to the signed-in guardian. */
export async function listLearners(g: GuardianSession): Promise<Learner[]> {
  return (await unwrap(g.client.GET("/v1/guardian/learners"), g.client)).learners;
}

/** SET-17 [Turn off]: withdraw one scope (`account` withdraws the whole consent). */
export async function withdrawScope(
  g: GuardianSession,
  consentId: string,
  scope: Scope,
): Promise<Consent> {
  return unwrap(
    g.client.DELETE("/v1/guardian/consents/{consent_id}/scopes/{scope}", {
      params: { path: { consent_id: consentId, scope }, header: idem() },
    }),
    g.client,
  );
}

/** The guardian-facing error for a failed step (AUTH-19/20/22 states, AUTH-30 otherwise). */
export type GuardianProblem =
  | "is_learner"
  | "is_minor"
  | "identity_required"
  | "expired"
  | "answered"
  | "not_found"
  | "rate_limited"
  | "offline"
  | "server";

export function guardianProblem(err: unknown): GuardianProblem {
  if (err instanceof ApiError) {
    if (err.code === "guardian_is_learner") return "is_learner";
    if (err.code === "guardian_is_minor") return "is_minor";
    if (err.code === "guardian_identity_required") return "identity_required";
    if (err.code === "consent_request_expired" || err.status === 410) return "expired";
    if (err.code === "consent_request_answered") return "answered";
    if (err.status === 404) return "not_found";
    if (err.status === 429) return "rate_limited";
    return "server";
  }
  return typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "server";
}
