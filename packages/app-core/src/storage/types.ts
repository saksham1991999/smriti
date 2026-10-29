import type { SyncEventPayloads, SyncEventType } from '../sync/types';

/**
 * The on-device storage interface (DB_SCHEMA §15). Mobile implements it with SQLite
 * (expo-sqlite, WAL) and MMKV; web with IndexedDB (Dexie) and localStorage. One `Storage`
 * per profile (`smriti-{user_id}.db`). Every row is plain JSON-serialisable data.
 *
 * Timestamps are ISO-8601 UTC strings; calendar days are `YYYY-MM-DD` in the profile timezone.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// ── Rows ─────────────────────────────────────────────────────────────────────

/** The action queue. `seq` is assigned by the storage (autoincrement). */
export interface OutboxRow<T extends SyncEventType = SyncEventType> {
  seq: number;
  /** UUIDv7, unique: the idempotency key. */
  event_id: string;
  type: T;
  payload: SyncEventPayloads[T];
  occurred_at: string;
  /** IANA timezone of the device when the event happened (envelope field `tz`). */
  tz: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
}

export type NewOutboxRow<T extends SyncEventType = SyncEventType> = Omit<OutboxRow<T>, 'seq' | 'attempts' | 'last_error' | 'sent_at'>;

export interface BundleRow {
  bundle_id: string;
  /** Content hash (also in the filename): bundles are immutable. */
  hash: string;
  path: string;
  bytes: number;
  /** Explicitly downloaded (Pro) or the seed pack: never evicted. */
  pinned: boolean;
  last_opened_at: string | null;
  /** `seed` for the seed pack shipped in the app build. */
  source?: 'seed' | 'cache' | 'download';
  /** Mode and locale, so the manifest diff can be scoped. */
  kind?: string;
  locale?: string;
}

export interface CardsIndexRow {
  card_id: string;
  bundle_id: string;
  topic_id: string;
  concept_ids: string[];
  /** Card type from the flashcard schema (basic, reverse, cloze, formula, …). */
  kind?: string;
  /** Cards that share a key are siblings (a card and its reverse): never on the same day. */
  sibling_key?: string | null;
  /** `core` concepts come first in a comeback plan (memory-labs §5.2). */
  priority?: 'core' | 'standard' | null;
}

/** The local FSRS schedule; same columns as `learn.srs_cards` plus the ts-fsrs step fields. */
export interface SrsCardRow {
  card_ref: string;
  deck_id: string | null;
  /** 0 new, 1 learning, 2 review, 3 relearning. */
  state: 0 | 1 | 2 | 3;
  due_at: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  last_review_at: string | null;
  suspended: boolean;
  /** Bit 1: leech_seen. */
  flags: number;
  buried_until: string | null;
  updated_at: string;
  /** Denormalised from `cards_index` for queue building. */
  topic_id?: string | null;
  concept_ids?: string[];
  sibling_key?: string | null;
  /** Day the card first entered the queue (counts toward `memory.new_cards_per_day`). */
  introduced_on?: string | null;
}

export interface DeckRow {
  id: string;
  owner_user_id: string | null;
  source: 'system' | 'user' | 'note' | 'transcript' | 'tutor' | 'shared_copy';
  title: string;
  topic_id: string | null;
  share_code: string | null;
  is_public: boolean;
  started_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface UserCardRow {
  id: string;
  deck_id: string;
  kind: 'basic' | 'basic_reverse' | 'cloze';
  front: Json;
  back: Json;
  image_asset_id: string | null;
  concept_id: string | null;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PalaceRow {
  id: string;
  name: string;
  template: 'home' | 'school' | 'monument' | 'pano360' | 'custom';
  pano_asset_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PalaceRoomRow {
  id: string;
  palace_id: string;
  name: string;
  sort: number;
  background_asset_id: string | null;
}

export interface PalaceLocusRow {
  id: string;
  room_id: string;
  sort: number;
  pos: { x: number; y: number } | { yaw: number; pitch: number };
  item_ref: string;
  note: string | null;
  image_asset_id: string | null;
}

export interface NoteRow {
  id: string;
  topic_id: string | null;
  concept_ids: string[];
  title: string;
  cues: Json;
  body: Json;
  summary: string | null;
  ai_filled_at: string | null;
  deck_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MindMapRow {
  id: string;
  root_topic_id: string | null;
  graph: Json;
  origin: 'ai' | 'user';
  updated_at: string;
}

export interface BookmarkRow {
  id: string;
  item_ref: string;
  kind: 'bookmark' | 'highlight' | 'formula_vault' | 'shortcut_vault';
  range: Json | null;
  note: string | null;
  created_at: string;
}

export interface UserMnemonicRow {
  id: string;
  concept_id: string | null;
  card_ref: string | null;
  technique: string;
  body: string;
  image_asset_id: string | null;
  audio_asset_id: string | null;
  origin: 'ai' | 'user';
  shared_for_review: boolean;
  created_at: string;
}

export interface EmotionTagRow {
  item_ref: string;
  emoji: string | null;
  feeling: string | null;
  note: string | null;
  created_at: string;
}

export interface LabProgressRow {
  item_id: string;
  last_opened_at: string;
  tasks: Record<string, Json>;
  readings: Record<string, Json>;
  completed_at: string | null;
}

export interface LessonProgressRow {
  topic_id: string;
  mode: 'deep_dive' | 'quick_revision';
  bundle_hash: string;
  last_card_index: number;
  cards_seen: number;
  bites_completed: string[];
  best_score: number | null;
  completed_at: string | null;
  updated_at: string;
}

export interface TopicStatusRow {
  topic_id: string;
  status: 'not_started' | 'in_progress' | 'learned';
  learned_via: 'lesson' | 'test_out' | 'placement' | 'chapter_test' | null;
  percent?: number;
  updated_at: string;
}

/** A keyed JSON blob: analytics_cache, social_cache, session_state, profile_snapshot. */
export interface KeyedBlobRow<T = Json> {
  key: string;
  data: T;
  updated_at: string;
}

export interface TutorHistoryRow {
  session_id: string;
  title: string;
  mode: string;
  last_message_at: string;
}

export interface MockLocalRow {
  attempt_id: string;
  data: Json;
  updated_at: string;
}

export interface AssetCacheRow {
  key: string;
  path: string;
  bytes: number;
  last_access_at: string;
  pinned: boolean;
  /** Private assets (doubt photos, generated images) are wiped on sign-out; public media stays. */
  private?: boolean;
}

// ── Tables ───────────────────────────────────────────────────────────────────

/** A keyed table. Composite keys are joined with `|` (see `TABLE_KEYS`). */
export interface Table<Row, Key extends string = string> {
  get(key: Key): Promise<Row | undefined>;
  getMany(keys: readonly Key[]): Promise<Row[]>;
  put(row: Row): Promise<void>;
  putMany(rows: readonly Row[]): Promise<void>;
  delete(key: Key): Promise<void>;
  deleteMany(keys: readonly Key[]): Promise<void>;
  all(): Promise<Row[]>;
  /** Rows whose fields equal every given value. */
  where(filter: Partial<Row>): Promise<Row[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

export interface OutboxTable {
  /** Appends in `seq` order and returns the stored row. A duplicate `event_id` is ignored. */
  append<T extends SyncEventType>(row: NewOutboxRow<T>): Promise<OutboxRow<T>>;
  /** Unsent rows in `seq` order. */
  peek(limit: number): Promise<OutboxRow[]>;
  /** Adds one to `attempts` and records the error code (never event content). */
  markFailed(eventIds: readonly string[], error: string): Promise<void>;
  /** Deletes acknowledged rows (accepted or rejected by the server). */
  remove(eventIds: readonly string[]): Promise<void>;
  has(eventId: string): Promise<boolean>;
  count(): Promise<number>;
  countByType(): Promise<Partial<Record<SyncEventType, number>>>;
  /** Every row, in `seq` order, for local folds (today's activity, quests). */
  all(): Promise<OutboxRow[]>;
  clear(): Promise<void>;
}

export interface SrsTable extends Table<SrsCardRow> {
  /** Cards with `due_at <= until`, not suspended. */
  dueBefore(untilIso: string): Promise<SrsCardRow[]>;
}

/** The tables of one profile database. */
export interface StorageTables {
  outbox: OutboxTable;
  bundles: Table<BundleRow>;
  cards_index: Table<CardsIndexRow>;
  srs_cards: SrsTable;
  decks: Table<DeckRow>;
  cards: Table<UserCardRow>;
  palaces: Table<PalaceRow>;
  palace_rooms: Table<PalaceRoomRow>;
  palace_loci: Table<PalaceLocusRow>;
  notes: Table<NoteRow>;
  mind_maps: Table<MindMapRow>;
  bookmarks: Table<BookmarkRow>;
  user_mnemonics: Table<UserMnemonicRow>;
  emotion_tags: Table<EmotionTagRow>;
  lab_progress: Table<LabProgressRow>;
  lesson_progress: Table<LessonProgressRow>;
  topic_status: Table<TopicStatusRow>;
  analytics_cache: Table<KeyedBlobRow>;
  tutor_history: Table<TutorHistoryRow>;
  social_cache: Table<KeyedBlobRow>;
  mock_local: Table<MockLocalRow>;
  profile_snapshot: Table<KeyedBlobRow>;
  session_state: Table<KeyedBlobRow>;
  asset_cache: Table<AssetCacheRow>;
}

export type TableName = keyof StorageTables;

export interface Storage extends StorageTables {
  /**
   * Runs `fn` atomically: a device write and its outbox event commit together or not at all
   * (DB_SCHEMA §15 sync rules). Implementations serialise transactions.
   */
  transaction<T>(fn: (tx: StorageTables) => Promise<T>): Promise<T>;
  /** Deletes every row of this profile (sign-out wipe, auth flow §6.7 step 6). */
  wipe(): Promise<void>;
}

/** How each table's primary key is derived from a row. Composite keys join with `|`. */
export const TABLE_KEYS = {
  bundles: (r: BundleRow) => r.bundle_id,
  cards_index: (r: CardsIndexRow) => r.card_id,
  srs_cards: (r: SrsCardRow) => r.card_ref,
  decks: (r: DeckRow) => r.id,
  cards: (r: UserCardRow) => r.id,
  palaces: (r: PalaceRow) => r.id,
  palace_rooms: (r: PalaceRoomRow) => r.id,
  palace_loci: (r: PalaceLocusRow) => r.id,
  notes: (r: NoteRow) => r.id,
  mind_maps: (r: MindMapRow) => r.id,
  bookmarks: (r: BookmarkRow) => r.id,
  user_mnemonics: (r: UserMnemonicRow) => r.id,
  emotion_tags: (r: EmotionTagRow) => r.item_ref,
  lab_progress: (r: LabProgressRow) => r.item_id,
  lesson_progress: (r: LessonProgressRow) => lessonProgressKey(r.topic_id, r.mode),
  topic_status: (r: TopicStatusRow) => r.topic_id,
  analytics_cache: (r: KeyedBlobRow) => r.key,
  tutor_history: (r: TutorHistoryRow) => r.session_id,
  social_cache: (r: KeyedBlobRow) => r.key,
  mock_local: (r: MockLocalRow) => r.attempt_id,
  profile_snapshot: (r: KeyedBlobRow) => r.key,
  session_state: (r: KeyedBlobRow) => r.key,
  asset_cache: (r: AssetCacheRow) => r.key,
} as const satisfies { [K in Exclude<TableName, 'outbox'>]: (row: never) => string };

export function lessonProgressKey(topicId: string, mode: LessonProgressRow['mode']): string {
  return `${topicId}|${mode}`;
}

/** A small key-value store: MMKV on mobile, localStorage on web. Strings only. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
