/**
 * Interfaces for what the host platform provides. app-core never touches `window`, `document`,
 * React Native or Node APIs directly; each app passes implementations of these.
 */

export interface HttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}

export interface HttpRequestInit {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  signal?: unknown;
}

/** Compatible with the global `fetch` on web, React Native and Node 18+. */
export type Fetch = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

/** Online/offline awareness: NetInfo on mobile, `navigator.onLine` + events on web. */
export interface Network {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type Clock = () => number;

/** Structured logging hook. Never pass personal data or event payloads (AGENTS.md rule 6). */
export interface Logger {
  debug(message: string, fields?: Record<string, string | number | boolean | null>): void;
  warn(message: string, fields?: Record<string, string | number | boolean | null>): void;
  error(message: string, fields?: Record<string, string | number | boolean | null>): void;
}

export const silentLogger: Logger = { debug() {}, warn() {}, error() {} };

/** A `Network` you drive by hand: tests, and platforms without a connectivity API. */
export class ManualNetwork implements Network {
  private listeners = new Set<(online: boolean) => void>();
  constructor(private online = true) {}
  isOnline() {
    return this.online;
  }
  set(online: boolean) {
    if (online === this.online) return;
    this.online = online;
    for (const l of [...this.listeners]) l(online);
  }
  subscribe(listener: (online: boolean) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** `setTimeout` from the host (works on web, RN and Node). */
export const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => (globalThis as unknown as { setTimeout(f: () => void, ms: number): unknown }).setTimeout(fn, ms),
  clearTimeout: (h) => (globalThis as unknown as { clearTimeout(h: unknown): void }).clearTimeout(h),
};

/** A scheduler with a manual clock, for tests and deterministic replays. */
export class ManualScheduler implements Scheduler {
  now = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.push({ at: this.now + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  pending(): number[] {
    return this.timers.map((t) => t.at - this.now).sort((a, b) => a - b);
  }
  /** Advances the clock, running due timers in order. */
  async advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = due.at;
      due.fn();
      await new Promise((r) => r(undefined));
    }
    this.now = target;
  }
}
