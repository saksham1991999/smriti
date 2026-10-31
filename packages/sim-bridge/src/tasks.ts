/**
 * Task checking, shared by the sim SDK (sims that report `task_result`) and
 * the host (third-party sims without results, where the host compares the
 * student's typed reading with the task's tolerance; flows §6.2).
 */

import type { ParamValues, Reading, TaskCheck, TaskSpec } from './protocol';

export type ReadingValues = Readonly<Record<string, number>>;

/** One recorded row: the measured value plus the other readings at that moment. */
export interface RecordedRow {
  name: string;
  value: number;
  taskId?: string;
  context: ReadingValues;
}

export type ConditionFn = (args: ParamValues) => boolean;

export interface TaskContext {
  /** Live readings now. */
  current: ReadingValues;
  /** Readings when the task became active. Needed by `ratio` and `hold`. */
  baseline?: ReadingValues;
  /** Rows the student recorded, oldest first. */
  recorded: readonly RecordedRow[];
  /** Sim-defined rules for `condition` checks. */
  conditions?: Readonly<Record<string, ConditionFn>>;
}

export type FailReason =
  | 'missing_reading'
  | 'out_of_tolerance'
  | 'held_changed'
  | 'condition_false'
  | 'unknown_condition'
  | 'no_baseline'
  | 'not_enough_readings';

export type TaskEvaluation =
  | { correct: true }
  | { correct: false; reason: FailReason; quantity?: string };

/** Absolute slack used when comparing held values, so float noise never fails a task. */
const HOLD_EPSILON = 1e-9;

export function readingsToValues(readings: readonly Reading[]): Record<string, number> {
  const values: Record<string, number> = {};
  for (const r of readings) values[r.name] = r.value;
  return values;
}

export function withinTolerance(actual: number, target: number, tolerance: number, relative = false): boolean {
  const slack = relative ? Math.abs(target) * tolerance : tolerance;
  // A tiny extra margin absorbs binary rounding (0.1 + 0.2 style).
  return Math.abs(actual - target) <= slack + 1e-12 * Math.max(1, Math.abs(target));
}

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) <= HOLD_EPSILON + 1e-9 * Math.max(Math.abs(a), Math.abs(b));
}

function checkHold(hold: readonly string[] | undefined, ctx: TaskContext): TaskEvaluation | null {
  if (!hold || hold.length === 0) return null;
  if (!ctx.baseline) return { correct: false, reason: 'no_baseline' };
  for (const name of hold) {
    const before = ctx.baseline[name];
    const now = ctx.current[name];
    if (before === undefined || now === undefined) return { correct: false, reason: 'missing_reading', quantity: name };
    if (!sameValue(before, now)) return { correct: false, reason: 'held_changed', quantity: name };
  }
  return null;
}

function valueFor(quantity: string, on: 'current' | 'last_recorded' | undefined, ctx: TaskContext): number | undefined {
  if (on === 'last_recorded') {
    for (let i = ctx.recorded.length - 1; i >= 0; i -= 1) {
      const row = ctx.recorded[i];
      if (!row) continue;
      if (row.name === quantity) return row.value;
      const fromContext = row.context[quantity];
      if (fromContext !== undefined) return fromContext;
    }
    return undefined;
  }
  return ctx.current[quantity];
}

function evaluateReadings(check: Extract<TaskCheck, { kind: 'readings' }>, ctx: TaskContext): TaskEvaluation {
  const rows = ctx.recorded.filter((row) => row.name === check.quantity);
  const sameBy = check.sameBy ?? [];
  // Group rows by their sameBy values, then count distinct distinctBy values in each group.
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const all: Record<string, number> = { ...row.context, [row.name]: row.value };
    const distinct = all[check.distinctBy];
    if (distinct === undefined) continue;
    const keyParts: string[] = [];
    let complete = true;
    for (const name of sameBy) {
      const v = all[name];
      if (v === undefined) {
        complete = false;
        break;
      }
      keyParts.push(v.toPrecision(9));
    }
    if (!complete) continue;
    const key = keyParts.join('|');
    const list = groups.get(key) ?? [];
    if (!list.some((v) => sameValue(v, distinct))) list.push(distinct);
    groups.set(key, list);
  }
  let best = 0;
  for (const list of groups.values()) best = Math.max(best, list.length);
  return best >= check.count
    ? { correct: true }
    : { correct: false, reason: 'not_enough_readings', quantity: check.quantity };
}

export function evaluateCheck(check: TaskCheck, ctx: TaskContext): TaskEvaluation {
  switch (check.kind) {
    case 'target': {
      const held = checkHold(check.hold, ctx);
      if (held) return held;
      const actual = valueFor(check.quantity, check.on, ctx);
      if (actual === undefined) return { correct: false, reason: 'missing_reading', quantity: check.quantity };
      return withinTolerance(actual, check.value, check.tolerance, check.relative)
        ? { correct: true }
        : { correct: false, reason: 'out_of_tolerance', quantity: check.quantity };
    }
    case 'range': {
      const held = checkHold(check.hold, ctx);
      if (held) return held;
      const actual = valueFor(check.quantity, check.on, ctx);
      if (actual === undefined) return { correct: false, reason: 'missing_reading', quantity: check.quantity };
      const okMin = check.min === undefined || actual >= check.min - 1e-12;
      const okMax = check.max === undefined || actual <= check.max + 1e-12;
      return okMin && okMax ? { correct: true } : { correct: false, reason: 'out_of_tolerance', quantity: check.quantity };
    }
    case 'ratio': {
      const held = checkHold(check.hold, ctx);
      if (held) return held;
      if (!ctx.baseline) return { correct: false, reason: 'no_baseline', quantity: check.quantity };
      const before = ctx.baseline[check.quantity];
      const now = ctx.current[check.quantity];
      if (before === undefined || now === undefined) {
        return { correct: false, reason: 'missing_reading', quantity: check.quantity };
      }
      if (before === 0) return { correct: false, reason: 'out_of_tolerance', quantity: check.quantity };
      return withinTolerance(now / before, check.ratio, check.tolerance, true)
        ? { correct: true }
        : { correct: false, reason: 'out_of_tolerance', quantity: check.quantity };
    }
    case 'condition': {
      const held = checkHold(check.hold, ctx);
      if (held) return held;
      const fn = ctx.conditions?.[check.rule];
      if (!fn) return { correct: false, reason: 'unknown_condition', ...(check.quantity ? { quantity: check.quantity } : {}) };
      return fn(check.args ?? {})
        ? { correct: true }
        : { correct: false, reason: 'condition_false', ...(check.quantity ? { quantity: check.quantity } : {}) };
    }
    case 'readings':
      return evaluateReadings(check, ctx);
    case 'all': {
      for (const sub of check.of) {
        const result = evaluateCheck(sub, ctx);
        if (!result.correct) return result;
      }
      return { correct: true };
    }
  }
}

export function evaluateTask(task: TaskSpec, ctx: TaskContext): TaskEvaluation {
  return evaluateCheck(task.check, ctx);
}

/** Readings a task depends on, so a host can show the right chips and fixed units. */
export function quantitiesOf(check: TaskCheck): string[] {
  const out = new Set<string>();
  const visit = (c: TaskCheck): void => {
    switch (c.kind) {
      case 'all':
        c.of.forEach(visit);
        return;
      case 'readings':
        out.add(c.quantity);
        out.add(c.distinctBy);
        c.sameBy?.forEach((q) => out.add(q));
        return;
      case 'condition':
        if (c.quantity) out.add(c.quantity);
        c.hold?.forEach((q) => out.add(q));
        return;
      default:
        out.add(c.quantity);
        c.hold?.forEach((q) => out.add(q));
    }
  };
  visit(check);
  return [...out];
}
