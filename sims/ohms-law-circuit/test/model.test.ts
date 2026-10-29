import { describe, expect, it } from 'vitest';
import { externalResistance, parallelResistance, solveCircuit, type CircuitInput } from '../src/model';

const base: CircuitInput = { emf: 6, internalResistance: 0, r1: 12, r2: 12, arrangement: 'single', switchOn: true };

describe('Ohm’s law circuit model', () => {
  it('I = V / R for one resistor', () => {
    expect(solveCircuit(base).current).toBeCloseTo(0.5, 12);
    expect(solveCircuit({ ...base, emf: 3 }).current).toBeCloseTo(0.25, 12);
    expect(solveCircuit({ ...base, r1: 6 }).current).toBeCloseTo(1, 12);
  });

  it('current is proportional to voltage at fixed resistance', () => {
    const currents = [2, 4, 6, 8].map((emf) => solveCircuit({ ...base, emf }).current);
    const ratios = currents.map((i, k) => i / [2, 4, 6, 8][k]!);
    for (const r of ratios) expect(r).toBeCloseTo(1 / 12, 12);
  });

  it('series resistances add and share the same current', () => {
    const r = solveCircuit({ ...base, arrangement: 'series', r1: 4, r2: 8 });
    expect(r.externalResistance).toBe(12);
    expect(r.i1).toBeCloseTo(0.5, 12);
    expect(r.i2).toBeCloseTo(0.5, 12);
    expect(r.v1 + r.v2).toBeCloseTo(6, 12);
    expect(r.v1).toBeCloseTo(2, 12);
  });

  it('parallel resistances combine as reciprocals and split the current', () => {
    expect(parallelResistance(12, 12)).toBe(6);
    expect(parallelResistance(3, 6)).toBeCloseTo(2, 12);
    const r = solveCircuit({ ...base, arrangement: 'parallel', r1: 3, r2: 6 });
    expect(r.current).toBeCloseTo(3, 12);
    expect(r.i1).toBeCloseTo(2, 12);
    expect(r.i2).toBeCloseTo(1, 12);
    expect(r.i1 + r.i2).toBeCloseTo(r.current, 12);
    // The equivalent resistance is smaller than either resistor.
    expect(externalResistance({ r1: 3, r2: 6, arrangement: 'parallel' })).toBeLessThan(3);
  });

  it('internal resistance lowers the terminal voltage: V = ε − Ir', () => {
    const r = solveCircuit({ ...base, emf: 12, internalResistance: 1, r1: 5 });
    expect(r.current).toBeCloseTo(2, 12);
    expect(r.terminalVoltage).toBeCloseTo(10, 12);
    expect(r.power).toBeCloseTo(20, 12);
  });

  it('no current flows with the switch off', () => {
    const r = solveCircuit({ ...base, switchOn: false });
    expect(r.current).toBe(0);
    expect(r.terminalVoltage).toBe(6);
    expect(r.power).toBe(0);
  });

  it('refuses non-physical inputs', () => {
    expect(() => solveCircuit({ ...base, r1: 0 })).toThrow();
    expect(() => solveCircuit({ ...base, emf: -1 })).toThrow();
  });
});
