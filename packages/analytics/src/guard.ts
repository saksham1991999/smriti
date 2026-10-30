import type { EventDef, PropDef } from './types';

/**
 * The props guard (AGENTS.md rule 6): no personal data and no free text typed by students.
 * - prop names that carry personal data or advertising ids are always rejected;
 * - strings must be short tokens (`^[A-Za-z0-9][A-Za-z0-9_.:-]*$`, at most 64 characters; ids 128),
 *   so a sentence, a name with a space, an email or a phone number cannot pass;
 * - props not in the catalogue entry are dropped.
 */

export const PII_PROP_NAMES = [
  'name', 'first_name', 'last_name', 'full_name', 'display_name', 'nickname', 'handle', 'username', 'pet_name',
  'email', 'phone', 'phone_number', 'mobile', 'address', 'city', 'pincode', 'postcode', 'ip', 'ip_address',
  'birth_year', 'birth_ym', 'birthday', 'dob', 'date_of_birth', 'age', 'gender', 'school', 'sub', 'user_id', 'auth_id',
  'latitude', 'longitude', 'lat', 'lng', 'location', 'geo',
  'text', 'body', 'message', 'content', 'query', 'search_query', 'note', 'notes', 'transcript', 'answer_text',
  'card_text', 'front', 'back', 'title', 'comment', 'feedback_text', 'free_text',
  'token', 'access_token', 'id_token', 'password', 'nonce',
] as const;

/** Advertising and cross-app identifiers: never collected for anyone (and never for minors, rule 8). */
export const AD_ID_PROP_NAMES = ['ad_id', 'advertising_id', 'idfa', 'idfv', 'gaid', 'aaid', 'adid', 'android_id', 'device_ad_id', 'fbclid', 'gclid'] as const;

const BLOCKED = new Set<string>([...PII_PROP_NAMES, ...AD_ID_PROP_NAMES]);

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:\-/]{0,127}$/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /(?:\+?\d[\s-]?){10,}/;

export type PropValue = string | number | boolean | null | readonly (string | number)[];

export interface GuardIssue {
  prop: string;
  code: 'blocked_name' | 'unknown_prop' | 'free_text' | 'bad_type' | 'unknown_enum_value' | 'too_many_items';
}

export interface GuardResult {
  props: Record<string, PropValue>;
  issues: GuardIssue[];
}

export function isBlockedPropName(name: string): boolean {
  const n = name.toLowerCase();
  return BLOCKED.has(n) || n.startsWith('utm_') || /(^|_)(email|phone|ad_id)$/.test(n);
}

export function isSafeToken(v: string, kind: 'token' | 'id' = 'token'): boolean {
  if (EMAIL_RE.test(v) || PHONE_RE.test(v)) return false;
  return (kind === 'id' ? ID_RE : TOKEN_RE).test(v);
}

function checkScalar(def: PropDef, v: unknown): GuardIssue['code'] | 'ok' | 'ok_unknown_enum' {
  if (v === null) return 'ok';
  switch (def.type) {
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? 'ok' : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? 'ok' : 'bad_type';
    case 'boolean':
      return typeof v === 'boolean' ? 'ok' : 'bad_type';
    case 'id':
      return typeof v === 'number' || (typeof v === 'string' && isSafeToken(v, 'id')) ? 'ok' : 'free_text';
    case 'enum':
    case 'enum_list':
      if (typeof v !== 'string' || !isSafeToken(v)) return typeof v === 'boolean' || typeof v === 'number' ? 'ok' : 'free_text';
      return def.values && !def.values.includes(v) ? 'ok_unknown_enum' : 'ok';
    default:
      if (typeof v === 'number' || typeof v === 'boolean') return 'ok';
      return typeof v === 'string' && isSafeToken(v) ? 'ok' : 'free_text';
  }
}

/** Checks props against an event definition. Bad props are dropped and reported, never sent. */
export function guardProps(def: Pick<EventDef, 'props'>, props: Record<string, unknown> | undefined): GuardResult {
  const out: Record<string, PropValue> = {};
  const issues: GuardIssue[] = [];
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === undefined) continue;
    if (isBlockedPropName(name)) {
      issues.push({ prop: name, code: 'blocked_name' });
      continue;
    }
    const pd = def.props[name];
    if (!pd) {
      issues.push({ prop: name, code: 'unknown_prop' });
      continue;
    }
    if (Array.isArray(value)) {
      if (pd.type !== 'list' && pd.type !== 'enum_list') {
        issues.push({ prop: name, code: 'bad_type' });
        continue;
      }
      if (value.length > 50) {
        issues.push({ prop: name, code: 'too_many_items' });
        continue;
      }
      const item: PropDef = pd.type === 'enum_list' ? { type: 'enum', ...(pd.values ? { values: pd.values } : {}) } : { type: 'id' };
      const results = value.map((v) => checkScalar(item, v));
      const bad = results.find((r) => r !== 'ok' && r !== 'ok_unknown_enum');
      if (bad) {
        issues.push({ prop: name, code: bad as GuardIssue['code'] });
        continue;
      }
      if (results.includes('ok_unknown_enum')) issues.push({ prop: name, code: 'unknown_enum_value' });
      out[name] = value as (string | number)[];
      continue;
    }
    const r = checkScalar(pd, value);
    if (r === 'ok' || r === 'ok_unknown_enum') {
      if (r === 'ok_unknown_enum') issues.push({ prop: name, code: 'unknown_enum_value' });
      out[name] = value as PropValue;
    } else issues.push({ prop: name, code: r });
  }
  return { props: out, issues };
}
