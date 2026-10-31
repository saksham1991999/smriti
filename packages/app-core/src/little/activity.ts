import type { Outbox } from '../sync/outbox';
import type { NewOutboxRow, OutboxRow, StorageTables } from '../storage/types';
import type { Locale, SyncEventPayloads } from '../sync/types';
import { toIso } from '../time';

/**
 * What lesson-core's story, song and play players return when a little learner finishes one
 * (`ActivityCompletion` in @smriti/lesson-core, matched structurally so app-core does not depend
 * on the player logic).
 */
export interface ActivityCompletionInput {
  kind: 'story' | 'song' | 'play';
  activityId: string;
  topicId: string;
  concepts: readonly string[];
  bundleVersion: string;
  locale: string;
  stars: number;
  msTotal: number;
  /** ms since the epoch. */
  completedAt: number;
}

const LOCALES: readonly Locale[] = ['en', 'hi'];

/** The `activity_completed` payload (contract v1.4, pending). Throws on a value the wire refuses. */
export function activityCompletedPayload(c: ActivityCompletionInput): SyncEventPayloads['activity_completed'] {
  if (!LOCALES.includes(c.locale as Locale)) throw new Error(`activity_completed: unsupported locale ${c.locale}`);
  if (!Number.isInteger(c.stars) || c.stars < 0) throw new Error('activity_completed: stars must be a whole number, 0 or more');
  return {
    kind: c.kind,
    activity_id: c.activityId,
    topic_id: c.topicId,
    concept_ids: [...c.concepts],
    bundle_version: c.bundleVersion,
    locale: c.locale as Locale,
    stars: c.stars,
    ms_total: Math.max(0, Math.round(c.msTotal)),
    completed_at: toIso(c.completedAt),
  };
}

/** The outbox row for a completion, with occurred_at at the moment it was completed. */
export function activityCompletedRow(outbox: Outbox, c: ActivityCompletionInput): NewOutboxRow<'activity_completed'> {
  return outbox.create('activity_completed', activityCompletedPayload(c), { occurredAt: c.completedAt });
}

/**
 * Appends `activity_completed` in the caller's transaction, together with the local write that
 * marks the path node done and adds the stars (DB_SCHEMA §15: both commit together).
 */
export function recordActivityCompleted(tx: Pick<StorageTables, 'outbox'>, outbox: Outbox, c: ActivityCompletionInput): Promise<OutboxRow<'activity_completed'>> {
  return outbox.record(tx, 'activity_completed', activityCompletedPayload(c), { occurredAt: c.completedAt });
}
