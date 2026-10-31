import {
  createSseParser,
  streamTutorMessage as streamTutorEvents,
  toTutorEvent,
  unwrap,
  type Schemas,
  type TutorHelpline,
  type TutorStreamEvent,
} from '@smriti/api-client';
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

/** A helpline the server sends with a crisis event (`safety.helplines`, owner config). Never in code. */
export type Helpline = TutorHelpline;

/**
 * One server-sent event from `/v1/tutor/sessions/{id}/messages`, as the tutor screen uses it:
 * api-client's typed event with `done` reduced to the stored message id.
 */
export type TutorEvent =
  | Exclude<TutorStreamEvent, { type: 'done' } | { type: 'quota_exhausted' }>
  | { type: 'quota_exhausted' }
  | { type: 'done'; messageId: string | null };

function fromStreamEvent(e: TutorStreamEvent): TutorEvent {
  if (e.type === 'done') return { type: 'done', messageId: typeof e.data.message_id === 'string' ? e.data.message_id : null };
  if (e.type === 'quota_exhausted') return { type: 'quota_exhausted' };
  return e;
}

/** Parses a whole SSE body into tutor events with api-client's parser. Unknown events are skipped. */
export function parseTutorStream(body: string): TutorEvent[] {
  const out: TutorEvent[] = [];
  const parser = createSseParser((raw) => {
    const e = toTutorEvent(raw);
    if (e) out.push(fromStreamEvent(e));
  });
  parser.push(body);
  parser.end();
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
 * Sends a message through api-client's tutor stream and hands each event to `onEvent` as it
 * arrives. On devices the call goes through `expo/fetch` (`deps.streamFetch`), whose body
 * streams; the client's middleware still adds auth and device headers. Without a streaming fetch
 * (Jest, the in-app fake) the body is read when it closes and the events arrive together.
 * Returns every event.
 */
export async function streamTutorMessage(
  app: SmritiApp,
  sessionId: string,
  text: string,
  input: 'typed' | 'chip',
  onEvent: (e: TutorEvent) => void = () => undefined,
): Promise<TutorEvent[]> {
  await app.ensureSession();
  const stream = app.deps.streamFetch;
  const events: TutorEvent[] = [];
  const body = { client_message_id: app.newId(), input, text };
  for await (const e of streamTutorEvents(app.api, sessionId, body, stream ? { fetch: stream } : undefined)) {
    const event = fromStreamEvent(e);
    events.push(event);
    onEvent(event);
  }
  return events;
}

/** Sends a message and returns every event once the stream closes. */
export function sendTutorMessage(app: SmritiApp, sessionId: string, text: string, input: 'typed' | 'chip' = 'typed'): Promise<TutorEvent[]> {
  return streamTutorMessage(app, sessionId, text, input);
}
