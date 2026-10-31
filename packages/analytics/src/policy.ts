import type { EventDef } from './types';

/**
 * Who may be sent what (AGENTS.md rule 8, DPDP; me-money §4.6, onboarding §9, learn §14):
 *
 * | audience            | learning | essential (✓/E) | other product |
 * |---------------------|----------|-----------------|---------------|
 * | adult, opted in     | yes      | yes             | yes           |
 * | adult, opted out    | yes      | yes             | no            |
 * | teen, child, unknown| yes      | yes             | no            |
 * | little (u10)        | yes      | only `home_viewed`, `lesson_completed`, `activity_completed`, `storybook_completed` |
 *
 * - With `minor.defer_sync_until_consent` on and no guardian consent yet, nothing is sent for a
 *   minor (or an unknown age).
 * - Server events are written by the API; the client never sends them.
 * - Minors never get behavioural-tracking props (campaign, referrer, attribution); nobody gets ad ids.
 */

export type Audience = 'adult' | 'teen' | 'child' | 'little' | 'unknown';

export interface PolicyContext {
  audience: Audience;
  /** Adults' "Help improve" toggle (on by default). Ignored for minors: product events are off. */
  productAnalyticsOptIn: boolean;
  /** `minor.defer_sync_until_consent`. */
  deferUntilConsent: boolean;
  /** Guardian consent recorded (the `account` scope). */
  guardianConsent: boolean;
}

export type DropReason = 'unknown_event' | 'server_only' | 'minor_not_allowed' | 'little_learner_not_allowed' | 'opted_out' | 'awaiting_consent';

export const LITTLE_LEARNER_PRODUCT_ALLOWLIST: readonly string[] = ['home_viewed', 'lesson_completed', 'activity_completed', 'storybook_completed'];

/** Props that track behaviour across contexts (attribution, campaigns): stripped for minors. */
export const MINOR_STRIPPED_PROPS: readonly string[] = [
  'campaign_id', 'campaign', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer',
  'install_referrer', 'attribution', 'ad_group', 'creative_id', 'experiment_id', 'variant_id', 'share_target',
];

export const isMinor = (a: Audience) => a !== 'adult';

/** Age band (`profile.age_band`) to audience. A missing band is `unknown` and treated as a minor. */
export function audienceFromAgeBand(band: 'u10' | '10_12' | '13_17' | '18p' | null | undefined): Audience {
  switch (band) {
    case 'u10':
      return 'little';
    case '10_12':
      return 'child';
    case '13_17':
      return 'teen';
    case '18p':
      return 'adult';
    default:
      return 'unknown';
  }
}

export function allowEvent(name: string, def: EventDef | undefined, ctx: PolicyContext): { ok: true } | { ok: false; reason: DropReason } {
  if (!def) return { ok: false, reason: 'unknown_event' };
  if (def.stream === 'server') return { ok: false, reason: 'server_only' };
  if (isMinor(ctx.audience) && ctx.deferUntilConsent && !ctx.guardianConsent) return { ok: false, reason: 'awaiting_consent' };
  if (def.stream === 'learning') return { ok: true };
  if (ctx.audience === 'little') {
    return LITTLE_LEARNER_PRODUCT_ALLOWLIST.includes(name) ? { ok: true } : { ok: false, reason: 'little_learner_not_allowed' };
  }
  if (def.essential) return { ok: true };
  if (isMinor(ctx.audience)) return { ok: false, reason: 'minor_not_allowed' };
  return ctx.productAnalyticsOptIn ? { ok: true } : { ok: false, reason: 'opted_out' };
}

/** Removes behavioural-tracking props for minors. */
export function stripForAudience<T extends Record<string, unknown>>(props: T, audience: Audience): Partial<T> {
  if (!isMinor(audience)) return props;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (!MINOR_STRIPPED_PROPS.includes(k) && !k.startsWith('utm_')) out[k] = v;
  return out as Partial<T>;
}
