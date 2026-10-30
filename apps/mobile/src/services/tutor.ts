import { unwrap, type Schemas } from '@smriti/api-client';

import type { PickedPhoto } from '../platform/photos';
import type { SmritiApp } from './app';

/**
 * The tutor's other screens: history (AI-09), feedback (AI-05), save as flashcard (AI-04) and
 * photo doubts (AI-16 to AI-18). Chat and streaming are in `practice.ts`.
 */
export type TutorSessionSummary = Schemas['smriti_api__schemas__tutor__SessionSummary'];
export type FeedbackReason = NonNullable<Schemas['FeedbackIn']['reasons']>[number];
export const FEEDBACK_REASONS: FeedbackReason[] = ['wrong', 'confusing', 'too_long', 'didnt_answer', 'wrong_language', 'not_suitable'];

export async function listTutorSessions(app: SmritiApp): Promise<TutorSessionSummary[]> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/tutor/sessions', { params: { query: { limit: 50 } } }));
}

export async function fetchTutorSession(app: SmritiApp, id: string): Promise<Schemas['TutorSession']> {
  await app.ensureSession();
  return unwrap(app.api.GET('/v1/tutor/sessions/{session_id}', { params: { path: { session_id: id } } }));
}

export async function deleteTutorSession(app: SmritiApp, id: string): Promise<void> {
  await app.ensureSession();
  const r = await app.api.DELETE('/v1/tutor/sessions/{session_id}', { params: { path: { session_id: id } } });
  if (r.error && r.response.status !== 404) await unwrap(Promise.resolve(r));
}

/** AI-05: thumbs up, or thumbs down with reasons (no free text, by design). */
export async function tutorFeedback(app: SmritiApp, messageId: string, rating: 'up' | 'down', reasons: FeedbackReason[] = []): Promise<Schemas['FeedbackOut']> {
  await app.ensureSession();
  return unwrap(app.api.POST('/v1/tutor/messages/{message_id}/feedback', { params: { path: { message_id: messageId } }, body: { rating, reasons } }));
}

const TUTOR_DECK_KEY = 'tutor-deck-id';
const CARD_MAX = 4000;

/**
 * AI-04: the question and the tutor's answer become a card in the student's "From the tutor"
 * deck, through the outbox (`deck_card_upserted`), so it works offline and syncs later.
 */
export async function saveTutorCard(app: SmritiApp, front: string, back: string): Promise<{ cardId: string; online: boolean }> {
  let deckId = await app.deps.stores.kv.get(TUTOR_DECK_KEY);
  if (!deckId) {
    deckId = app.newId();
    await app.deps.stores.kv.set(TUTOR_DECK_KEY, deckId);
  }
  const cardId = app.newId();
  await app.record('deck_card_upserted', { user_card_id: cardId, deck_id: deckId, front: front.slice(0, CARD_MAX), back: back.slice(0, CARD_MAX) });
  return { cardId, online: app.deps.network.isOnline() };
}

// ── Photo doubts (AI-16 to AI-18) ─────────────────────────────────────────────

export type PhotoDoubtResult = { status: 'read'; questionText: string } | { status: 'unavailable' } | { status: 'error' };

/**
 * Sends one photo of one question to be read. apps/api has no photo-doubt route yet, so the only
 * implementation reports `unavailable` and the screen says so; the capture, permission and crop
 * steps are real and swap onto the route when it lands.
 */
export interface PhotoDoubts {
  read(photo: PickedPhoto): Promise<PhotoDoubtResult>;
}

export const unavailablePhotoDoubts: PhotoDoubts = {
  async read() {
    return { status: 'unavailable' };
  },
};
