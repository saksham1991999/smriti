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
  type SyncEventType,
  type Table,
  type TableName,
} from '@smriti/app-core';

/**
 * The subset of expo-sqlite's async database API this adapter needs. expo-sqlite's
 * `SQLiteDatabase` satisfies it on device; tests pass Node's built-in SQLite behind the same shape.
 */
export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlParam[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: SqlParam[]): Promise<T | null>;
}
export type SqlParam = string | number | null;

/** Bumped when the table layout changes; each step is a forward-only migration. */
export const SCHEMA_VERSION = 1;

const KEYED_TABLES = (Object.keys(TABLE_KEYS) as (keyof typeof TABLE_KEYS)[]).filter((t) => t !== 'srs_cards');

/**
 * `Storage` on expo-sqlite (DB_SCHEMA §15): one database per profile, WAL mode. Each keyed table
 * stores the row as JSON under its primary key; the outbox and the FSRS schedule have real columns
 * because they are queried by order and by due date. All access is serialised, and a transaction
 * holds the lock, so a device write and its outbox event commit together or not at all.
 */
export class SqliteStorage implements Storage {
  readonly outbox: OutboxTable;
  readonly srs_cards: SrsTable;
  readonly bundles!: StorageTables['bundles'];
  readonly cards_index!: StorageTables['cards_index'];
  readonly decks!: StorageTables['decks'];
  readonly cards!: StorageTables['cards'];
  readonly palaces!: StorageTables['palaces'];
  readonly palace_rooms!: StorageTables['palace_rooms'];
  readonly palace_loci!: StorageTables['palace_loci'];
  readonly notes!: StorageTables['notes'];
  readonly mind_maps!: StorageTables['mind_maps'];
  readonly bookmarks!: StorageTables['bookmarks'];
  readonly user_mnemonics!: StorageTables['user_mnemonics'];
  readonly emotion_tags!: StorageTables['emotion_tags'];
  readonly lab_progress!: StorageTables['lab_progress'];
  readonly lesson_progress!: StorageTables['lesson_progress'];
  readonly topic_status!: StorageTables['topic_status'];
  readonly analytics_cache!: StorageTables['analytics_cache'];
  readonly tutor_history!: StorageTables['tutor_history'];
  readonly social_cache!: StorageTables['social_cache'];
  readonly mock_local!: StorageTables['mock_local'];
  readonly profile_snapshot!: StorageTables['profile_snapshot'];
  readonly session_state!: StorageTables['session_state'];
  readonly asset_cache!: StorageTables['asset_cache'];

  private chain: Promise<unknown> = Promise.resolve();
  private readonly txTables: StorageTables;

  private constructor(private readonly db: SqlDb) {
    const locked: Runner = (fn) => this.locked(fn);
    const direct: Runner = (fn) => fn();
    this.outbox = new SqlOutbox(db, locked);
    this.srs_cards = new SqlSrsTable(db, locked);
    const mutable = this as unknown as Record<string, unknown>;
    const txMutable: Record<string, unknown> = { outbox: new SqlOutbox(db, direct), srs_cards: new SqlSrsTable(db, direct) };
    for (const name of KEYED_TABLES) {
      const keyOf = TABLE_KEYS[name] as (row: never) => string;
      mutable[name] = new SqlTable(db, name, keyOf, locked);
      txMutable[name] = new SqlTable(db, name, keyOf, direct);
    }
    this.txTables = txMutable as unknown as StorageTables;
  }

  /** Opens (and migrates) a profile database. */
  static async open(db: SqlDb): Promise<SqliteStorage> {
    await migrate(db);
    return new SqliteStorage(db);
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.catch(() => undefined);
    return result;
  }

  transaction<T>(fn: (tx: StorageTables) => Promise<T>): Promise<T> {
    return this.locked(async () => {
      await this.db.execAsync('BEGIN IMMEDIATE');
      try {
        const out = await fn(this.txTables);
        await this.db.execAsync('COMMIT');
        return out;
      } catch (err) {
        await this.db.execAsync('ROLLBACK');
        throw err;
      }
    });
  }

  async wipe(): Promise<void> {
    await this.transaction(async () => {
      for (const name of KEYED_TABLES) await this.db.runAsync(`DELETE FROM ${tableName(name)}`);
      await this.db.runAsync('DELETE FROM srs_cards');
      await this.db.runAsync('DELETE FROM outbox');
    });
  }
}

type Runner = <T>(fn: () => Promise<T>) => Promise<T>;

const tableName = (name: TableName) => `t_${name}`;

async function migrate(db: SqlDb): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;
  const statements = [
    ...KEYED_TABLES.map((t) => `CREATE TABLE IF NOT EXISTS ${tableName(t)} (k TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)`),
    `CREATE TABLE IF NOT EXISTS srs_cards (k TEXT PRIMARY KEY NOT NULL, due_at TEXT NOT NULL, suspended INTEGER NOT NULL, data TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS srs_cards_due ON srs_cards (suspended, due_at)',
    `CREATE TABLE IF NOT EXISTS outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      tz TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      sent_at TEXT
    )`,
    'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)',
    `PRAGMA user_version = ${SCHEMA_VERSION}`,
  ];
  for (const s of statements) await db.execAsync(s);
}

class SqlTable<Row extends object> implements Table<Row> {
  private readonly t: string;
  constructor(
    private readonly db: SqlDb,
    name: TableName,
    private readonly keyOf: (row: Row) => string,
    private readonly run: Runner,
  ) {
    this.t = tableName(name);
  }

  get(key: string) {
    return this.run(async () => {
      const r = await this.db.getFirstAsync<{ data: string }>(`SELECT data FROM ${this.t} WHERE k = ?`, key);
      return r ? (JSON.parse(r.data) as Row) : undefined;
    });
  }
  getMany(keys: readonly string[]) {
    return this.run(async () => {
      if (keys.length === 0) return [];
      const out: Row[] = [];
      for (const chunk of chunks(keys, 500)) {
        const rows = await this.db.getAllAsync<{ k: string; data: string }>(
          `SELECT k, data FROM ${this.t} WHERE k IN (${chunk.map(() => '?').join(',')})`,
          ...chunk,
        );
        const byKey = new Map(rows.map((r) => [r.k, r.data]));
        for (const k of chunk) {
          const d = byKey.get(k);
          if (d) out.push(JSON.parse(d) as Row);
        }
      }
      return out;
    });
  }
  put(row: Row) {
    return this.run(async () => {
      await this.db.runAsync(`INSERT OR REPLACE INTO ${this.t} (k, data) VALUES (?, ?)`, this.keyOf(row), JSON.stringify(row));
    });
  }
  putMany(rows: readonly Row[]) {
    return this.run(async () => {
      for (const row of rows) await this.db.runAsync(`INSERT OR REPLACE INTO ${this.t} (k, data) VALUES (?, ?)`, this.keyOf(row), JSON.stringify(row));
    });
  }
  delete(key: string) {
    return this.run(async () => {
      await this.db.runAsync(`DELETE FROM ${this.t} WHERE k = ?`, key);
    });
  }
  deleteMany(keys: readonly string[]) {
    return this.run(async () => {
      for (const chunk of chunks(keys, 500)) {
        if (chunk.length) await this.db.runAsync(`DELETE FROM ${this.t} WHERE k IN (${chunk.map(() => '?').join(',')})`, ...chunk);
      }
    });
  }
  all() {
    return this.run(async () => (await this.db.getAllAsync<{ data: string }>(`SELECT data FROM ${this.t} ORDER BY k`)).map((r) => JSON.parse(r.data) as Row));
  }
  async where(filter: Partial<Row>) {
    const entries = Object.entries(filter) as [keyof Row, unknown][];
    const rows = await this.all();
    return rows.filter((r) => entries.every(([k, v]) => JSON.stringify(r[k]) === JSON.stringify(v)));
  }
  count() {
    return this.run(async () => (await this.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${this.t}`))?.n ?? 0);
  }
  clear() {
    return this.run(async () => {
      await this.db.runAsync(`DELETE FROM ${this.t}`);
    });
  }
}

class SqlSrsTable implements SrsTable {
  constructor(
    private readonly db: SqlDb,
    private readonly run: Runner,
  ) {}
  private write(row: SrsCardRow) {
    return this.db.runAsync(
      'INSERT OR REPLACE INTO srs_cards (k, due_at, suspended, data) VALUES (?, ?, ?, ?)',
      row.card_ref,
      new Date(row.due_at).toISOString(),
      row.suspended ? 1 : 0,
      JSON.stringify(row),
    );
  }
  get(key: string) {
    return this.run(async () => {
      const r = await this.db.getFirstAsync<{ data: string }>('SELECT data FROM srs_cards WHERE k = ?', key);
      return r ? (JSON.parse(r.data) as SrsCardRow) : undefined;
    });
  }
  getMany(keys: readonly string[]) {
    return this.run(async () => {
      const out: SrsCardRow[] = [];
      for (const chunk of chunks(keys, 500)) {
        if (!chunk.length) continue;
        const rows = await this.db.getAllAsync<{ data: string }>(`SELECT data FROM srs_cards WHERE k IN (${chunk.map(() => '?').join(',')})`, ...chunk);
        out.push(...rows.map((r) => JSON.parse(r.data) as SrsCardRow));
      }
      return out;
    });
  }
  put(row: SrsCardRow) {
    return this.run(async () => {
      await this.write(row);
    });
  }
  putMany(rows: readonly SrsCardRow[]) {
    return this.run(async () => {
      for (const r of rows) await this.write(r);
    });
  }
  delete(key: string) {
    return this.run(async () => {
      await this.db.runAsync('DELETE FROM srs_cards WHERE k = ?', key);
    });
  }
  deleteMany(keys: readonly string[]) {
    return this.run(async () => {
      for (const chunk of chunks(keys, 500)) {
        if (chunk.length) await this.db.runAsync(`DELETE FROM srs_cards WHERE k IN (${chunk.map(() => '?').join(',')})`, ...chunk);
      }
    });
  }
  all() {
    return this.run(async () => (await this.db.getAllAsync<{ data: string }>('SELECT data FROM srs_cards ORDER BY k')).map((r) => JSON.parse(r.data) as SrsCardRow));
  }
  async where(filter: Partial<SrsCardRow>) {
    const entries = Object.entries(filter) as [keyof SrsCardRow, unknown][];
    return (await this.all()).filter((r) => entries.every(([k, v]) => JSON.stringify(r[k]) === JSON.stringify(v)));
  }
  count() {
    return this.run(async () => (await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM srs_cards'))?.n ?? 0);
  }
  clear() {
    return this.run(async () => {
      await this.db.runAsync('DELETE FROM srs_cards');
    });
  }
  dueBefore(untilIso: string) {
    return this.run(async () =>
      (
        await this.db.getAllAsync<{ data: string }>(
          'SELECT data FROM srs_cards WHERE suspended = 0 AND due_at <= ? ORDER BY due_at',
          new Date(untilIso).toISOString(),
        )
      ).map((r) => JSON.parse(r.data) as SrsCardRow),
    );
  }
}

interface OutboxDbRow {
  seq: number;
  event_id: string;
  type: string;
  payload: string;
  occurred_at: string;
  tz: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
}

const fromDb = (r: OutboxDbRow): OutboxRow =>
  ({
    seq: r.seq,
    event_id: r.event_id,
    type: r.type as SyncEventType,
    payload: JSON.parse(r.payload),
    occurred_at: r.occurred_at,
    tz: r.tz,
    attempts: r.attempts,
    last_error: r.last_error,
    sent_at: r.sent_at,
  }) as OutboxRow;

class SqlOutbox implements OutboxTable {
  constructor(
    private readonly db: SqlDb,
    private readonly run: Runner,
  ) {}
  append<T extends SyncEventType>(row: NewOutboxRow<T>): Promise<OutboxRow<T>> {
    return this.run(async () => {
      await this.db.runAsync(
        'INSERT OR IGNORE INTO outbox (event_id, type, payload, occurred_at, tz) VALUES (?, ?, ?, ?, ?)',
        row.event_id,
        row.type,
        JSON.stringify(row.payload),
        row.occurred_at,
        row.tz,
      );
      const stored = await this.db.getFirstAsync<OutboxDbRow>('SELECT * FROM outbox WHERE event_id = ?', row.event_id);
      return fromDb(stored!) as OutboxRow<T>;
    });
  }
  peek(limit: number) {
    return this.run(async () => (await this.db.getAllAsync<OutboxDbRow>('SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY seq LIMIT ?', limit)).map(fromDb));
  }
  markFailed(eventIds: readonly string[], error: string) {
    return this.run(async () => {
      for (const chunk of chunks(eventIds, 500)) {
        if (!chunk.length) continue;
        await this.db.runAsync(
          `UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE event_id IN (${chunk.map(() => '?').join(',')})`,
          error,
          ...chunk,
        );
      }
    });
  }
  remove(eventIds: readonly string[]) {
    return this.run(async () => {
      for (const chunk of chunks(eventIds, 500)) {
        if (chunk.length) await this.db.runAsync(`DELETE FROM outbox WHERE event_id IN (${chunk.map(() => '?').join(',')})`, ...chunk);
      }
    });
  }
  has(eventId: string) {
    return this.run(async () => (await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE event_id = ?', eventId))!.n > 0);
  }
  count() {
    return this.run(async () => (await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox'))?.n ?? 0);
  }
  countByType() {
    return this.run(async () => {
      const rows = await this.db.getAllAsync<{ type: SyncEventType; n: number }>('SELECT type, COUNT(*) AS n FROM outbox GROUP BY type');
      const out: Partial<Record<SyncEventType, number>> = {};
      for (const r of rows) out[r.type] = r.n;
      return out;
    });
  }
  all() {
    return this.run(async () => (await this.db.getAllAsync<OutboxDbRow>('SELECT * FROM outbox ORDER BY seq')).map(fromDb));
  }
  clear() {
    return this.run(async () => {
      await this.db.runAsync('DELETE FROM outbox');
    });
  }
}

/** A small key-value store in the profile database (onboarding state, soft-prompt budget, settings). */
export class SqliteKeyValueStore implements KeyValueStore {
  constructor(private readonly db: SqlDb) {}
  static async open(db: SqlDb): Promise<SqliteKeyValueStore> {
    await db.execAsync('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)');
    return new SqliteKeyValueStore(db);
  }
  async get(key: string) {
    return (await this.db.getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', key))?.v ?? null;
  }
  async set(key: string, value: string) {
    await this.db.runAsync('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', key, value);
  }
  async delete(key: string) {
    await this.db.runAsync('DELETE FROM kv WHERE k = ?', key);
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
