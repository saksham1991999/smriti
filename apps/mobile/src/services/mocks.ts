import { unwrap, type Schemas } from '@smriti/api-client';
import { localize } from '@smriti/content-schema';
import type { Answer, AnyQuestion } from '@smriti/lesson-core';
import type { MockPaletteState } from '@smriti/tokens';

import type { SmritiApp } from './app';
import { toServerAnswer } from './practice';

/**
 * Mocks (MOCK-02 to MOCK-26) on `/v1/mocks/*` and `/v1/attempts/*`. The server owns the clock,
 * the deadline, sections and scoring; the runner keeps answers on the device (so a crash or going
 * offline loses nothing) and saves them with `PUT /v1/attempts/{id}/answers`, newest wins.
 *
 * MockRunner has no React in it, so it can move to app-core for the web app (docs/PARITY.md).
 */
export type MockDetail = Schemas['MockDetail'];
export type Attempt = Schemas['Attempt'];
export type AttemptQuestion = Schemas['AttemptQuestion'];
export type AttemptSection = Schemas['AttemptSection'];
export type AttemptSummary = Schemas['AttemptSummary'];
export type Report = Schemas['Report'];
export type Solutions = Schemas['Solutions'];
export type SaveResult = Schemas['SaveResult'];
export type PaletteStatus = Schemas['SavedAnswer']['palette_status'];
export type Confidence = 'sure' | 'fifty_fifty' | 'guess';
type ServerAnswer = NonNullable<Schemas['AnswerSave']['answer']>;

export const PALETTE_TOKEN: Record<PaletteStatus, MockPaletteState> = {
  not_visited: 'notVisited',
  not_answered: 'notAnswered',
  answered: 'answered',
  marked: 'marked',
  answered_marked: 'answeredMarked',
};

const path = (attempt_id: string) => ({ params: { path: { attempt_id } } });

export async function fetchMockDetail(app: SmritiApp, mockId: string): Promise<MockDetail> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/mocks/{mock_id}', { params: { path: { mock_id: mockId } } }));
}

export async function startAttempt(app: SmritiApp, mockId: string, language: 'en' | 'hi', timePolicy: 'practice' | 'strict'): Promise<Attempt> {
  await app.ensureSession();
  return unwrap(
    app.api.POST('/v1/mocks/{mock_id}/attempts', {
      params: { path: { mock_id: mockId } },
      body: { attempt_id: app.newId(), language, time_policy: timePolicy, started_at: new Date(app.deps.clock()).toISOString() },
    }),
  );
}

export async function generateMock(app: SmritiApp, body: Omit<Schemas['GenerateMock'], 'attempt_id'>): Promise<Attempt> {
  await app.ensureSession();
  return unwrap(app.api.POST('/v1/mocks/generate', { body: { ...body, attempt_id: app.newId() } as Schemas['GenerateMock'] }));
}

export async function fetchAttempt(app: SmritiApp, id: string): Promise<Attempt> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/attempts/{attempt_id}', path(id)));
}

export async function listAttempts(app: SmritiApp): Promise<AttemptSummary[]> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/attempts', { params: { query: { limit: 50 } } }));
}

export async function fetchReport(app: SmritiApp, id: string): Promise<Report> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/attempts/{attempt_id}/report', path(id)));
}

export async function fetchSolutions(app: SmritiApp, id: string): Promise<Solutions> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/attempts/{attempt_id}/solutions', { params: { path: { attempt_id: id }, query: { locale: app.ui.getState().locale } } }));
}

/** The server's answer shape back into lesson-core's (for the renderers). */
export function fromServerAnswer(a: Record<string, unknown> | null | undefined): Answer | null {
  if (!a || typeof a.kind !== 'string') return null;
  const list = (k: string) => (Array.isArray(a[k]) ? (a[k] as unknown[]) : []);
  switch (a.kind) {
    case 'options':
      return { kind: 'options', optionIds: list('option_ids').map(String) };
    case 'number':
      return { kind: 'number', value: (a.value as number | string) ?? '', unit: (a.unit as string | null | undefined) ?? null };
    case 'pairs':
      return { kind: 'pairs', pairs: list('pairs') as { left: string; right: string }[] };
    case 'matrix':
      return { kind: 'matrix', rows: list('rows') as { row: string; columns: string[] }[] };
    case 'blanks':
      return {
        kind: 'blanks',
        blanks: (list('blanks') as { blank: string; choice_id?: string | null; text?: string | null }[]).map((b) => ({ blank: b.blank, ...(b.choice_id ? { choiceId: b.choice_id } : {}), ...(b.text ? { text: b.text } : {}) })),
      };
    case 'order':
      return { kind: 'order', order: list('order').map(String) };
    default:
      return null;
  }
}

/** True when a draft holds an actual answer (an empty options list is no answer). */
export function hasAnswer(a: Answer | null): boolean {
  if (!a) return false;
  switch (a.kind) {
    case 'options':
      return a.optionIds.length > 0;
    case 'number':
      return String(a.value).trim() !== '' && String(a.value) !== '-';
    case 'pairs':
      return a.pairs.length > 0;
    case 'matrix':
      return a.rows.some((r) => r.columns.length > 0);
    case 'blanks':
      return a.blanks.some((b) => Boolean(b.choiceId) || Boolean(b.text?.trim()));
    case 'order':
      return a.order.length > 0;
  }
}

/** A question body (both languages) as the renderers take it, in one language. */
export function localQuestion(body: Record<string, unknown>, locale: 'en' | 'hi'): AnyQuestion {
  return localize(body, locale) as unknown as AnyQuestion;
}

interface Row {
  answer: Answer | null;
  palette: PaletteStatus;
  timeMs: number;
  visits: number;
  changes: number;
  firstSeenSeq: number | null;
  answeredSeq: number | null;
  confidence: Confidence | null;
  updatedAt: string;
}

interface Persisted {
  rows: Record<string, Row>;
  dirty: string[];
  current: string | null;
  seq: number;
}

export type RunnerPhase = 'running' | 'paused' | 'submitting' | 'submitted' | 'expired';

/**
 * One attempt in progress. CBT rules (MOCK-07/08): the draft on screen is kept only with Save &
 * next or Mark for review & next; Clear response empties it. Every change is saved on the device
 * at once and to the server in batches (every few seconds, on leave, before submit).
 */
export class MockRunner {
  attempt: Attempt;
  readonly questions: AttemptQuestion[];
  private rows = new Map<string, Row>();
  private dirty = new Set<string>();
  private seq = 0;
  private skewMs: number;
  private viewStartedAt: number | null = null;
  private listeners = new Set<() => void>();
  private flushing: Promise<void> | null = null;
  current: string;
  draft: Answer | null = null;
  phase: RunnerPhase;
  /** Answers the server refused, by question id, with its code (MOCK-07 over_attempt and so on). */
  rejected = new Map<string, string>();
  lastSavedAt: number | null = null;
  version = 0;

  constructor(
    private readonly app: SmritiApp,
    attempt: Attempt,
    persisted: Persisted | null = null,
  ) {
    this.attempt = attempt;
    this.questions = [...(attempt.questions ?? [])].sort((a, b) => a.position - b.position);
    this.skewMs = Date.parse(attempt.server_time) - app.deps.clock();
    for (const q of this.questions) {
      const s = q.saved;
      this.rows.set(q.question_id, {
        answer: fromServerAnswer(s?.answer),
        palette: s?.palette_status ?? 'not_visited',
        timeMs: s?.time_spent_ms ?? 0,
        visits: s?.visits ?? 0,
        changes: s?.answer_changes ?? 0,
        firstSeenSeq: s?.first_seen_seq ?? null,
        answeredSeq: s?.answered_seq ?? null,
        confidence: s?.confidence ?? null,
        updatedAt: s?.client_updated_at ?? new Date(0).toISOString(),
      });
      this.seq = Math.max(this.seq, s?.first_seen_seq ?? 0, s?.answered_seq ?? 0);
    }
    // Device copy newer than the server's (offline answers, a crash before the last save).
    if (persisted) {
      for (const [id, r] of Object.entries(persisted.rows)) {
        const cur = this.rows.get(id);
        if (cur && Date.parse(r.updatedAt) > Date.parse(cur.updatedAt)) this.rows.set(id, r);
      }
      for (const id of persisted.dirty) if (this.rows.has(id)) this.dirty.add(id);
      this.seq = Math.max(this.seq, persisted.seq);
    }
    const firstOpen = this.questions.find((q) => this.sectionOf(q.question_id)?.status === 'open') ?? this.questions[0];
    this.current = persisted?.current && this.rows.has(persisted.current) ? persisted.current : (firstOpen?.question_id ?? '');
    this.phase = attempt.status !== 'in_progress' ? 'submitted' : attempt.paused ? 'paused' : 'running';
    this.draft = this.row(this.current)?.answer ?? null;
    if (this.phase === 'running') this.enter(this.current);
  }

  static storageKey(attemptId: string): string {
    return `mock-attempt:${attemptId}`;
  }

  static async load(app: SmritiApp, attempt: Attempt): Promise<MockRunner> {
    let persisted: Persisted | null = null;
    try {
      const raw = await app.deps.stores.kv.get(MockRunner.storageKey(attempt.id));
      persisted = raw ? (JSON.parse(raw) as Persisted) : null;
    } catch {
      persisted = null;
    }
    return new MockRunner(app, attempt, persisted);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private changed() {
    this.version++;
    for (const l of this.listeners) l();
  }

  row(id: string): Row | undefined {
    return this.rows.get(id);
  }

  question(id: string): AttemptQuestion | undefined {
    return this.questions.find((q) => q.question_id === id);
  }

  sectionOf(id: string): AttemptSection | undefined {
    const q = this.question(id);
    return this.attempt.sections.find((s) => s.code === q?.section_code);
  }

  numberOf(id: string): number {
    return this.questions.findIndex((q) => q.question_id === id) + 1;
  }

  /** The server's clock now, from the skew measured when the attempt arrived. */
  serverNow(): number {
    return this.app.deps.clock() + this.skewMs;
  }

  /** The deadline on this device's clock (for ui-native Timer's `endsAt`). */
  deadlineLocal(): number {
    return Date.parse(this.attempt.server_deadline_at) - this.skewMs;
  }

  sectionDeadlineLocal(code: string): number | null {
    const s = this.attempt.sections.find((x) => x.code === code);
    return s?.closes_at ? Date.parse(s.closes_at) - this.skewMs : null;
  }

  remainingMs(): number {
    if (this.phase === 'paused') return this.attempt.remaining_ms;
    return Math.max(0, Date.parse(this.attempt.server_deadline_at) - this.serverNow());
  }

  canOpen(id: string): boolean {
    const s = this.sectionOf(id);
    if (!s) return false;
    if (this.attempt.section_navigation === 'free') return true;
    return s.status === 'open';
  }

  counts(code?: string): Record<PaletteStatus, number> {
    const out: Record<PaletteStatus, number> = { not_visited: 0, not_answered: 0, answered: 0, marked: 0, answered_marked: 0 };
    for (const q of this.questions) {
      if (code && q.section_code !== code) continue;
      out[this.rows.get(q.question_id)!.palette]++;
    }
    return out;
  }

  private stampTime() {
    if (this.viewStartedAt === null) return;
    const r = this.rows.get(this.current);
    const now = this.app.deps.clock();
    if (r) {
      r.timeMs += Math.max(0, now - this.viewStartedAt);
      this.touch(this.current, false);
    }
    this.viewStartedAt = now;
  }

  private enter(id: string) {
    const r = this.rows.get(id);
    if (!r) return;
    r.visits += 1;
    if (r.firstSeenSeq === null) r.firstSeenSeq = ++this.seq;
    if (r.palette === 'not_visited') r.palette = 'not_answered';
    this.viewStartedAt = this.app.deps.clock();
    this.touch(id);
  }

  private touch(id: string, persist = true) {
    const r = this.rows.get(id);
    if (!r) return;
    r.updatedAt = new Date(this.serverNow()).toISOString();
    this.dirty.add(id);
    if (persist) void this.persist();
  }

  go(id: string) {
    if (id === this.current || !this.rows.has(id) || this.phase !== 'running') return;
    if (!this.canOpen(id)) return;
    this.stampTime();
    this.current = id;
    this.draft = this.rows.get(id)!.answer;
    this.enter(id);
    this.changed();
  }

  step(delta: 1 | -1) {
    const i = this.questions.findIndex((q) => q.question_id === this.current);
    for (let j = i + delta; j >= 0 && j < this.questions.length; j += delta) {
      const id = this.questions[j]!.question_id;
      if (this.canOpen(id)) return this.go(id);
    }
  }

  setDraft(a: Answer | null) {
    this.draft = a;
    this.changed();
  }

  setConfidence(c: Confidence | null) {
    const r = this.rows.get(this.current);
    if (!r) return;
    r.confidence = c;
    this.touch(this.current);
    this.changed();
  }

  /** True when the screen shows an answer that Save & next has not kept (the unsaved tip). */
  unsaved(): boolean {
    const r = this.rows.get(this.current);
    return JSON.stringify(this.draft ?? null) !== JSON.stringify(r?.answer ?? null) && hasAnswer(this.draft);
  }

  private commit(mark: boolean) {
    const r = this.rows.get(this.current);
    if (!r) return;
    const answer = hasAnswer(this.draft) ? this.draft : null;
    if (JSON.stringify(answer) !== JSON.stringify(r.answer)) {
      if (r.answer && answer) r.changes += 1;
      r.answer = answer;
      if (answer) r.answeredSeq = ++this.seq;
    }
    r.palette = answer ? (mark ? 'answered_marked' : 'answered') : mark ? 'marked' : 'not_answered';
    this.rejected.delete(this.current);
    this.stampTime();
    this.touch(this.current);
  }

  saveNext() {
    this.commit(false);
    this.advanceOrStay();
  }

  markNext() {
    this.commit(true);
    this.advanceOrStay();
  }

  clear() {
    const r = this.rows.get(this.current);
    if (!r) return;
    this.draft = null;
    r.answer = null;
    r.palette = r.palette === 'marked' || r.palette === 'answered_marked' ? 'marked' : 'not_answered';
    this.touch(this.current);
    this.changed();
  }

  private advanceOrStay() {
    const before = this.current;
    this.step(1);
    if (this.current === before) this.changed();
    void this.flush();
  }

  private async persist() {
    const data: Persisted = { rows: Object.fromEntries(this.rows), dirty: [...this.dirty], current: this.current, seq: this.seq };
    try {
      await this.app.deps.stores.kv.set(MockRunner.storageKey(this.attempt.id), JSON.stringify(data));
    } catch {
      // Storage full or unavailable: the server copy still has everything saved so far.
    }
  }

  /** Sends every changed row. Safe to call often; calls overlap into one request at a time. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush() {
    if (this.phase === 'running') this.stampTime();
    if (this.dirty.size === 0) return;
    const ids = [...this.dirty];
    const answers = ids.map((id) => {
      const r = this.rows.get(id)!;
      return {
        question_id: id,
        answer: r.answer ? (toServerAnswer(r.answer) as ServerAnswer) : null,
        palette_status: r.palette,
        time_spent_ms: Math.round(r.timeMs),
        visits: r.visits,
        answer_changes: r.changes,
        first_seen_seq: r.firstSeenSeq,
        answered_seq: r.answeredSeq,
        confidence: r.confidence,
        client_updated_at: r.updatedAt,
      };
    });
    let res: SaveResult;
    try {
      res = await unwrap(this.app.api.PUT('/v1/attempts/{attempt_id}/answers', { ...path(this.attempt.id), body: { answers } }));
    } catch {
      return; // Offline: the rows stay dirty and on the device.
    }
    for (const id of [...res.saved, ...res.kept_newer]) {
      const r = this.rows.get(id);
      const sent = answers.find((a) => a.question_id === id);
      if (r && sent && r.updatedAt === sent.client_updated_at) this.dirty.delete(id);
    }
    for (const r of res.rejected) {
      this.rejected.set(r.question_id, r.code);
      this.dirty.delete(r.question_id);
    }
    this.lastSavedAt = this.app.deps.clock();
    this.skewMs = Date.parse(res.server_time) - this.app.deps.clock();
    this.attempt = { ...this.attempt, server_deadline_at: res.server_deadline_at, status: res.status, sections: res.sections };
    if (res.status !== 'in_progress') this.phase = 'submitted';
    // A section that closed (its timer, or locked order) moves the student to the open one.
    if (!this.canOpen(this.current)) {
      const next = this.questions.find((q) => this.canOpen(q.question_id));
      if (next) {
        this.current = next.question_id;
        this.draft = this.rows.get(next.question_id)?.answer ?? null;
        this.enter(next.question_id);
      }
    }
    await this.persist();
    this.changed();
  }

  async pause(): Promise<void> {
    await this.flush();
    const a = await unwrap(this.app.api.POST('/v1/attempts/{attempt_id}/pause', { ...path(this.attempt.id), body: { at: new Date(this.serverNow()).toISOString() } }));
    this.adopt(a);
  }

  async resume(): Promise<void> {
    const a = await unwrap(this.app.api.POST('/v1/attempts/{attempt_id}/resume', path(this.attempt.id)));
    this.adopt(a);
    if (this.phase === 'running') this.viewStartedAt = this.app.deps.clock();
  }

  async takeover(): Promise<void> {
    this.adopt(await unwrap(this.app.api.POST('/v1/attempts/{attempt_id}/takeover', path(this.attempt.id))));
  }

  async submitSection(code: string): Promise<void> {
    await this.flush();
    this.adopt(await unwrap(this.app.api.POST('/v1/attempts/{attempt_id}/sections/{section_code}/submit', { params: { path: { attempt_id: this.attempt.id, section_code: code } } })));
    const next = this.questions.find((q) => this.canOpen(q.question_id));
    if (next) this.go(next.question_id);
  }

  async abandon(): Promise<void> {
    this.adopt(await unwrap(this.app.api.POST('/v1/attempts/{attempt_id}/abandon', path(this.attempt.id))));
    await this.app.deps.stores.kv.delete(MockRunner.storageKey(this.attempt.id)).catch(() => undefined);
  }

  /** Saves what is left, then submits (MOCK-16) or, at the deadline, auto-submits (MOCK-17). */
  async submit(expired = false): Promise<Report> {
    this.phase = 'submitting';
    this.changed();
    await this.flush();
    const report = await unwrap(this.app.api.POST('/v1/attempts/{attempt_id}/submit', path(this.attempt.id)));
    this.phase = expired ? 'expired' : 'submitted';
    await this.app.deps.stores.kv.delete(MockRunner.storageKey(this.attempt.id)).catch(() => undefined);
    this.changed();
    return report;
  }

  private adopt(a: Attempt) {
    this.skewMs = Date.parse(a.server_time) - this.app.deps.clock();
    this.attempt = { ...a, questions: this.attempt.questions ?? null };
    this.phase = a.status !== 'in_progress' ? 'submitted' : a.paused ? 'paused' : 'running';
    this.changed();
  }
}
