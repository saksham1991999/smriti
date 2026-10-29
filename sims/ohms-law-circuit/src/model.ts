/**
 * DC circuit model: a cell of EMF ε and internal resistance r, a switch, an
 * ideal ammeter in the main line, and one resistor, two in series, or two in
 * parallel. Ohm's law (V = IR) with the standard combination rules:
 *
 *   series    R = R1 + R2
 *   parallel  1/R = 1/R1 + 1/R2
 *   current   I = ε / (R + r)        (0 when the switch is off)
 *   terminal  V = ε − I r
 *
 * Pure functions, no DOM, so they are unit-tested against known values.
 */

export type Arrangement = 'single' | 'series' | 'parallel';

export interface CircuitInput {
  /** Cell EMF in volts. */
  emf: number;
  /** Internal resistance in ohms (0 for an ideal cell). */
  internalResistance: number;
  r1: number;
  r2: number;
  arrangement: Arrangement;
  switchOn: boolean;
}

export interface CircuitResult {
  /** Resistance of the external circuit, in ohms. */
  externalResistance: number;
  /** Ammeter reading (main line), in amperes. */
  current: number;
  /** Voltage across the cell's terminals, in volts. */
  terminalVoltage: number;
  /** Current through R1 and R2, in amperes. */
  i1: number;
  i2: number;
  /** Voltage across R1 and R2, in volts. */
  v1: number;
  v2: number;
  /** Power delivered to the external circuit, in watts. */
  power: number;
}

export function seriesResistance(r1: number, r2: number): number {
  return r1 + r2;
}

export function parallelResistance(r1: number, r2: number): number {
  if (r1 <= 0 || r2 <= 0) throw new Error('resistances must be positive');
  return (r1 * r2) / (r1 + r2);
}

export function externalResistance(input: Pick<CircuitInput, 'r1' | 'r2' | 'arrangement'>): number {
  switch (input.arrangement) {
    case 'single':
      return input.r1;
    case 'series':
      return seriesResistance(input.r1, input.r2);
    case 'parallel':
      return parallelResistance(input.r1, input.r2);
  }
}

export function solveCircuit(input: CircuitInput): CircuitResult {
  if (input.r1 <= 0 || input.r2 <= 0) throw new Error('resistances must be positive');
  if (input.internalResistance < 0 || input.emf < 0) throw new Error('emf and internal resistance must be non-negative');
  const R = externalResistance(input);
  const current = input.switchOn ? input.emf / (R + input.internalResistance) : 0;
  const terminalVoltage = input.emf - current * input.internalResistance;
  const vExt = current * R;
  let i1 = 0;
  let i2 = 0;
  let v1 = 0;
  let v2 = 0;
  switch (input.arrangement) {
    case 'single':
      i1 = current;
      v1 = vExt;
      break;
    case 'series':
      i1 = current;
      i2 = current;
      v1 = current * input.r1;
      v2 = current * input.r2;
      break;
    case 'parallel':
      v1 = vExt;
      v2 = vExt;
      i1 = vExt / input.r1;
      i2 = vExt / input.r2;
      break;
  }
  return { externalResistance: R, current, terminalVoltage, i1, i2, v1, v2, power: current * current * R };
}
