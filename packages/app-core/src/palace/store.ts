/**
 * Palaces on the device and in the outbox (sync contract v1.5). Every change writes the local
 * tables and its sync event in one `storage.transaction`, so both commit or neither does:
 *
 * - `savePalaceDoc` stores the document (palaces, palace_rooms, palace_loci; items in
 *   `PalaceRow.items`) and enqueues `palace_saved`, replacing any unsent one for the same palace
 *   (the server only keeps the newest snapshot, so the outbox does too).
 * - `deletePalaceDoc` enqueues `palace_deleted`; `ratePalaceItem` schedules the item's `p:` card
 *   with the device FSRS and enqueues `review_rated` (the server stores it as `palace_walk`).
 * - `applyServerPalaces` merges `GET /v1/palaces` (`mergeServerPalaces`).
 *
 * `createPalaceStore` wraps them in a vanilla Zustand store the web and mobile screens share.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { SrsScheduler } from '../fsrs/scheduler';
import type { Clock } from '../platform';
import type { PalaceLocusRow, PalaceRoomRow, PalaceRow, SrsCardRow, Storage, StorageTables } from '../storage/types';
import type { Outbox } from '../sync/outbox';
import type { Confidence, ReviewRating, SyncEventPayloads } from '../sync/types';
import { toIso, type Instant } from '../time';
import { PalaceOpError, createPalaceDoc, validatePalace, type CreatePalaceInput, type NewId } from './ops';
import { mergeServerPalaces, palaceCardRef } from './selectors';
import type { PalaceDoc, ServerPalaceList } from './types';

type Tables = Pick<StorageTables, 'palaces' | 'palace_rooms' | 'palace_loci'>;

// ── wire payloads ──────────────────────────────────────────────────────────────

/** The `palace_saved` payload: the document as it is (validated). */
export function palaceSavedPayload(doc: PalaceDoc): SyncEventPayloads['palace_saved'] {
  const d = validatePalace(doc);
  return {
    palace_id: d.palace_id,
    name: d.name,
    template: d.template,
    template_id: d.template_id,
    source: d.source,
    rooms: d.rooms.map((r) => ({ room_id: r.room_id, name: r.name, sort: r.sort, template_room: r.template_room, loci: r.loci.map((l) => ({ locus_id: l.locus_id, sort: l.sort, pos: { ...l.pos } })) })),
    items: d.items.map((i) => ({ item_id: i.item_id, item_ref: i.item_ref, label: i.label, note: i.note, locus_id: i.locus_id })),
    updated_at: d.updated_at,
  };
}

export const palaceDeletedPayload = (palaceId: string): SyncEventPayloads['palace_deleted'] => ({ palace_id: palaceId });

/** Palaces with an unsent `palace_saved` or `palace_deleted` (left alone by a server merge). */
export async function pendingPalaceIds(tx: Pick<StorageTables, 'outbox'>): Promise<Set<string>> {
  const rows = await tx.outbox.all();
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.sent_at === null && (r.type === 'palace_saved' || r.type === 'palace_deleted')) {
      ids.add((r.payload as { palace_id: string }).palace_id);
    }
  }
  return ids;
}

async function dropUnsentSaves(tx: Pick<StorageTables, 'outbox'>, palaceId: string): Promise<void> {
  const stale = (await tx.outbox.all()).filter(
    (r) => r.sent_at === null && r.type === 'palace_saved' && (r.payload as { palace_id: string }).palace_id === palaceId,
  );
  if (stale.length > 0) await tx.outbox.remove(stale.map((r) => r.event_id));
}

/** Enqueues `palace_saved`, replacing any unsent one for the same palace. */
export async function enqueuePalaceSaved(tx: Pick<StorageTables, 'outbox'>, outbox: Outbox, doc: PalaceDoc) {
  const payload = palaceSavedPayload(doc);
  await dropUnsentSaves(tx, doc.palace_id);
  return outbox.record(tx, 'palace_saved', payload);
}

export async function enqueuePalaceDeleted(tx: Pick<StorageTables, 'outbox'>, outbox: Outbox, palaceId: string) {
  await dropUnsentSaves(tx, palaceId);
  return outbox.record(tx, 'palace_deleted', palaceDeletedPayload(palaceId));
}

// ── local tables ───────────────────────────────────────────────────────────────

async function readRooms(tx: Tables, palaceId: string): Promise<{ rooms: PalaceRoomRow[]; loci: PalaceLocusRow[] }> {
  const rooms = await tx.palace_rooms.where({ palace_id: palaceId });
  const loci = (await Promise.all(rooms.map((r) => tx.palace_loci.where({ room_id: r.id })))).flat();
  return { rooms, loci };
}

/** The device copy of a palace, or null when it is missing or deleted. */
export async function loadPalaceDoc(tx: Tables, palaceId: string): Promise<PalaceDoc | null> {
  const row = await tx.palaces.get(palaceId);
  if (!row || row.deleted_at) return null;
  const { rooms, loci } = await readRooms(tx, palaceId);
  if (rooms.length === 0) return null;
  return {
    palace_id: row.id,
    name: row.name,
    template: row.template,
    template_id: row.template_id ?? null,
    source: row.source ?? null,
    rooms: [...rooms]
      .sort((a, b) => a.sort - b.sort)
      .map((r) => ({
        room_id: r.id,
        name: r.name,
        sort: r.sort,
        template_room: r.template_room ?? null,
        loci: loci
          .filter((l) => l.room_id === r.id)
          .sort((a, b) => a.sort - b.sort)
          .map((l) => ({ locus_id: l.id, sort: l.sort, pos: l.pos })),
      })),
    items: (row.items ?? []).map((i) => ({ ...i })),
    updated_at: row.updated_at,
  };
}

/** Every live palace on the device, newest change first. */
export async function listPalaceDocs(tx: Tables): Promise<PalaceDoc[]> {
  const rows = (await tx.palaces.all()).filter((p) => !p.deleted_at).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const docs = await Promise.all(rows.map((r) => loadPalaceDoc(tx, r.id)));
  return docs.filter((d): d is PalaceDoc => d !== null);
}

async function writeRows(tx: Tables, doc: PalaceDoc, existing: PalaceRow | undefined): Promise<void> {
  const old = await readRooms(tx, doc.palace_id);
  await tx.palace_loci.deleteMany(old.loci.map((l) => l.id));
  await tx.palace_rooms.deleteMany(old.rooms.map((r) => r.id));
  const background = new Map(old.rooms.map((r) => [r.id, r.background_asset_id]));
  const onSpot = new Map(doc.items.filter((i) => i.locus_id !== null).map((i) => [i.locus_id as string, i]));
  await tx.palaces.put({
    id: doc.palace_id,
    name: doc.name,
    template: doc.template,
    pano_asset_id: existing?.pano_asset_id ?? null,
    created_at: existing?.created_at ?? doc.updated_at,
    updated_at: doc.updated_at,
    deleted_at: null,
    template_id: doc.template_id,
    source: doc.source,
    items: doc.items.map((i) => ({ ...i })),
  });
  await tx.palace_rooms.putMany(
    doc.rooms.map((r) => ({ id: r.room_id, palace_id: doc.palace_id, name: r.name, sort: r.sort, background_asset_id: background.get(r.room_id) ?? null, template_room: r.template_room })),
  );
  await tx.palace_loci.putMany(
    doc.rooms.flatMap((r) =>
      r.loci.map((l) => {
        const item = onSpot.get(l.locus_id);
        return { id: l.locus_id, room_id: r.room_id, sort: l.sort, pos: l.pos, item_ref: item?.item_ref ?? '', note: item?.note ?? null, image_asset_id: null };
      }),
    ),
  );
}

async function dropCards(tx: Pick<StorageTables, 'srs_cards'>, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length > 0) await tx.srs_cards.deleteMany(itemIds.map(palaceCardRef));
}

const laterIso = (nowIso: string, previous: string | undefined): string =>
  previous !== undefined && Date.parse(previous) >= Date.parse(nowIso) ? new Date(Date.parse(previous) + 1).toISOString() : nowIso;

/**
 * Saves the palace on the device and enqueues `palace_saved`. Stamps `updated_at` (always later
 * than the stored copy) and drops the local cards of items that were removed. Returns the saved doc.
 */
export async function savePalaceDoc(storage: Storage, outbox: Outbox, doc: PalaceDoc, now: Instant): Promise<PalaceDoc> {
  return storage.transaction(async (tx) => {
    const existing = await tx.palaces.get(doc.palace_id);
    const stamped = validatePalace({ ...doc, updated_at: laterIso(toIso(now), existing?.updated_at) });
    const keep = new Set(stamped.items.map((i) => i.item_id));
    await dropCards(tx, (existing?.items ?? []).map((i) => i.item_id).filter((id) => !keep.has(id)));
    await writeRows(tx, stamped, existing);
    await enqueuePalaceSaved(tx, outbox, stamped);
    return stamped;
  });
}

/** Deletes the palace here (its rooms, spots, items and their cards) and enqueues `palace_deleted`. */
export async function deletePalaceDoc(storage: Storage, outbox: Outbox, palaceId: string, now: Instant): Promise<void> {
  await storage.transaction(async (tx) => {
    const row = await tx.palaces.get(palaceId);
    if (row) {
      const { rooms, loci } = await readRooms(tx, palaceId);
      await tx.palace_loci.deleteMany(loci.map((l) => l.id));
      await tx.palace_rooms.deleteMany(rooms.map((r) => r.id));
      await dropCards(tx, (row.items ?? []).map((i) => i.item_id));
      await tx.palaces.put({ ...row, name: '', items: [], template_id: null, source: null, deleted_at: toIso(now) });
    }
    await enqueuePalaceDeleted(tx, outbox, palaceId);
  });
}

/**
 * MEM-18 "What's here?": rates one item. Schedules its `p:` card with the device FSRS (a new card
 * on its first rating) and enqueues `review_rated`, which counts toward the day's reviews.
 */
export async function ratePalaceItem(
  storage: Storage,
  outbox: Outbox,
  scheduler: SrsScheduler,
  args: { itemId: string; rating: ReviewRating; msToAnswer: number; confidence?: Confidence | null; now: Instant },
): Promise<SrsCardRow> {
  const ref = palaceCardRef(args.itemId);
  return storage.transaction(async (tx) => {
    const card = (await tx.srs_cards.get(ref)) ?? scheduler.newCard(ref, args.now);
    const res = scheduler.schedule(card, args.rating, args.now);
    await tx.srs_cards.put(res.card);
    await outbox.record(
      tx,
      'review_rated',
      { card_ref: ref, rating: args.rating, confidence: args.confidence ?? null, ms_to_answer: Math.max(0, Math.round(args.msToAnswer)), fsrs_state: res.fsrsState },
      { occurredAt: args.now },
    );
    return res.card;
  });
}

/** Merges `GET /v1/palaces` into the device. Returns what changed. */
export async function applyServerPalaces(storage: Storage, list: ServerPalaceList): Promise<{ upserted: number; removed: number }> {
  return storage.transaction(async (tx) => {
    const merge = mergeServerPalaces(await listPalaceDocs(tx), list, await pendingPalaceIds(tx));
    for (const doc of merge.upsert) await writeRows(tx, doc, await tx.palaces.get(doc.palace_id));
    for (const id of merge.remove) {
      const row = await tx.palaces.get(id);
      if (!row) continue;
      const { rooms, loci } = await readRooms(tx, id);
      await tx.palace_loci.deleteMany(loci.map((l) => l.id));
      await tx.palace_rooms.deleteMany(rooms.map((r) => r.id));
      await tx.palaces.put({ ...row, name: '', items: [], deleted_at: row.deleted_at ?? row.updated_at });
    }
    return { upserted: merge.upsert.length, removed: merge.remove.length };
  });
}

// ── shared store ───────────────────────────────────────────────────────────────

export interface PalaceStoreDeps {
  storage: Storage;
  outbox: Outbox;
  clock: Clock;
  newId: NewId;
  scheduler: SrsScheduler;
  /** Building a palace is Pro (PRD §11.1); the server rejects a new palace otherwise. */
  isPro: () => boolean;
}

export interface PalaceState {
  palaces: PalaceDoc[];
  loaded: boolean;
  /** Reads every palace from the device. */
  load(): Promise<void>;
  /** MEM-13: a new palace from a template. Throws `PalaceOpError('pro_required')` without Pro. */
  create(input: CreatePalaceInput): Promise<PalaceDoc>;
  /** Applies one operation from `ops.ts` (place, addItems, setRooms, …) and saves the result. */
  edit(palaceId: string, op: (doc: PalaceDoc) => PalaceDoc): Promise<PalaceDoc>;
  remove(palaceId: string): Promise<void>;
  rate(itemId: string, rating: ReviewRating, msToAnswer: number, confidence?: Confidence | null): Promise<SrsCardRow>;
  /** Merges `GET /v1/palaces`, then reloads. */
  applyServer(list: ServerPalaceList): Promise<void>;
}

export type PalaceStore = StoreApi<PalaceState>;

export function createPalaceStore(deps: PalaceStoreDeps): PalaceStore {
  return createStore<PalaceState>()((set, get) => {
    const replace = (doc: PalaceDoc) => {
      const rest = get().palaces.filter((p) => p.palace_id !== doc.palace_id);
      set({ palaces: [doc, ...rest] });
    };
    return {
      palaces: [],
      loaded: false,
      async load() {
        set({ palaces: await listPalaceDocs(deps.storage), loaded: true });
      },
      async create(input) {
        if (!deps.isPro()) throw new PalaceOpError('pro_required');
        const now = deps.clock();
        const doc = await savePalaceDoc(deps.storage, deps.outbox, createPalaceDoc(input, toIso(now), deps.newId), now);
        replace(doc);
        return doc;
      },
      async edit(palaceId, op) {
        const current = get().palaces.find((p) => p.palace_id === palaceId) ?? (await loadPalaceDoc(deps.storage, palaceId));
        if (!current) throw new PalaceOpError('palace_not_found');
        const doc = await savePalaceDoc(deps.storage, deps.outbox, op(current), deps.clock());
        replace(doc);
        return doc;
      },
      async remove(palaceId) {
        await deletePalaceDoc(deps.storage, deps.outbox, palaceId, deps.clock());
        set({ palaces: get().palaces.filter((p) => p.palace_id !== palaceId) });
      },
      rate(itemId, rating, msToAnswer, confidence) {
        return ratePalaceItem(deps.storage, deps.outbox, deps.scheduler, { itemId, rating, msToAnswer, confidence: confidence ?? null, now: deps.clock() });
      },
      async applyServer(list) {
        await applyServerPalaces(deps.storage, list);
        await get().load();
      },
    };
  });
}
