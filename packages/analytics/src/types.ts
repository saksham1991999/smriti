/** How a prop's value is checked. Every type rejects free text. */
export type PropType = 'enum' | 'enum_list' | 'id' | 'number' | 'boolean' | 'bucket' | 'token' | 'list';

export interface PropDef {
  type: PropType;
  values?: readonly string[];
}

/**
 * - `learning`: the service itself (answers, reviews, lessons); goes through the sync outbox too.
 * - `product`: screens and taps for funnels; optional, off for minors except essential events.
 * - `server`: written by the API; the client never sends these.
 */
export type Stream = 'learning' | 'product' | 'server';

export interface EventDef {
  stream: Stream;
  /** On the minors' essential allowlist (✓ / E in the flow docs). */
  essential: boolean;
  areas: readonly string[];
  props: Readonly<Record<string, PropDef>>;
}
