import { describe, expect, it } from 'vitest';
import { evaluateTask, type TaskSpec } from '@smriti/sim-bridge';
import { checkSimPackage, type SimManifest } from '@smriti/sim-kit';
import manifest from '../manifest.json';
import en from '../strings.en.json';
import hi from '../strings.hi.json';
import { maxHeight, range, timeOfFlight, vx, vy, type Launch } from '../src/model';

const tasks = manifest.tasks as unknown as TaskSpec[];
const task = (id: string): TaskSpec => {
  const found = tasks.find((x) => x.id === id);
  if (!found) throw new Error(id);
  return found;
};

/** The readings after a landed launch (the same names and model as main.ts). */
function landed(l: Launch): Record<string, number> {
  const T = timeOfFlight(l);
  return {
    time: T,
    vx: vx(l),
    vy: vy(l, T),
    range: range(l),
    max_height: maxHeight(l),
    time_of_flight: T,
    launch_speed: l.v0,
    angle: l.angle,
    gravity: l.g,
  };
}

const passes = (id: string, l: Launch): boolean => evaluateTask(task(id), { current: landed(l), recorded: [] }).correct;
const at = (angle: number, v0 = 20, g = 9.8): Launch => ({ v0, angle, g, h0: 0 });

describe('projectile-launcher package', () => {
  it('has a complete, valid manifest and matching strings', () => {
    expect(checkSimPackage(manifest as unknown as SimManifest, { en, hi }, [])).toEqual([]);
  });

  it('reports what the lesson card reads, in the card units', () => {
    const units = Object.fromEntries(manifest.readings.map((r) => [r.name, r.unit]));
    expect(units).toMatchObject({ range: 'm', max_height: 'm', time_of_flight: 's', vx: 'm/s', vy: 'm/s' });
  });

  it('defaults are the card setup: 20 m/s at 45°, g = 9.8, from the ground', () => {
    const p = manifest.params;
    expect([p.v0.default, p.angle.default, p.g.default, p.h0.default]).toEqual([20, 45, 9.8, 0]);
  });

  it('each task passes for its launch and fails for the wrong angle', () => {
    expect(passes('range-45', at(45))).toBe(true);
    expect(passes('height-45', at(45))).toBe(true);
    expect(passes('range-30', at(30))).toBe(true);
    expect(passes('range-60', at(60))).toBe(true);
    expect(passes('range-45', at(44))).toBe(false);
    expect(passes('range-30', at(60))).toBe(false);
    expect(passes('range-60', at(30))).toBe(false);
  });

  it('tasks need the card speed and gravity', () => {
    expect(passes('range-45', at(45, 21))).toBe(false);
    expect(passes('range-45', at(45, 20, 9.7))).toBe(false);
  });
});
