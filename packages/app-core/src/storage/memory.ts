import type { SyncEventType } from '../sync/types';
import {
  TABLE_KEYS,
  type KeyValueStore,
  type NewOutboxRow,
  type OutboxRow,
  type OutboxTable,
  type SrsCardRow,
  type SrsTable,
  type Storage,
  type StorageTables,
  type Table,
  type TableName,
} from './types';

function clone<T>(value: T): T {
  const sc = (globalThis as { structuredClone?: <V>(v: V) => V }).structuredClone;
  return sc ? sc(value) : (JSON.parse(JSON.stringify(value)) as T);
}

class MemoryTable<Row extends object> implements Table<Row> {
  rows = new Map<string, Row>();
  constructor(private readonly keyOf: (row: Row) => string) {}

  async get(key: string) {
    const r = this.rows.get(key);
    return r ? clone(r) : undefined;
  }
  async getMany(keys: readonly string[]) {
    return keys.flatMap((k) => {
      const r = this.rows.get(k);
      return r ? [clone(r)] : [];
    });
  }
  async put(row: Row) {
    this.rows.set(this.keyOf(row), clone(row));
  }
  async putMany(rows: readonly Row[]) {
    for (const r of rows) this.rows.set(this.keyOf(r), clone(r));
  }
  async delete(key: string) {
    this.rows.delete(key);
  }
  async deleteMany(keys: readonly string[]) {
    for (const k of keys) this.rows.delete(k);
  }
  async all() {
    return [...this.rows.values()].map(clone);
  }
  async where(filter: Partial<Row>) {
    const entries = Object.entries(filter) as [keyof Row, unknown][];
    return [...this.rows.values()]
      .filter((r) => entries.every(([k, v]) => JSON.stringify(r[k]) === JSON.stringify(v)))
      .map(clone);
  }
  async count() {
    return this.rows.size;
  }
  async clear() {
    this.rows.clear();
  }
  snapshot(): Map<string, Row> {
    return new Map([...this.rows].map(([k, v]) => [k, clone(v)]));
  }
  restore(snap: Map<string, Row>) {
    this.rows = snap;
  }
}

class MemorySrsTable extends MemoryTable<SrsCardRow> implements SrsTable {
  async dueBefore(untilIso: string) {
    const until = Date.parse(untilIso);
    return [...this.rows.values()].filter((r) => !r.suspended && Date.parse(r.due_at) <= until).map(clone);
  }
}

class MemoryOutbox implements OutboxTable {
  rows: OutboxRow[] = [];
  nextSeq = 1;

  async append<T extends SyncEventType>(row: NewOutboxRow<T>): Promise<OutboxRow<T>> {
    const existing = this.rows.find((r) => r.event_id === row.event_id);
    if (existing) return clone(existing) as OutboxRow<T>;
    const stored: OutboxRow<T> = { ...clone(row), seq: this.nextSeq++, attempts: 0, last_error: null, sent_at: null };
    this.rows.push(stored as OutboxRow);
    return clone(stored);
  }
  async peek(limit: number) {
    return this.rows.filter((r) => r.sent_at === null).slice(0, limit).map(clone);
  }
  async markFailed(eventIds: readonly string[], error: string) {
    const ids = new Set(eventIds);
    for (const r of this.rows) {
      if (ids.has(r.event_id)) {
        r.attempts += 1;
        r.last_error = error;
      }
    }
  }
  async remove(eventIds: readonly string[]) {
    const ids = new Set(eventIds);
    this.rows = this.rows.filter((r) => !ids.has(r.event_id));
  }
  async has(eventId: string) {
    return this.rows.some((r) => r.event_id === eventId);
  }
  async count() {
    return this.rows.length;
  }
  async countByType() {
    const out: Partial<Record<SyncEventType, number>> = {};
    for (const r of this.rows) out[r.type] = (out[r.type] ?? 0) + 1;
    return out;
  }
  async all() {
    return this.rows.map(clone);
  }
  async clear() {
    this.rows = [];
  }
  snapshot() {
    return { rows: this.rows.map(clone), nextSeq: this.nextSeq };
  }
  restore(s: { rows: OutboxRow[]; nextSeq: number }) {
    this.rows = s.rows;
    this.nextSeq = s.nextSeq;
  }
}

type TableKeyFn = (row: never) => string;

/**
 * An in-memory `Storage` for tests and for the local-only guest before a database exists.
 * Transactions snapshot every table and roll back if the callback throws.
 */
export class InMemoryStorage implements Storage {
  readonly outbox = new MemoryOutbox();
  readonly srs_cards = new MemorySrsTable(TABLE_KEYS.srs_cards);
  readonly bundles;
  readonly cards_index;
  readonly decks;
  readonly cards;
  readonly palaces;
  readonly palace_rooms;
  readonly palace_loci;
  readonly notes;
  readonly mind_maps;
  readonly bookmarks;
  readonly user_mnemonics;
  readonly emotion_tags;
  readonly lab_progress;
  readonly lesson_progress;
  readonly topic_status;
  readonly analytics_cache;
  readonly tutor_history;
  readonly social_cache;
  readonly mock_local;
  readonly profile_snapshot;
  readonly session_state;
  readonly asset_cache;
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    const t = <K extends Exclude<TableName, 'outbox' | 'srs_cards'>>(k: K) =>
      new MemoryTable(TABLE_KEYS[k] as TableKeyFn) as unknown as MemoryTable<Parameters<(typeof TABLE_KEYS)[K]>[0]>;
    this.bundles = t('bundles');
    this.cards_index = t('cards_index');
    this.decks = t('decks');
    this.cards = t('cards');
    this.palaces = t('palaces');
    this.palace_rooms = t('palace_rooms');
    this.palace_loci = t('palace_loci');
    this.notes = t('notes');
    this.mind_maps = t('mind_maps');
    this.bookmarks = t('bookmarks');
    this.user_mnemonics = t('user_mnemonics');
    this.emotion_tags = t('emotion_tags');
    this.lab_progress = t('lab_progress');
    this.lesson_progress = t('lesson_progress');
    this.topic_status = t('topic_status');
    this.analytics_cache = t('analytics_cache');
    this.tutor_history = t('tutor_history');
    this.social_cache = t('social_cache');
    this.mock_local = t('mock_local');
    this.profile_snapshot = t('profile_snapshot');
    this.session_state = t('session_state');
    this.asset_cache = t('asset_cache');
  }

  private tables(): MemoryTable<object>[] {
    const out: MemoryTable<object>[] = [];
    for (const v of Object.values(this)) if (v instanceof MemoryTable) out.push(v as MemoryTable<object>);
    return out;
  }

  transaction<T>(fn: (tx: StorageTables) => Promise<T>): Promise<T> {
    const run = async () => {
      const tables = this.tables();
      const snaps = tables.map((t) => t.snapshot());
      const outboxSnap = this.outbox.snapshot();
      try {
        return await fn(this);
      } catch (err) {
        tables.forEach((t, i) => t.restore(snaps[i] as Map<string, object>));
        this.outbox.restore(outboxSnap);
        throw err;
      }
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  async wipe() {
    for (const t of this.tables()) await t.clear();
    await this.outbox.clear();
  }
}

export class MemoryKeyValueStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
}
