/**
 * The sim-side SDK. A sim creates one client, reports its live readings, and
 * the client handles the handshake, task checking, recording, throttling and
 * both transports (iframe `postMessage` and the React Native WebView bridge).
 *
 *   const client = createSimClient({ simId, simVersion, conditions, handlers: { init, reset, record, snapshot, restore } });
 *   client.start();
 *   // whenever the model changes:
 *   client.setReadings([{ name: 'current', value: 0.5, unit: 'A' }]);
 */

import { systemClock, type Clock } from '../clock';
import { isOriginAllowed } from '../origin';
import {
  PROTOCOL_VERSION,
  isCompatibleVersion,
  simMessage,
  type Capability,
  type ErrorCode,
  type HostToSimMessage,
  type InitPayload,
  type Locale,
  type MeasurementPayload,
  type ParamValues,
  type Reading,
  type ResultData,
  type SetParamsPayload,
  type SimSnapshot,
  type SimToHostMessage,
  type TaskResultPayload,
  type TaskSpec,
  type ThemeName,
} from '../protocol';
import {
  evaluateTask,
  quantitiesOf,
  readingsToValues,
  type ConditionFn,
  type RecordedRow,
  type TaskEvaluation,
} from '../tasks';
import { parseHostMessage } from '../validate';

export interface SimInitContext {
  locale: Locale;
  theme: ThemeName;
  reducedMotion: boolean;
  lowPower: boolean;
  params: ParamValues;
  tasks: TaskSpec[];
  activeTaskId?: string;
  snapshot?: SimSnapshot;
  /** True when a host sent `init`; false when the page was opened on its own. */
  embedded: boolean;
}

export interface RecordedMeasurement {
  name: string;
  value: number;
  unit: string;
  context?: Reading[];
}

export interface SimHandlers {
  /** Build the scene for this locale, theme and params. Call `setReadings` before returning. */
  init(ctx: SimInitContext): void | Promise<void>;
  setParams?(change: SetParamsPayload): void;
  reset?(): void;
  pause?(): void;
  resume?(): void;
  /** The current measurement for [Record reading], or null if nothing can be recorded now. */
  record?(taskId: string | undefined): RecordedMeasurement | null;
  snapshot?(): SimSnapshot;
  restore?(snapshot: SimSnapshot): void;
  /** The host moved to another task (to highlight what the task is about, if the sim wants). */
  activeTaskChanged?(taskId: string | undefined): void;
}

interface MessageEventLike {
  data: unknown;
  origin: string;
  source: unknown;
}

/** The sim's window, reduced to what the client uses. Injectable for tests. */
export interface SimWindowLike {
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  ReactNativeWebView?: { postMessage(data: string): void };
  SmritiSimBridge?: { receive(raw: unknown): void; version: string };
}

export interface ParentLike {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface SimClientOptions {
  simId: string;
  simVersion: string;
  capabilities?: Capability[];
  aspect?: string;
  preferredOrientation?: 'portrait' | 'landscape' | 'any';
  /** Sim-defined rules for `condition` task checks. */
  conditions?: Record<string, ConditionFn>;
  /**
   * Host origins to accept. When empty, the client pins the origin of the
   * first valid `init` and refuses messages from any other origin.
   */
  allowedHostOrigins?: readonly string[];
  /** State messages per second at most (`sim.max_state_hz`). */
  maxStateHz?: number;
  helloIntervalMs?: number;
  maxHelloAttempts?: number;
  handlers: SimHandlers;
  /** Defaults to the real window and `window.parent`. */
  self?: SimWindowLike;
  parent?: ParentLike | null;
  clock?: Clock;
}

type Outgoing = SimToHostMessage;

export class SimClient {
  private readonly opts: SimClientOptions;
  private readonly clock: Clock;
  private readonly self: SimWindowLike | undefined;
  private readonly parent: ParentLike | null;
  private readonly rn: { postMessage(data: string): void } | undefined;
  private ctx: SimInitContext | null = null;
  private isReady = false;
  private started = false;
  private pinnedOrigin: string | null = null;
  private helloTimer: unknown = null;
  private helloCount = 0;
  private stateTimer: unknown = null;
  private lastStateAt = Number.NEGATIVE_INFINITY;
  private latest: Reading[] = [];
  private activeTask: string | undefined;
  private baselines = new Map<string, Record<string, number>>();
  private pendingBaseline = false;
  private readonly recorded: RecordedRow[] = [];
  private readonly results = new Map<string, boolean>();
  private completeSent = false;
  private rowCounter = 0;
  private readonly onWindowMessage = (event: MessageEventLike): void => this.fromWindow(event);

  constructor(opts: SimClientOptions) {
    this.opts = opts;
    this.clock = opts.clock ?? systemClock;
    const g = globalThis as unknown as { window?: SimWindowLike & { parent?: unknown } };
    this.self = opts.self ?? g.window;
    if (opts.parent !== undefined) this.parent = opts.parent;
    else {
      const w = g.window;
      this.parent = w && w.parent && w.parent !== w ? (w.parent as ParentLike) : null;
    }
    this.rn = this.self?.ReactNativeWebView;
  }

  /** True when a host can talk to this page (inside an iframe or a React Native WebView). */
  get embedded(): boolean {
    return this.rn !== undefined || this.parent !== null;
  }

  get context(): SimInitContext | null {
    return this.ctx;
  }

  get activeTaskId(): string | undefined {
    return this.activeTask;
  }

  get readings(): readonly Reading[] {
    return this.latest;
  }

  get recordedRows(): readonly RecordedRow[] {
    return this.recorded;
  }

  taskResult(taskId: string): boolean | undefined {
    return this.results.get(taskId);
  }

  /** Listen for the host and announce the sim with `hello`. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.self) {
      this.self.addEventListener('message', this.onWindowMessage);
      this.self.SmritiSimBridge = { receive: (raw) => this.handleRaw(raw), version: PROTOCOL_VERSION };
    }
    if (this.embedded) this.sendHello();
  }

  /** Run without a host (the page was opened directly): init with these defaults. */
  async startStandalone(defaults: Omit<InitPayload, 'protocolVersion'>): Promise<void> {
    await this.applyInit({ protocolVersion: PROTOCOL_VERSION, ...defaults }, false);
  }

  /** Report the live readings. Sent to the host as `state`, at most `maxStateHz` times a second. */
  setReadings(readings: Reading[]): void {
    this.latest = readings;
    if (this.pendingBaseline && this.activeTask !== undefined) {
      this.baselines.set(this.activeTask, readingsToValues(readings));
      this.pendingBaseline = false;
    }
    if (this.isReady) this.scheduleState();
  }

  /** Store a measurement row and send it to the host. */
  recordMeasurement(m: RecordedMeasurement, taskId?: string): MeasurementPayload {
    this.rowCounter += 1;
    const payload: MeasurementPayload = {
      id: `r${this.rowCounter}`,
      name: m.name,
      value: m.value,
      unit: m.unit,
      ...(taskId !== undefined ? { taskId } : {}),
      ...(m.context ? { context: m.context } : {}),
    };
    this.recorded.push({
      name: m.name,
      value: m.value,
      ...(taskId !== undefined ? { taskId } : {}),
      context: readingsToValues(m.context ?? []),
    });
    if (this.isReady) this.post(simMessage('measurement', payload));
    return payload;
  }

  /** Evaluate a task now, send `task_result`, and `complete` once every task is right. */
  checkTask(taskId: string): TaskResultPayload | null {
    const task = this.ctx?.tasks.find((t) => t.id === taskId);
    if (!task) {
      this.reportError('bad_message', `unknown task ${taskId}`);
      return null;
    }
    const evaluation = this.evaluate(task);
    const data: ResultData = {};
    const values = readingsToValues(this.latest);
    for (const q of quantitiesOf(task.check)) {
      const v = values[q];
      if (v !== undefined) data[q] = v;
    }
    const payload: TaskResultPayload = {
      taskId,
      correct: evaluation.correct,
      ...(!evaluation.correct && evaluation.quantity !== undefined ? { quantity: evaluation.quantity } : {}),
      data,
    };
    if (!this.results.get(taskId)) this.results.set(taskId, evaluation.correct);
    if (this.isReady) this.post(simMessage('task_result', payload));
    this.maybeComplete();
    return payload;
  }

  /** Evaluate without reporting (for the sim's own hints). */
  evaluate(task: TaskSpec): TaskEvaluation {
    const baseline = this.baselines.get(task.id);
    return evaluateTask(task, {
      current: readingsToValues(this.latest),
      ...(baseline ? { baseline } : {}),
      recorded: this.recorded,
      ...(this.opts.conditions ? { conditions: this.opts.conditions } : {}),
    });
  }

  /** The sim itself moved to a task (rare; normally the host does). */
  setActiveTask(taskId: string | undefined): void {
    this.activeTask = taskId;
    if (taskId === undefined) return;
    if (this.latest.length > 0) {
      this.baselines.set(taskId, readingsToValues(this.latest));
      this.pendingBaseline = false;
    } else {
      this.pendingBaseline = true;
    }
  }

  reportError(code: ErrorCode, message: string, fatal = false): void {
    this.post(simMessage('error', { code, message: message.slice(0, 500), fatal }));
  }

  resize(height: number, width?: number): void {
    if (!this.isReady) return;
    this.post(simMessage('resize', width !== undefined ? { height, width } : { height }));
  }

  progress(loaded: number, total: number): void {
    this.post(simMessage('progress', { loaded, total }));
  }

  /** Tell the host the lab is finished (sims without tasks decide this themselves). */
  complete(): void {
    if (this.completeSent || !this.isReady) return;
    this.completeSent = true;
    const tasks = this.ctx?.tasks ?? [];
    this.post(
      simMessage('complete', {
        tasksDone: tasks.filter((t) => this.results.get(t.id) === true).length,
        tasksTotal: tasks.length,
      }),
    );
  }

  destroy(): void {
    if (this.self) {
      this.self.removeEventListener('message', this.onWindowMessage);
      delete this.self.SmritiSimBridge;
    }
    if (this.helloTimer !== null) this.clock.clearTimeout(this.helloTimer);
    if (this.stateTimer !== null) this.clock.clearTimeout(this.stateTimer);
    this.helloTimer = null;
    this.stateTimer = null;
    this.isReady = false;
  }

  /* ------------------------------------------------------------ internals */

  private fromWindow(event: MessageEventLike): void {
    // Only the frame that embeds us may talk to us.
    if (this.parent === null || event.source !== this.parent) return;
    const allowed = this.opts.allowedHostOrigins ?? [];
    if (allowed.length > 0) {
      if (!isOriginAllowed(event.origin, { allowed, allowOpaque: allowed.includes('null') })) return;
    } else if (this.pinnedOrigin !== null && event.origin !== this.pinnedOrigin) {
      return;
    }
    const parsed = parseHostMessage(event.data);
    if (!parsed.ok) {
      if (parsed.error !== 'not_envelope' && parsed.error !== 'not_json') {
        this.reportError('bad_message', parsed.error);
      }
      return;
    }
    if (this.pinnedOrigin === null && parsed.message.type === 'init') this.pinnedOrigin = event.origin;
    if (this.pinnedOrigin === null && allowed.length === 0) return; // nothing before init
    void this.handle(parsed.message);
  }

  private handleRaw(raw: unknown): void {
    const parsed = parseHostMessage(raw);
    if (!parsed.ok) {
      if (parsed.error !== 'not_envelope') this.reportError('bad_message', parsed.error);
      return;
    }
    void this.handle(parsed.message);
  }

  private async handle(message: HostToSimMessage): Promise<void> {
    const h = this.opts.handlers;
    try {
      switch (message.type) {
        case 'init':
          await this.applyInit(message.payload, true);
          return;
        case 'set_params': {
          if (!this.ctx) return;
          const { params, ...rest } = message.payload;
          this.ctx = { ...this.ctx, ...rest, params: params ? { ...this.ctx.params, ...params } : this.ctx.params };
          h.setParams?.(message.payload);
          return;
        }
        case 'task':
          if (!this.ctx) return;
          this.setActiveTask(message.payload.taskId);
          h.activeTaskChanged?.(message.payload.taskId);
          return;
        case 'check':
          if (!this.ctx) return;
          this.checkTask(message.payload.taskId);
          return;
        case 'record': {
          if (!this.ctx) return;
          if (!h.record) {
            this.reportError('unsupported', 'record');
            return;
          }
          const m = h.record(message.payload.taskId);
          if (m) this.recordMeasurement(m, message.payload.taskId ?? this.activeTask);
          return;
        }
        case 'reset':
          if (!this.ctx) return;
          if (this.activeTask !== undefined) this.pendingBaseline = true;
          h.reset?.();
          return;
        case 'pause':
          h.pause?.();
          return;
        case 'resume':
          h.resume?.();
          return;
        case 'save':
          if (!h.snapshot) {
            this.reportError('unsupported', 'snapshot');
            return;
          }
          this.post(simMessage('snapshot', { snapshot: h.snapshot() }));
          return;
        case 'restore':
          h.restore?.(message.payload.snapshot);
          return;
      }
    } catch (err) {
      this.reportError('internal', err instanceof Error ? err.message : 'handler failed');
    }
  }

  private async applyInit(p: InitPayload, embedded: boolean): Promise<void> {
    if (!isCompatibleVersion(p.protocolVersion, PROTOCOL_VERSION)) {
      this.reportError('version_mismatch', `sim speaks ${PROTOCOL_VERSION}, host sent ${p.protocolVersion}`, true);
      return;
    }
    if (this.helloTimer !== null) {
      this.clock.clearTimeout(this.helloTimer);
      this.helloTimer = null;
    }
    this.isReady = false;
    this.ctx = {
      locale: p.locale,
      theme: p.theme,
      reducedMotion: p.reducedMotion,
      lowPower: p.lowPower,
      params: p.params,
      tasks: p.tasks,
      ...(p.activeTaskId !== undefined ? { activeTaskId: p.activeTaskId } : {}),
      ...(p.snapshot ? { snapshot: p.snapshot } : {}),
      embedded,
    };
    this.results.clear();
    this.completeSent = false;
    this.baselines.clear();
    const first = p.activeTaskId ?? p.tasks[0]?.id;
    this.activeTask = first;
    this.pendingBaseline = first !== undefined;
    try {
      await this.opts.handlers.init(this.ctx);
      if (p.snapshot) this.opts.handlers.restore?.(p.snapshot);
    } catch (err) {
      this.reportError('init_failed', err instanceof Error ? err.message : 'init failed', true);
      return;
    }
    this.isReady = true;
    if (!embedded) return;
    this.post(
      simMessage('ready', {
        protocolVersion: PROTOCOL_VERSION,
        simId: this.opts.simId,
        simVersion: this.opts.simVersion,
        capabilities: this.opts.capabilities ?? ['tasks'],
        readings: this.latest,
        ...(this.opts.aspect ? { aspect: this.opts.aspect } : {}),
        ...(this.opts.preferredOrientation ? { preferredOrientation: this.opts.preferredOrientation } : {}),
      }),
    );
  }

  private maybeComplete(): void {
    const tasks = this.ctx?.tasks ?? [];
    if (tasks.length > 0 && tasks.every((t) => this.results.get(t.id) === true)) this.complete();
  }

  private sendHello(): void {
    if (this.ctx && this.ctx.embedded) return;
    this.helloCount += 1;
    this.post(
      simMessage('hello', { protocolVersion: PROTOCOL_VERSION, simId: this.opts.simId, simVersion: this.opts.simVersion }),
    );
    if (this.helloCount < (this.opts.maxHelloAttempts ?? 30)) {
      this.helloTimer = this.clock.setTimeout(() => {
        this.helloTimer = null;
        this.sendHello();
      }, this.opts.helloIntervalMs ?? 400);
    }
  }

  private scheduleState(): void {
    const interval = 1000 / (this.opts.maxStateHz ?? 10);
    const now = this.clock.now();
    if (this.stateTimer !== null) return; // a trailing send is already queued
    const wait = interval - (now - this.lastStateAt);
    if (wait <= 0) {
      this.sendState();
      return;
    }
    this.stateTimer = this.clock.setTimeout(() => {
      this.stateTimer = null;
      this.sendState();
    }, wait);
  }

  private sendState(): void {
    if (!this.isReady) return;
    this.lastStateAt = this.clock.now();
    const snap = this.opts.handlers.snapshot?.();
    this.post(
      simMessage('state', {
        readings: this.latest,
        ...(this.activeTask !== undefined ? { activeTaskId: this.activeTask } : {}),
        ...(snap ? { snapshot: snap } : {}),
      }),
    );
  }

  private post(message: Outgoing): void {
    if (this.ctx && !this.ctx.embedded) return; // standalone: nobody to tell
    if (this.rn) {
      this.rn.postMessage(JSON.stringify(message));
      return;
    }
    if (!this.parent) return;
    const allowed = this.opts.allowedHostOrigins ?? [];
    const target =
      allowed.length === 1 && allowed[0] !== 'null' && allowed[0] !== '*'
        ? (allowed[0] ?? '*')
        : this.pinnedOrigin && this.pinnedOrigin !== 'null'
          ? this.pinnedOrigin
          : '*';
    this.parent.postMessage(message, target);
  }
}

export function createSimClient(opts: SimClientOptions): SimClient {
  return new SimClient(opts);
}
