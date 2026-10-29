/**
 * Transport-agnostic host session: the handshake, the ready timeout, state
 * throttling, error limits, task progress and the readings list. The iframe
 * and WebView helpers wrap it with a transport.
 */

import { systemClock, type Clock } from '../clock';
import {
  PROTOCOL_VERSION,
  hostMessage,
  isCompatibleVersion,
  type HostToSimMessage,
  type InitPayload,
  type MeasurementPayload,
  type ReadyPayload,
  type Reading,
  type SetParamsPayload,
  type SimSnapshot,
  type SimToHostMessage,
  type TaskSpec,
} from '../protocol';
import { evaluateTask, readingsToValues, type RecordedRow, type TaskEvaluation } from '../tasks';
import { parseSimMessage } from '../validate';

export type HostStatus =
  | 'idle'
  | 'waiting_hello'
  | 'initializing'
  | 'running'
  | 'paused'
  | 'complete'
  | 'failed'
  | 'destroyed';

export type RejectReason = 'origin' | 'source' | 'invalid' | 'unexpected' | 'sim_id';

export type CrashReason = 'fatal_error' | 'too_many_errors' | 'version_mismatch';

export type HostEvent =
  | { kind: 'status'; status: HostStatus; previous: HostStatus }
  | { kind: 'message'; message: SimToHostMessage }
  | { kind: 'sent'; message: HostToSimMessage }
  | { kind: 'ready'; payload: ReadyPayload; loadMs: number }
  | { kind: 'timeout'; waitedMs: number }
  | { kind: 'rejected'; reason: RejectReason; detail?: string }
  | { kind: 'crashed'; reason: CrashReason }
  | { kind: 'reloaded' }
  | { kind: 'task'; progress: TaskProgress };

export interface HostTransport {
  send(message: HostToSimMessage): void;
}

export type TaskStatus = 'pending' | 'correct' | 'wrong' | 'skipped';

export interface TaskProgress {
  taskId: string;
  status: TaskStatus;
  /** Wrong checks so far. The hint shows after `hintAfterTries` (flows §6.2: two). */
  tries: number;
  /** The quantity to name in "Not quite. Check {quantity} again." */
  quantity?: string;
  checkedBy?: 'sim' | 'host';
}

export interface HostSessionOptions {
  transport: HostTransport;
  /** Everything in `init` except the protocol version, which the session adds. */
  init: Omit<InitPayload, 'protocolVersion'>;
  /** `sim.ready_timeout_ms` (8000) or `sim.ready_timeout_ms_low` (12000) on low-tier phones. */
  readyTimeoutMs?: number;
  /** `sim.max_state_hz`: state messages delivered per second at most. */
  maxStateHz?: number;
  /** `sim.max_errors`: error and invalid messages tolerated per session. */
  maxErrors?: number;
  /** When set, `hello` and `ready` must name this sim. */
  expectedSimId?: string;
  hintAfterTries?: number;
  onEvent?: (event: HostEvent) => void;
  clock?: Clock;
}

export const DEFAULT_READY_TIMEOUT_MS = 8000;
export const DEFAULT_MAX_STATE_HZ = 10;
export const DEFAULT_MAX_ERRORS = 20;
const SAVE_TIMEOUT_MS = 2000;

export class HostSession {
  private statusValue: HostStatus = 'idle';
  private readonly opts: HostSessionOptions;
  private readonly clock: Clock;
  private initPayload: InitPayload;
  private startedAt = 0;
  private readyTimer: unknown = null;
  private stateTimer: unknown = null;
  private lastStateAt = Number.NEGATIVE_INFINITY;
  private pendingState: SimToHostMessage | null = null;
  private errors = 0;
  private readyInfo: ReadyPayload | null = null;
  private latestReadings: Reading[] = [];
  private latestSnapshot: SimSnapshot | undefined;
  private readonly progress = new Map<string, TaskProgress>();
  private readonly measurementList: MeasurementPayload[] = [];
  private readonly listeners = new Set<(event: HostEvent) => void>();
  private saveWaiters: Array<{ resolve: (s: SimSnapshot) => void; reject: (e: Error) => void; timer: unknown }> = [];
  private hostRowCounter = 0;

  constructor(opts: HostSessionOptions) {
    this.opts = opts;
    this.clock = opts.clock ?? systemClock;
    this.initPayload = { protocolVersion: PROTOCOL_VERSION, ...opts.init };
    if (opts.onEvent) this.listeners.add(opts.onEvent);
    this.resetProgress(opts.init.tasks);
  }

  get status(): HostStatus {
    return this.statusValue;
  }

  get ready(): ReadyPayload | null {
    return this.readyInfo;
  }

  get readings(): readonly Reading[] {
    return this.latestReadings;
  }

  get snapshot(): SimSnapshot | undefined {
    return this.latestSnapshot;
  }

  get measurements(): readonly MeasurementPayload[] {
    return this.measurementList;
  }

  get tasks(): readonly TaskSpec[] {
    return this.initPayload.tasks;
  }

  taskProgress(): TaskProgress[] {
    return this.initPayload.tasks.map((t) => this.progress.get(t.id) ?? { taskId: t.id, status: 'pending', tries: 0 });
  }

  /** True once the student has had `hintAfterTries` wrong checks on this task. */
  shouldShowHint(taskId: string): boolean {
    const p = this.progress.get(taskId);
    return p !== undefined && p.status === 'wrong' && p.tries >= (this.opts.hintAfterTries ?? 2);
  }

  subscribe(listener: (event: HostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Start waiting for the sim's `hello`. Call before the sim starts loading. */
  start(): void {
    if (this.statusValue !== 'idle') return;
    this.startedAt = this.clock.now();
    this.setStatus('waiting_hello');
    this.armReadyTimer();
  }

  /** After a timeout the student may choose [Keep waiting]. */
  keepWaiting(): void {
    if (this.statusValue === 'waiting_hello' || this.statusValue === 'initializing') this.armReadyTimer();
  }

  /** Feed a raw message (already origin- and source-checked by the transport). */
  receive(raw: unknown): void {
    if (this.statusValue === 'destroyed' || this.statusValue === 'idle') return;
    const parsed = parseSimMessage(raw);
    if (!parsed.ok) {
      const detail = parsed.issues.length > 0 ? `${parsed.error}: ${parsed.issues[0]?.path} ${parsed.issues[0]?.message}` : parsed.error;
      this.reject('invalid', detail);
      return;
    }
    this.handle(parsed.message);
  }

  /** Record a rejected message from the transport layer (wrong origin or source). */
  reject(reason: RejectReason, detail?: string): void {
    this.emit({ kind: 'rejected', reason, ...(detail !== undefined ? { detail } : {}) });
    if (reason === 'invalid' || reason === 'unexpected') this.countError();
  }

  reset(): void {
    this.sendWhenLive(hostMessage('reset', {}));
  }

  pause(): void {
    if (this.statusValue !== 'running') return;
    this.sendWhenLive(hostMessage('pause', {}));
    this.setStatus('paused');
  }

  resume(): void {
    if (this.statusValue !== 'paused') return;
    this.sendWhenLive(hostMessage('resume', {}));
    this.setStatus(this.allTasksDone() ? 'complete' : 'running');
  }

  setParams(change: SetParamsPayload): void {
    const { params, ...rest } = change;
    this.initPayload = {
      ...this.initPayload,
      ...rest,
      params: params ? { ...this.initPayload.params, ...params } : this.initPayload.params,
    };
    this.sendWhenLive(hostMessage('set_params', change));
  }

  setActiveTask(taskId: string): void {
    this.initPayload = { ...this.initPayload, activeTaskId: taskId };
    this.sendWhenLive(hostMessage('task', { taskId }));
  }

  /** Ask the sim to check a task. The answer arrives as a `task_result` event. */
  check(taskId: string): void {
    this.sendWhenLive(hostMessage('check', { taskId }));
  }

  /** Ask the sim for a measurement ([Record reading]). */
  record(taskId?: string): void {
    this.sendWhenLive(hostMessage('record', taskId !== undefined ? { taskId } : {}));
  }

  restore(snapshot: SimSnapshot): void {
    this.latestSnapshot = snapshot;
    this.sendWhenLive(hostMessage('restore', { snapshot }));
  }

  /** Ask the sim for a snapshot now, for example before the WebView is torn down. */
  save(): Promise<SimSnapshot> {
    return new Promise((resolve, reject) => {
      if (!this.isLive()) {
        if (this.latestSnapshot) resolve(this.latestSnapshot);
        else reject(new Error('sim is not running'));
        return;
      }
      const timer = this.clock.setTimeout(() => {
        this.saveWaiters = this.saveWaiters.filter((w) => w.timer !== timer);
        if (this.latestSnapshot) resolve(this.latestSnapshot);
        else reject(new Error('save timed out'));
      }, SAVE_TIMEOUT_MS);
      this.saveWaiters.push({ resolve, reject, timer });
      this.send(hostMessage('save', {}));
    });
  }

  /** Mark a task skipped ([Skip task] after the hint). Skipped is never wrong. */
  skip(taskId: string): void {
    const prev = this.progress.get(taskId);
    if (!prev || prev.status === 'correct') return;
    this.updateProgress({ ...prev, status: 'skipped' });
    if (this.allTasksDone() && this.statusValue === 'running') this.setStatus('complete');
  }

  /**
   * Host-side check for sims that cannot report results (PhET HTML5 builds):
   * the student types the value they see; it is stored as a reading row and
   * the task is evaluated against its tolerance.
   */
  checkLocally(taskId: string, typed?: { name: string; value: number; unit: string }): TaskEvaluation {
    const task = this.initPayload.tasks.find((t) => t.id === taskId);
    if (!task) return { correct: false, reason: 'missing_reading' };
    if (typed) {
      this.hostRowCounter += 1;
      this.measurementList.push({ id: `host-${this.hostRowCounter}`, taskId, ...typed });
    }
    const rows: RecordedRow[] = this.measurementList.map((m) => ({
      name: m.name,
      value: m.value,
      ...(m.taskId !== undefined ? { taskId: m.taskId } : {}),
      context: readingsToValues(m.context ?? []),
    }));
    const evaluation = evaluateTask(task, { current: readingsToValues(this.latestReadings), recorded: rows });
    this.applyResult(taskId, evaluation.correct, evaluation.correct ? undefined : evaluation.quantity, 'host');
    return evaluation;
  }

  clearMeasurements(): void {
    this.measurementList.length = 0;
  }

  removeMeasurement(id: string): void {
    const i = this.measurementList.findIndex((m) => m.id === id);
    if (i >= 0) this.measurementList.splice(i, 1);
  }

  destroy(): void {
    this.clearTimer('ready');
    this.clearTimer('state');
    for (const waiter of this.saveWaiters) {
      this.clock.clearTimeout(waiter.timer);
      waiter.reject(new Error('session destroyed'));
    }
    this.saveWaiters = [];
    this.setStatus('destroyed');
    this.listeners.clear();
  }

  /* ------------------------------------------------------------ internals */

  private handle(message: SimToHostMessage): void {
    switch (message.type) {
      case 'hello': {
        const p = message.payload;
        if (this.opts.expectedSimId && p.simId !== this.opts.expectedSimId) {
          this.reject('sim_id', p.simId);
          return;
        }
        if (!isCompatibleVersion(p.protocolVersion, PROTOCOL_VERSION)) {
          this.emit({ kind: 'message', message });
          this.fail('version_mismatch');
          return;
        }
        if (this.statusValue === 'waiting_hello') {
          this.emit({ kind: 'message', message });
          this.setStatus('initializing');
          this.send(hostMessage('init', this.initForSend()));
        } else if (this.statusValue === 'running' || this.statusValue === 'paused' || this.statusValue === 'complete') {
          // The page reloaded (WebView restart): continue from the last snapshot.
          this.emit({ kind: 'message', message });
          this.emit({ kind: 'reloaded' });
          this.readyInfo = null;
          this.startedAt = this.clock.now();
          this.setStatus('initializing');
          this.armReadyTimer();
          this.send(hostMessage('init', this.initForSend()));
        }
        // A repeated hello while initializing is ignored: init is already on its way.
        return;
      }
      case 'ready': {
        if (this.statusValue !== 'initializing') {
          this.reject('unexpected', 'ready');
          return;
        }
        const p = message.payload;
        if (this.opts.expectedSimId && p.simId !== this.opts.expectedSimId) {
          this.reject('sim_id', p.simId);
          return;
        }
        this.clearTimer('ready');
        this.readyInfo = p;
        this.latestReadings = p.readings;
        this.emit({ kind: 'message', message });
        this.emit({ kind: 'ready', payload: p, loadMs: Math.max(0, this.clock.now() - this.startedAt) });
        this.setStatus(this.allTasksDone() ? 'complete' : 'running');
        return;
      }
      case 'progress':
        if (this.statusValue === 'waiting_hello' || this.statusValue === 'initializing') this.emit({ kind: 'message', message });
        return;
      case 'state':
        if (!this.isLive()) {
          this.reject('unexpected', 'state');
          return;
        }
        this.deliverState(message);
        return;
      case 'measurement':
        if (!this.isLive()) {
          this.reject('unexpected', 'measurement');
          return;
        }
        this.measurementList.push(message.payload);
        this.emit({ kind: 'message', message });
        return;
      case 'task_result': {
        if (!this.isLive()) {
          this.reject('unexpected', 'task_result');
          return;
        }
        const p = message.payload;
        if (!this.progress.has(p.taskId)) {
          this.reject('unexpected', `unknown task ${p.taskId}`);
          return;
        }
        this.emit({ kind: 'message', message });
        this.applyResult(p.taskId, p.correct, p.quantity, 'sim');
        return;
      }
      case 'complete':
        if (!this.isLive()) {
          this.reject('unexpected', 'complete');
          return;
        }
        this.emit({ kind: 'message', message });
        if (this.statusValue === 'running') this.setStatus('complete');
        return;
      case 'error':
        this.emit({ kind: 'message', message });
        if (message.payload.fatal) {
          this.fail('fatal_error');
          return;
        }
        this.countError();
        return;
      case 'resize':
        this.emit({ kind: 'message', message });
        return;
      case 'snapshot': {
        this.latestSnapshot = message.payload.snapshot;
        this.emit({ kind: 'message', message });
        const waiters = this.saveWaiters;
        this.saveWaiters = [];
        for (const w of waiters) {
          this.clock.clearTimeout(w.timer);
          w.resolve(message.payload.snapshot);
        }
        return;
      }
    }
  }

  private deliverState(message: Extract<SimToHostMessage, { type: 'state' }>): void {
    const hz = this.opts.maxStateHz ?? DEFAULT_MAX_STATE_HZ;
    const interval = 1000 / hz;
    const now = this.clock.now();
    if (now - this.lastStateAt >= interval && this.stateTimer === null) {
      this.applyState(message);
      return;
    }
    // Too fast: keep only the latest and flush it at the end of the window.
    this.pendingState = message;
    if (this.stateTimer === null) {
      const wait = Math.max(0, interval - (now - this.lastStateAt));
      this.stateTimer = this.clock.setTimeout(() => {
        this.stateTimer = null;
        const pending = this.pendingState;
        this.pendingState = null;
        if (pending && pending.type === 'state' && this.isLive()) this.applyState(pending);
      }, wait);
    }
  }

  private applyState(message: Extract<SimToHostMessage, { type: 'state' }>): void {
    this.lastStateAt = this.clock.now();
    this.latestReadings = message.payload.readings;
    if (message.payload.snapshot) this.latestSnapshot = message.payload.snapshot;
    this.emit({ kind: 'message', message });
  }

  private applyResult(taskId: string, correct: boolean, quantity: string | undefined, by: 'sim' | 'host'): void {
    const prev = this.progress.get(taskId) ?? { taskId, status: 'pending' as TaskStatus, tries: 0 };
    if (prev.status === 'correct') return;
    const next: TaskProgress = correct
      ? { taskId, status: 'correct', tries: prev.tries, checkedBy: by }
      : { taskId, status: 'wrong', tries: prev.tries + 1, checkedBy: by, ...(quantity !== undefined ? { quantity } : {}) };
    this.updateProgress(next);
    if (this.allTasksDone() && this.statusValue === 'running') this.setStatus('complete');
  }

  private updateProgress(next: TaskProgress): void {
    this.progress.set(next.taskId, next);
    this.emit({ kind: 'task', progress: next });
  }

  private allTasksDone(): boolean {
    const tasks = this.initPayload.tasks;
    if (tasks.length === 0) return false;
    return tasks.every((t) => {
      const s = this.progress.get(t.id)?.status;
      return s === 'correct' || s === 'skipped';
    });
  }

  private resetProgress(tasks: readonly TaskSpec[]): void {
    this.progress.clear();
    for (const t of tasks) this.progress.set(t.id, { taskId: t.id, status: 'pending', tries: 0 });
  }

  private initForSend(): InitPayload {
    const snapshot = this.latestSnapshot ?? this.initPayload.snapshot;
    return snapshot ? { ...this.initPayload, snapshot } : this.initPayload;
  }

  private isLive(): boolean {
    return this.statusValue === 'running' || this.statusValue === 'paused' || this.statusValue === 'complete';
  }

  private sendWhenLive(message: HostToSimMessage): void {
    if (this.isLive()) this.send(message);
  }

  private send(message: HostToSimMessage): void {
    this.opts.transport.send(message);
    this.emit({ kind: 'sent', message });
  }

  private countError(): void {
    this.errors += 1;
    if (this.errors > (this.opts.maxErrors ?? DEFAULT_MAX_ERRORS)) this.fail('too_many_errors');
  }

  private fail(reason: CrashReason): void {
    if (this.statusValue === 'failed' || this.statusValue === 'destroyed') return;
    this.clearTimer('ready');
    this.clearTimer('state');
    this.emit({ kind: 'crashed', reason });
    this.setStatus('failed');
  }

  private armReadyTimer(): void {
    this.clearTimer('ready');
    const timeout = this.opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.readyTimer = this.clock.setTimeout(() => {
      this.readyTimer = null;
      if (this.statusValue === 'waiting_hello' || this.statusValue === 'initializing') {
        this.emit({ kind: 'timeout', waitedMs: this.clock.now() - this.startedAt });
      }
    }, timeout);
  }

  private clearTimer(which: 'ready' | 'state'): void {
    const handle = which === 'ready' ? this.readyTimer : this.stateTimer;
    if (handle !== null) this.clock.clearTimeout(handle);
    if (which === 'ready') this.readyTimer = null;
    else {
      this.stateTimer = null;
      this.pendingState = null;
    }
  }

  private setStatus(status: HostStatus): void {
    if (status === this.statusValue) return;
    const previous = this.statusValue;
    this.statusValue = status;
    this.emit({ kind: 'status', status, previous });
  }

  private emit(event: HostEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A listener bug must not break the bridge.
      }
    }
  }
}
