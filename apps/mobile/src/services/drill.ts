import { ApiError, unwrap, type Schemas } from '@smriti/api-client';
import { checkAnswer, type Answer, type AnyQuestion, type CheckResult } from '@smriti/lesson-core';

import type { SmritiApp } from './app';
import { hasAnswer, localQuestion, type Confidence } from './mocks';
import { toServerAnswer } from './practice';

/**
 * Drills and the PYQ bank (PRC-02 to PRC-10) on `/v1/practice/*` and `/v1/pyq/*`. The server
 * picks and sizes the session (to the free questions left today, so it never stops mid-way),
 * checks each answer and counts it. The question bodies come from the content bundles on the
 * device, so a drill renders without waiting on the network; the answer key in the bundle gives
 * instant feedback, and the server's check is what counts.
 *
 * DrillRunner has no React in it, so it can move to app-core for the web app (docs/PARITY.md).
 */
export type WeakSpots = Schemas['WeakSpots'];
export type WeakSpot = Schemas['WeakSpot'];
export type PracticeSession = Schemas['PracticeSession'];
export type SessionQuestion = Schemas['SessionQuestion'];
export type SessionSummary = Schemas['smriti_api__schemas__practice__SessionSummary'];
export type AnswerResult = Schemas['AnswerResult'];
export type PyqPaper = Schemas['PyqPaper'];
export type PyqPaperDetail = Schemas['PyqPaperDetail'];
export type PyqQuestion = Schemas['PyqQuestion'];
export type SessionCreate = Schemas['smriti_api__schemas__practice__SessionCreate'];
export type MistakeType = 'conceptual' | 'calculation' | 'misread' | 'silly' | 'time';
export type Difficulty = 'adaptive' | 'easy' | 'medium' | 'hard';

export const drillKeys = {
  weakSpots: (user: string | null, exam: string | null) => ['smriti', 'practice', 'weak-spots', user, exam] as const,
  papers: (user: string | null, exam: string | null) => ['smriti', 'pyq', 'papers', user, exam] as const,
  paper: (user: string | null, id: string) => ['smriti', 'pyq', 'paper', user, id] as const,
  pyqs: (user: string | null, exam: string | null, chapter: string | null) => ['smriti', 'pyq', 'list', user, exam, chapter] as const,
  sessions: (user: string | null) => ['smriti', 'practice', 'sessions', user] as const,
};

export async function fetchWeakSpots(app: SmritiApp): Promise<WeakSpots> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/practice/weak-spots', { params: { query: { exam: app.examProfileId() } } }));
}

export async function listSessions(app: SmritiApp): Promise<SessionSummary[]> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/practice/sessions', { params: { query: { limit: 50 } } }));
}

export async function fetchSession(app: SmritiApp, id: string): Promise<PracticeSession> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/practice/sessions/{session_id}', { params: { path: { session_id: id } } }));
}

/**
 * Starts a session. The id is made here so a retry after a lost response gets the same session
 * back (the server treats `session_id` as the idempotency key).
 */
export async function createSession(app: SmritiApp, body: Omit<SessionCreate, 'session_id'>, sessionId: string = app.newId()): Promise<PracticeSession> {
  await app.ensureSession();
  return unwrap(app.api.POST('/v1/practice/sessions', { body: { ...body, session_id: sessionId, exam: body.exam ?? app.examProfileId() } }));
}

export async function completeSession(app: SmritiApp, id: string, endedBy: 'finished' | 'closed' | 'time_up'): Promise<PracticeSession> {
  await app.ensureSession();
  return unwrap(app.api.POST('/v1/practice/sessions/{session_id}/complete', { params: { path: { session_id: id } }, body: { ended_by: endedBy } }));
}

export async function listPyqPapers(app: SmritiApp): Promise<PyqPaper[]> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/pyq/papers', { params: { query: { exam: app.examProfileId() } } }));
}

export async function fetchPyqPaper(app: SmritiApp, id: string): Promise<PyqPaperDetail> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/pyq/papers/{paper_id}', { params: { path: { paper_id: id } } }));
}

export interface PyqFilters {
  year?: number[];
  session?: string | null;
  subject?: string | null;
  chapter?: string | null;
  difficulty?: 'easy' | 'medium' | 'hard' | null;
  type?: string | null;
  status?: 'not_tried' | 'wrong' | 'correct' | null;
}

export async function listPyqs(app: SmritiApp, f: PyqFilters = {}): Promise<PyqQuestion[]> {
  await app.ensureSession();
  return unwrap(
    app.api.GET('/v1/pyq', {
      params: {
        query: {
          exam: app.examProfileId(),
          year: f.year && f.year.length ? f.year : null,
          session: f.session ?? null,
          subject: f.subject ?? null,
          chapter: f.chapter ?? null,
          difficulty: f.difficulty ?? null,
          type: f.type ?? null,
          status: f.status ?? null,
          limit: 200,
        },
      },
    }),
  );
}

/** SET-24 / AI-05: "Report a problem" on a question, solution, card or tutor reply. */
export async function reportContent(app: SmritiApp, body: Schemas['ContentReportIn']): Promise<Schemas['ContentReportOut']> {
  await app.ensureSession();
  return unwrap(app.api.POST('/v1/content/reports', { body: { ...body, locale: body.locale ?? app.ui.getState().locale } }));
}

/** The paper's mock id for "Take as a timed mock" (the server lists PYQ papers as `pyq:{paper_id}`). */
export const pyqMockId = (paperId: string) => `pyq:${paperId}`;

/** `https://host/path` → `host`, for "Source: {source_host}". */
export function sourceHost(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1]!.replace(/^www\./, '') : null;
}

/**
 * A question's body from the bundles on this device: the practice bundle first, then the
 * lesson bundles (questions are shared across them). Null when its topic isn't downloaded.
 */
export function deviceQuestion(app: SmritiApp, topicId: string | null, questionId: string): AnyQuestion | null {
  if (!topicId) return null;
  const locale = app.ui.getState().locale;
  for (const mode of ['practice', 'deep_dive', 'quick_revision'] as const) {
    const b = app.deps.content.load(locale, topicId, mode, app.examProfileId());
    const q = b?.bundle.questions[questionId];
    if (q) return q as unknown as AnyQuestion;
  }
  return null;
}

// ── The runner (PRC-04 and PRC-05) ────────────────────────────────────────────

export interface Solution {
  feynman: string | null;
  steps: string[];
  shortcut: string | null;
  shortcutFails: string | null;
  traps: { optionId: string | null; why: string }[];
}

export interface DrillRow {
  question: AnyQuestion | null;
  draft: Answer | null;
  confidence: Confidence | null;
  /** 1, or 2 after [Try again]. */
  attempt: 1 | 2;
  /** The first try's check, kept for the summary and the "first wrong" rule. */
  first: { correct: boolean; partial: number } | null;
  /** The latest check: the server's when it answered, else the device's from the bundle key. */
  result: { correct: boolean; partial: number; local: CheckResult | null; confirmed: boolean } | null;
  solution: Solution | null;
  struck: string[];
  timeMs: number;
  mistake: MistakeType | null;
  skipped: boolean;
}

interface Pending {
  question_id: string;
  answer: ReturnType<typeof toServerAnswer>;
  attempt: 1 | 2;
  confidence: Confidence | null;
  time_ms: number;
  mistake_type: MistakeType | null;
}

export interface DrillOptions {
  feedback: 'after_each' | 'at_end';
  timed: boolean;
  /** PRC-03 source, kept for "Drill again". */
  concepts: string[];
  topicId: string | null;
  chapterTest: boolean;
}

const SINGLE_TRY = new Set(['mcq_single', 'assertion_reason', 'statement_based']);

export class DrillRunner {
  readonly rows: DrillRow[];
  index = 0;
  version = 0;
  phase: 'running' | 'done' = 'running';
  endedBy: 'finished' | 'closed' | 'time_up' | null = null;
  private shownAt: number;
  private pending: Pending[] = [];
  private flushing: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  readonly startedAt: number;

  constructor(
    private readonly app: SmritiApp,
    public session: PracticeSession,
    readonly options: DrillOptions,
  ) {
    this.rows = session.questions.map((q) => {
      const question = deviceQuestion(app, q.topic_id, q.question_id);
      return { question, draft: null, confidence: null, attempt: 1, first: null, result: null, solution: question ? solutionOf(question) : null, struck: [], timeMs: 0, mistake: null, skipped: false };
    });
    this.startedAt = app.deps.clock();
    this.shownAt = this.startedAt;
  }

  /** Total time for Timed mode: the sum of each question's ideal time (PRC-03). */
  timedTotalMs(): number {
    return this.session.questions.reduce((s, q) => s + (q.ideal_time_s ?? 60) * 1000, 0);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  get current(): DrillRow {
    return this.rows[this.index]!;
  }

  get sq(): SessionQuestion {
    return this.session.questions[this.index]!;
  }

  isLast(): boolean {
    return this.index >= this.rows.length - 1;
  }

  setDraft(a: Answer) {
    this.current.draft = a;
    this.emit();
  }

  setConfidence(c: Confidence | null) {
    this.current.confidence = c;
    this.emit();
  }

  setMistake(m: MistakeType | null) {
    const row = this.current;
    row.mistake = m;
    // The tag rides on the answer that is still waiting to be sent, if there is one.
    const p = this.pending.find((x) => x.question_id === this.sq.question_id && x.attempt === row.attempt);
    if (p) p.mistake_type = m;
    this.emit();
  }

  /** [Check] (after-each mode) or [Next] (at-the-end mode): checks on the device, sends to the server. */
  check(): void {
    const row = this.current;
    const q = row.question;
    if (!q || !hasAnswer(row.draft)) return;
    const now = this.app.deps.clock();
    row.timeMs += now - this.shownAt;
    this.shownAt = now;
    const local = safeCheck(q, row.draft!);
    row.result = { correct: local?.correct ?? false, partial: local?.partial ?? 0, local, confirmed: false };
    if (row.attempt === 1) row.first = { correct: row.result.correct, partial: row.result.partial };
    this.pending.push({ question_id: this.sq.question_id, answer: toServerAnswer(row.draft!), attempt: row.attempt, confidence: row.confidence, time_ms: Math.round(row.timeMs), mistake_type: row.mistake });
    this.emit();
    void this.flush();
  }

  /** [Try again]: the first wrong try on a single-answer question in after-each mode. */
  canRetry(): boolean {
    const row = this.current;
    return this.options.feedback === 'after_each' && row.attempt === 1 && row.result !== null && !row.result.correct && row.question !== null && SINGLE_TRY.has(row.question.type);
  }

  retry(): void {
    const row = this.current;
    if (!this.canRetry()) return;
    const chosen = row.draft?.kind === 'options' ? row.draft.optionIds : [];
    row.struck = [...row.struck, ...chosen];
    row.attempt = 2;
    row.result = null;
    row.draft = null;
    this.shownAt = this.app.deps.clock();
    this.emit();
  }

  /** [Skip] on a question that didn't load: doesn't count toward the free cap. */
  skip(): void {
    this.current.skipped = true;
    this.next();
  }

  next(): void {
    if (this.isLast()) {
      this.emit();
      return;
    }
    this.index++;
    this.shownAt = this.app.deps.clock();
    this.emit();
  }

  /** Re-reads a question that wasn't on the device (after a download). */
  reload(): void {
    const row = this.current;
    row.question = deviceQuestion(this.app, this.sq.topic_id, this.sq.question_id);
    row.solution = row.question ? solutionOf(row.question) : null;
    this.emit();
  }

  /** Sends checked answers, oldest first, once at a time. Failures stay queued (offline). */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (this.pending.length > 0) {
        const p = this.pending[0]!;
        let res: AnswerResult;
        try {
          await this.app.ensureSession();
          res = await unwrap(
            this.app.api.POST('/v1/practice/sessions/{session_id}/answers', {
              params: { path: { session_id: this.session.id } },
              body: { ...p, locale: this.app.ui.getState().locale },
            }),
          );
        } catch (e) {
          // A rejected answer (4xx other than a timeout) won't succeed on retry: drop it.
          if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) this.pending.shift();
          break;
        }
        this.pending.shift();
        this.applyServer(res);
      }
      this.flushing = null;
    })();
    return this.flushing;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  private applyServer(res: AnswerResult) {
    const i = this.session.questions.findIndex((q) => q.question_id === res.question_id);
    const row = this.rows[i];
    if (!row) return;
    if (res.attempt === row.attempt && row.result) row.result = { ...row.result, correct: res.check.correct, partial: res.check.partial, confirmed: true };
    if (res.attempt === 1) row.first = { correct: res.check.correct, partial: res.check.partial };
    // The server's solution, in the student's language, when the bundle had none.
    if (!row.solution) row.solution = solutionFromServer(res.solution);
    this.session = { ...this.session, answered: res.session_answered, correct: res.session_correct, quota: res.quota };
    this.emit();
  }

  /** Ends the session on the server (PRC-06). Answers still queued are sent first. */
  async finish(endedBy: 'finished' | 'closed' | 'time_up'): Promise<void> {
    this.phase = 'done';
    this.endedBy = endedBy;
    await this.flush();
    try {
      this.session = await completeSession(this.app, this.session.id, endedBy);
    } catch {
      // The summary still shows what the device knows; the server closes stale sessions itself.
    }
    await this.app.deps.stores.kv.set(DrillRunner.summaryKey(this.session.id), JSON.stringify(this.summary()));
    this.emit();
  }

  summary(): DrillSummary {
    const answered = this.rows.filter((r) => r.first !== null);
    return {
      sessionId: this.session.id,
      kind: this.session.kind,
      answered: answered.length,
      correct: answered.filter((r) => r.first!.correct).length,
      size: this.rows.length,
      ms: answered.reduce((s, r) => s + r.timeMs, 0),
      endedBy: this.endedBy ?? 'closed',
      concepts: this.options.concepts.length ? this.options.concepts : [...new Set(this.session.questions.flatMap((q) => q.concepts))],
      topicId: this.options.topicId ?? this.session.questions[0]?.topic_id ?? null,
      chapterTest: this.options.chapterTest,
      questions: this.session.questions.map((q, i) => ({
        id: q.question_id,
        topicId: q.topic_id,
        difficulty: q.difficulty,
        timeMs: this.rows[i]!.timeMs,
        result: this.rows[i]!.first === null ? 'skipped' : this.rows[i]!.first!.correct ? 'correct' : 'wrong',
      })),
      capped: this.session.capped_by_free_limit,
      lastFree: !this.session.quota.unlimited && this.session.quota.remaining === 0,
    };
  }

  static summaryKey(id: string) {
    return `drill-summary:${id}`;
  }

  static async loadSummary(app: SmritiApp, id: string): Promise<DrillSummary | null> {
    try {
      const raw = await app.deps.stores.kv.get(DrillRunner.summaryKey(id));
      return raw ? (JSON.parse(raw) as DrillSummary) : null;
    } catch {
      return null;
    }
  }
}

export interface DrillSummary {
  sessionId: string;
  kind: string;
  answered: number;
  correct: number;
  size: number;
  ms: number;
  endedBy: 'finished' | 'closed' | 'time_up';
  concepts: string[];
  topicId: string | null;
  chapterTest: boolean;
  questions: { id: string; topicId: string; difficulty: string | null; timeMs: number; result: 'correct' | 'wrong' | 'skipped' }[];
  capped: boolean;
  lastFree: boolean;
}

function safeCheck(q: AnyQuestion, a: Answer): CheckResult | null {
  try {
    return 'answer' in q && q.answer ? checkAnswer(q, a) : null;
  } catch {
    return null;
  }
}

interface RawSolution {
  feynman?: unknown;
  steps?: unknown;
  shortcut?: unknown;
  shortcut_fails_when?: unknown;
  common_traps?: unknown;
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'text' in v && typeof (v as { text: unknown }).text === 'string') return (v as { text: string }).text;
  return null;
}

function toSolution(s: RawSolution | null | undefined): Solution | null {
  if (!s) return null;
  const steps = Array.isArray(s.steps) ? s.steps.map(str).filter((x): x is string => Boolean(x)) : [];
  const traps = Array.isArray(s.common_traps)
    ? (s.common_traps as { option_id?: unknown; why?: unknown }[]).map((t) => ({ optionId: typeof t.option_id === 'string' ? t.option_id : null, why: str(t.why) ?? '' })).filter((t) => t.why)
    : [];
  const out = { feynman: str(s.feynman), steps, shortcut: str(s.shortcut), shortcutFails: str(s.shortcut_fails_when), traps };
  return out.feynman || out.steps.length || out.shortcut || out.traps.length ? out : null;
}

function solutionOf(q: AnyQuestion): Solution | null {
  return toSolution((q as unknown as { solution?: RawSolution }).solution);
}

function solutionFromServer(view: Record<string, unknown>): Solution | null {
  return toSolution(view.solution as RawSolution | undefined);
}

/** A server body (both languages) for a PYQ opened outside a bundle, in one language. */
export function bodyQuestion(body: Record<string, unknown>, locale: 'en' | 'hi'): AnyQuestion {
  return localQuestion(body, locale);
}

/** "m:ss" for time lines and tiles. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Runners started on this device, so PRC-03 → PRC-04 → PRC-06 share one without a refetch. */
const live = new Map<string, DrillRunner>();

export function keepRunner(r: DrillRunner): void {
  live.set(r.session.id, r);
}

export function liveRunner(id: string): DrillRunner | null {
  return live.get(id) ?? null;
}

export function dropRunner(id: string): void {
  live.delete(id);
}
