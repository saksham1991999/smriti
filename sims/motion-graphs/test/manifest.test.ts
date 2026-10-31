import { describe, expect, it } from 'vitest';
import { evaluateTask, type TaskSpec } from '@smriti/sim-bridge';
import { checkSimPackage, type SimManifest } from '@smriti/sim-kit';
import manifest from '../manifest.json';
import en from '../strings.en.json';
import hi from '../strings.hi.json';
import { displacement, pathLength, position, velocity, type Motion } from '../src/model';

const card: Motion = { x0: 0, u: 10, a: -2 };
const tasks = manifest.tasks as unknown as TaskSpec[];
const task = (id: string): TaskSpec => {
  const found = tasks.find((x) => x.id === id);
  if (!found) throw new Error(id);
  return found;
};

/** The readings the sim reports at time t (the same names and model as main.ts). */
function readingsAt(m: Motion, t: number): Record<string, number> {
  return {
    time: t,
    position: position(m, t),
    velocity: velocity(m, t),
    acceleration: m.a,
    displacement: displacement(m, t),
    path_length: pathLength(m, t),
    initial_velocity: m.u,
  };
}

const passes = (id: string, m: Motion, t: number): boolean => evaluateTask(task(id), { current: readingsAt(m, t), recorded: [] }).correct;

describe('motion-graphs package', () => {
  it('has a complete, valid manifest and matching strings', () => {
    expect(checkSimPackage(manifest as unknown as SimManifest, { en, hi }, [])).toEqual([]);
  });

  it('reports every reading the lesson card checks, in the card units', () => {
    const units = Object.fromEntries(manifest.readings.map((r) => [r.name, r.unit]));
    expect(units).toMatchObject({ time: 's', position: 'm', velocity: 'm/s', acceleration: 'm/s²', displacement: 'm', path_length: 'm' });
  });

  it('defaults are the card case: x0 = 0, u = 10 m/s, a = −2 m/s², 10 s clock', () => {
    const p = manifest.params;
    expect([p.x0.default, p.u.default, p.a.default, p.t_max.default]).toEqual([0, 10, -2, 10]);
  });

  it('the stop-time and farthest tasks pass at 5 s and fail a step either side', () => {
    expect(passes('stop-time', card, 5)).toBe(true);
    expect(passes('farthest', card, 5)).toBe(true);
    expect(passes('stop-time', card, 4.9)).toBe(false);
    expect(passes('farthest', card, 5.1)).toBe(false);
  });

  it('the back-home and path tasks pass at 10 s with x = 0 m and a 50 m path', () => {
    expect(passes('back-home', card, 10)).toBe(true);
    expect(passes('path', card, 10)).toBe(true);
    expect(passes('path', card, 9)).toBe(false);
  });

  it('every task needs the card setup (u = 10 m/s, a = −2 m/s²)', () => {
    const other: Motion = { x0: 0, u: 10, a: -1 };
    for (const t of tasks) expect(passes(t.id, other, 10)).toBe(false);
  });
});
