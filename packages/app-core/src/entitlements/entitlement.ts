import type { EntitlementSection } from '../sync/types';
import { toMs, type Instant } from '../time';

/**
 * Pro entitlement as the client sees it (me-money §5.1). The server (`billing.entitlements`)
 * decides; the app caches the last answer in `profile_snapshot`.
 * - `grace` keeps Pro (billing-issue banner); `on_hold` / `halted` lock Pro features;
 * - offline, the cached entitlement is trusted until `pro_until` plus `billing.offline_grace_days`;
 *   after that Pro features say "Connect to check your Pro".
 */

export type ProAccess = 'pro' | 'free' | 'needs_check';

export interface ProAccessContext {
  now: Instant;
  online: boolean;
  /** `billing.offline_grace_days` (3). */
  offlineGraceDays: number;
}

export function proAccess(ent: EntitlementSection | null | undefined, ctx: ProAccessContext): ProAccess {
  if (!ent || ent.plan !== 'pro') return 'free';
  if (ent.status === 'on_hold' || ent.status === 'expired' || ent.status === 'pending') return 'free';
  const now = toMs(ctx.now);
  const until = ent.status === 'grace' && ent.grace_until ? ent.grace_until : ent.pro_until;
  if (until === null || until === undefined) return 'pro';
  const untilMs = toMs(until);
  if (now < untilMs) return 'pro';
  if (!ctx.online && now < untilMs + ctx.offlineGraceDays * 86_400_000) return 'pro';
  return ctx.online ? 'free' : 'needs_check';
}

export function isPro(ent: EntitlementSection | null | undefined, ctx: ProAccessContext): boolean {
  return proAccess(ent, ctx) === 'pro';
}

/** The banner the entitlement calls for (me-money §6.5), if any. */
export function billingBanner(ent: EntitlementSection | null | undefined): 'billing_on_hold' | 'billing_issue' | 'payment_pending' | null {
  if (!ent) return null;
  if (ent.status === 'on_hold') return 'billing_on_hold';
  if (ent.status === 'grace') return 'billing_issue';
  if (ent.status === 'pending') return 'payment_pending';
  return null;
}
