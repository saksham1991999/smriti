/**
 * IndexedDB (Dexie) implementation of app-core's `Storage` (TRD §4.2, DB_SCHEMA §15): the same
 * outbox, schedule, progress and snapshot tables as the mobile SQLite database. Every keyed row is
 * stored as `{ k, ...row }`, where `k` comes from app-core's `TABLE_KEYS`, so composite keys work
 * the same way on both platforms.
 */
import Dexie, { type Table as DexieTable, type Transaction } from "dexie";
import {
  TABLE_KEYS,
  type NewOutboxRow,
  type OutboxRow,
  type OutboxTable,
  type SrsCardRow,
  type SrsTable,
  type Storage,
  type StorageTables,
  type SyncEventType,
  type Table,
  type TableName,
} from "@smriti/app-core";

type KeyedName = Exclude<TableName, "outbox">;
type Stored<Row> = Row & { k: string };
type KeyFn = (row: never) => string;

const KEYED: KeyedName[] = Object.keys(TABLE_KEYS) as KeyedName[];

function strip<Row>(stored: Stored<Row> | undefined): Row | undefined {
  if (!stored) return undefined;
  const { k: _k, ...row } = stored;
  return row as Row;
}

class SmritiDexie extends Dexie {
  constructor(name: string) {
    super(name);
    const schema: Record<string, string> = { outbox: "++seq, &event_id, type" };
    for (const t of KEYED) schema[t] = t === "srs_cards" ? "k, due_at" : "k";
    this.version(1).stores(schema);
  }
}

class DexieKeyedTable<Row extends object> implements Table<Row> {
  constructor(
    protected readonly table: () => DexieTable<Stored<Row>, string>,
    protected readonly keyOf: (row: Row) => string,
  ) {}
  async get(key: string) {
    return strip(await this.table().get(key));
  }
  async getMany(keys: readonly string[]) {
    const rows = await this.table().bulkGet([...keys]);
    return rows.flatMap((r) => (r ? [strip(r) as Row] : []));
  }
  async put(row: Row) {
    await this.table().put({ ...row, k: this.keyOf(row) });
  }
  async putMany(rows: readonly Row[]) {
    await this.table().bulkPut(rows.map((r) => ({ ...r, k: this.keyOf(r) })));
  }
  async delete(key: string) {
    await this.table().delete(key);
  }
  async deleteMany(keys: readonly string[]) {
    await this.table().bulkDelete([...keys]);
  }
  async all() {
    return (await this.table().toArray()).map((r) => strip(r) as Row);
  }
  async where(filter: Partial<Row>) {
    const entries = Object.entries(filter) as [keyof Row, unknown][];
    const rows = await this.all();
    return rows.filter((r) => entries.every(([key, v]) => JSON.stringify(r[key]) === JSON.stringify(v)));
  }
  async count() {
    return this.table().count();
  }
  async clear() {
    await this.table().clear();
  }
}

class DexieSrsTable extends DexieKeyedTable<SrsCardRow> implements SrsTable {
  async dueBefore(untilIso: string) {
    const rows = await this.table().where("due_at").belowOrEqual(untilIso).toArray();
    // ISO strings compare lexically only when they share a format; re-check numerically.
    const until = Date.parse(untilIso);
    return rows.map((r) => strip(r) as SrsCardRow).filter((r) => !r.suspended && Date.parse(r.due_at) <= until);
  }
}

/** How long an acknowledged event stays on the device for local folds. */
const KEEP_SENT_MS = 2 * 86_400_000;

class DexieOutbox implements OutboxTable {
  constructor(private readonly table: () => DexieTable<OutboxRow, number>) {}
  async append<T extends SyncEventType>(row: NewOutboxRow<T>): Promise<OutboxRow<T>> {
    const existing = await this.table().where("event_id").equals(row.event_id).first();
    if (existing) return existing as OutboxRow<T>;
    const stored = { ...row, attempts: 0, last_error: null, sent_at: null } as Omit<OutboxRow<T>, "seq">;
    const seq = await this.table().add(stored as unknown as OutboxRow);
    return { ...stored, seq } as OutboxRow<T>;
  }
  async peek(limit: number) {
    const rows = await this.table().orderBy("seq").toArray();
    return rows.filter((r) => r.sent_at === null).slice(0, limit);
  }
  async markFailed(eventIds: readonly string[], error: string) {
    const rows = await this.table().where("event_id").anyOf([...eventIds]).toArray();
    await this.table().bulkPut(rows.map((r) => ({ ...r, attempts: r.attempts + 1, last_error: error })));
  }
  /**
   * Acknowledged rows are marked sent and kept for two days, so today's local folds (activity,
   * minutes) still see them after a sync; `peek`, `count` and `countByType` skip them.
   */
  async remove(eventIds: readonly string[]) {
    const now = new Date().toISOString();
    const rows = await this.table().where("event_id").anyOf([...eventIds]).toArray();
    await this.table().bulkPut(rows.map((r) => ({ ...r, sent_at: r.sent_at ?? now })));
    const cutoff = Date.now() - KEEP_SENT_MS;
    await this.table()
      .filter((r) => r.sent_at !== null && Date.parse(r.sent_at) < cutoff)
      .delete();
  }
  async has(eventId: string) {
    return (await this.table().where("event_id").equals(eventId).count()) > 0;
  }
  async count() {
    return this.table().filter((r) => r.sent_at === null).count();
  }
  async countByType() {
    const out: Partial<Record<SyncEventType, number>> = {};
    await this.table().each((r) => {
      if (r.sent_at === null) out[r.type] = (out[r.type] ?? 0) + 1;
    });
    return out;
  }
  async all() {
    return this.table().orderBy("seq").toArray();
  }
  async clear() {
    await this.table().clear();
  }
}

/**
 * Builds the table set. `tx` is the active Dexie transaction when inside `transaction()`, so
 * every read and write in the callback joins it.
 */
function buildTables(db: SmritiDexie, tx?: Transaction): StorageTables {
  const pick = <R>(name: string) => () => (tx ? tx.table(name) : db.table(name)) as unknown as DexieTable<R, string>;
  const tables: Record<string, unknown> = {
    outbox: new DexieOutbox(pick<OutboxRow>("outbox") as unknown as () => DexieTable<OutboxRow, number>),
  };
  for (const name of KEYED) {
    const keyFn = TABLE_KEYS[name] as KeyFn as (row: object) => string;
    tables[name] = name === "srs_cards" ? new DexieSrsTable(pick("srs_cards"), keyFn) : new DexieKeyedTable(pick(name), keyFn);
  }
  return tables as unknown as StorageTables;
}

export class DexieStorage implements Storage {
  readonly db: SmritiDexie;
  private readonly t: StorageTables;
  constructor(name = "smriti-local") {
    this.db = new SmritiDexie(name);
    this.t = buildTables(this.db);
  }
  get outbox() { return this.t.outbox; }
  get bundles() { return this.t.bundles; }
  get cards_index() { return this.t.cards_index; }
  get srs_cards() { return this.t.srs_cards; }
  get decks() { return this.t.decks; }
  get cards() { return this.t.cards; }
  get palaces() { return this.t.palaces; }
  get palace_rooms() { return this.t.palace_rooms; }
  get palace_loci() { return this.t.palace_loci; }
  get notes() { return this.t.notes; }
  get mind_maps() { return this.t.mind_maps; }
  get bookmarks() { return this.t.bookmarks; }
  get user_mnemonics() { return this.t.user_mnemonics; }
  get emotion_tags() { return this.t.emotion_tags; }
  get lab_progress() { return this.t.lab_progress; }
  get lesson_progress() { return this.t.lesson_progress; }
  get topic_status() { return this.t.topic_status; }
  get analytics_cache() { return this.t.analytics_cache; }
  get tutor_history() { return this.t.tutor_history; }
  get social_cache() { return this.t.social_cache; }
  get mock_local() { return this.t.mock_local; }
  get profile_snapshot() { return this.t.profile_snapshot; }
  get session_state() { return this.t.session_state; }
  get asset_cache() { return this.t.asset_cache; }

  transaction<T>(fn: (tx: StorageTables) => Promise<T>): Promise<T> {
    // Dexie's overloads recurse too deeply on our table map; call through a plain signature.
    const tx = this.db.transaction.bind(this.db) as unknown as (mode: "rw", tables: DexieTable[], scope: (t: Transaction) => Promise<T>) => Promise<T>;
    return tx("rw", this.db.tables, (t) => fn(buildTables(this.db, t)));
  }

  async wipe() {
    await this.transaction(async () => {
      for (const table of this.db.tables) await table.clear();
    });
  }
}
