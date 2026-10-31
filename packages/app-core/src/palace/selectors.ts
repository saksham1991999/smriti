/**
 * Read-only views of a palace for MEM-12 to MEM-18: the walk, the quiz order, "next walk due",
 * and the merge of `GET /v1/palaces` into the device copy.
 */
import type { SrsCardRow } from '../storage/types';
import { walkLoci } from './ops';
import { PALACE_LIMITS, type PalaceDoc, type PalaceItem, type PalaceLocus, type PalaceRoom, type ServerPalace, type ServerPalaceList } from './types';

/** (sync v1.5) The FSRS card of a palace item. */
export const palaceCardRef = (itemId: string): string => `p:${itemId}`;
export const isPalaceCardRef = (ref: string): boolean => ref.startsWith('p:');
/** The item behind a `p:` card ref, or null. */
export const palaceItemIdOf = (ref: string): string | null => (isPalaceCardRef(ref) && ref.length > 2 ? ref.slice(2) : null);

export interface WalkStop {
  room: PalaceRoom;
  locus: PalaceLocus;
  /** 0-based position along the whole walk. */
  index: number;
  item: PalaceItem | null;
}

/** MEM-17: every spot in walk order with what sits on it. */
export function walkStops(doc: PalaceDoc): WalkStop[] {
  const byLocus = new Map(doc.items.filter((i) => i.locus_id !== null).map((i) => [i.locus_id as string, i]));
  const roomOf = new Map(doc.rooms.flatMap((r) => r.loci.map((l) => [l.locus_id, r] as const)));
  return walkLoci(doc).map((locus, index) => ({ room: roomOf.get(locus.locus_id) as PalaceRoom, locus, index, item: byLocus.get(locus.locus_id) ?? null }));
}

/** MEM-18 "What's here?": the placed items in walk order (the tray isn't quizzed). */
export function quizItems(doc: PalaceDoc): PalaceItem[] {
  return walkStops(doc).flatMap((s) => (s.item ? [s.item] : []));
}

/** Items still in the tray, in tray order. */
export const trayItems = (doc: PalaceDoc): PalaceItem[] => doc.items.filter((i) => i.locus_id === null);

export interface PalaceStats {
  rooms: number;
  spots: number;
  placed: number;
  tray: number;
  /** Above 30 items the builder suggests splitting (memory-labs §5.6). */
  long: boolean;
}

export function palaceStats(doc: PalaceDoc): PalaceStats {
  const placed = doc.items.filter((i) => i.locus_id !== null).length;
  return {
    rooms: doc.rooms.length,
    spots: doc.rooms.reduce((n, r) => n + r.loci.length, 0),
    placed,
    tray: doc.items.length - placed,
    long: doc.items.length > PALACE_LIMITS.longPalaceItems,
  };
}

/** MEM-18 "Put them back": the share of items placed on their own spot, 0 to 100. */
export function orderScorePct(doc: PalaceDoc, answers: ReadonlyMap<string, string | null>): number {
  const placed = doc.items.filter((i) => i.locus_id !== null);
  if (placed.length === 0) return 0;
  const right = placed.filter((i) => answers.get(i.item_id) === i.locus_id).length;
  return Math.round((right / placed.length) * 100);
}

type DueLookup = (cardRef: string) => Pick<SrsCardRow, 'due_at' | 'suspended'> | undefined;

/** MEM-12 "next walk due": the earliest due placed item; null before the first quiz. */
export function nextWalkAt(doc: PalaceDoc, srs: DueLookup): string | null {
  let best: string | null = null;
  for (const item of quizItems(doc)) {
    const card = srs(palaceCardRef(item.item_id));
    if (!card || card.suspended) continue;
    if (best === null || Date.parse(card.due_at) < Date.parse(best)) best = card.due_at;
  }
  return best;
}

/** Placed items whose card is due by `nowIso` (a palace quiz of due spots only). */
export function dueQuizItems(doc: PalaceDoc, srs: DueLookup, nowIso: string): PalaceItem[] {
  const now = Date.parse(nowIso);
  return quizItems(doc).filter((i) => {
    const card = srs(palaceCardRef(i.item_id));
    return card !== undefined && !card.suspended && Date.parse(card.due_at) <= now;
  });
}

/** The document part of a server palace (drops `card_ref`, `due_at`, `created_at`, `next_walk_at`). */
export function docOfServerPalace(p: ServerPalace): PalaceDoc {
  return {
    palace_id: p.palace_id,
    name: p.name,
    template: p.template,
    template_id: p.template_id ?? null,
    source: p.source ?? null,
    rooms: p.rooms.map((r) => ({ ...r, template_room: r.template_room ?? null, loci: r.loci.map((l) => ({ ...l })) })),
    items: p.items.map((i) => ({ item_id: i.item_id, item_ref: i.item_ref, label: i.label ?? null, note: i.note ?? null, locus_id: i.locus_id ?? null })),
    updated_at: p.updated_at,
  };
}

export interface PalaceMerge {
  /** Server copies newer than the device's (or new to it): write them. */
  upsert: PalaceDoc[];
  /** Deleted on another device: remove them here. */
  remove: string[];
}

/**
 * Merges `GET /v1/palaces` into the device copy. The newer `updated_at` wins, a palace with an
 * unsent edit or delete in the outbox (`pending`) is left alone (the outbox will win or lose on
 * the server), and a palace deleted elsewhere goes.
 */
export function mergeServerPalaces(local: readonly PalaceDoc[], server: ServerPalaceList, pending: ReadonlySet<string>): PalaceMerge {
  const mine = new Map(local.map((d) => [d.palace_id, d]));
  const upsert: PalaceDoc[] = [];
  for (const p of server.palaces) {
    if (pending.has(p.palace_id)) continue;
    const here = mine.get(p.palace_id);
    if (!here || Date.parse(p.updated_at) > Date.parse(here.updated_at)) upsert.push(docOfServerPalace(p));
  }
  const remove = server.deleted.filter((id) => mine.has(id) && !pending.has(id));
  return { upsert, remove };
}
