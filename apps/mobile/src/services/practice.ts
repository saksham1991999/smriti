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

/** A helpline the server sends with a crisis event (`safety.helplines`, owner config). Never in code. */
export interface Helpline {
  name: string;
  number: string;
  [k: string]: string;
}

/** One server-sent event from `/v1/tutor/sessions/{id}/messages` (routes/tutor.py). */
export type TutorEvent =
  | { type: 'delta'; text: string }
  | { type: 'replace'; text: string }
  | { type: 'safety'; kind: string; helplines: Helpline[]; chips: string[] }
  | { type: 'citations'; items: unknown[] }
  | { type: 'chips'; items: unknown[] }
  | { type: 'quota'; quota: Quota }
  | { type: 'quota_exhausted' }
  | { type: 'error'; code: string; retry: boolean }
  | { type: 'done'; messageId: string | null };

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
        out.push({
          type: 'safety',
          kind: str('kind'),
          helplines: (list('helplines') as Record<string, unknown>[]).filter((h) => typeof h.name === 'string' && typeof h.number === 'string') as unknown as Helpline[],
          chips: list('chips').filter((c): c is string => typeof c === 'string'),
        });
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
        out.push({ type: 'done', messageId: str('message_id') || null });
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
 * Sends a message and returns the parsed events once the stream closes (no streaming body: Jest,
 * the in-app fake). `streamTutorMessage` is the one screens use.
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

/**
 * Sends a message and hands each server-sent event to `onEvent` as it arrives, through
 * `expo/fetch` (the API client still adds auth and device headers). Falls back to reading the
 * whole stream when no streaming fetch is available. Returns every event.
 */
export async function streamTutorMessage(
  app: SmritiApp,
  sessionId: string,
  text: string,
  input: 'typed' | 'chip',
  onEvent: (e: TutorEvent) => void,
): Promise<TutorEvent[]> {
  await app.ensureSession();
  const stream = app.deps.streamFetch;
  if (!stream) {
    const events = await sendTutorMessage(app, sessionId, text, input);
    events.forEach(onEvent);
    return events;
  }
  const body = await unwrap(
    app.api.POST('/v1/tutor/sessions/{session_id}/messages', {
      params: { path: { session_id: sessionId } },
      body: { client_message_id: app.newId(), input, text },
      parseAs: 'stream',
      fetch: stream,
    }),
  );
  const events: TutorEvent[] = [];
  const emit = (chunk: string) => {
    for (const e of parseTutorStream(chunk)) {
      events.push(e);
      onEvent(e);
    }
  };
  const reader = (body as ReadableStream<Uint8Array> | null)?.getReader();
  if (!reader) return events;
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Complete events end with a blank line; the tail waits for the next chunk.
    const cut = Math.max(buffer.lastIndexOf('\n\n'), buffer.lastIndexOf('\r\n\r\n'));
    if (cut >= 0) {
      emit(buffer.slice(0, cut));
      buffer = buffer.slice(cut).replace(/^(\r?\n)+/, '');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) emit(buffer);
  return events;
}
