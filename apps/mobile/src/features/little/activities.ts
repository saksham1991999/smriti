import { recordActivityCompleted, toIso, type ActivityCompletionInput } from '@smriti/app-core';

import type { SmritiApp } from '../../services/app';

/**
 * Which of a little learner's stories, songs and play activities are done on this profile. The
 * server counts `activity_completed` toward the streak and XP but doesn't send per-activity
 * progress back, so the device keeps the done set (in the profile database, so it follows the
 * profile and goes with sign-out), written in the same transaction as the outbox event.
 */
const KEY = 'little.activities.v1';

interface DoneSet {
  done: Record<string, { stars: number; at: string }>;
}

async function read(app: SmritiApp): Promise<DoneSet> {
  const row = await app.deps.stores.storage.session_state.get(KEY);
  const data = row?.data as DoneSet | undefined;
  return data && typeof data === 'object' && data.done ? data : { done: {} };
}

export async function doneActivities(app: SmritiApp): Promise<Set<string>> {
  return new Set(Object.keys((await read(app)).done));
}

/**
 * Records a finished activity: the `activity_completed` event (stars become XP on the server)
 * and the path node marked done, committed together (DB_SCHEMA §15), then a sync.
 */
export async function completeActivity(app: SmritiApp, c: ActivityCompletionInput): Promise<void> {
  const storage = app.deps.stores.storage;
  await storage.transaction(async (tx) => {
    await recordActivityCompleted(tx, app.outbox, c);
    const row = await tx.session_state.get(KEY);
    const prev = (row?.data as DoneSet | undefined)?.done ?? {};
    const at = toIso(c.completedAt);
    const best = Math.max(prev[c.activityId]?.stars ?? 0, c.stars);
    await tx.session_state.put({ key: KEY, data: { done: { ...prev, [c.activityId]: { stars: best, at } } } as never, updated_at: at });
  });
  void app.syncNow();
}
