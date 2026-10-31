import type { PalaceLocusRow, PalaceRoomRow, PalaceRow } from '@smriti/app-core';

import type { SmritiApp } from '../../services/app';
import { loadTopicStates } from '../../services/progress';

/**
 * Memory palaces (MEM-12 to MEM-18, memory-labs flow §5.6). Palaces live in the profile
 * database (`palaces`, `palace_rooms`, `palace_loci`) and work fully offline.
 *
 * Items come from content, never typed in here: a list mnemonic's `decodes_to` items from a
 * topic the learner has learned ("From a topic", MEM-15). A locus stores the item as
 * `mnemonic:{topicId}:{mnemonicId}:{index}`, so its label is read from the bundle in the app's
 * language each time. An empty spot has an empty `item_ref`.
 */
export type PalaceTemplate = 'home' | 'school' | 'custom';
export const SPOTS_PER_ROOM = 4;

export interface PalaceSource {
  /** `mnemonic:{topicId}:{mnemonicId}` */
  id: string;
  topicId: string;
  topicName: string;
  items: { ref: string; label: string }[];
}

export interface PalaceSummary {
  palace: PalaceRow;
  rooms: number;
  items: number;
}

export interface Spot {
  locus: PalaceLocusRow;
  room: PalaceRoomRow;
  /** 1-based, in walk order across rooms. */
  n: number;
  label: string | null;
}

export interface PalaceModel {
  palace: PalaceRow;
  rooms: PalaceRoomRow[];
  spots: Spot[];
  /** Items chosen for the palace that are not on a spot yet. */
  unplaced: { ref: string; label: string }[];
}

const UNPLACED_KEY = (id: string) => `palace.unplaced.${id}`;

function locale(app: SmritiApp) {
  return app.ui.getState().locale;
}

/** "From a topic": list mnemonics (two or more items, in order) from learned topics on the device. */
export async function palaceSources(app: SmritiApp): Promise<PalaceSource[]> {
  const states = await loadTopicStates(app);
  const out: PalaceSource[] = [];
  for (const s of states.values()) {
    if (s.status !== 'learned') continue;
    const loaded = app.deps.content.load(locale(app), s.topic.id, 'deep_dive', app.examProfileId());
    for (const m of Object.values(loaded?.bundle.mnemonics ?? {})) {
      if (m.decodes_to.length < 2) continue;
      const id = `mnemonic:${s.topic.id}:${m.id}`;
      out.push({ id, topicId: s.topic.id, topicName: s.topic.name, items: m.decodes_to.map((label, i) => ({ ref: `${id}:${i}`, label })) });
    }
  }
  return out;
}

/** The item's label in the current language, or null when the content no longer has it. */
export function itemLabel(app: SmritiApp, ref: string): string | null {
  const m = /^mnemonic:([^:]+):([^:]+):(\d+)$/.exec(ref);
  if (!m) return null;
  const loaded = app.deps.content.load(locale(app), m[1]!, 'deep_dive', app.examProfileId());
  return loaded?.bundle.mnemonics[m[2]!]?.decodes_to[Number(m[3])] ?? null;
}

export async function listPalaces(app: SmritiApp): Promise<PalaceSummary[]> {
  const db = app.deps.stores.storage;
  const palaces = (await db.palaces.all()).filter((p) => !p.deleted_at).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const rooms = await db.palace_rooms.all();
  const loci = await db.palace_loci.all();
  return palaces.map((palace) => {
    const mine = rooms.filter((r) => r.palace_id === palace.id);
    const ids = new Set(mine.map((r) => r.id));
    return { palace, rooms: mine.length, items: loci.filter((l) => ids.has(l.room_id) && l.item_ref).length };
  });
}

/** Creates the palace with enough rooms of four spots for the items, all waiting in the tray. */
export async function createPalace(app: SmritiApp, input: { name: string; template: PalaceTemplate; items: string[] }): Promise<string> {
  const now = new Date(app.deps.clock()).toISOString();
  const id = app.newId();
  const roomCount = Math.max(1, Math.ceil(input.items.length / SPOTS_PER_ROOM));
  await app.deps.stores.storage.transaction(async (tx) => {
    await tx.palaces.put({ id, name: input.name.trim().slice(0, 60), template: input.template, pano_asset_id: null, created_at: now, updated_at: now, deleted_at: null });
    for (let r = 0; r < roomCount; r++) {
      const roomId = app.newId();
      // Room names are shown as "Room {n}" in the app's language; a renamed room stores its name.
      await tx.palace_rooms.put({ id: roomId, palace_id: id, name: '', sort: r, background_asset_id: null });
      for (let s = 0; s < SPOTS_PER_ROOM; s++) {
        await tx.palace_loci.put({ id: app.newId(), room_id: roomId, sort: s, pos: { x: (s % 2) * 0.5 + 0.25, y: Math.floor(s / 2) * 0.5 + 0.25 }, item_ref: '', note: null, image_asset_id: null });
      }
    }
    await tx.session_state.put({ key: UNPLACED_KEY(id), data: input.items, updated_at: now });
  });
  app.track('palace_created', { palace_id: id, template: input.template });
  return id;
}

export async function loadPalace(app: SmritiApp, id: string): Promise<PalaceModel | null> {
  const db = app.deps.stores.storage;
  const palace = await db.palaces.get(id);
  if (!palace || palace.deleted_at) return null;
  const rooms = (await db.palace_rooms.where({ palace_id: id })).sort((a, b) => a.sort - b.sort);
  const spots: Spot[] = [];
  for (const room of rooms) {
    const loci = (await db.palace_loci.where({ room_id: room.id })).sort((a, b) => a.sort - b.sort);
    for (const locus of loci) spots.push({ locus, room, n: spots.length + 1, label: locus.item_ref ? itemLabel(app, locus.item_ref) : null });
  }
  const queued = ((await db.session_state.get(UNPLACED_KEY(id)))?.data as string[] | undefined) ?? [];
  const unplaced = queued.map((ref) => ({ ref, label: itemLabel(app, ref) })).filter((i): i is { ref: string; label: string } => i.label !== null);
  return { palace, rooms, spots, unplaced };
}

async function write(app: SmritiApp, model: PalaceModel, spots: Spot[], unplaced: string[]) {
  const now = new Date(app.deps.clock()).toISOString();
  await app.deps.stores.storage.transaction(async (tx) => {
    for (const s of spots) await tx.palace_loci.put(s.locus);
    await tx.session_state.put({ key: UNPLACED_KEY(model.palace.id), data: unplaced, updated_at: now });
    await tx.palaces.put({ ...model.palace, updated_at: now });
  });
}

/**
 * Puts an item (from the tray, or from another spot) on a spot. A filled target swaps: its item
 * goes where the moved one came from (the tray or the other spot).
 */
export async function placeItem(app: SmritiApp, model: PalaceModel, itemRef: string, locusId: string): Promise<void> {
  const target = model.spots.find((s) => s.locus.id === locusId);
  if (!target) return;
  const from = model.spots.find((s) => s.locus.item_ref === itemRef);
  const tray = model.unplaced.map((i) => i.ref).filter((r) => r !== itemRef);
  const displaced = target.locus.item_ref;
  const changed: Spot[] = [{ ...target, locus: { ...target.locus, item_ref: itemRef } }];
  if (from && from.locus.id !== locusId) changed.push({ ...from, locus: { ...from.locus, item_ref: displaced } });
  else if (displaced) tray.unshift(displaced);
  await write(app, model, changed, tray);
}

/** Auto-place: tray items onto the empty spots in walk order. */
export async function autoPlace(app: SmritiApp, model: PalaceModel): Promise<void> {
  const tray = model.unplaced.map((i) => i.ref);
  const changed: Spot[] = [];
  for (const s of model.spots) {
    if (s.locus.item_ref || !tray.length) continue;
    changed.push({ ...s, locus: { ...s.locus, item_ref: tray.shift()! } });
  }
  await write(app, model, changed, tray);
}

/** The spots that hold an item, in walk order (MEM-17 and MEM-18 walk only these). */
export function filledSpots(model: PalaceModel): (Spot & { label: string })[] {
  return model.spots.filter((s): s is Spot & { label: string } => !!s.locus.item_ref && s.label !== null);
}
