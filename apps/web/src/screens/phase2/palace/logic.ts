/**
 * Memory palace rules (MEM-12 to MEM-18), kept free of React so they're tested on their own.
 * A room has a fixed number of spots laid out along a zig-zag walk path; a placement maps
 * "<room id>:<spot index>" to an item ref. Items not on a spot wait in the tray.
 */
import type { SrsCardRow } from "@smriti/app-core";

export const SPOTS_PER_ROOM = 5;
/** Palaces longer than this are hard to walk (MEM-14 `too_long`). */
export const LONG_PALACE = 20;

export type SpotKey = `${string}:${number}`;
export interface Placement {
  placed: Record<SpotKey, string>;
  tray: string[];
}
export interface Pos {
  x: number;
  y: number;
}

export const spotKey = (roomId: string, index: number): SpotKey => `${roomId}:${index}`;
export function parseSpot(key: string): { roomId: string; index: number } {
  const at = key.lastIndexOf(":");
  return { roomId: key.slice(0, at), index: Number(key.slice(at + 1)) };
}

/**
 * Spot positions as fractions of the room image: left to right, alternating low and high so the
 * walk path zig-zags across the floor and the markers never overlap.
 */
export function spotPositions(n: number = SPOTS_PER_ROOM): Pos[] {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0.5, y: 0.62 }];
  const left = 0.14;
  const span = 0.72;
  return Array.from({ length: n }, (_, i) => ({ x: round(left + (span * i) / (n - 1)), y: i % 2 === 0 ? 0.7 : 0.42 }));
}
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Every spot of the palace in walk order (rooms by `sort`, then spot index). */
export function allSpots(rooms: readonly { id: string; sort: number }[], perRoom = SPOTS_PER_ROOM): SpotKey[] {
  return [...rooms].sort((a, b) => a.sort - b.sort).flatMap((r) => Array.from({ length: perRoom }, (_, i) => spotKey(r.id, i)));
}

function locate(p: Placement, ref: string): SpotKey | "tray" | null {
  if (p.tray.includes(ref)) return "tray";
  const hit = (Object.keys(p.placed) as SpotKey[]).find((k) => p.placed[k] === ref);
  return hit ?? null;
}

/**
 * Puts `ref` on `key`. It leaves the tray or its old spot; an item already on `key` swaps into the
 * place `ref` came from (MEM-14: dropping on a filled spot swaps the two items).
 */
export function place(p: Placement, ref: string, key: SpotKey): Placement {
  const from = locate(p, ref);
  if (from === key) return p;
  const placed = { ...p.placed };
  let tray = p.tray.filter((r) => r !== ref);
  const other = placed[key];
  if (from && from !== "tray") delete placed[from];
  placed[key] = ref;
  if (other && other !== ref) {
    if (from && from !== "tray") placed[from] = other;
    else tray = [other, ...tray];
  }
  return { placed, tray };
}

/** Takes the item off `key` and back to the front of the tray. */
export function unplace(p: Placement, key: SpotKey): Placement {
  const ref = p.placed[key];
  if (!ref) return p;
  const placed = { ...p.placed };
  delete placed[key];
  return { placed, tray: [ref, ...p.tray] };
}

/** Removes the item from the palace altogether. */
export function removeItem(p: Placement, ref: string): Placement {
  const placed = { ...p.placed };
  for (const k of Object.keys(placed) as SpotKey[]) if (placed[k] === ref) delete placed[k];
  return { placed, tray: p.tray.filter((r) => r !== ref) };
}

/** Fills the empty spots in walk order with the tray's items, in tray order (MEM-14 [Auto-place]). */
export function autoPlace(p: Placement, order: readonly SpotKey[]): Placement {
  const placed = { ...p.placed };
  const tray = [...p.tray];
  for (const k of order) {
    if (!tray.length) break;
    if (!placed[k]) placed[k] = tray.shift() as string;
  }
  return { placed, tray };
}

/** Adds new items to the end of the tray, skipping ones the palace already holds. */
export function addItems(p: Placement, refs: readonly string[]): Placement {
  const have = new Set([...p.tray, ...Object.values(p.placed)]);
  const fresh: string[] = [];
  for (const r of refs) {
    if (have.has(r)) continue;
    have.add(r);
    fresh.push(r);
  }
  return { placed: p.placed, tray: [...p.tray, ...fresh] };
}

export interface WalkStop {
  key: SpotKey;
  roomId: string;
  index: number;
  ref: string;
}

/** The filled spots in walk order: the stops of a walk or a quiz (MEM-17, MEM-18). */
export function walkStops(rooms: readonly { id: string; sort: number }[], placed: Placement["placed"]): WalkStop[] {
  return allSpots(rooms).flatMap((key) => {
    const ref = placed[key];
    if (!ref) return [];
    const { roomId, index } = parseSpot(key);
    return [{ key, roomId, index, ref }];
  });
}

/**
 * When the palace should be walked next: the earliest due date among its rated items. A palace
 * never quizzed is walked now, but isn't marked Due.
 */
export function nextWalk(srs: Readonly<Record<string, SrsCardRow>>, refs: readonly string[], now: number): { at: number | null; due: boolean } {
  const dues = refs.flatMap((r) => (srs[r] ? [Date.parse(srs[r].due_at)] : []));
  if (!dues.length) return { at: null, due: false };
  const at = Math.min(...dues);
  return { at, due: at <= now };
}

export type When = { key: "now" } | { key: "today" } | { key: "tomorrow" } | { key: "days"; n: number };

/** "now", "later today", "tomorrow" or "in N days", by local calendar day. */
export function whenFrom(at: number | null, now: number): When {
  if (at === null || at <= now) return { key: "now" };
  const day = (ms: number) => {
    const d = new Date(ms);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  };
  const days = day(at) - day(now);
  if (days <= 0) return { key: "today" };
  if (days === 1) return { key: "tomorrow" };
  return { key: "days", n: days };
}

/** A quiz rating counts as remembered unless it was Again. */
export const remembered = (ratings: readonly number[]) => ratings.filter((r) => r > 1).length;

/** Item refs: a key point of a concept, or a card of one of the student's decks. */
export const keyPointRef = (conceptId: string, index: number) => `kp:${conceptId}#${index}`;
export const deckCardRef = (cardId: string) => `card:${cardId}`;
export const sourceOf = (refs: readonly string[]): "list" | "deck" => (refs.some((r) => r.startsWith("card:")) ? "deck" : "list");

/** A deck card side's text (`{text}` or a plain string), for the item label. */
export function cardText(side: unknown): string {
  if (typeof side === "string") return side;
  if (side && typeof side === "object" && "text" in side) {
    const v = (side as { text: unknown }).text;
    if (typeof v === "string") return v;
    if (v && typeof v === "object") return String((v as Record<string, unknown>).en ?? Object.values(v)[0] ?? "");
  }
  return "";
}

/** A short label for chips on the room canvas (the full text is in the list and the spot card). */
export function shortLabel(label: string, max = 28): string {
  const s = label.trim().replace(/\s+/g, " ");
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}
