/**
 * Palace document operations, pure: each takes a palace and returns the next one (or throws a
 * `PalaceOpError`). They are the API's `services/palaces.py` operations, kept in step by the
 * shared vector `test-vectors/palace.json`. None of them changes `updated_at`: the store stamps
 * it when it saves (`savePalace`).
 */
import {
  DEFAULT_SPOT_POSITIONS,
  PALACE_LIMITS,
  type PalaceDoc,
  type PalaceItem,
  type PalaceLocus,
  type PalacePos,
  type PalaceRoom,
  type PalaceSource,
  type PalaceTemplateKind,
} from './types';

export type PalaceOpErrorCode =
  | 'invalid_palace'
  | 'room_not_found'
  | 'spot_not_found'
  | 'item_not_found'
  | 'item_exists'
  | 'too_many_items'
  | 'pro_required'
  | 'palace_not_found';

export class PalaceOpError extends Error {
  constructor(
    readonly code: PalaceOpErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = 'PalaceOpError';
  }
}

export type NewId = () => string;

/** A room to create or keep: spots from the template the client loaded, in walk order. */
export interface RoomInput {
  /** An existing room's id keeps it (and its spots unless `loci` is given); none makes a new room. */
  room_id?: string | null;
  name: string;
  template_room?: string | null;
  loci?: { locus_id?: string | null; pos: PalacePos }[];
}

export interface ItemInput {
  item_id?: string | null;
  item_ref: string;
  label?: string | null;
}

export interface CreatePalaceInput {
  palace_id?: string | null;
  name: string;
  template: PalaceTemplateKind;
  template_id?: string | null;
  source?: PalaceSource | null;
  /** Empty makes one room named after the palace. */
  rooms?: RoomInput[];
}

const ITEM_REF = /^[A-Za-z0-9_.:#-]{1,240}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TEMPLATE_ID = /^pt\.[a-z0-9]+(-[a-z0-9]+)*$/;
const TEMPLATES: readonly PalaceTemplateKind[] = ['home', 'school', 'monument', 'pano360', 'custom'];
const SOURCES: readonly PalaceSource[] = ['list', 'topic', 'deck', 'mnemonics'];

const fail = (detail: string): never => {
  throw new PalaceOpError('invalid_palace', detail);
};

function checkPos(pos: PalacePos): void {
  if ('x' in pos) {
    if (!(pos.x >= 0 && pos.x <= 1 && pos.y >= 0 && pos.y <= 1)) fail('a spot is off the picture');
  } else if (!(pos.yaw >= -180 && pos.yaw <= 180 && pos.pitch >= -90 && pos.pitch <= 90)) {
    fail('a spot is outside the scene');
  }
}

const textOk = (s: string | null, max: number, allowEmpty: boolean) =>
  s === null || (s.length <= max && (allowEmpty || s.length > 0));

/** Throws `invalid_palace` for anything the server would reject as `invalid_payload`. */
export function validatePalace(doc: PalaceDoc): PalaceDoc {
  if (!textOk(doc.name, PALACE_LIMITS.nameLength, false)) fail('name');
  if (!TEMPLATES.includes(doc.template)) fail('template');
  if (doc.template_id !== null && !TEMPLATE_ID.test(doc.template_id)) fail('template_id');
  if (doc.source !== null && !SOURCES.includes(doc.source)) fail('source');
  if (doc.rooms.length < 1 || doc.rooms.length > PALACE_LIMITS.rooms) fail('a palace has 1 to 20 rooms');
  if (doc.items.length > PALACE_LIMITS.items) fail('a palace holds at most 200 items');
  if (new Set(doc.rooms.map((r) => r.room_id)).size !== doc.rooms.length) fail('room ids repeat');
  if (new Set(doc.rooms.map((r) => r.sort)).size !== doc.rooms.length) fail('room sort values repeat');
  const spots = new Set<string>();
  for (const r of doc.rooms) {
    if (!textOk(r.name, PALACE_LIMITS.nameLength, false)) fail('room name');
    if (r.sort < 0 || r.sort >= PALACE_LIMITS.rooms || !Number.isInteger(r.sort)) fail('room sort');
    if (r.template_room !== null && !SLUG.test(r.template_room)) fail('template_room');
    if (r.loci.length < 1 || r.loci.length > PALACE_LIMITS.spotsPerRoom) fail('a room has 1 to 20 spots');
    if (new Set(r.loci.map((l) => l.sort)).size !== r.loci.length) fail('spot sort values repeat in a room');
    for (const l of r.loci) {
      if (l.sort < 0 || l.sort >= PALACE_LIMITS.spotsPerRoom || !Number.isInteger(l.sort)) fail('spot sort');
      checkPos(l.pos);
      if (spots.has(l.locus_id)) fail('spot ids repeat');
      spots.add(l.locus_id);
    }
  }
  if (new Set(doc.items.map((i) => i.item_id)).size !== doc.items.length) fail('item ids repeat');
  const placed: string[] = [];
  for (const i of doc.items) {
    if (!ITEM_REF.test(i.item_ref)) fail('item_ref');
    if (!textOk(i.label, PALACE_LIMITS.labelLength, false)) fail('label');
    if (!textOk(i.note, PALACE_LIMITS.noteLength, true)) fail('note');
    if (i.locus_id !== null) placed.push(i.locus_id);
  }
  if (placed.some((l) => !spots.has(l))) fail("an item sits on a spot that isn't in this palace");
  if (new Set(placed).size !== placed.length) fail('two items sit on one spot');
  return doc;
}

export function defaultLoci(newId: NewId): PalaceLocus[] {
  return DEFAULT_SPOT_POSITIONS.map(([x, y], sort) => ({ locus_id: newId(), sort, pos: { x, y } }));
}

function buildRoom(room: RoomInput, sort: number, existing: PalaceRoom | undefined, newId: NewId): PalaceRoom {
  let loci: PalaceLocus[];
  if (room.loci && room.loci.length > 0) {
    loci = room.loci.map((l, i) => ({ locus_id: l.locus_id ?? newId(), sort: i, pos: { ...l.pos } }));
  } else if (existing) {
    loci = existing.loci.map((l) => ({ ...l, pos: { ...l.pos } }));
  } else {
    loci = defaultLoci(newId);
  }
  return { room_id: room.room_id ?? newId(), name: room.name, sort, template_room: room.template_room ?? null, loci };
}

/** A new palace from the template the client loaded (`palace_template@1` rooms and spots). */
export function createPalaceDoc(input: CreatePalaceInput, nowIso: string, newId: NewId): PalaceDoc {
  const rooms = input.rooms && input.rooms.length > 0 ? input.rooms : [{ name: input.name }];
  return validatePalace({
    palace_id: input.palace_id ?? newId(),
    name: input.name,
    template: input.template,
    template_id: input.template_id ?? null,
    source: input.source ?? null,
    rooms: rooms.map((r, i) => buildRoom(r, i, undefined, newId)),
    items: [],
    updated_at: nowIso,
  });
}

/** Every spot in walk order: rooms by their order, spots by theirs. */
export function walkLoci(doc: PalaceDoc): PalaceLocus[] {
  return [...doc.rooms].sort((a, b) => a.sort - b.sort).flatMap((r) => [...r.loci].sort((a, b) => a.sort - b.sort));
}

const items = (doc: PalaceDoc): PalaceItem[] => doc.items.map((i) => ({ ...i }));

function findItem(list: PalaceItem[], itemId: string): PalaceItem {
  const item = list.find((i) => i.item_id === itemId);
  if (!item) throw new PalaceOpError('item_not_found');
  return item;
}

/** The new walk, whole. Rooms named by id are kept; items on spots that went return to the tray. */
export function setRooms(doc: PalaceDoc, rooms: RoomInput[], newId: NewId): PalaceDoc {
  const existing = new Map(doc.rooms.map((r) => [r.room_id, r]));
  for (const r of rooms) if (r.room_id && !existing.has(r.room_id)) throw new PalaceOpError('room_not_found');
  const next = rooms.map((r, i) => buildRoom(r, i, r.room_id ? existing.get(r.room_id) : undefined, newId));
  const spots = new Set(next.flatMap((r) => r.loci.map((l) => l.locus_id)));
  return validatePalace({
    ...doc,
    rooms: next,
    items: items(doc).map((i) => ({ ...i, locus_id: i.locus_id !== null && spots.has(i.locus_id) ? i.locus_id : null })),
  });
}

export interface PalaceUpdate {
  name?: string;
  source?: PalaceSource | null;
  rooms?: RoomInput[];
}

/** Rename, change the source, or set the walk (PATCH /v1/palaces/{id}). */
export function updatePalace(doc: PalaceDoc, update: PalaceUpdate, newId: NewId): PalaceDoc {
  let next = update.rooms !== undefined ? setRooms(doc, update.rooms, newId) : doc;
  if (update.name !== undefined || 'source' in update) {
    next = validatePalace({
      ...next,
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...('source' in update ? { source: update.source ?? null } : {}),
    });
  }
  return next;
}

/** Adds items to the tray, or with `autoPlace` onto the free spots in walk order (the rest stay in the tray). */
export function addItems(doc: PalaceDoc, add: ItemInput[], autoPlace: boolean, newId: NewId): PalaceDoc {
  const current = items(doc);
  if (current.length + add.length > PALACE_LIMITS.items) throw new PalaceOpError('too_many_items');
  const known = new Set(current.map((i) => i.item_id));
  if (add.some((i) => i.item_id && known.has(i.item_id))) throw new PalaceOpError('item_exists');
  const taken = new Set(current.map((i) => i.locus_id).filter((l): l is string => l !== null));
  const free = autoPlace ? walkLoci(doc).map((l) => l.locus_id).filter((l) => !taken.has(l)) : [];
  const added = add.map((i, n) => ({
    item_id: i.item_id ?? newId(),
    item_ref: i.item_ref,
    label: i.label ?? null,
    note: null,
    locus_id: free[n] ?? null,
  }));
  return validatePalace({ ...doc, items: [...current, ...added] });
}

/** Puts an item on a spot. An item already there swaps to where this one was (or the tray). */
export function placeItem(doc: PalaceDoc, itemId: string, roomId: string, spot: number): PalaceDoc {
  const room = doc.rooms.find((r) => r.room_id === roomId);
  if (!room) throw new PalaceOpError('room_not_found');
  const locus = room.loci.find((l) => l.sort === spot);
  if (!locus) throw new PalaceOpError('spot_not_found');
  const list = items(doc);
  const item = findItem(list, itemId);
  const before = item.locus_id;
  for (const other of list) if (other !== item && other.locus_id === locus.locus_id) other.locus_id = before;
  item.locus_id = locus.locus_id;
  return validatePalace({ ...doc, items: list });
}

export function unplaceItem(doc: PalaceDoc, itemId: string): PalaceDoc {
  const list = items(doc);
  findItem(list, itemId).locus_id = null;
  return validatePalace({ ...doc, items: list });
}

/** Changes an item's label or link note (MEM-16); null or an empty note clears it. */
export function patchItem(doc: PalaceDoc, itemId: string, patch: { label?: string | null; note?: string | null }): PalaceDoc {
  const list = items(doc);
  const item = findItem(list, itemId);
  if ('label' in patch) item.label = patch.label ?? null;
  if ('note' in patch) item.note = patch.note || null;
  return validatePalace({ ...doc, items: list });
}

export function removeItem(doc: PalaceDoc, itemId: string): PalaceDoc {
  const list = items(doc);
  findItem(list, itemId);
  return validatePalace({ ...doc, items: list.filter((i) => i.item_id !== itemId) });
}
