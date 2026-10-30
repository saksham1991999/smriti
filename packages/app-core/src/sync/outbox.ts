import { createIdGenerator, type CryptoLike } from '../crypto';
import type { Clock } from '../platform';
import type { NewOutboxRow, OutboxRow, StorageTables } from '../storage/types';
import { toIso } from '../time';
import { canonicalCardRef, type SyncEventPayloads, type SyncEventType, type WireEvent } from './types';

export interface OutboxOptions {
  crypto: Pick<CryptoLike, 'getRandomValues'>;
  clock: Clock;
  /** The device timezone, read at each event (the student may travel). */
  timeZone: () => string;
}

/**
 * Creates learning events and appends them to the outbox. Call `record` inside the same
 * `storage.transaction` as the local table write, so both commit together (DB_SCHEMA §15).
 */
export class Outbox {
  private readonly nextId: () => string;
  constructor(private readonly opts: OutboxOptions) {
    this.nextId = createIdGenerator(opts.crypto, opts.clock);
  }

  /** Builds an outbox row without storing it. */
  create<T extends SyncEventType>(
    type: T,
    payload: SyncEventPayloads[T],
    at?: { occurredAt?: number | string | Date; eventId?: string },
  ): NewOutboxRow<T> {
    const p = payload as SyncEventPayloads[T] & { card_ref?: unknown };
    const wirePayload = typeof p.card_ref === 'string' ? { ...p, card_ref: canonicalCardRef(p.card_ref) } : payload;
    return {
      event_id: at?.eventId ?? this.nextId(),
      type,
      payload: wirePayload,
      occurred_at: toIso(at?.occurredAt ?? this.opts.clock()),
      tz: this.opts.timeZone(),
    };
  }

  /** Appends an event using the given transaction's tables. */
  record<T extends SyncEventType>(
    tx: Pick<StorageTables, 'outbox'>,
    type: T,
    payload: SyncEventPayloads[T],
    at?: { occurredAt?: number | string | Date; eventId?: string },
  ): Promise<OutboxRow<T>> {
    return tx.outbox.append(this.create(type, payload, at));
  }
}

export function toWireEvent(row: OutboxRow): WireEvent {
  return { event_id: row.event_id, type: row.type, occurred_at: row.occurred_at, tz: row.tz, payload: row.payload };
}

/**
 * Lesson and review counts of the unsent events, for the sign-out "unsynced" warning
 * (auth flow §6.7). Counts only, no content.
 */
export async function unsyncedSummary(tx: Pick<StorageTables, 'outbox'>): Promise<{ total: number; lessons: number; reviews: number }> {
  const byType = await tx.outbox.countByType();
  const total = Object.values(byType).reduce((a, b) => a + (b ?? 0), 0);
  return { total, lessons: byType.lesson_completed ?? 0, reviews: byType.review_rated ?? 0 };
}
