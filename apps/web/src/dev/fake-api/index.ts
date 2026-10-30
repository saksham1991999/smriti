/**
 * FAKE API (dev and e2e builds only; production builds refuse anything under src/dev/).
 *
 * An MSW handler set that implements the sync contract v1.1 and the dev auth routes, plus the
 * config, content, billing and account routes the web app needs, until apps/api lands. It runs
 * in-process: `createFetch(fakeApi.intercept)` answers matching requests without a network or a
 * service worker; Vitest uses the same handlers. Switching to the real API is VITE_API_BASE_URL
 * (and VITE_FAKE_API unset). Billing here is `FakeBilling`'s server side: it never charges anyone.
 */
import { getResponse, http, HttpResponse, type RequestHandler } from "msw";
import type { SyncEventsRequest, WireEvent } from "@smriti/app-core";
import { FIXTURE_CONFIG, fixtureCatalog, fixtureLesson, fixtureQuestions } from "./fixtures";
import { computeState, emptyDb, validateEvent, type FakeDbData, type FakeUser } from "./state";

export interface FakeApiOptions {
  baseUrl: string;
  now?: () => number;
  /** Persist between page loads (localStorage in the browser). */
  load?: () => FakeDbData | null;
  save?: (db: FakeDbData) => void;
  /** Artificial latency in ms (shows loading states in dev). */
  latencyMs?: number;
}

export interface FakeApi {
  handlers: RequestHandler[];
  intercept(request: Request): Promise<Response | undefined>;
  db(): FakeDbData;
  reset(): void;
}

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rid = () => crypto.randomUUID();

function jwt(user: FakeUser, now: number, method: string): string {
  const header = b64url(JSON.stringify({ alg: "none", typ: "JWT", kid: "fake" }));
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      role: "authenticated",
      aud: "authenticated",
      is_anonymous: user.isAnonymous,
      exp: Math.floor(now / 1000) + 3600,
      iat: Math.floor(now / 1000),
      amr: [{ method, timestamp: Math.floor(now / 1000) }],
    }),
  );
  return `${header}.${payload}.fake-signature`;
}

function subOf(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const part = auth.slice(7).split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string; exp?: number };
    return json.sub ?? null;
  } catch {
    return null;
  }
}

export function createFakeApi(opts: FakeApiOptions): FakeApi {
  const now = opts.now ?? Date.now;
  let data: FakeDbData = opts.load?.() ?? emptyDb();
  const save = () => opts.save?.(data);
  const base = opts.baseUrl.replace(/\/$/, "");
  const url = (p: string) => `${base}${p}`;

  const newUser = (anon: boolean, email: string | null, name: string | null): FakeUser => {
    const u: FakeUser = {
      id: rid(),
      isAnonymous: anon,
      email,
      name,
      createdAt: now(),
      deletedAt: null,
      version: 1,
      locale: "en",
      events: [],
      entitlement: { plan: "free", pro_until: null },
      introClaimed: false,
      guardianConsent: false,
    };
    data.users[u.id] = u;
    return u;
  };

  const session = (u: FakeUser, method: string) => {
    const refresh = rid();
    data.refresh[refresh] = u.id;
    save();
    return HttpResponse.json({
      access_token: jwt(u, now(), method),
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: refresh,
      user: { id: u.id, is_anonymous: u.isAnonymous },
    });
  };

  const authed = (request: Request): FakeUser | null => {
    const sub = subOf(request);
    const u = sub ? data.users[sub] : undefined;
    return u && !u.deletedAt ? u : null;
  };
  const unauthorized = () => HttpResponse.json({ code: "unauthorized" }, { status: 401 });
  const byEmail = (email: string) => Object.values(data.users).find((x) => x.email === email && !x.deletedAt);

  const handlers: RequestHandler[] = [
    // ── Dev auth (sync contract "Dev auth") ──────────────────────────────────
    http.post(url("/v1/dev/auth/anonymous"), () => session(newUser(true, null, null), "anonymous")),
    http.post(url("/v1/dev/auth/google"), async ({ request }) => {
      const body = (await request.json()) as { email?: string; name?: string };
      const email = (body.email ?? "").trim().toLowerCase();
      if (!email.includes("@")) return HttpResponse.json({ code: "invalid_email" }, { status: 422 });
      const owner = byEmail(email);
      const current = authed(request);
      if (current) {
        // Link: the identity already belongs to another account → identity_already_exists.
        if (owner && owner.id !== current.id) return HttpResponse.json({ code: "identity_already_exists" }, { status: 409 });
        current.isAnonymous = false;
        current.email = email;
        current.name = body.name ?? current.name;
        current.version += 1;
        return session(current, "oauth");
      }
      return session(owner ?? newUser(false, email, body.name ?? null), "oauth");
    }),
    http.post(url("/v1/dev/auth/refresh"), async ({ request }) => {
      const body = (await request.json()) as { refresh_token?: string };
      const u = body.refresh_token ? data.users[data.refresh[body.refresh_token] ?? ""] : undefined;
      if (!u || u.deletedAt) return unauthorized();
      return session(u, "refresh");
    }),

    // ── Sync contract v1.1 ───────────────────────────────────────────────────
    http.post(url("/v1/sync/events"), async ({ request }) => {
      const u = authed(request);
      if (!u) return unauthorized();
      const body = (await request.json()) as SyncEventsRequest;
      if (!Array.isArray(body.events) || body.events.length > 200) return HttpResponse.json({ code: "invalid_envelope" }, { status: 422 });
      const accepted: string[] = [];
      const rejected: { event_id: string; code: string }[] = [];
      const seen = new Set(u.events.map((e) => e.event_id));
      for (const e of body.events as WireEvent[]) {
        const code = validateEvent(e);
        if (code) rejected.push({ event_id: e.event_id, code });
        else {
          if (!seen.has(e.event_id)) u.events.push(e);
          seen.add(e.event_id);
          accepted.push(e.event_id);
        }
      }
      if (accepted.length) u.version += 1;
      save();
      return HttpResponse.json({ accepted, rejected, state_version: u.version });
    }),
    http.get(url("/v1/sync/state"), ({ request }) => {
      const u = authed(request);
      if (!u) return unauthorized();
      return HttpResponse.json(computeState(u, now()));
    }),

    // ── Config and content (fixtures) ────────────────────────────────────────
    http.get(url("/v1/config"), () => HttpResponse.json(FIXTURE_CONFIG)),
    http.get(url("/v1/content/catalog"), ({ request }) => {
      const profiles = new URL(request.url).searchParams.getAll("profile");
      return HttpResponse.json(fixtureCatalog(profiles));
    }),
    http.get(url("/v1/content/lessons/:topicId"), ({ params, request }) => {
      const locale = new URL(request.url).searchParams.get("locale") === "hi" ? "hi" : "en";
      const lesson = fixtureLesson(String(params.topicId), locale);
      return lesson ? HttpResponse.json(lesson) : HttpResponse.json({ code: "not_found" }, { status: 404 });
    }),
    http.get(url("/v1/practice/questions"), ({ request }) => {
      const q = new URL(request.url).searchParams;
      return HttpResponse.json({ fixture: true, questions: fixtureQuestions(q.get("subject") ?? "phy", Number(q.get("count") ?? 10)) });
    }),

    // ── Billing (FakeBilling's server side; never charges) ───────────────────
    http.get(url("/v1/billing/intro-eligibility"), ({ request }) => {
      const u = authed(request);
      if (!u) return unauthorized();
      return HttpResponse.json({ eligible: !u.introClaimed, intro_price_paise: 100, price_paise: 9900, currency: "INR" });
    }),
    http.post(url("/v1/billing/checkout"), ({ request }) => {
      const u = authed(request);
      if (!u) return unauthorized();
      if (u.isAnonymous) return HttpResponse.json({ code: "sign_in_required" }, { status: 403 });
      const intro = !u.introClaimed;
      const id = rid();
      data.checkouts[id] = { userId: u.id, intro, amount: intro ? 100 : 9900 };
      save();
      return HttpResponse.json({ checkout_id: id, amount_paise: intro ? 100 : 9900, intro, provider: "fake" });
    }),
    http.post(url("/v1/billing/fake/complete"), async ({ request }) => {
      const u = authed(request);
      if (!u) return unauthorized();
      const body = (await request.json()) as { checkout_id?: string; outcome?: "success" | "failure" };
      const co = body.checkout_id ? data.checkouts[body.checkout_id] : undefined;
      if (!co || co.userId !== u.id) return HttpResponse.json({ code: "not_found" }, { status: 404 });
      if (body.outcome === "failure") return HttpResponse.json({ status: "failed" });
      const until = now() + 30 * 86_400_000;
      u.entitlement = { plan: "pro", pro_until: new Date(until).toISOString(), status: "active", is_intro: co.intro, source: "fake", cancel_at_period_end: false };
      if (co.intro) u.introClaimed = true;
      u.version += 1;
      delete data.checkouts[body.checkout_id ?? ""];
      save();
      return HttpResponse.json({ status: "active", entitlement: u.entitlement, state_version: u.version });
    }),
    http.post(url("/v1/billing/cancel"), ({ request }) => {
      const u = authed(request);
      if (!u) return unauthorized();
      u.entitlement = { ...u.entitlement, cancel_at_period_end: true };
      u.version += 1;
      save();
      return HttpResponse.json({ entitlement: u.entitlement });
    }),

    // ── Account: merge, deletion, guardian consent ───────────────────────────
    http.post(url("/v1/account/merge-intents"), async ({ request }) => {
      const u = authed(request);
      if (!u?.isAnonymous) return HttpResponse.json({ code: "not_a_guest" }, { status: 403 });
      const body = (await request.json()) as { email?: string };
      const id = rid();
      data.mergeIntents[id] = { guestId: u.id, email: (body.email ?? "").toLowerCase() };
      save();
      return HttpResponse.json({ intent_id: id, expires_in: 600 });
    }),
    http.post(url("/v1/account/merges"), async ({ request }) => {
      const u = authed(request);
      if (!u || u.isAnonymous) return unauthorized();
      const body = (await request.json()) as { intent_id?: string };
      const intent = body.intent_id ? data.mergeIntents[body.intent_id] : undefined;
      const guest = intent ? data.users[intent.guestId] : undefined;
      if (!intent || !guest || intent.email !== u.email) return HttpResponse.json({ code: "invalid_intent" }, { status: 409 });
      // Union of events (event ids keep it idempotent). The account keeps its own pet and profile.
      const have = new Set(u.events.map((e) => e.event_id));
      const keepTypes = new Set(["pet_named", "onboarding_answer"]);
      const accountHasPet = u.events.some((e) => e.type === "pet_named");
      for (const e of guest.events) {
        if (have.has(e.event_id)) continue;
        if (accountHasPet && keepTypes.has(e.type)) continue;
        u.events.push(e);
      }
      u.events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
      u.version += 1;
      guest.deletedAt = now();
      delete data.mergeIntents[body.intent_id ?? ""];
      save();
      return HttpResponse.json({ status: "merged", state_version: u.version });
    }),
    http.post(url("/v1/account/deletion"), ({ request }) => {
      const u = authed(request);
      if (!u) return unauthorized();
      u.deletedAt = now();
      save();
      return HttpResponse.json({ status: "scheduled", erase_after: new Date(now() + 7 * 86_400_000).toISOString() });
    }),
    http.post(url("/v1/guardian/consents"), async ({ request }) => {
      const u = authed(request);
      if (!u) return unauthorized();
      const body = (await request.json()) as { guardian_email?: string; declared_adult?: boolean };
      if (!body.declared_adult || !body.guardian_email?.includes("@")) return HttpResponse.json({ code: "invalid_payload" }, { status: 422 });
      u.guardianConsent = true;
      save();
      return HttpResponse.json({ status: "recorded", scopes: ["account", "social"] });
    }),
  ];

  return {
    handlers,
    async intercept(request) {
      if (!request.url.startsWith(base)) return undefined;
      if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
      const res = await getResponse(handlers, request);
      return res ?? HttpResponse.json({ code: "not_found" }, { status: 404 });
    },
    db: () => data,
    reset() {
      data = emptyDb();
      save();
    },
  };
}

const STORE_KEY = "smriti.fake-api.v1";

/** The browser instance: persisted in localStorage so a reload keeps the fake server's data. */
export function createBrowserFakeApi(baseUrl: string): FakeApi {
  return createFakeApi({
    baseUrl,
    latencyMs: 120,
    load: () => {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        return raw ? (JSON.parse(raw) as FakeDbData) : null;
      } catch {
        return null;
      }
    },
    save: (db) => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(db));
      } catch {
        /* storage full or blocked: keep in memory */
      }
    },
  });
}
