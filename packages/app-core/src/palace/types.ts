/**
 * Memory palaces on the wire (sync contract v1.5, memory-labs flow §5.6). A palace is one
 * document: rooms in walk order, each with its spots (loci) in walk order, and the items being
 * memorised, each on a spot or still in the tray. The same shape is the `palace_saved` payload,
 * the body of every `/v1/palaces` answer, and what the apps render. The API's Pydantic models
 * (`apps/api/smriti_api/schemas/palaces.py`) are the source of truth.
 *
 * Names, labels and notes are the student's own words: keep them out of logs and analytics.
 */

export type PalaceTemplateKind = 'home' | 'school' | 'monument' | 'pano360' | 'custom';
/** What the items came from (MEM-15): a list or date concept, a topic, a deck or my mnemonics. */
export type PalaceSource = 'list' | 'topic' | 'deck' | 'mnemonics';

/** A spot on a picture room (fractions of its width and height) or in a 360° room (degrees). */
export type PalacePos = { x: number; y: number } | { yaw: number; pitch: number };

export interface PalaceLocus {
  locus_id: string;
  /** Walk order in the room, 0-based. */
  sort: number;
  pos: PalacePos;
}

export interface PalaceRoom {
  room_id: string;
  name: string;
  /** Walk order in the palace, 0-based. */
  sort: number;
  /** The `palace_template@1` room slug, for its picture and alt text; null for none. */
  template_room: string | null;
  loci: PalaceLocus[];
}

export interface PalaceItem {
  item_id: string;
  /** `kp:<concept>#<n>`, `card:<id>`, a card ref, `m:<mnemonic_id>` or a concept id. Never free text. */
  item_ref: string;
  label: string | null;
  /** The student's link note (MEM-16). */
  note: string | null;
  /** The spot it sits on; null while it is in the tray. */
  locus_id: string | null;
}

export interface PalaceDoc {
  palace_id: string;
  name: string;
  template: PalaceTemplateKind;
  /** The `pt.` id of the `palace_template@1` it was built from. */
  template_id: string | null;
  source: PalaceSource | null;
  rooms: PalaceRoom[];
  items: PalaceItem[];
  /** ISO time of the last edit on the device that made it. The newest one wins. */
  updated_at: string;
}

/** `GET /v1/palaces/{id}` and each palace of `GET /v1/palaces`. */
export interface ServerPalace extends PalaceDoc {
  items: (PalaceItem & { card_ref: string; due_at: string | null })[];
  created_at: string;
  next_walk_at: string | null;
}

/** `GET /v1/palaces`. */
export interface ServerPalaceList {
  palaces: ServerPalace[];
  deleted: string[];
}

export const PALACE_LIMITS = {
  rooms: 20,
  spotsPerRoom: 20,
  items: 200,
  nameLength: 80,
  labelLength: 200,
  noteLength: 300,
  /** memory-labs §5.6: above this many items the builder suggests splitting the palace. */
  longPalaceItems: 30,
} as const;

/** The spots a room gets when it comes with none: a zig-zag in walk order (API DEFAULT_SPOT_POSITIONS). */
export const DEFAULT_SPOT_POSITIONS: readonly (readonly [number, number])[] = [
  [0.15, 0.65],
  [0.325, 0.4],
  [0.5, 0.65],
  [0.675, 0.4],
  [0.85, 0.65],
];
