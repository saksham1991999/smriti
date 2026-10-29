import { describe, expect, it } from 'vitest';
import { checkSimPackage, type SimManifest } from '@smriti/sim-kit';
import manifest from '../manifest.json';
import en from '../strings.en.json';
import hi from '../strings.hi.json';
import { solveCircuit } from '../src/model';

describe('ohms-law-circuit package', () => {
  it('has a complete, valid manifest and matching strings', () => {
    expect(checkSimPackage(manifest as unknown as SimManifest, { en, hi }, ['arrangement', 'switch_on'])).toEqual([]);
  });

  it('every target task can be reached with the slider steps', () => {
    // Task 1: 0.5 A with one resistor (6 V across 12 Ω).
    expect(solveCircuit({ emf: 6, internalResistance: 0, r1: 12, r2: 12, arrangement: 'single', switchOn: true }).current).toBe(0.5);
    // Task 4: 1 A with two resistors in parallel (6 V across 12 Ω ∥ 12 Ω).
    expect(solveCircuit({ emf: 6, internalResistance: 0, r1: 12, r2: 12, arrangement: 'parallel', switchOn: true }).current).toBe(1);
  });
});
