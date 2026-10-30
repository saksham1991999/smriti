import type { Clock, Fetch, Logger, Network, Scheduler } from '../platform';
import { silentLogger } from '../platform';
import type { Json, KeyedBlobRow, SrsCardRow, Storage, StorageTables, TopicStatusRow } from '../storage/types';
import { toIso } from '../time';
import { toWireEvent } from './outbox';
import type { SyncEventsRequest, SyncEventsResponse, SyncStateResponse } from './types';

export const SYNC_BATCH_SIZE = 200;
export const STATE_VERSION_KEY = 'sync.state_version';
export const SNAPSHOT_SECTIONS = ['profile', 'streak', 'plant', 'pet', 'wallet', 'entitlement'] as const;
export type SnapshotSection = (typeof SNAPSHOT_SECTIONS)[number];

export interface BackoffPolicy {
  baseMs: number;
  factor: number;
  maxMs: number;
  /** ±fraction of random jitter (0.2 = ±20%). */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 1_000, factor: 2, maxMs: 5 * 60_000, jitter: 0.2 };

/** Delay before retry number `attempt` (1-based). `random` returns [0, 1). */
export function backoffDelay(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF, random: () => number = () => 0.5): number {
  const raw = Math.min(policy.maxMs, policy.baseMs * policy.factor ** Math.max(0, attempt - 1));
  const spread = raw * policy.jitter * (random() * 2 - 1);
  return Math.max(0, Math.round(Math.min(policy.maxMs, raw + spread)));
}

/** Supplies the bearer token. `refresh` is called once after a 401. */
export interface TokenSource {
  getAccessToken(): Promise<string | null>;
  refresh?(): Promise<string | null>;
}

export type SyncStatus = 'idle' | 'flushing' | 'backing_off' | 'offline' | 'waiting_for_session' | 'session_ended';

export interface FlushResult {
  sent: number;
  accepted: number;
  rejected: number;
  status: SyncStatus;
  retryInMs?: number;
}

export interface SyncClientOptions {
  storage: Storage;
  fetch: Fetch;
  /** API base URL without `/v1`. */
  baseUrl: string;
  network: Network;
  tokens: TokenSource;
  deviceId: string;
  variant: string;
  scheduler: Scheduler;
  clock: Clock;
  random?: () => number;
  logger?: Logger;
  batchSize?: number;
  backoff?: BackoffPolicy;
  /** Extra headers (`traceparent`, app version). Never personal data. */
  headers?: () => Record<string, string>;
  /** Called after server state has been written to storage. */
  onStateApplied?: (state: SyncStateResponse) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/**
 * Flushes the outbox to `POST /v1/sync/events` and pulls `GET /v1/sync/state` (sync contract v1):
 * batches of up to 200 in `seq` order; accepted and rejected events are removed (rejected ones are
 * logged by code and never retried); 5xx, 429 and network errors keep the batch and retry with
 * exponential backoff; server state overwrites local copies.
 */
export class SyncClient {
  private readonly o: Required<Omit<SyncClientOptions, 'onStateApplied' | 'headers'>> &
    Pick<SyncClientOptions, 'onStateApplied' | 'headers'>;
  private status: SyncStatus = 'idle';
  private failures = 0;
  private retryHandle: unknown = null;
  private inflight: Promise<FlushResult> | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<(s: SyncStatus) => void>();
  private serverStateVersion = 0;
  private batchLimit = SYNC_BATCH_SIZE;

  constructor(options: SyncClientOptions) {
    this.o = {
      random: Math.random,
      logger: silentLogger,
      batchSize: SYNC_BATCH_SIZE,
      backoff: DEFAULT_BACKOFF,
      ...options,
    };
    if (this.o.batchSize < 1 || this.o.batchSize > SYNC_BATCH_SIZE) throw new RangeError('batchSize must be 1..200');
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  onStatus(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts listening for reconnects and flushes once if online. */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.o.network.subscribe((online) => {
      if (online) {
        this.clearRetry();
        void this.flush();
      } else {
        this.setStatus('offline');
      }
    });
    if (this.o.network.isOnline()) void this.flush();
    else this.setStatus('offline');
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearRetry();
  }

  /** After the student signs in again (AUTH-31): clears `session_ended` and flushes the kept outbox. */
  resume(): Promise<FlushResult> {
    if (this.status === 'session_ended') this.setStatus('idle');
    this.failures = 0;
    this.clearRetry();
    return this.flush();
  }

  /** Call after appending events (debounce in the app if you like). Safe to call repeatedly. */
  flush(): Promise<FlushResult> {
    if (!this.inflight) {
      this.inflight = this.runFlush().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private setStatus(s: SyncStatus) {
    if (s === this.status) return;
    this.status = s;
    for (const l of [...this.listeners]) l(s);
  }

  private clearRetry() {
    if (this.retryHandle !== null) {
      this.o.scheduler.clearTimeout(this.retryHandle);
      this.retryHandle = null;
    }
  }

  private scheduleRetry(): number {
    this.failures += 1;
    const delay = backoffDelay(this.failures, this.o.backoff, this.o.random);
    this.clearRetry();
    this.retryHandle = this.o.scheduler.setTimeout(() => {
      this.retryHandle = null;
      void this.flush();
    }, delay);
    this.setStatus('backing_off');
    return delay;
  }

  private headers(token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-App-Variant': this.o.variant,
      'X-Device-Id': this.o.deviceId,
      ...(this.o.headers?.() ?? {}),
    };
  }

  private async runFlush(): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, accepted: 0, rejected: 0, status: 'idle' };
    if (this.status === 'session_ended') return { ...result, status: 'session_ended' };
    this.setStatus('flushing');
    for (;;) {
      if (!this.o.network.isOnline()) {
        this.setStatus('offline');
        return { ...result, status: 'offline' };
      }
      let token = await this.o.tokens.getAccessToken();
      if (!token) {
        this.setStatus('waiting_for_session');
        return { ...result, status: 'waiting_for_session' };
      }
      const rows = await this.o.storage.outbox.peek(Math.min(this.o.batchSize, this.batchLimit));
      if (rows.length === 0) break;
      const body: SyncEventsRequest = { device_id: this.o.deviceId, events: rows.map(toWireEvent) };
      let res: SyncEventsResponse;
      try {
        res = await this.postEvents(body, token).catch(async (err: unknown) => {
          if (err instanceof HttpError && err.status === 401 && this.o.tokens.refresh) {
            token = await this.o.tokens.refresh();
            if (!token) throw new HttpError(401, 'session_ended');
            return this.postEvents(body, token);
          }
          throw err;
        });
      } catch (err) {
        const code = err instanceof HttpError ? err.code : 'network_error';
        await this.o.storage.outbox.markFailed(
          rows.map((r) => r.event_id),
          code,
        );
        if (err instanceof HttpError && isPermanentClientError(err.status)) {
          // The server refused the whole envelope. Halve the batch to isolate the bad event;
          // a single event it still refuses is dropped like a rejected event (never retried).
          if (rows.length > 1) {
            this.batchLimit = Math.ceil(rows.length / 2);
            continue;
          }
          await this.o.storage.outbox.remove(rows.map((r) => r.event_id));
          this.o.logger.warn('sync.event_dropped', { code });
          result.sent += 1;
          result.rejected += 1;
          continue;
        }
        if (err instanceof HttpError && err.status === 401) {
          this.o.logger.warn('sync.session_ended', { batch: rows.length });
          this.setStatus('session_ended');
          return { ...result, status: 'session_ended' };
        }
        const retryInMs = this.scheduleRetry();
        this.o.logger.warn('sync.flush_failed', { code, batch: rows.length, retry_in_ms: retryInMs });
        return { ...result, status: 'backing_off', retryInMs };
      }

      const acked = new Set([...res.accepted, ...res.rejected.map((r) => r.event_id)]);
      for (const r of res.rejected) {
        // Rejected events are dropped, never retried. Log the code only, never the payload.
        this.o.logger.warn('sync.event_rejected', { code: r.code });
      }
      await this.o.storage.outbox.remove([...acked]);
      const missing = rows.filter((r) => !acked.has(r.event_id)).map((r) => r.event_id);
      result.sent += rows.length;
      result.accepted += res.accepted.length;
      result.rejected += res.rejected.length;
      this.serverStateVersion = Math.max(this.serverStateVersion, res.state_version);
      if (missing.length > 0) {
        // The server neither accepted nor rejected some events: keep them and retry later.
        await this.o.storage.outbox.markFailed(missing, 'not_acknowledged');
        const retryInMs = this.scheduleRetry();
        return { ...result, status: 'backing_off', retryInMs };
      }
      this.failures = 0;
      this.batchLimit = SYNC_BATCH_SIZE;
    }

    const local = await readStateVersion(this.o.storage);
    if (this.serverStateVersion > local) {
      try {
        await this.pullState();
      } catch (err) {
        const code = err instanceof HttpError ? err.code : 'network_error';
        this.o.logger.warn('sync.pull_failed', { code });
        const retryInMs = this.scheduleRetry();
        return { ...result, status: 'backing_off', retryInMs };
      }
    }
    this.failures = 0;
    this.setStatus('idle');
    return { ...result, status: 'idle' };
  }

  private async postEvents(body: SyncEventsRequest, token: string): Promise<SyncEventsResponse> {
    const res = await this.o.fetch(`${this.o.baseUrl}/v1/sync/events`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new HttpError(res.status, `http_${res.status}`);
    return parseEventsResponse(await res.json());
  }

  /**
   * `GET /v1/sync/state?since=` and apply it (server wins). Pass `full` to restore everything
   * (new device, after a merge or reinstall).
   */
  async pullState(opts: { full?: boolean } = {}): Promise<SyncStateResponse> {
    const token = await this.o.tokens.getAccessToken();
    if (!token) throw new HttpError(401, 'no_session');
    const since = opts.full ? null : await readStateVersion(this.o.storage);
    const url = `${this.o.baseUrl}/v1/sync/state${since ? `?since=${since}` : ''}`;
    const res = await this.o.fetch(url, { method: 'GET', headers: this.headers(token) });
    if (!res.ok) throw new HttpError(res.status, `http_${res.status}`);
    const state = (await res.json()) as SyncStateResponse;
    await this.o.storage.transaction((tx) => applyServerState(tx, state, this.o.clock()));
    this.serverStateVersion = Math.max(this.serverStateVersion, state.state_version);
    this.o.onStateApplied?.(state);
    return state;
  }
}

/** 4xx answers that retrying the same envelope cannot fix (401, 408 and 429 are retried). */
function isPermanentClientError(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

function parseEventsResponse(raw: unknown): SyncEventsResponse {
  const r = raw as Partial<SyncEventsResponse> | null;
  if (!r || !Array.isArray(r.accepted) || !Array.isArray(r.rejected) || typeof r.state_version !== 'number') {
    throw new HttpError(502, 'bad_response');
  }
  return { accepted: r.accepted, rejected: r.rejected, state_version: r.state_version };
}

export async function readStateVersion(tx: Pick<StorageTables, 'session_state'>): Promise<number> {
  const row = await tx.session_state.get(STATE_VERSION_KEY);
  return typeof row?.data === 'number' ? row.data : 0;
}

/** Reads one profile snapshot section written by `applyServerState` or by optimistic updates. */
export async function readSnapshotSection<T>(tx: Pick<StorageTables, 'profile_snapshot'>, section: SnapshotSection): Promise<T | undefined> {
  const row = await tx.profile_snapshot.get(section);
  return row?.data as T | undefined;
}

/**
 * Writes a `GET /v1/sync/state` response into local tables. Each section received replaces the
 * local copy (server wins); sections that are absent are left alone.
 */
export async function applyServerState(tx: StorageTables, state: SyncStateResponse, nowMs: number): Promise<void> {
  const now = toIso(nowMs);
  const put = (key: string, data: unknown) =>
    tx.profile_snapshot.put({ key, data: data as Json, updated_at: now } satisfies KeyedBlobRow);
  for (const section of SNAPSHOT_SECTIONS) {
    if (state[section] !== undefined) await put(section, state[section]);
  }
  if (state.srs) {
    const existing = await tx.srs_cards.getMany(state.srs.cards.map((c) => c.card_ref));
    const byRef = new Map(existing.map((r) => [r.card_ref, r]));
    const rows: SrsCardRow[] = state.srs.cards.map((c) => {
      const prev = byRef.get(c.card_ref);
      return {
        card_ref: c.card_ref,
        deck_id: c.deck_id ?? prev?.deck_id ?? null,
        state: c.state,
        due_at: c.due,
        stability: c.stability,
        difficulty: c.difficulty,
        elapsed_days: c.elapsed_days ?? prev?.elapsed_days ?? 0,
        scheduled_days: c.scheduled_days ?? prev?.scheduled_days ?? 0,
        learning_steps: c.learning_steps ?? prev?.learning_steps ?? 0,
        reps: c.reps,
        lapses: c.lapses,
        last_review_at: c.last_review,
        suspended: c.suspended ?? prev?.suspended ?? false,
        flags: prev?.flags ?? 0,
        buried_until: prev?.buried_until ?? null,
        updated_at: now,
        topic_id: prev?.topic_id ?? null,
        concept_ids: prev?.concept_ids ?? [],
        sibling_key: prev?.sibling_key ?? null,
        introduced_on: prev?.introduced_on ?? null,
      };
    });
    await tx.srs_cards.putMany(rows);
    await tx.srs_cards.deleteMany(state.srs.deleted);
  }
  if (state.topic_progress) {
    const rows: TopicStatusRow[] = state.topic_progress.map((t) => ({
      topic_id: t.topic_id,
      status: t.status,
      learned_via: t.learned_via ?? null,
      percent: t.percent,
      updated_at: now,
    }));
    await tx.topic_status.putMany(rows);
  }
  await tx.session_state.put({ key: STATE_VERSION_KEY, data: state.state_version, updated_at: now });
}
