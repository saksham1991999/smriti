import type { components } from '@smriti/api-client';

import type { SmritiApp } from '../../services/app';

export type FeynmanOut = components['schemas']['FeynmanOut'];
export type Band = 'needs_work' | 'getting_there' | 'clear';

/** The concept a topic's explain-back is about: the first concept its lesson cards teach. */
export function conceptFor(app: SmritiApp, topicId: string): string | null {
  const locale = app.ui.getState().locale;
  const exam = app.examProfileId();
  for (const mode of ['deep_dive', 'quick_revision'] as const) {
    const b = app.deps.content.load(locale, topicId, mode, exam);
    for (const card of (b?.bundle.cards ?? []) as unknown as { concepts?: string[] }[]) {
      if (card.concepts?.[0]) return card.concepts[0];
    }
  }
  return null;
}

/** AI-11's band for a 0–100 score, from `feynman.bands` (lower bounds). */
export function bandOf(app: SmritiApp, score: number): Band {
  const b = (app.flags.get('feynman.bands') as { getting_there: number; clear: number } | null) ?? { getting_there: 40, clear: 70 };
  return score >= b.clear ? 'clear' : score >= b.getting_there ? 'getting_there' : 'needs_work';
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export type FeynmanResult = { kind: 'graded'; out: FeynmanOut } | { kind: 'offline' } | { kind: 'unavailable' } | { kind: 'limit' } | { kind: 'refused' };

/**
 * `POST /v1/feynman/attempts`. The explanation is sent to be graded and never to analytics (AGENTS
 * rule 6); the analytics events carry only bands and counts.
 */
export async function submitExplanation(app: SmritiApp, conceptId: string, explanation: string, input: 'text' | 'voice', followUpOf: string | null = null): Promise<FeynmanResult> {
  if (!app.deps.network.isOnline()) return { kind: 'offline' };
  await app.ensureSession();
  const res = await app.api
    .POST('/v1/feynman/attempts', { body: { client_attempt_id: app.newId(), concept_id: conceptId, explanation, input_mode: input, follow_up_of: followUpOf }, headers: { 'Idempotency-Key': app.newId() } })
    .catch(() => null);
  if (!res) return { kind: 'offline' };
  if (res.data) return res.data.status === 'graded' ? { kind: 'graded', out: res.data } : { kind: 'refused' };
  return res.response.status === 429 ? { kind: 'limit' } : { kind: 'unavailable' };
}
