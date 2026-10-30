/**
 * The sim-bridge protocol: the messages a host (React Native WebView on mobile,
 * sandboxed iframe on web) and a sim exchange through `postMessage`.
 *
 * TRD §7.3 sets the core (`init`, `reset`, `ready`, `state`, `measurement`,
 * `task_result`, `complete`, `error`). flows/memory-labs.md §12 G1 adds the
 * version handshake, `pause`/`resume`, `set_params`, `record` and `progress`.
 * This file is the single source of truth for both sides.
 *
 * Handshake:
 *   sim  → host  hello     { protocolVersion, simId, simVersion }   (repeated until init arrives)
 *   host → sim   init      { protocolVersion, locale, theme, reducedMotion, lowPower, params, tasks, ... }
 *   sim  → host  ready     { protocolVersion, simId, capabilities, readings, ... }
 *
 * Every message is wrapped in an envelope `{ ns: "smriti.sim", v: 1, type, payload }`.
 * `v` is the protocol major version. Minor versions only add optional fields,
 * so both sides ignore keys they do not know.
 */

export const PROTOCOL_NS = 'smriti.sim' as const;
export const PROTOCOL_VERSION = '1.0.0';
export const PROTOCOL_MAJOR = 1 as const;

/** Upper bound for one serialised message. Larger messages are rejected. */
export const MAX_MESSAGE_BYTES = 64 * 1024;

export type Locale = 'en' | 'hi';
export const LOCALES: readonly Locale[] = ['en', 'hi'];

export type ThemeName = 'light' | 'dark';
export const THEMES: readonly ThemeName[] = ['light', 'dark'];

/** Every visible string is shipped in English and Hindi (AGENTS rule 7). */
export interface LocalizedText {
  en: string;
  hi: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** A sim parameter value, as set by content (`params`) or the host. */
export type ParamValue = number | string | boolean;
export type ParamValues = Record<string, ParamValue>;

/** A live value the sim shows, for example the ammeter reading. */
export interface Reading {
  /** Stable machine name, for example `current`. Tasks refer to it. */
  name: string;
  value: number;
  /** SI unit symbol, for example `A`, `Ω`, `cm`, `s`, `mL`. Empty for unitless values. */
  unit: string;
  /** Localised quantity name for the host's reading chips. */
  label?: LocalizedText;
  /** Decimal places the sim displays. Hosts format with the same precision. */
  precision?: number;
}

/** Serialisable sim state, so a new WebView can continue where the old one stopped. */
export interface SimSnapshot {
  /** Sim-defined schema version of `data`. */
  v: number;
  data: JsonObject;
}

/* ------------------------------------------------------------------ tasks */

/**
 * How a task is checked. Tasks come from the lesson card (`tasks[]`: prompt,
 * expected measurement, tolerance; content-format §7) or the lab's manifest.
 *
 * - `target`: a reading is within `tolerance` of `value`.
 * - `range`: a reading is inside `[min, max]`.
 * - `ratio`: a reading is `ratio` times its value when the task started.
 * - `condition`: a sim-defined rule, for example `image_virtual`.
 * - `readings`: the student recorded `count` rows of `quantity` with distinct
 *   values of `distinctBy`, all sharing the same `sameBy` values.
 * - `all`: every sub-check passes.
 *
 * `hold` lists readings that must not change from the task's start (for
 * example "keep the voltage the same").
 */
export type TaskCheck =
  | TargetCheck
  | RangeCheck
  | RatioCheck
  | ConditionCheck
  | ReadingsCheck
  | AllCheck;

export interface TargetCheck {
  kind: 'target';
  quantity: string;
  value: number;
  tolerance: number;
  /** When true, `tolerance` is a fraction of `value` (0.02 = 2%). */
  relative?: boolean;
  /** Check the live reading (default) or the last recorded reading. */
  on?: 'current' | 'last_recorded';
  hold?: string[];
}

export interface RangeCheck {
  kind: 'range';
  quantity: string;
  min?: number;
  max?: number;
  on?: 'current' | 'last_recorded';
  hold?: string[];
}

export interface RatioCheck {
  kind: 'ratio';
  quantity: string;
  ratio: number;
  /** Relative tolerance on the ratio (0.03 = 3%). */
  tolerance: number;
  hold?: string[];
}

export interface ConditionCheck {
  kind: 'condition';
  rule: string;
  args?: ParamValues;
  /** The reading to name in "Check {quantity} again" when the rule fails. */
  quantity?: string;
  hold?: string[];
}

export interface ReadingsCheck {
  kind: 'readings';
  quantity: string;
  count: number;
  distinctBy: string;
  sameBy?: string[];
}

export interface AllCheck {
  kind: 'all';
  of: TaskCheck[];
}

export interface TaskSpec {
  id: string;
  prompt: LocalizedText;
  hint?: LocalizedText;
  check: TaskCheck;
}

/* --------------------------------------------------------------- payloads */

export type Capability = 'tasks' | 'record' | 'pause' | 'set_params' | 'snapshot' | 'resize';
export const CAPABILITIES: readonly Capability[] = ['tasks', 'record', 'pause', 'set_params', 'snapshot', 'resize'];

export type Orientation = 'portrait' | 'landscape' | 'any';

export type EmptyPayload = Record<string, never>;

export interface InitPayload {
  protocolVersion: string;
  locale: Locale;
  theme: ThemeName;
  /** The student's reduced-motion setting. Sims drop auto-play loops (sim-builder). */
  reducedMotion: boolean;
  /** Battery saver: 30 fps, fewer particles, no shadows (flows §6.2, §6.3). */
  lowPower: boolean;
  params: ParamValues;
  tasks: TaskSpec[];
  /** The task the host highlights first. Defaults to the first task. */
  activeTaskId?: string;
  /** Continue from a saved state (same-WebView expand fallback, flows §6.9). */
  snapshot?: SimSnapshot;
}

export interface SetParamsPayload {
  locale?: Locale;
  theme?: ThemeName;
  reducedMotion?: boolean;
  lowPower?: boolean;
  params?: ParamValues;
}

export interface TaskRefPayload {
  taskId: string;
}

export interface RecordPayload {
  taskId?: string;
}

export interface RestorePayload {
  snapshot: SimSnapshot;
}

export interface HelloPayload {
  protocolVersion: string;
  simId: string;
  simVersion: string;
}

export interface ReadyPayload {
  protocolVersion: string;
  simId: string;
  simVersion: string;
  capabilities: Capability[];
  readings: Reading[];
  /** The sim's preferred viewport aspect, for example `4:3`. */
  aspect?: string;
  preferredOrientation?: Orientation;
}

export interface ProgressPayload {
  loaded: number;
  total: number;
}

export interface StatePayload {
  readings: Reading[];
  activeTaskId?: string;
  snapshot?: SimSnapshot;
}

export interface MeasurementPayload {
  /** Row id, unique within the session. */
  id: string;
  name: string;
  value: number;
  unit: string;
  taskId?: string;
  /** The other readings at the moment of recording (the table's input columns). */
  context?: Reading[];
}

export type ResultData = Record<string, number | string | boolean>;

export interface TaskResultPayload {
  taskId: string;
  correct: boolean;
  /** The reading to name in the "Not quite. Check {quantity} again." line. */
  quantity?: string;
  data?: ResultData;
}

export interface CompletePayload {
  tasksDone: number;
  tasksTotal: number;
}

export type ErrorCode =
  | 'version_mismatch'
  | 'bad_message'
  | 'init_failed'
  | 'render_failed'
  | 'unsupported'
  | 'internal';
export const ERROR_CODES: readonly ErrorCode[] = [
  'version_mismatch',
  'bad_message',
  'init_failed',
  'render_failed',
  'unsupported',
  'internal',
];

export interface ErrorPayload {
  code: ErrorCode;
  /** Developer-facing message. Never contains student data. */
  message: string;
  fatal: boolean;
}

export interface ResizePayload {
  height: number;
  width?: number;
}

export interface SnapshotPayload {
  snapshot: SimSnapshot;
}

/* --------------------------------------------------------------- messages */

export interface HostToSimPayloads {
  init: InitPayload;
  set_params: SetParamsPayload;
  /** Make a task the active one (the host moved to it). */
  task: TaskRefPayload;
  /** Ask the sim to check a task now; it answers with `task_result`. */
  check: TaskRefPayload;
  /** Ask the sim for a measurement; it answers with `measurement`. */
  record: RecordPayload;
  reset: EmptyPayload;
  pause: EmptyPayload;
  resume: EmptyPayload;
  /** Ask for a snapshot; the sim answers with `snapshot`. */
  save: EmptyPayload;
  restore: RestorePayload;
}

export interface SimToHostPayloads {
  hello: HelloPayload;
  ready: ReadyPayload;
  progress: ProgressPayload;
  state: StatePayload;
  measurement: MeasurementPayload;
  task_result: TaskResultPayload;
  complete: CompletePayload;
  error: ErrorPayload;
  resize: ResizePayload;
  snapshot: SnapshotPayload;
}

export type HostToSimType = keyof HostToSimPayloads;
export type SimToHostType = keyof SimToHostPayloads;

export const HOST_TO_SIM_TYPES: readonly HostToSimType[] = [
  'init',
  'set_params',
  'task',
  'check',
  'record',
  'reset',
  'pause',
  'resume',
  'save',
  'restore',
];

export const SIM_TO_HOST_TYPES: readonly SimToHostType[] = [
  'hello',
  'ready',
  'progress',
  'state',
  'measurement',
  'task_result',
  'complete',
  'error',
  'resize',
  'snapshot',
];

export interface Envelope<T extends string, P> {
  ns: typeof PROTOCOL_NS;
  v: typeof PROTOCOL_MAJOR;
  type: T;
  payload: P;
}

export type HostToSimMessage = {
  [K in HostToSimType]: Envelope<K, HostToSimPayloads[K]>;
}[HostToSimType];

export type SimToHostMessage = {
  [K in SimToHostType]: Envelope<K, SimToHostPayloads[K]>;
}[SimToHostType];

export type AnyMessage = HostToSimMessage | SimToHostMessage;

export function hostMessage<K extends HostToSimType>(
  type: K,
  payload: HostToSimPayloads[K],
): Envelope<K, HostToSimPayloads[K]> {
  return { ns: PROTOCOL_NS, v: PROTOCOL_MAJOR, type, payload };
}

export function simMessage<K extends SimToHostType>(
  type: K,
  payload: SimToHostPayloads[K],
): Envelope<K, SimToHostPayloads[K]> {
  return { ns: PROTOCOL_NS, v: PROTOCOL_MAJOR, type, payload };
}

/** Parses `major.minor.patch`. Returns null for anything else. */
export function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})$/.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Two protocol versions can talk when their major versions match. */
export function isCompatibleVersion(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  return pa !== null && pb !== null && pa.major === pb.major;
}
