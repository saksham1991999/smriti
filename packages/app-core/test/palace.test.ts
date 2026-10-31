import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONTRACT_V15_EVENT_TYPES,
  CONTRACT_V1_EVENT_TYPES,
  DEFAULT_SPOT_POSITIONS,
  InMemoryStorage,
  Outbox,
  PalaceOpError,
  SrsScheduler,
  addItems,
  applyServerPalaces,
  createPalaceDoc,
  createPalaceStore,
  deletePalaceDoc,
  dueQuizItems,
  isPalaceCardRef,
  listPalaceDocs,
  loadPalaceDoc,
  mergeServerPalaces,
  nextWalkAt,
  orderScorePct,
  palaceCardRef,
  palaceItemIdOf,
  palaceSavedPayload,
  palaceStats,
  patchItem,
  pendingPalaceIds,
  placeItem,
  quizItems,
  ratePalaceItem,
  removeItem,
  savePalaceDoc,
  setRooms,
  trayItems,
  unplaceItem,
  validatePalace,
  walkStops,
  type ItemInput,
  type PalaceDoc,
  type RoomInput,
  type ServerPalaceList,
} from '../src';
import { nodeCrypto } from './helpers';

interface VectorCase {
  name: string;
  op: string;
  args: Record<string, unknown>;
  expected: { doc?: Omit<PalaceDoc, 'updated_at'>; error?: string };
}
interface Vector {
  version: number;
  contract: string;
  default_spot_positions: number[][];
  base: PalaceDoc;
  cases: VectorCase[];
  sync: { name: string; type: string; payload: unknown; expected: { code?: string } }[];
}

const VECTOR = JSON.parse(readFileSync(join(__dirname, '..', 'test-vectors', 'palace.json'), 'utf8')) as Vector;
const base = (): PalaceDoc => JSON.parse(JSON.stringify(VECTOR.base)) as PalaceDoc;
const noNewId = (): string => {
  throw new Error('vector cases give every id');
};

function run(doc: PalaceDoc, op: string, a: Record<string, unknown>): PalaceDoc {
  const s = (k: string) => a[k] as string;
  switch (op) {
    case 'place':
      return placeItem(doc, s('item_id'), s('room_id'), a.spot as number);
    case 'unplace':
      return unplaceItem(doc, s('item_id'));
    case 'add_items':
      return addItems(doc, a.items as ItemInput[], a.auto_place as boolean, noNewId);
    case 'patch_item':
      return patchItem(doc, s('item_id'), a.patch as { label?: string | null; note?: string | null });
    case 'remove_item':
      return removeItem(doc, s('item_id'));
    case 'set_rooms':
      return setRooms(doc, a.rooms as RoomInput[], noNewId);
    default:
      throw new Error(op);
  }
}

describe('palace vector (sync v1.5)', () => {
  it('shares the default spots and contract version with the API', () => {
    expect(VECTOR.version).toBe(1);
    expect(VECTOR.contract).toBe('1.5');
    expect(DEFAULT_SPOT_POSITIONS.map((p) => [...p])).toEqual(VECTOR.default_spot_positions);
  });

  it.each(VECTOR.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const doc = base();
    if (c.expected.error) {
      let code: string | null = null;
      try {
        run(doc, c.op, c.args);
      } catch (e) {
        code = e instanceof PalaceOpError ? e.code : 'thrown';
      }
      expect(code).toBe(c.expected.error);
      return;
    }
    const out = run(doc, c.op, c.args);
    const { updated_at, ...rest } = out;
    expect(updated_at).toBe(doc.updated_at);
    expect(rest).toEqual(c.expected.doc);
    expect(doc).toEqual(base()); // operations never change their input
  });

  it('refuses what the server refuses as invalid_payload', () => {
    for (const step of VECTOR.sync.filter((s) => s.type === 'palace_saved' && s.expected.code === 'invalid_payload')) {
      expect(() => validatePalace(step.payload as PalaceDoc), step.name).toThrow(PalaceOpError);
    }
    for (const step of VECTOR.sync.filter((s) => s.type === 'palace_saved' && !s.expected.code)) {
      expect(() => validatePalace(step.payload as PalaceDoc), step.name).not.toThrow();
    }
  });
});

let n = 0;
const ids = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
const T0 = Date.UTC(2026, 9, 31, 4, 0);

function setup(isPro = true) {
  const storage = new InMemoryStorage();
  let now = T0;
  const clock = () => now;
  const outbox = new Outbox({ crypto: nodeCrypto, clock, timeZone: () => 'Asia/Kolkata' });
  const scheduler = new SrsScheduler({ enableFuzz: false });
  const store = createPalaceStore({ storage, outbox, clock, newId: ids, scheduler, isPro: () => isPro });
  return { storage, outbox, scheduler, store, tick: (ms: number) => (now += ms) };
}

describe('palace documents', () => {
  it('builds from a template, with default spots for a room that has none', () => {
    const doc = createPalaceDoc(
      { name: 'Home', template: 'home', template_id: 'pt.home-basic', rooms: [{ name: 'Hall', template_room: 'hall', loci: [{ pos: { x: 0.1, y: 0.2 } }] }, { name: 'Kitchen' }] },
      '2026-10-31T04:00:00.000Z',
      ids,
    );
    expect(doc.rooms.map((r) => r.loci.length)).toEqual([1, 5]);
    expect(doc.rooms[1]!.loci.map((l) => l.pos)).toEqual(DEFAULT_SPOT_POSITIONS.map(([x, y]) => ({ x, y })));
    expect(createPalaceDoc({ name: 'Solo', template: 'custom' }, '2026-10-31T04:00:00.000Z', ids).rooms[0]!.name).toBe('Solo');
    expect(() => createPalaceDoc({ name: '', template: 'home' }, '2026-10-31T04:00:00.000Z', ids)).toThrow(PalaceOpError);
  });

  it('walks, quizzes and scores in walk order', () => {
    const doc = base();
    expect(walkStops(doc).map((s) => s.item?.item_ref ?? null)).toEqual(['kp:c.sample-list#1', 'kp:c.sample-list#2', null, null, null]);
    expect(quizItems(doc).map((i) => i.item_ref)).toEqual(['kp:c.sample-list#1', 'kp:c.sample-list#2']);
    expect(trayItems(doc).map((i) => i.item_ref)).toEqual(['kp:c.sample-list#3']);
    expect(palaceStats(doc)).toEqual({ rooms: 2, spots: 5, placed: 2, tray: 1, long: false });
    const [i1, i2] = doc.items;
    expect(orderScorePct(doc, new Map([[i1!.item_id, i1!.locus_id], [i2!.item_id, i1!.locus_id]]))).toBe(50);
  });

  it('names cards p:<item_id> and finds the next walk', () => {
    const doc = base();
    const [i1, i2] = doc.items;
    expect(palaceCardRef(i1!.item_id)).toBe(`p:${i1!.item_id}`);
    expect(isPalaceCardRef('p:x') && !isPalaceCardRef('c:x')).toBe(true);
    expect(palaceItemIdOf(`p:${i2!.item_id}`)).toBe(i2!.item_id);
    const due = new Map([
      [palaceCardRef(i1!.item_id), { due_at: '2026-11-03T00:00:00.000Z', suspended: false }],
      [palaceCardRef(i2!.item_id), { due_at: '2026-11-01T00:00:00.000Z', suspended: false }],
    ]);
    expect(nextWalkAt(doc, (r) => due.get(r))).toBe('2026-11-01T00:00:00.000Z');
    expect(nextWalkAt(doc, () => undefined)).toBeNull();
    expect(dueQuizItems(doc, (r) => due.get(r), '2026-11-02T00:00:00.000Z').map((i) => i.item_id)).toEqual([i2!.item_id]);
  });

  it('merges the server list: newer wins, pending edits stay, deletes go', () => {
    const doc = base();
    const newer = { ...doc, name: 'Newer', updated_at: '2026-10-02T00:00:00.000Z', created_at: doc.updated_at, next_walk_at: null, items: doc.items.map((i) => ({ ...i, card_ref: palaceCardRef(i.item_id), due_at: null })) };
    const list: ServerPalaceList = { palaces: [newer], deleted: [] };
    expect(mergeServerPalaces([doc], list, new Set()).upsert.map((d) => d.name)).toEqual(['Newer']);
    expect(mergeServerPalaces([doc], list, new Set([doc.palace_id])).upsert).toEqual([]);
    expect(mergeServerPalaces([{ ...doc, updated_at: '2026-10-03T00:00:00.000Z' }], list, new Set()).upsert).toEqual([]);
    expect(mergeServerPalaces([doc], { palaces: [], deleted: [doc.palace_id] }, new Set()).remove).toEqual([doc.palace_id]);
  });
});

describe('palace store and outbox', () => {
  it('saves to the device and keeps one pending palace_saved per palace', async () => {
    const { storage, store, tick } = setup();
    const doc = await store.getState().create({ name: 'Home', template: 'home', source: 'list', rooms: [{ name: 'Hall' }] });
    tick(1000);
    const filled = await store.getState().edit(doc.palace_id, (d) => addItems(d, [{ item_ref: 'kp:c.x#1' }, { item_ref: 'kp:c.x#2' }], true, ids));
    expect(Date.parse(filled.updated_at)).toBeGreaterThan(Date.parse(doc.updated_at));
    const rows = await storage.outbox.all();
    expect(rows.map((r) => r.type)).toEqual(['palace_saved']);
    expect(rows[0]!.payload).toEqual(palaceSavedPayload(filled));
    expect(await loadPalaceDoc(storage, doc.palace_id)).toEqual(filled);
    const loci = await storage.palace_loci.all();
    expect(loci.filter((l) => l.item_ref !== '').length).toBe(2);
    expect(await pendingPalaceIds(storage)).toEqual(new Set([doc.palace_id]));
  });

  it('needs Pro to build a palace', async () => {
    const { store } = setup(false);
    await expect(store.getState().create({ name: 'Home', template: 'home' })).rejects.toMatchObject({ code: 'pro_required' });
  });

  it('rates a spot as a p: card and drops cards of removed items and deleted palaces', async () => {
    const { storage, outbox, scheduler, store } = setup();
    const doc = await store.getState().create({ name: 'Home', template: 'home' });
    const filled = await store.getState().edit(doc.palace_id, (d) => addItems(d, [{ item_ref: 'kp:c.x#1' }, { item_ref: 'kp:c.x#2' }], true, ids));
    const [a, b] = filled.items;
    const card = await ratePalaceItem(storage, outbox, scheduler, { itemId: a!.item_id, rating: 3, msToAnswer: 2500.4, now: T0 });
    expect(card.card_ref).toBe(palaceCardRef(a!.item_id));
    await store.getState().rate(b!.item_id, 1, 1000);
    const rated = (await storage.outbox.all()).filter((r) => r.type === 'review_rated');
    expect(rated.map((r) => (r.payload as { card_ref: string }).card_ref)).toEqual([palaceCardRef(a!.item_id), palaceCardRef(b!.item_id)]);
    expect((rated[0]!.payload as { ms_to_answer: number }).ms_to_answer).toBe(2500);

    await store.getState().edit(doc.palace_id, (d) => removeItem(d, a!.item_id));
    expect(await storage.srs_cards.get(palaceCardRef(a!.item_id))).toBeUndefined();
    expect(await storage.srs_cards.get(palaceCardRef(b!.item_id))).toBeDefined();

    await deletePalaceDoc(storage, outbox, doc.palace_id, T0);
    expect(await storage.srs_cards.get(palaceCardRef(b!.item_id))).toBeUndefined();
    expect(await listPalaceDocs(storage)).toEqual([]);
    const types = (await storage.outbox.all()).map((r) => r.type);
    expect(types.filter((t) => t === 'palace_saved')).toEqual([]); // the unsent save went with it
    expect(types[types.length - 1]).toBe('palace_deleted');
    expect((await storage.palaces.get(doc.palace_id))?.name).toBe('');
  });

  it('applies the server list and reloads', async () => {
    const { storage, store } = setup();
    const doc = base();
    const server: ServerPalaceList = {
      palaces: [{ ...doc, created_at: doc.updated_at, next_walk_at: null, items: doc.items.map((i) => ({ ...i, card_ref: palaceCardRef(i.item_id), due_at: null })) }],
      deleted: [],
    };
    await store.getState().applyServer(server);
    expect(store.getState().palaces).toEqual([doc]);
    expect(await applyServerPalaces(storage, { palaces: [], deleted: [doc.palace_id] })).toEqual({ upserted: 0, removed: 1 });
    expect(await listPalaceDocs(storage)).toEqual([]);
  });

  it('lists the v1.5 events in the contract', () => {
    for (const t of CONTRACT_V15_EVENT_TYPES) expect(CONTRACT_V1_EVENT_TYPES).toContain(t);
  });
});
