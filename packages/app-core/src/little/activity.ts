import type { Outbox } from '../sync/outbox';
import type { NewOutboxRow, OutboxRow, StorageTables } from '../storage/types';
import { activityCompletedPayload, type ActivityCompletionLike } from '../sync/activity';

/** What lesson-core's players return when a little learner finishes a story, song or play. */
export type ActivityCompletionInput = ActivityCompletionLike;

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
