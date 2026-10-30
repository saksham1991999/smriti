/**
 * A lesson session: the reducer plus an injected clock, id source and time zone. Every event the
 * reducer produces comes out as a sync envelope, ready for app-core's outbox.
 */
import type { LessonConfig } from "./config.js";
import { envelope, type EventEnvelope, uuidv7 } from "./events.js";
import { initialState, type LessonAction, type LessonState, reduce } from "./machine.js";

export interface SessionOptions {
  config: LessonConfig;
  /** ms since the epoch; inject a fake clock in tests. */
  clock?: () => number;
  /** IANA zone of the device, sent with every event (sync.md envelope). */
  tz: string;
  /** Event id source; defaults to UUIDv7 from the clock. */
  newId?: (now: number) => string;
  /** Called with each event, in order; write it to the outbox in the same transaction as progress. */
  onEvent?: (event: EventEnvelope) => void;
}

export class LessonSession {
  private s: LessonState;
  private readonly clock: () => number;
  private readonly newId: (now: number) => string;
  readonly emitted: EventEnvelope[] = [];

  constructor(private readonly opts: SessionOptions) {
    this.s = initialState(opts.config);
    this.clock = opts.clock ?? (() => Date.now());
    this.newId = opts.newId ?? ((now) => uuidv7(now));
  }

  get state(): LessonState {
    return this.s;
  }

  dispatch(action: LessonAction): LessonState {
    const now = this.clock();
    this.s = reduce(this.s, { ...action, now });
    for (const e of this.s.events) {
      const env = envelope(e, this.opts.tz, this.newId(e.at));
      this.emitted.push(env);
      this.opts.onEvent?.(env);
    }
    return this.s;
  }

  /** What to save per card (learn §7.3 rule 1): the furthest card and the bite. */
  progress(): { lastCardIndex: number; biteId: string | null; bundleVersion: string | null } {
    return { lastCardIndex: this.s.index, biteId: this.s.plan?.biteId ?? null, bundleVersion: this.s.plan?.bundleVersion ?? null };
  }
}
