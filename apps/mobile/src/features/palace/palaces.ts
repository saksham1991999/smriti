import {
  PALACE_LIMITS,
  addItems,
  createPalaceDoc,
  listPalaceDocs,
  loadPalaceDoc,
  palaceStats,
  placeItem as placeDocItem,
  ratePalaceItem,
  savePalaceDoc,
  walkLoci,
  type PalaceDoc,
  type PalaceItem,
  type PalaceRoom,
  type ReviewRating,
} from '@smriti/app-core';

import type { SmritiApp } from '../../services/app';
import { loadTopicStates } from '../../services/progress';
import { Reviews } from '../../services/reviews';

/**
 * Memory palaces (MEM-12 to MEM-18, memory-labs flow §5.6) on app-core's palace documents: the
 * device copy lives in the profile database (`palaces`, `palace_rooms`, `palace_loci`), every
 * change is saved with its `palace_saved` sync event in one transaction (`savePalaceDoc`), and
 * MEM-18 ratings schedule each item's `p:` card with the device FSRS (`ratePalaceItem`). Web
 * shares the same module, so a palace built on one syncs to the other.
 *
 * Items come from content, never typed in here: a list mnemonic's `decodes_to` items from a
 * topic the learner has learned ("From a topic", MEM-15). An item's ref is
 * `mnemonic:{topicId}:{mnemonicId}:{index}`, so its label is read from the bundle in the app's
 * language each time; the stored label is the fallback when the content no longer has it.
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
  palace: PalaceDoc;
  rooms: number;
  items: number;
}

export interface Spot {
  locusId: string;
  room: PalaceRoom;
  /** 1-based, in walk order across rooms. */
  n: number;
  /** The item on this spot, if any. */
  item: PalaceItem | null;
  label: string | null;
}

export interface PalaceModel {
  palace: PalaceDoc;
  rooms: PalaceRoom[];
  spots: Spot[];
  /** Items chosen for the palace that are not on a spot yet (the tray). */
  unplaced: { id: string; ref: string; label: string }[];
}

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

const labelOf = (app: SmritiApp, item: PalaceItem) => itemLabel(app, item.item_ref) ?? item.label;

export async function listPalaces(app: SmritiApp): Promise<PalaceSummary[]> {
  const docs = await listPalaceDocs(app.deps.stores.storage);
  return docs.map((palace) => {
    const s = palaceStats(palace);
    return { palace, rooms: palace.rooms.length, items: s.placed };
  });
}

/**
 * Creates the palace with enough rooms of four spots for the items, all waiting in the tray.
 * `roomName(n)` names room n (1-based) in the app's language; the learner can rename it later.
 */
export async function createPalace(app: SmritiApp, input: { name: string; template: PalaceTemplate; items: string[]; roomName: (n: number) => string }): Promise<string> {
  const now = app.now();
  const roomCount = Math.max(1, Math.ceil(input.items.length / SPOTS_PER_ROOM));
  const spots = Array.from({ length: SPOTS_PER_ROOM }, (_, s) => ({ pos: { x: (s % 2) * 0.5 + 0.25, y: Math.floor(s / 2) * 0.5 + 0.25 } }));
  const rooms = Array.from({ length: roomCount }, (_, r) => ({ name: input.roomName(r + 1), loci: spots }));
  let doc = createPalaceDoc({ name: input.name.trim().slice(0, PALACE_LIMITS.nameLength), template: input.template, source: 'mnemonics', rooms }, new Date(now).toISOString(), app.newId);
  doc = addItems(doc, input.items.map((ref) => ({ item_ref: ref, label: itemLabel(app, ref) })), false, app.newId);
  const saved = await savePalaceDoc(app.deps.stores.storage, app.outbox, doc, now);
  app.track('palace_created', { palace_id: saved.palace_id, template: input.template });
  void app.syncNow().catch(() => undefined);
  return saved.palace_id;
}

function model(app: SmritiApp, palace: PalaceDoc): PalaceModel {
  const rooms = [...palace.rooms].sort((a, b) => a.sort - b.sort);
  const roomOf = new Map(rooms.flatMap((r) => r.loci.map((l) => [l.locus_id, r] as const)));
  const onSpot = new Map(palace.items.filter((i) => i.locus_id !== null).map((i) => [i.locus_id as string, i]));
  const spots = walkLoci(palace).map((l, k): Spot => {
    const item = onSpot.get(l.locus_id) ?? null;
    return { locusId: l.locus_id, room: roomOf.get(l.locus_id)!, n: k + 1, item, label: item ? labelOf(app, item) : null };
  });
  const unplaced = palace.items
    .filter((i) => i.locus_id === null)
    .map((i) => ({ id: i.item_id, ref: i.item_ref, label: labelOf(app, i) }))
    .filter((i): i is { id: string; ref: string; label: string } => i.label !== null);
  return { palace, rooms, spots, unplaced };
}

export async function loadPalace(app: SmritiApp, id: string): Promise<PalaceModel | null> {
  const doc = await loadPalaceDoc(app.deps.stores.storage, id);
  return doc ? model(app, doc) : null;
}

async function save(app: SmritiApp, doc: PalaceDoc): Promise<void> {
  await savePalaceDoc(app.deps.stores.storage, app.outbox, doc, app.now());
  void app.syncNow().catch(() => undefined);
}

/**
 * Puts an item (from the tray, or from another spot) on a spot. A filled target swaps: its item
 * goes where the moved one came from (the tray or the other spot).
 */
export async function placeItem(app: SmritiApp, m: PalaceModel, itemId: string, locusId: string): Promise<void> {
  const target = m.spots.find((s) => s.locusId === locusId);
  if (!target) return;
  const spot = target.room.loci.find((l) => l.locus_id === locusId)!.sort;
  await save(app, placeDocItem(m.palace, itemId, target.room.room_id, spot));
}

/** Auto-place: tray items onto the empty spots in walk order. */
export async function autoPlace(app: SmritiApp, m: PalaceModel): Promise<void> {
  let doc = m.palace;
  const tray = m.unplaced.map((i) => i.id);
  for (const s of m.spots) {
    if (s.item || !tray.length) continue;
    const spot = s.room.loci.find((l) => l.locus_id === s.locusId)!.sort;
    doc = placeDocItem(doc, tray.shift()!, s.room.room_id, spot);
  }
  await save(app, doc);
}

/** The spots that hold an item, in walk order (MEM-17 and MEM-18 walk only these). */
export function filledSpots(m: PalaceModel): (Spot & { item: PalaceItem; label: string })[] {
  return m.spots.filter((s): s is Spot & { item: PalaceItem; label: string } => s.item !== null && s.label !== null);
}

/** MEM-18: rates one item's recall, which schedules its `p:` review card and counts as a review. */
export async function rateItem(app: SmritiApp, itemId: string, rating: ReviewRating, msToAnswer: number): Promise<void> {
  const scheduler = new Reviews(app).scheduler;
  await ratePalaceItem(app.deps.stores.storage, app.outbox, scheduler, { itemId, rating, msToAnswer, now: app.now() });
  void app.syncNow().catch(() => undefined);
}
