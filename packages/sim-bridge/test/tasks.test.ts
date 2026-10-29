import { describe, expect, it } from 'vitest';
import type { TaskCheck } from '../src/protocol';
import { evaluateCheck, quantitiesOf, withinTolerance, type RecordedRow } from '../src/tasks';

const ctx = (current: Record<string, number>, extra: Partial<Parameters<typeof evaluateCheck>[1]> = {}) => ({
  current,
  recorded: [] as RecordedRow[],
  ...extra,
});

describe('withinTolerance', () => {
  it('handles absolute and relative tolerances', () => {
    expect(withinTolerance(0.505, 0.5, 0.01)).toBe(true);
    expect(withinTolerance(0.52, 0.5, 0.01)).toBe(false);
    expect(withinTolerance(102, 100, 0.02, true)).toBe(true);
    expect(withinTolerance(103, 100, 0.02, true)).toBe(false);
    // Float noise right at the edge still passes.
    expect(withinTolerance(0.1 + 0.2, 0.2, 0.1)).toBe(true);
  });
});

describe('evaluateCheck', () => {
  it('target: names the quantity when out of tolerance', () => {
    const check: TaskCheck = { kind: 'target', quantity: 'current', value: 0.5, tolerance: 0.01 };
    expect(evaluateCheck(check, ctx({ current: 0.5 }))).toEqual({ correct: true });
    expect(evaluateCheck(check, ctx({ current: 0.25 }))).toEqual({ correct: false, reason: 'out_of_tolerance', quantity: 'current' });
    expect(evaluateCheck(check, ctx({}))).toMatchObject({ correct: false, reason: 'missing_reading' });
  });

  it('target on the last recorded reading (host-checked sims)', () => {
    const check: TaskCheck = { kind: 'target', quantity: 'volume', value: 25, tolerance: 0.1, on: 'last_recorded' };
    const recorded: RecordedRow[] = [
      { name: 'volume', value: 20, context: {} },
      { name: 'volume', value: 25.05, context: {} },
    ];
    expect(evaluateCheck(check, ctx({ volume: 0 }, { recorded }))).toEqual({ correct: true });
    expect(evaluateCheck(check, ctx({ volume: 25 }, { recorded: [] }))).toMatchObject({ correct: false, reason: 'missing_reading' });
  });

  it('range', () => {
    const check: TaskCheck = { kind: 'range', quantity: 'ph', min: 11 };
    expect(evaluateCheck(check, ctx({ ph: 11.4 }))).toEqual({ correct: true });
    expect(evaluateCheck(check, ctx({ ph: 10.9 })).correct).toBe(false);
  });

  it('ratio with a held quantity', () => {
    const check: TaskCheck = { kind: 'ratio', quantity: 'current', ratio: 2, tolerance: 0.03, hold: ['voltage'] };
    const baseline = { current: 0.5, voltage: 6 };
    expect(evaluateCheck(check, ctx({ current: 1.0, voltage: 6 }, { baseline }))).toEqual({ correct: true });
    // Doubling the voltage doubles the current too, but the task said keep it.
    expect(evaluateCheck(check, ctx({ current: 1.0, voltage: 12 }, { baseline }))).toEqual({
      correct: false,
      reason: 'held_changed',
      quantity: 'voltage',
    });
    expect(evaluateCheck(check, ctx({ current: 0.75, voltage: 6 }, { baseline })).correct).toBe(false);
    expect(evaluateCheck(check, ctx({ current: 1, voltage: 6 }))).toMatchObject({ correct: false, reason: 'no_baseline' });
  });

  it('condition uses the sim rule and passes args', () => {
    const conditions = { arrangement: (args: Record<string, unknown>) => args.is === 'parallel' };
    expect(evaluateCheck({ kind: 'condition', rule: 'arrangement', args: { is: 'parallel' } }, ctx({}, { conditions }))).toEqual({
      correct: true,
    });
    expect(evaluateCheck({ kind: 'condition', rule: 'arrangement', args: { is: 'series' } }, ctx({}, { conditions })).correct).toBe(false);
    expect(evaluateCheck({ kind: 'condition', rule: 'nope' }, ctx({}, { conditions }))).toMatchObject({ reason: 'unknown_condition' });
  });

  it('readings: distinct values, grouped by quantities that must stay the same', () => {
    const check: TaskCheck = { kind: 'readings', quantity: 'current', count: 3, distinctBy: 'voltage', sameBy: ['resistance'] };
    const row = (current: number, voltage: number, resistance: number): RecordedRow => ({
      name: 'current',
      value: current,
      context: { voltage, resistance },
    });
    expect(evaluateCheck(check, ctx({}, { recorded: [row(0.5, 6, 12), row(0.25, 3, 12)] })).correct).toBe(false);
    // Same voltage twice does not count twice.
    expect(evaluateCheck(check, ctx({}, { recorded: [row(0.5, 6, 12), row(0.5, 6, 12), row(0.25, 3, 12)] })).correct).toBe(false);
    // Different resistance breaks the group.
    expect(evaluateCheck(check, ctx({}, { recorded: [row(0.5, 6, 12), row(0.25, 3, 12), row(0.9, 9, 10)] })).correct).toBe(false);
    expect(evaluateCheck(check, ctx({}, { recorded: [row(0.5, 6, 12), row(0.25, 3, 12), row(0.75, 9, 12)] })).correct).toBe(true);
  });

  it('all: reports the first failing sub-check', () => {
    const check: TaskCheck = {
      kind: 'all',
      of: [
        { kind: 'condition', rule: 'ok' },
        { kind: 'target', quantity: 'current', value: 1, tolerance: 0.01 },
      ],
    };
    const conditions = { ok: () => true };
    expect(evaluateCheck(check, ctx({ current: 1 }, { conditions }))).toEqual({ correct: true });
    expect(evaluateCheck(check, ctx({ current: 0.5 }, { conditions }))).toMatchObject({ correct: false, quantity: 'current' });
  });
});

describe('quantitiesOf', () => {
  it('collects every quantity a check reads', () => {
    expect(
      quantitiesOf({
        kind: 'all',
        of: [
          { kind: 'ratio', quantity: 'period', ratio: 2, tolerance: 0.03, hold: ['gravity'] },
          { kind: 'readings', quantity: 'period', count: 2, distinctBy: 'mass', sameBy: ['length'] },
        ],
      }).sort(),
    ).toEqual(['gravity', 'length', 'mass', 'period']);
  });
});
