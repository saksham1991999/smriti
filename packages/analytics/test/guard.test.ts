import { describe, expect, it } from 'vitest';
import { guardProps, isBlockedPropName, isSafeToken, type EventDef } from '../src/index';

const def: Pick<EventDef, 'props'> = {
  props: {
    topic_id: { type: 'id' },
    mode: { type: 'enum', values: ['quick', 'full'] },
    tags: { type: 'enum_list', values: ['a', 'b'] },
    card_ids: { type: 'list' },
    n: { type: 'number' },
    ok: { type: 'boolean' },
    source: { type: 'token' },
    wait_bucket: { type: 'bucket' },
  },
};

describe('isSafeToken', () => {
  it('accepts short tokens and ids', () => {
    expect(isSafeToken('home_hero')).toBe(true);
    expect(isSafeToken('MOCK-01')).toBe(true);
    expect(isSafeToken('jee:phy.kin.1')).toBe(true);
    expect(isSafeToken('d:0192f/abc', 'id')).toBe(true);
    expect(isSafeToken('d:0192f/abc')).toBe(false);
  });

  it('rejects free text, emails and phone numbers', () => {
    expect(isSafeToken('I hate this lesson')).toBe(false);
    expect(isSafeToken('')).toBe(false);
    expect(isSafeToken('a'.repeat(65))).toBe(false);
    expect(isSafeToken('a'.repeat(128), 'id')).toBe(true);
    expect(isSafeToken('ravi@example.com')).toBe(false);
    expect(isSafeToken('ravi.k@example.in', 'id')).toBe(false);
    expect(isSafeToken('9876543210')).toBe(false);
    expect(isSafeToken('+91-98765-43210')).toBe(false);
    expect(isSafeToken('नमस्ते')).toBe(false);
  });
});

describe('isBlockedPropName', () => {
  it('blocks personal data, free text and ad ids', () => {
    for (const n of ['name', 'email', 'parent_email', 'guardian_phone', 'pet_name', 'query', 'transcript', 'gaid', 'idfa', 'device_ad_id', 'utm_source', 'Email']) {
      expect(isBlockedPropName(n)).toBe(true);
    }
    for (const n of ['topic_id', 'mode', 'source', 'email_verified_step']) expect(isBlockedPropName(n)).toBe(false);
  });
});

describe('guardProps', () => {
  it('keeps clean props', () => {
    const r = guardProps(def, { topic_id: 'jee.phy.kin', mode: 'quick', tags: ['a'], card_ids: ['u:1', 2], n: 3, ok: false, source: 'home', wait_bucket: '10_30' });
    expect(r.issues).toEqual([]);
    expect(Object.keys(r.props)).toHaveLength(8);
  });

  it('drops blocked names and unknown props', () => {
    const r = guardProps(def, { email: 'x', note: 'hi', extra: 'y', mode: 'full' });
    expect(r.props).toEqual({ mode: 'full' });
    expect(r.issues).toEqual([
      { prop: 'email', code: 'blocked_name' },
      { prop: 'note', code: 'blocked_name' },
      { prop: 'extra', code: 'unknown_prop' },
    ]);
  });

  it('drops free text in any string prop', () => {
    const r = guardProps(def, { source: 'my teacher said so', topic_id: 'call me 9876543210', mode: 'a b' });
    expect(r.props).toEqual({});
    expect(r.issues.map((i) => i.code)).toEqual(['free_text', 'free_text', 'free_text']);
  });

  it('checks types', () => {
    const r = guardProps(def, { n: 'many', ok: 'yes', mode: ['quick'], tags: 'a' });
    expect(r.props).toEqual({ tags: 'a' });
    expect(r.issues).toEqual([
      { prop: 'n', code: 'bad_type' },
      { prop: 'ok', code: 'bad_type' },
      { prop: 'mode', code: 'bad_type' },
    ]);
    expect(guardProps(def, { n: Number.NaN }).issues).toEqual([{ prop: 'n', code: 'bad_type' }]);
    expect(guardProps(def, { n: '12' }).props).toEqual({ n: '12' });
  });

  it('keeps unknown enum values with a warning (the docs lists are incomplete)', () => {
    const r = guardProps(def, { mode: 'practice', tags: ['a', 'zzz'] });
    expect(r.props).toEqual({ mode: 'practice', tags: ['a', 'zzz'] });
    expect(r.issues).toEqual([
      { prop: 'mode', code: 'unknown_enum_value' },
      { prop: 'tags', code: 'unknown_enum_value' },
    ]);
  });

  it('rejects free text inside lists and over-long lists', () => {
    expect(guardProps(def, { card_ids: ['ok', 'not ok'] }).issues).toEqual([{ prop: 'card_ids', code: 'free_text' }]);
    expect(guardProps(def, { card_ids: Array.from({ length: 51 }, (_, i) => `c${i}`) }).issues).toEqual([{ prop: 'card_ids', code: 'too_many_items' }]);
  });

  it('passes null and skips undefined', () => {
    expect(guardProps(def, { mode: null, source: undefined })).toEqual({ props: { mode: null }, issues: [] });
    expect(guardProps(def, undefined)).toEqual({ props: {}, issues: [] });
  });
});
