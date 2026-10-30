/**
 * AI-11 [Add gaps to review]: each missed or wrong key point becomes a card in the student's
 * "From the tutor" deck (MEM-08): the concept's name on the front, the key point (the bundle's own
 * words) on the back. Written as `deck_card_upserted` through the outbox; the server creates the
 * deck with its first card. The deck id is kept on the device so every gap lands in one deck.
 */
import type { Services } from "../../../boot/services";
import { gapsOf, type FeynmanResult } from "./logic";

const DECK_KEY = "tutor.deck_id";

export async function tutorDeckId(s: Pick<Services, "kv" | "newId">): Promise<string> {
  const existing = await s.kv.get(DECK_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await s.kv.set(DECK_KEY, id);
  return id;
}

/** Stable card id per attempt and key point, so pressing twice never makes two cards. */
export function gapCardId(attemptId: string, index: number): string {
  // A UUID-shaped id: the attempt's first 28 hex digits, then the key point's index.
  const hex = attemptId.replace(/-/g, "").toLowerCase().padEnd(32, "0").slice(0, 28) + (index & 0xffff).toString(16).padStart(4, "0");
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function addGapsToReview(
  s: Pick<Services, "kv" | "newId" | "record" | "storage">,
  args: { result: FeynmanResult; conceptName: string; topicId: string; deckTitle: string; locale?: "en" | "hi" },
): Promise<number> {
  const { missed, wrong } = gapsOf(args.result);
  const points = [...missed, ...wrong];
  if (!points.length) return 0;
  const deckId = await tutorDeckId(s);
  const now = new Date().toISOString();
  const locale = args.locale ?? "en";
  for (const k of points) {
    const id = gapCardId(args.result.id, k.index);
    const front = { text: args.conceptName };
    const back = { text: k.text[locale] ?? k.text.en ?? "" };
    await s.record("deck_card_upserted", { user_card_id: id, deck_id: deckId, front, back }, async (tx) => {
      const deck = await tx.decks.get(deckId);
      if (!deck) {
        await tx.decks.put({ id: deckId, owner_user_id: null, source: "tutor", title: args.deckTitle, topic_id: null, share_code: null, is_public: false, started_at: now, created_at: now, updated_at: now, deleted_at: null });
      }
      await tx.cards.put({ id, deck_id: deckId, kind: "basic", front, back, image_asset_id: null, concept_id: args.result.concept_id, source_ref: `feynman:${args.result.id}`, created_at: now, updated_at: now, deleted_at: null });
    });
  }
  return points.length;
}
