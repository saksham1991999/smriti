/**
 * Palaces live on this device (memory-labs flow §5.6): the palace, its rooms and its filled spots
 * in the local tables, and the rest (item labels, the tray, the per-item review schedule) in one
 * key-value document per palace. There is no palace API or `palace_*` sync event yet, so nothing
 * here reaches the server; the report lists what's missing.
 *
 * Rooms come from a built-in "home" kit until room templates exist as content (`palace_template@1`,
 * gap G3): each kit room is one of the app's illustrated scenes, stored as the room's background.
 */
import type { PalaceLocusRow, PalaceRoomRow, PalaceRow, SrsCardRow } from "@smriti/app-core";
import type { Services } from "../../../boot/services";
import { parseSpot, spotKey, spotPositions, type Placement, type SpotKey } from "./logic";

type Store = Pick<Services, "storage" | "kv">;

/** The illustrated rooms a palace can use, in the order a new home palace walks them. */
export const KIT_ROOMS = [
  { art: "scene-memory-palace", name: "room_courtyard" },
  { art: "scene-pet-room", name: "room_corner" },
  { art: "scene-notebook-desk", name: "room_desk" },
] as const;
export type KitRoom = (typeof KIT_ROOMS)[number];
export const kitRoom = (art: string | null): KitRoom => KIT_ROOMS.find((r) => r.art === art) ?? KIT_ROOMS[0];

export const TEMPLATES = { home: [0, 1, 2], custom: [0] } as const;
export type TemplateId = keyof typeof TEMPLATES;

export interface PalaceExtras {
  /** Item ref → its label, in the words it had when it was added. */
  labels: Record<string, string>;
  tray: string[];
  /** Item ref → its review schedule from the palace quiz. */
  srs: Record<string, SrsCardRow>;
  source: "list" | "deck" | "mnemonics";
  /** Spot key → the student's scene note. */
  notes: Record<string, string>;
}

export interface PalaceDoc {
  palace: PalaceRow;
  rooms: PalaceRoomRow[];
  placement: Placement;
  extras: PalaceExtras;
}

const extrasKey = (id: string) => `palace.extras.${id}`;
const emptyExtras = (): PalaceExtras => ({ labels: {}, tray: [], srs: {}, source: "list", notes: {} });

async function readExtras(kv: Store["kv"], id: string): Promise<PalaceExtras> {
  try {
    const raw = await kv.get(extrasKey(id));
    return raw ? { ...emptyExtras(), ...(JSON.parse(raw) as Partial<PalaceExtras>) } : emptyExtras();
  } catch {
    return emptyExtras();
  }
}

export async function loadPalace(s: Store, id: string): Promise<PalaceDoc | null> {
  const palace = await s.storage.palaces.get(id);
  if (!palace || palace.deleted_at) return null;
  const rooms = (await s.storage.palace_rooms.where({ palace_id: id })).sort((a, b) => a.sort - b.sort);
  const loci = (await Promise.all(rooms.map((r) => s.storage.palace_loci.where({ room_id: r.id })))).flat();
  const extras = await readExtras(s.kv, id);
  const placed: Record<SpotKey, string> = {};
  for (const l of loci) placed[spotKey(l.room_id, l.sort)] = l.item_ref;
  return { palace, rooms, placement: { placed, tray: extras.tray }, extras };
}

/** Writes the whole palace: small enough that a full rewrite of its spots is simplest. */
export async function savePalace(s: Store, doc: PalaceDoc): Promise<PalaceDoc> {
  const now = new Date().toISOString();
  const palace = { ...doc.palace, updated_at: now };
  await s.storage.palaces.put(palace);
  await s.storage.palace_rooms.putMany(doc.rooms);
  for (const r of doc.rooms) {
    const old = await s.storage.palace_loci.where({ room_id: r.id });
    await s.storage.palace_loci.deleteMany(old.map((l) => l.id));
  }
  const positions = spotPositions();
  const loci: PalaceLocusRow[] = (Object.keys(doc.placement.placed) as SpotKey[]).map((key) => {
    const { roomId, index } = parseSpot(key);
    return {
      id: `${roomId}-${index}`,
      room_id: roomId,
      sort: index,
      pos: positions[index] ?? { x: 0.5, y: 0.5 },
      item_ref: doc.placement.placed[key] as string,
      note: doc.extras.notes[key] ?? null,
      image_asset_id: null,
    };
  });
  await s.storage.palace_loci.putMany(loci);
  const extras = { ...doc.extras, tray: doc.placement.tray };
  await s.kv.set(extrasKey(palace.id), JSON.stringify(extras));
  return { ...doc, palace, extras };
}

export function newRoom(palaceId: string, kit: KitRoom, name: string, sort: number): PalaceRoomRow {
  return { id: crypto.randomUUID(), palace_id: palaceId, name, sort, background_asset_id: kit.art };
}

export async function createPalace(
  s: Store,
  args: { name: string; template: TemplateId; roomName: (kit: KitRoom) => string; items: { ref: string; label: string }[]; source: PalaceExtras["source"] },
): Promise<PalaceDoc> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const palace: PalaceRow = { id, name: args.name, template: args.template, pano_asset_id: null, created_at: now, updated_at: now, deleted_at: null };
  const rooms = TEMPLATES[args.template].map((k, i) => {
    const kit = KIT_ROOMS[k] as KitRoom;
    return newRoom(id, kit, args.roomName(kit), i);
  });
  const extras: PalaceExtras = { ...emptyExtras(), source: args.source, labels: Object.fromEntries(args.items.map((i) => [i.ref, i.label])), tray: args.items.map((i) => i.ref) };
  return savePalace(s, { palace, rooms, placement: { placed: {}, tray: extras.tray }, extras });
}

export async function deletePalace(s: Store, doc: PalaceDoc): Promise<void> {
  await s.storage.palaces.put({ ...doc.palace, deleted_at: new Date().toISOString() });
  await s.kv.delete(extrasKey(doc.palace.id));
}

export async function listPalaces(s: Store): Promise<PalaceDoc[]> {
  const rows = (await s.storage.palaces.all()).filter((p) => !p.deleted_at).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const docs = await Promise.all(rows.map((p) => loadPalace(s, p.id)));
  return docs.filter((d): d is PalaceDoc => d !== null);
}
