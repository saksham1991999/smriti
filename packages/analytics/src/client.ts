import { CATALOGUE } from './catalogue.generated';
import { guardProps, isSafeToken, type GuardIssue, type PropValue } from './guard';
import { allowEvent, stripForAudience, type Audience, type DropReason, type PolicyContext } from './policy';
import type { EventDef, Stream } from './types';

type Catalogue = typeof CATALOGUE;
export type EventName = keyof Catalogue;

type ValueOf<P> = P extends { type: 'enum'; values: readonly (infer V)[] }
  ? V | (string & {})
  : P extends { type: 'enum_list'; values: readonly (infer V)[] }
    ? readonly (V | (string & {}))[]
    : P extends { type: 'number' }
      ? number
      : P extends { type: 'boolean' }
        ? boolean
        : P extends { type: 'list' | 'enum_list' }
          ? readonly (string | number)[]
          : string | number | boolean;

/** Typed props of an event (all optional: the docs don't mark required props). */
export type EventProps<N extends EventName> = {
  [K in keyof Catalogue[N]['props']]?: ValueOf<Catalogue[N]['props'][K]> | null;
};

/** Common props on every event (practice §10). Tokens only. */
export interface CommonContext {
  exam_profile?: string | null;
  platform: 'ios' | 'android' | 'web';
  app_variant: string;
  app_version?: string;
  locale: 'en' | 'hi';
  is_guest: boolean;
  tier: 'free' | 'pro';
}

export interface AnalyticsEvent {
  event_id: string;
  name: string;
  stream: Stream;
  occurred_at: string;
  props: Record<string, PropValue>;
  context: CommonContext;
  audience: Audience;
}

/** Sends a batch. Throw (or reject) to keep the batch for a retry. */
export interface Transport {
  send(batch: readonly AnalyticsEvent[]): Promise<void>;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AnalyticsClientOptions {
  transport: Transport;
  clock: () => number;
  /** A UUIDv7 maker (`createIdGenerator` from app-core). */
  newId: () => string;
  policy: () => PolicyContext;
  context: () => CommonContext;
  scheduler?: Scheduler;
  batchSize?: number;
  flushIntervalMs?: number;
  /** Oldest events are dropped above this (offline for a long time). */
  maxQueue?: number;
  /** Development hook: guard issues and drops (names and codes only). */
  onIssue?: (event: string, issue: GuardIssue | { code: DropReason }) => void;
  catalogue?: Record<string, EventDef>;
}

export type TrackResult = { queued: true; issues: GuardIssue[] } | { queued: false; reason: DropReason };

/**
 * The product-analytics batcher. Every event is checked against the catalogue, the audience
 * policy and the props guard before it is queued; batches go out through the injected transport,
 * with exponential backoff on failure.
 */
export class AnalyticsClient {
  private queue: AnalyticsEvent[] = [];
  private timer: unknown = null;
  private failures = 0;
  private sending: Promise<number> | null = null;
  private readonly o: Required<Omit<AnalyticsClientOptions, 'scheduler' | 'onIssue'>> & Pick<AnalyticsClientOptions, 'scheduler' | 'onIssue'>;

  constructor(options: AnalyticsClientOptions) {
    this.o = { batchSize: 20, flushIntervalMs: 10_000, maxQueue: 500, catalogue: CATALOGUE as unknown as Record<string, EventDef>, ...options };
  }

  track<N extends EventName>(name: N, props?: EventProps<N>): TrackResult {
    const def = this.o.catalogue[name as string];
    const policy = this.o.policy();
    const allowed = allowEvent(name as string, def, policy);
    if (!allowed.ok) {
      this.o.onIssue?.(name as string, { code: allowed.reason });
      return { queued: false, reason: allowed.reason };
    }
    const { props: clean, issues } = guardProps(def as EventDef, stripForAudience((props ?? {}) as Record<string, unknown>, policy.audience));
    for (const i of issues) this.o.onIssue?.(name as string, i);
    this.queue.push({
      event_id: this.o.newId(),
      name: name as string,
      stream: (def as EventDef).stream,
      occurred_at: new Date(this.o.clock()).toISOString(),
      props: clean,
      context: sanitizeContext(this.o.context()),
      audience: policy.audience,
    });
    if (this.queue.length > this.o.maxQueue) this.queue.splice(0, this.queue.length - this.o.maxQueue);
    if (this.queue.length >= this.o.batchSize) void this.flush();
    else this.schedule(this.o.flushIntervalMs);
    return { queued: true, issues };
  }

  pending(): number {
    return this.queue.length;
  }

  /** Sends everything queued, a batch at a time. Returns the number sent. */
  flush(): Promise<number> {
    if (!this.sending) {
      this.sending = this.runFlush().finally(() => {
        this.sending = null;
      });
    }
    return this.sending;
  }

  /** Sign-out or consent withdrawn: drop what is queued. */
  clear(): void {
    this.queue = [];
    this.cancelTimer();
  }

  private async runFlush(): Promise<number> {
    this.cancelTimer();
    let sent = 0;
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, this.o.batchSize);
      try {
        await this.o.transport.send(batch);
      } catch {
        this.failures += 1;
        this.schedule(Math.min(5 * 60_000, 1000 * 2 ** (this.failures - 1)));
        return sent;
      }
      const ids = new Set(batch.map((e) => e.event_id));
      this.queue = this.queue.filter((e) => !ids.has(e.event_id));
      sent += batch.length;
      this.failures = 0;
    }
    return sent;
  }

  private schedule(ms: number) {
    if (!this.o.scheduler || this.timer !== null) return;
    this.timer = this.o.scheduler.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private cancelTimer() {
    if (this.timer !== null && this.o.scheduler) this.o.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }
}

function sanitizeContext(c: CommonContext): CommonContext {
  const tok = (v: string | null | undefined) => (v && isSafeToken(v) ? v : null);
  return {
    exam_profile: tok(c.exam_profile),
    platform: c.platform,
    app_variant: tok(c.app_variant) ?? 'unknown',
    ...(c.app_version ? { app_version: tok(c.app_version) ?? 'unknown' } : {}),
    locale: c.locale,
    is_guest: Boolean(c.is_guest),
    tier: c.tier,
  };
}

/** A transport that posts JSON to a URL (`ANALYTICS_URL`), for web and mobile. */
export function httpTransport(opts: {
  url: string;
  fetch: (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;
  headers?: () => Record<string, string>;
}): Transport {
  return {
    async send(batch) {
      const res = await opts.fetch(opts.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(opts.headers?.() ?? {}) },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok && res.status !== 400) throw new Error(`analytics http_${res.status}`); // 400: bad batch, don't retry
    },
  };
}

/** Collects events in memory: tests and local development. */
export class MemoryTransport implements Transport {
  readonly batches: AnalyticsEvent[][] = [];
  fail = false;
  async send(batch: readonly AnalyticsEvent[]) {
    if (this.fail) throw new Error('offline');
    this.batches.push([...batch]);
  }
  get events(): AnalyticsEvent[] {
    return this.batches.flat();
  }
}
