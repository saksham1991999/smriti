/**
 * FAKE API, Phase 2 and 3 routes (dev and e2e builds only): Feynman, speech, voice, insights,
 * live mocks and parent mode, shaped like apps/api's responses. Nothing here is study content:
 * key points are read from the published fixture bundles, and any text the real model would write
 * (follow-up questions, transcripts) is labelled fixture text. Scores and counts are made up by
 * simple rules so the screens have something to show; they are never shown outside dev and e2e.
 *
 * State is kept per user in its own localStorage key (`smriti.fake-api.phase2.v1`), so the main
 * fake database's shape doesn't change.
 */
import { http, HttpResponse, type RequestHandler } from "msw";
import type { Schemas } from "@smriti/api-client";
import { FIXTURE_PROFILE } from "./fixtures";
import type { FakeUser } from "./state";

export interface Phase2Context {
  url: (path: string) => string;
  authed: (request: Request) => FakeUser | null;
  unauthorized: () => Response;
  now: () => number;
  /** Every fake user (parent mode links learners to a guardian). */
  users: () => Record<string, FakeUser>;
  loadContent: (path: string) => Promise<unknown>;
}

interface UserState {
  feynman: Record<string, { clarity: number; completeness: number; accuracy: number }>;
  feynmanAttempts: Record<string, Schemas["FeynmanOut"]>;
}

const STORE_KEY = "smriti.fake-api.phase2.v1";

function loadStore(): Record<string, UserState> {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, UserState>) : {};
  } catch {
    return {};
  }
}

const isPro = (u: FakeUser, now: number) => u.entitlement.plan === "pro" && (!u.entitlement.pro_until || Date.parse(u.entitlement.pro_until) > now);
const words = (s: string) => s.match(/[\p{L}\p{M}\p{N}_]+/gu)?.length ?? 0;

/** The fake's tutor quota line (the real one counts tutor messages against the Pro fair-use cap). */
const quota = (): Schemas["QuotaOut"] => ({ used: 0, limit: null, remaining: null, resets_at: null, unlimited: true });

/** RFC 7807 problem details with the extra fields some errors carry (`reason`, `min_words`). */
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  HttpResponse.json({ type: code, title: code, status, code, ...extra }, { status, headers: { "Content-Type": "application/problem+json" } });

export function createPhase2Handlers(ctx: Phase2Context): RequestHandler[] {
  const { url, authed, unauthorized, now } = ctx;
  const store = loadStore();
  const save = () => {
    try {
      globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      /* memory only */
    }
  };
  const state = (u: FakeUser): UserState => (store[u.id] ??= { feynman: {}, feynmanAttempts: {} });

  /** A concept's key points in both languages, from the published fixture bundles. */
  const keyPoints = async (conceptId: string): Promise<{ en: string; hi: string }[] | null> => {
    const topicId = conceptId.split(".").slice(0, 3).join(".");
    const out: Record<"en" | "hi", string[]> = { en: [], hi: [] };
    for (const locale of ["en", "hi"] as const) {
      try {
        const m = (await ctx.loadContent(`manifests/${FIXTURE_PROFILE}.${locale}.json`)) as { topics: Record<string, { bundles: Record<string, { path: string }> }> };
        const path = m.topics[topicId]?.bundles.deep_dive?.path;
        if (!path) return null;
        const b = (await ctx.loadContent(path)) as { concepts: { id: string; key_points: string[] }[] };
        out[locale] = b.concepts.find((c) => c.id === conceptId)?.key_points ?? [];
      } catch {
        return null;
      }
    }
    return out.en.map((en, i) => ({ en, hi: out.hi[i] ?? en }));
  };

  return [
    // ── G-3 Feynman ────────────────────────────────────────────────────────
    http.post(url("/v1/feynman/attempts"), async ({ request }) => {
      const u = authed(request);
      if (!u) return unauthorized();
      if (!isPro(u, now())) return problem(403, "pro_required", { paywall_trigger: "tutor_tool", paywall_source: "tutor_feynman" });
      const body = (await request.json()) as Schemas["FeynmanIn"];
      const st = state(u);
      const replay = st.feynmanAttempts[body.client_attempt_id];
      if (replay) return HttpResponse.json(replay);
      if (!body.follow_up_of && words(body.explanation) < 30) return problem(422, "too_short", { min_words: 30 });
      if (/\bunsafe-fixture\b/i.test(body.explanation)) return problem(422, "feynman_safety", { kind: "refusal", helplines: [] });
      const points = await keyPoints(body.concept_id);
      if (!points?.length) return problem(404, "concept_not_found");
      // Fixture grading rules: long answers cover everything; "wrong" marks the second point.
      const n = words(body.explanation);
      const all = n >= 80 || !!body.follow_up_of;
      const wrongIndex = /\bwrong\b/i.test(body.explanation) && points.length > 1 ? 1 : -1;
      const key_points = points.map((text, index) => ({
        index,
        text,
        status: (index === wrongIndex ? "misconception" : all || index === 0 ? "covered" : "missing") as "covered" | "missing" | "misconception",
        note: index === wrongIndex ? "Fixture note: this point is stated the wrong way round." : null,
      }));
      const covered = key_points.filter((k) => k.status === "covered").length;
      const addressed = key_points.filter((k) => k.status !== "missing").length;
      const clarity = Math.min(100, 30 + n);
      const completeness = Math.round((covered / key_points.length) * 100);
      const accuracy = addressed ? Math.round((covered / addressed) * 100) : 0;
      const previous = st.feynman[body.concept_id] ?? null;
      const result: Schemas["FeynmanOut"] = {
        id: crypto.randomUUID(),
        session_id: crypto.randomUUID(),
        concept_id: body.concept_id,
        attempt_no: Object.values(st.feynmanAttempts).filter((a) => a.concept_id === body.concept_id).length + 1,
        clarity,
        completeness,
        accuracy,
        key_points,
        follow_ups: all ? [] : key_points.filter((k) => k.status !== "covered").map((k) => `Fixture follow-up question about key point ${k.index + 1}`),
        previous,
        mastery_delta: 0,
        status: "graded",
        safety: null,
        quota: quota(),
      };
      st.feynman[body.concept_id] = { clarity, completeness, accuracy };
      st.feynmanAttempts[body.client_attempt_id] = result;
      save();
      return HttpResponse.json(result);
    }),

    // ── Speech (dictation returns a fixture sentence; no audio is kept) ─────
    http.post(url("/v1/speech/dictation"), async ({ request }) => {
      const u = authed(request);
      if (!u) return unauthorized();
      if (!isPro(u, now())) return problem(403, "pro_required");
      const bytes = (await request.arrayBuffer()).byteLength;
      if (!bytes) return problem(422, "empty_audio");
      const locale = new URL(request.url).searchParams.get("locale") === "hi" ? "hi" : "en";
      return HttpResponse.json({ text: locale === "hi" ? "फ़िक्स्चर डिक्टेशन का वाक्य।" : "Fixture dictation sentence.", confidence: 0.9, quota: quota() });
    }),
  ];
}
