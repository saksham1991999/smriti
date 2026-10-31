import type { Clock } from '../src/clock';
import type { TaskSpec } from '../src/protocol';

/** A manual clock: time only moves when the test calls `advance`. */
export class FakeClock implements Clock {
  private t = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }

  get pending(): number {
    return this.timers.size;
  }
}

export const txt = (en: string): { en: string; hi: string } => ({ en, hi: `${en} (hi)` });

export const sampleTasks: TaskSpec[] = [
  { id: 't1', prompt: txt('Make the current 0.5 A'), check: { kind: 'target', quantity: 'current', value: 0.5, tolerance: 0.01 } },
  {
    id: 't2',
    prompt: txt('Double the current, same voltage'),
    hint: txt('Halve the resistance'),
    check: { kind: 'ratio', quantity: 'current', ratio: 2, tolerance: 0.03, hold: ['voltage'] },
  },
];

/** Flush pending promise callbacks. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}
