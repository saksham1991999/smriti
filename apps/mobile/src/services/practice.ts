import { unwrap, type Schemas } from '@smriti/api-client';
import type { Answer } from '@smriti/lesson-core';

import type { SmritiApp } from './app';

/**
 * Practice, mocks, the daily challenge and the AI tutor (PRC-01, MOCK-01, AI-02). Everything goes
 * through @smriti/api-client against `/v1/practice/*`, `/v1/mocks`, `/v1/daily-challenge/*` and
 * `/v1/tutor/*`. Progress itself still flows through app-core's outbox and `/v1/sync/*`.
 */
export type PracticeHub = Schemas['PracticeHub'];
export type MockCard = Schemas['MockCard'];
export type DailyChallenge = Schemas['DailyChallenge'];
export type TutorSession = Schemas['TutorSession'];
export type Quota = Schemas['QuotaOut'];

export const practiceKeys = {
  hub: (user: string | null, exam: string | null) => ['smriti', 'practice', 'hub', user, exam] as const,
  mocks: (user: string | null, exam: string | null) => ['smriti', 'mocks', user, exam] as const,
  challenge: (user: string | null, exam: string | null) => ['smriti', 'daily-challenge', user, exam] as const,
};

async function ready(app: SmritiApp): Promise<{ exam: string | null }> {
  await app.ensureSession();
  return { exam: app.examProfileId() };
}

export async function fetchPracticeHub(app: SmritiApp): Promise<PracticeHub> {
  const { exam } = await ready(app);
  return unwrap(app.api.GET('/v1/practice/hub', { params: { query: { exam } } }));
}

export async function fetchMocks(app: SmritiApp): Promise<MockCard[]> {
  const { exam } = await ready(app);
  return unwrap(app.api.GET('/v1/mocks', { params: { query: { exam } } }));
}

export async function fetchDailyChallenge(app: SmritiApp): Promise<DailyChallenge> {
  const { exam } = await ready(app);
  return unwrap(app.api.GET('/v1/daily-challenge/today', { params: { query: { exam } } }));
}

export async function startDailyChallenge(app: SmritiApp, challengeId: string): Promise<DailyChallenge> {
  await app.ensureSession();
  return unwrap(app.api.POST('/v1/daily-challenge/{challenge_id}/start', { params: { path: { challenge_id: challengeId } } }));
}

export async function answerDailyChallenge(app: SmritiApp, challengeId: string, answer: Answer, clientTimeMs: number): Promise<DailyChallenge> {
  await app.ensureSession();
  return unwrap(
    app.api.POST('/v1/daily-challenge/{challenge_id}/answer', {
      params: { path: { challenge_id: challengeId } },
      body: { answer: toServerAnswer(answer), client_time_ms: Math.max(0, Math.round(clientTimeMs)), tz: app.deps.timeZone() },
    }),
  );
}

/** lesson-core's `Answer` (camelCase, from the renderers) in the API's answer shape. */
export function toServerAnswer(a: Answer): NonNullable<Schemas['DailyChallengeAnswer']['answer']> {
  switch (a.kind) {
    case 'options':
      return { kind: 'options', option_ids: a.optionIds };
    case 'number':
      return { kind: 'number', value: a.value, ...(a.unit ? { unit: a.unit } : {}) };
    case 'pairs':
      return { kind: 'pairs', pairs: a.pairs };
    case 'matrix':
      return { kind: 'matrix', rows: a.rows };
    case 'blanks':
      return { kind: 'blanks', blanks: a.blanks.map((b) => ({ blank: b.blank, choice_id: b.choiceId ?? null, text: b.text ?? null })) };
    case 'order':
      return { kind: 'order', order: a.order };
  }
}

/** Which buddy line PRC-01 shows (UX_FLOW PRC-01: cap first, then the challenge, then weak spots). */
export function hubPetLine(hub: PracticeHub): 'cap_reached' | 'challenge_not_played' | 'weak_spots_found' | 'new_student' {
  const q = hub.limits.practice_questions;
  if (!q.unlimited && q.remaining !== null && q.remaining <= 0) return 'cap_reached';
  if (hub.daily_challenge.state === 'not_played') return 'challenge_not_played';
  if (hub.weak_spots.length > 0) return 'weak_spots_found';
  return 'new_student';
}

// ── AI tutor (AI-02) ───────────────────────────────────────────────────────────

export async function openTutorSession(app: SmritiApp, contextRef: string | null): Promise<TutorSession> {
  const { exam } = await ready(app);
  return unwrap(app.api.POST('/v1/tutor/sessions', { body: { mode: 'chat', exam, context_ref: contextRef } }));
}

/** One server-sent event from `/v1/tutor/sessions/{id}/messages` (routes/tutor.py). */
export type TutorEvent =
  | { type: 'delta'; text: string }
  | { type: 'replace'; text: string }
  | { type: 'safety'; kind: string }
  | { type: 'citations'; items: unknown[] }
  | { type: 'chips'; items: unknown[] }
  | { type: 'quota'; quota: Quota }
  | { type: 'quota_exhausted' }
  | { type: 'error'; code: string; retry: boolean }
  | { type: 'done' };

/** Parses an SSE body (`event: x\ndata: {...}\n\n`) into tutor events. Unknown events are skipped. */
export function parseTutorStream(body: string): TutorEvent[] {
  const out: TutorEvent[] = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    let name = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) continue;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data.join('\n')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const str = (k: string) => (typeof payload[k] === 'string' ? (payload[k] as string) : '');
    const list = (k: string) => (Array.isArray(payload[k]) ? (payload[k] as unknown[]) : []);
    switch (name) {
      case 'delta':
      case 'replace':
        out.push({ type: name, text: str('text') });
        break;
      case 'safety':
        out.push({ type: 'safety', kind: str('kind') });
        break;
      case 'citations':
      case 'chips':
        out.push({ type: name, items: list('items') });
        break;
      case 'quota':
        out.push({ type: 'quota', quota: payload as unknown as Quota });
        break;
      case 'quota_exhausted':
        out.push({ type: 'quota_exhausted' });
        break;
      case 'error':
        out.push({ type: 'error', code: str('code') || 'error', retry: payload.retry === true });
        break;
      case 'done':
        out.push({ type: 'done' });
        break;
    }
  }
  return out;
}

/** The answer text after applying `delta` and `replace` events in order. */
export function tutorAnswerText(events: TutorEvent[]): string {
  let text = '';
  for (const e of events) {
    if (e.type === 'delta') text += e.text;
    else if (e.type === 'replace') text = e.text;
  }
  return text;
}

/**
 * Sends a message and returns the parsed events. React Native's fetch has no streaming body, so
 * the events are read once the stream closes; the answer then appears in one go.
 */
export async function sendTutorMessage(app: SmritiApp, sessionId: string, text: string, input: 'typed' | 'chip' = 'typed'): Promise<TutorEvent[]> {
  await app.ensureSession();
  const body = await unwrap(
    app.api.POST('/v1/tutor/sessions/{session_id}/messages', {
      params: { path: { session_id: sessionId } },
      body: { client_message_id: app.newId(), input, text },
      parseAs: 'text',
    }),
  );
  return parseTutorStream(typeof body === 'string' ? body : '');
}
