/**
 * A small, dependency-free schema validator for sim-bridge messages.
 *
 * Both sides validate everything they receive: the host never trusts a sim
 * (third-party sims run in the same shell) and the sim never trusts a frame
 * it did not expect. Unknown keys are ignored so minor protocol versions can
 * add optional fields.
 */

import {
  CAPABILITIES,
  ERROR_CODES,
  HOST_TO_SIM_TYPES,
  LOCALES,
  MAX_MESSAGE_BYTES,
  PROTOCOL_MAJOR,
  PROTOCOL_NS,
  SIM_TO_HOST_TYPES,
  THEMES,
  type HostToSimMessage,
  type HostToSimType,
  type SimToHostMessage,
  type SimToHostType,
} from './protocol';

export interface Issue {
  path: string;
  message: string;
}

/** A schema pushes issues for `value` at `path`. No issues means valid. */
export type Schema = (value: unknown, path: string, issues: Issue[]) => void;

const MAX_ID = 128;
const MAX_TEXT = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const s = {
  string(opts: { min?: number; max?: number; pattern?: RegExp } = {}): Schema {
    const min = opts.min ?? 0;
    const max = opts.max ?? MAX_TEXT;
    return (v, path, issues) => {
      if (typeof v !== 'string') {
        issues.push({ path, message: 'expected string' });
        return;
      }
      if (v.length < min || v.length > max) issues.push({ path, message: `length must be ${min}..${max}` });
      else if (opts.pattern && !opts.pattern.test(v)) issues.push({ path, message: 'bad format' });
    };
  },
  number(opts: { min?: number; max?: number; int?: boolean } = {}): Schema {
    return (v, path, issues) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        issues.push({ path, message: 'expected finite number' });
        return;
      }
      if (opts.int && !Number.isInteger(v)) issues.push({ path, message: 'expected integer' });
      if (opts.min !== undefined && v < opts.min) issues.push({ path, message: `must be >= ${opts.min}` });
      if (opts.max !== undefined && v > opts.max) issues.push({ path, message: `must be <= ${opts.max}` });
    };
  },
  boolean(): Schema {
    return (v, path, issues) => {
      if (typeof v !== 'boolean') issues.push({ path, message: 'expected boolean' });
    };
  },
  literal<T extends string>(values: readonly T[]): Schema {
    return (v, path, issues) => {
      if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
        issues.push({ path, message: `expected one of ${values.join(', ')}` });
      }
    };
  },
  array(item: Schema, opts: { max?: number } = {}): Schema {
    const max = opts.max ?? 100;
    return (v, path, issues) => {
      if (!Array.isArray(v)) {
        issues.push({ path, message: 'expected array' });
        return;
      }
      if (v.length > max) {
        issues.push({ path, message: `at most ${max} items` });
        return;
      }
      v.forEach((entry, i) => item(entry, `${path}[${i}]`, issues));
    };
  },
  object(required: Record<string, Schema>, optional: Record<string, Schema> = {}): Schema {
    return (v, path, issues) => {
      if (!isRecord(v)) {
        issues.push({ path, message: 'expected object' });
        return;
      }
      for (const [key, schema] of Object.entries(required)) {
        if (!(key in v) || v[key] === undefined) issues.push({ path: `${path}.${key}`, message: 'required' });
        else schema(v[key], `${path}.${key}`, issues);
      }
      for (const [key, schema] of Object.entries(optional)) {
        if (key in v && v[key] !== undefined) schema(v[key], `${path}.${key}`, issues);
      }
    };
  },
  record(value: Schema, opts: { maxKeys?: number; key?: Schema } = {}): Schema {
    const maxKeys = opts.maxKeys ?? 64;
    return (v, path, issues) => {
      if (!isRecord(v)) {
        issues.push({ path, message: 'expected object' });
        return;
      }
      const keys = Object.keys(v);
      if (keys.length > maxKeys) {
        issues.push({ path, message: `at most ${maxKeys} keys` });
        return;
      }
      for (const key of keys) {
        opts.key?.(key, `${path}{${key}}`, issues);
        value(v[key], `${path}.${key}`, issues);
      }
    };
  },
  union(...options: Schema[]): Schema {
    return (v, path, issues) => {
      for (const option of options) {
        const local: Issue[] = [];
        option(v, path, local);
        if (local.length === 0) return;
      }
      issues.push({ path, message: 'no matching variant' });
    };
  },
  json(maxDepth = 8): Schema {
    const check = (v: unknown, path: string, issues: Issue[], depth: number): void => {
      if (depth > maxDepth) {
        issues.push({ path, message: 'too deep' });
        return;
      }
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) issues.push({ path, message: 'expected finite number' });
        return;
      }
      if (Array.isArray(v)) {
        v.forEach((entry, i) => check(entry, `${path}[${i}]`, issues, depth + 1));
        return;
      }
      if (isRecord(v)) {
        for (const [key, entry] of Object.entries(v)) check(entry, `${path}.${key}`, issues, depth + 1);
        return;
      }
      issues.push({ path, message: 'not JSON' });
    };
    return (v, path, issues) => check(v, path, issues, 0);
  },
};

/* ------------------------------------------------------- shared schemas */

const id = s.string({ min: 1, max: MAX_ID, pattern: /^[A-Za-z0-9_.:-]+$/ });
const version = s.string({ min: 5, max: 20, pattern: /^\d{1,4}\.\d{1,4}\.\d{1,6}$/ });
const text = s.string({ max: MAX_TEXT });
const unit = s.string({ max: 16 });
const localized = s.object({ en: text, hi: text });
const paramValue = s.union(s.number(), s.string({ max: 200 }), s.boolean());
const params = s.record(paramValue, { maxKeys: 64, key: id });
const quantityList = s.array(id, { max: 16 });

const reading = s.object(
  { name: id, value: s.number(), unit },
  { label: localized, precision: s.number({ min: 0, max: 10, int: true }) },
);
const readings = s.array(reading, { max: 64 });

const snapshot = s.object({ v: s.number({ min: 0, int: true }), data: s.json() });

const on = s.literal(['current', 'last_recorded'] as const);

function taskCheck(depth: number): Schema {
  const target = s.object(
    { kind: s.literal(['target'] as const), quantity: id, value: s.number(), tolerance: s.number({ min: 0 }) },
    { relative: s.boolean(), on, hold: quantityList },
  );
  const range = s.object(
    { kind: s.literal(['range'] as const), quantity: id },
    { min: s.number(), max: s.number(), on, hold: quantityList },
  );
  const ratio = s.object(
    {
      kind: s.literal(['ratio'] as const),
      quantity: id,
      ratio: s.number({ min: 0 }),
      tolerance: s.number({ min: 0 }),
    },
    { hold: quantityList },
  );
  const condition = s.object(
    { kind: s.literal(['condition'] as const), rule: id },
    { args: params, quantity: id, hold: quantityList },
  );
  const readingsCheck = s.object(
    {
      kind: s.literal(['readings'] as const),
      quantity: id,
      count: s.number({ min: 1, max: 50, int: true }),
      distinctBy: id,
    },
    { sameBy: quantityList },
  );
  const variants: Schema[] = [target, range, ratio, condition, readingsCheck];
  if (depth < 3) {
    variants.push(
      s.object({ kind: s.literal(['all'] as const), of: s.array(taskCheck(depth + 1), { max: 8 }) }),
    );
  }
  // Discriminate on `kind` so the issue list names the real problem.
  return (v, path, issues) => {
    if (!isRecord(v) || typeof v.kind !== 'string') {
      issues.push({ path: `${path}.kind`, message: 'required' });
      return;
    }
    const kinds = ['target', 'range', 'ratio', 'condition', 'readings', 'all'];
    const index = kinds.indexOf(v.kind);
    const schema = index >= 0 ? variants[index] : undefined;
    if (!schema) {
      issues.push({ path: `${path}.kind`, message: `unknown check kind ${v.kind}` });
      return;
    }
    schema(v, path, issues);
  };
}

export const taskSpecSchema: Schema = s.object(
  { id, prompt: localized, check: taskCheck(0) },
  { hint: localized },
);

const empty = s.object({});
const locale = s.literal(LOCALES);
const theme = s.literal(THEMES);

export const hostToSimSchemas: Record<HostToSimType, Schema> = {
  init: s.object(
    {
      protocolVersion: version,
      locale,
      theme,
      reducedMotion: s.boolean(),
      lowPower: s.boolean(),
      params,
      tasks: s.array(taskSpecSchema, { max: 50 }),
    },
    { activeTaskId: id, snapshot },
  ),
  set_params: s.object({}, { locale, theme, reducedMotion: s.boolean(), lowPower: s.boolean(), params }),
  task: s.object({ taskId: id }),
  check: s.object({ taskId: id }),
  record: s.object({}, { taskId: id }),
  reset: empty,
  pause: empty,
  resume: empty,
  save: empty,
  restore: s.object({ snapshot }),
};

export const simToHostSchemas: Record<SimToHostType, Schema> = {
  hello: s.object({ protocolVersion: version, simId: id, simVersion: version }),
  ready: s.object(
    {
      protocolVersion: version,
      simId: id,
      simVersion: version,
      capabilities: s.array(s.literal(CAPABILITIES), { max: 16 }),
      readings,
    },
    {
      aspect: s.string({ max: 10, pattern: /^\d{1,2}:\d{1,2}$/ }),
      preferredOrientation: s.literal(['portrait', 'landscape', 'any'] as const),
    },
  ),
  progress: s.object({ loaded: s.number({ min: 0 }), total: s.number({ min: 0 }) }),
  state: s.object({ readings }, { activeTaskId: id, snapshot }),
  measurement: s.object(
    { id, name: id, value: s.number(), unit },
    { taskId: id, context: s.array(reading, { max: 20 }) },
  ),
  task_result: s.object(
    { taskId: id, correct: s.boolean() },
    { quantity: id, data: s.record(paramValue, { maxKeys: 32, key: id }) },
  ),
  complete: s.object({
    tasksDone: s.number({ min: 0, int: true }),
    tasksTotal: s.number({ min: 0, int: true }),
  }),
  error: s.object({ code: s.literal(ERROR_CODES), message: s.string({ max: 500 }), fatal: s.boolean() }),
  resize: s.object({ height: s.number({ min: 0, max: 20000 }) }, { width: s.number({ min: 0, max: 20000 }) }),
  snapshot: s.object({ snapshot }),
};

export type Direction = 'toSim' | 'toHost';

export type ParseResult<M> =
  | { ok: true; message: M }
  | { ok: false; error: 'too_large' | 'not_json' | 'not_envelope' | 'wrong_version' | 'unknown_type' | 'invalid_payload'; issues: Issue[] };

/** Size of a message in UTF-16 code units of its JSON form, cheap enough to run on every message. */
function sizeOf(raw: unknown): number {
  if (typeof raw === 'string') return raw.length;
  try {
    return JSON.stringify(raw)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function parse(raw: unknown, direction: Direction): ParseResult<HostToSimMessage | SimToHostMessage> {
  if (sizeOf(raw) > MAX_MESSAGE_BYTES) return { ok: false, error: 'too_large', issues: [] };
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'not_json', issues: [] };
    }
  }
  if (!isRecord(value) || value.ns !== PROTOCOL_NS || typeof value.type !== 'string') {
    return { ok: false, error: 'not_envelope', issues: [] };
  }
  if (value.v !== PROTOCOL_MAJOR) {
    return { ok: false, error: 'wrong_version', issues: [{ path: '$.v', message: `expected ${PROTOCOL_MAJOR}` }] };
  }
  const types: readonly string[] = direction === 'toSim' ? HOST_TO_SIM_TYPES : SIM_TO_HOST_TYPES;
  if (!types.includes(value.type)) {
    return { ok: false, error: 'unknown_type', issues: [{ path: '$.type', message: value.type.slice(0, 40) }] };
  }
  const schemas: Record<string, Schema> = direction === 'toSim' ? hostToSimSchemas : simToHostSchemas;
  const schema = schemas[value.type];
  const issues: Issue[] = [];
  const payload = value.payload ?? {};
  schema?.(payload, '$.payload', issues);
  if (issues.length > 0) return { ok: false, error: 'invalid_payload', issues };
  const message = { ns: PROTOCOL_NS, v: PROTOCOL_MAJOR, type: value.type, payload } as
    | HostToSimMessage
    | SimToHostMessage;
  return { ok: true, message };
}

/** Validate a message arriving at the sim (from the host). Accepts objects or JSON strings. */
export function parseHostMessage(raw: unknown): ParseResult<HostToSimMessage> {
  return parse(raw, 'toSim') as ParseResult<HostToSimMessage>;
}

/** Validate a message arriving at the host (from a sim). Accepts objects or JSON strings. */
export function parseSimMessage(raw: unknown): ParseResult<SimToHostMessage> {
  return parse(raw, 'toHost') as ParseResult<SimToHostMessage>;
}

/** Validate a task list, for example from a lesson card or a manifest. */
export function validateTasks(tasks: unknown): Issue[] {
  const issues: Issue[] = [];
  s.array(taskSpecSchema, { max: 50 })(tasks, '$', issues);
  return issues;
}
