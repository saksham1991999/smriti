/**
 * Frame loop with an fps cap: 60 normally, 30 in battery saver (sim-builder
 * "Low power"). Paused loops do not request frames at all.
 */

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export interface LoopOptions {
  fps: number;
  /** dt in seconds since the last frame, capped so a hidden tab does not jump. */
  onFrame(dt: number): void;
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
}

export const MAX_FRAME_DT = 0.1;

export function createLoop(o: LoopOptions): Loop {
  const raf = o.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = o.caf ?? ((id) => cancelAnimationFrame(id));
  const minInterval = 1000 / o.fps;
  let id: number | null = null;
  let last: number | null = null;
  let running = false;

  const tick = (t: number): void => {
    if (!running) return;
    id = raf(tick);
    if (last === null) {
      last = t;
      return;
    }
    const elapsed = t - last;
    // Allow 1 ms of jitter so 60 Hz displays still give 30 fps exactly.
    if (elapsed + 1 < minInterval) return;
    last = t;
    o.onFrame(Math.min(MAX_FRAME_DT, elapsed / 1000));
  };

  return {
    start() {
      if (running) return;
      running = true;
      last = null;
      id = raf(tick);
    },
    stop() {
      running = false;
      if (id !== null) caf(id);
      id = null;
    },
    get running() {
      return running;
    },
  };
}
