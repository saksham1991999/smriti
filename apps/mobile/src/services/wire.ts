import type { EventEnvelope, EventResponse } from '@smriti/lesson-core';

/**
 * Shapes the API accepts that lesson-core and the onboarding answers do not produce directly.
 * Each one is reported under "Contract changes": once lesson-core emits the contract's form,
 * these become no-ops.
 */

/**
 * `answer_submitted.response` on the wire is "the option ids, number or text key" (sync.md):
 * a list of keys, one key, a number or null (`ResponseKey` = `[A-Za-z0-9_.:-]{0,64}`).
 * lesson-core emits a tagged object, so it is flattened here without losing what was chosen.
 */
export function toWireResponse(r: EventResponse): string[] | number | null {
  if (r === null) return null;
  if ('option_ids' in r) return r.option_ids;
  if ('value' in r) return r.value;
  if ('pairs' in r) return r.pairs.map((p) => `${p.left}:${p.right}`);
  if ('rows' in r) return r.rows.flatMap((row) => row.columns.map((c) => `${row.row}:${c}`));
  if ('blanks' in r) return r.blanks.map((b) => `${b.blank}:${b.key ?? ''}`);
  return r.order;
}

/** Envelope payloads as the API takes them. */
export function toWireEnvelope(env: EventEnvelope): EventEnvelope {
  if (env.type !== 'answer_submitted') return env;
  const p = env.payload as { response: EventResponse };
  return { ...env, payload: { ...p, response: toWireResponse(p.response) } } as EventEnvelope;
}

/** ONB-02 goals for `onboarding_answer` step `goal`: exam profile ids, or "curious" (School sends `class`). */
export function goalAnswer(goals: string[]): string[] | 'curious' | null {
  const exams = goals.filter((g) => g !== 'school' && g !== 'curious');
  if (exams.length) return exams;
  return goals.includes('curious') ? 'curious' : null;
}
