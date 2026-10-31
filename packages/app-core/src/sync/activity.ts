import { localDate, toIso, type Instant } from '../time';
import type { LittleActivityCompletionKind, Locale, SyncEventPayloads } from './types';

/**
 * The `activity_completed` sync event (contract v1.4) for little learners' stories, songs and
 * play. The host gets an `ActivityCompletion` from lesson-core and enqueues this payload. The
 * server counts it toward the day's streak and the path as it counts a completed lesson, awards
 * `stars × xp.little_activity_star` XP, and records one per activity, bundle version and local
 * day of `completed_at` (later ones are rejected with `already_recorded`).
 *
 * The shape matches lesson-core's `ActivityCompletion` structurally, so app-core needs no
 * dependency on lesson-core.
 */
export interface ActivityCompletionLike {
  kind: LittleActivityCompletionKind;
  activityId: string;
  topicId: string;
  concepts: readonly string[];
  bundleVersion: string;
  locale: string;
  stars: number;
  msTotal: number;
  completedAt: Instant;
}

/** `xp.little_activity_star` (proposed, default 1). */
export const DEFAULT_LITTLE_ACTIVITY_STAR_XP = 1;
const MAX_MS = 24 * 3600 * 1000;
const MAX_STARS = 100;

const clampInt = (n: number, hi: number) => Math.min(hi, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

/** The wire payload. Throws for a locale the contract doesn't carry (en and hi only). */
export function activityCompletedPayload(c: ActivityCompletionLike): SyncEventPayloads['activity_completed'] {
  if (c.locale !== 'en' && c.locale !== 'hi') throw new RangeError(`Unsupported locale: ${c.locale}`);
  const locale: Locale = c.locale;
  return {
    kind: c.kind,
    activity_id: c.activityId,
    topic_id: c.topicId,
    concept_ids: [...new Set(c.concepts)],
    bundle_version: c.bundleVersion,
    locale,
    stars: clampInt(c.stars, MAX_STARS),
    ms_total: clampInt(c.msTotal, MAX_MS),
    completed_at: toIso(c.completedAt),
  };
}

/** The XP the server credits: stars times the per-star flag. */
export function activityCompletedXp(stars: number, perStar: number = DEFAULT_LITTLE_ACTIVITY_STAR_XP): number {
  return clampInt(stars, MAX_STARS) * Math.max(0, Math.floor(perStar));
}

/** The key the server dedupes on (besides the user): activity, bundle version, local day. */
export function activityDedupeKey(p: Pick<SyncEventPayloads['activity_completed'], 'activity_id' | 'bundle_version' | 'completed_at'>, timeZone: string): string {
  return `${p.activity_id}|${p.bundle_version}|${localDate(p.completed_at, timeZone)}`;
}
