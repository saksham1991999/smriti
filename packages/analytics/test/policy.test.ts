import { describe, expect, it } from 'vitest';
import { allowEvent, audienceFromAgeBand, stripForAudience, type EventDef, type PolicyContext } from '../src/index';

const learning: EventDef = { stream: 'learning', essential: false, areas: ['learn'], props: {} };
const essential: EventDef = { stream: 'product', essential: true, areas: ['auth'], props: {} };
const product: EventDef = { stream: 'product', essential: false, areas: ['learn'], props: {} };
const server: EventDef = { stream: 'server', essential: false, areas: ['auth'], props: {} };

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  audience: 'adult',
  productAnalyticsOptIn: true,
  deferUntilConsent: false,
  guardianConsent: false,
  ...over,
});

describe('allowEvent', () => {
  it('refuses unknown and server-only events', () => {
    expect(allowEvent('nope', undefined, ctx())).toEqual({ ok: false, reason: 'unknown_event' });
    expect(allowEvent('account_deleted', server, ctx())).toEqual({ ok: false, reason: 'server_only' });
  });

  it('adults: everything when opted in; learning and essential when opted out', () => {
    expect(allowEvent('x', product, ctx()).ok).toBe(true);
    const out = ctx({ productAnalyticsOptIn: false });
    expect(allowEvent('x', product, out)).toEqual({ ok: false, reason: 'opted_out' });
    expect(allowEvent('x', learning, out).ok).toBe(true);
    expect(allowEvent('x', essential, out).ok).toBe(true);
  });

  it('teens, children and unknown ages: learning and essential only, whatever the toggle says', () => {
    for (const audience of ['teen', 'child', 'unknown'] as const) {
      const c = ctx({ audience, productAnalyticsOptIn: true });
      expect(allowEvent('x', learning, c).ok).toBe(true);
      expect(allowEvent('x', essential, c).ok).toBe(true);
      expect(allowEvent('x', product, c)).toEqual({ ok: false, reason: 'minor_not_allowed' });
    }
  });

  it('little learners: learning plus a short product allowlist, not every essential event', () => {
    const c = ctx({ audience: 'little' });
    expect(allowEvent('lesson_completed', learning, c).ok).toBe(true);
    expect(allowEvent('home_viewed', product, c).ok).toBe(true);
    expect(allowEvent('storybook_completed', product, c).ok).toBe(true);
    expect(allowEvent('sign_in_started', essential, c)).toEqual({ ok: false, reason: 'little_learner_not_allowed' });
    expect(allowEvent('shop_opened', product, c)).toEqual({ ok: false, reason: 'little_learner_not_allowed' });
  });

  it('defers everything for minors until guardian consent when the flag is on', () => {
    for (const audience of ['teen', 'child', 'little', 'unknown'] as const) {
      const waiting = ctx({ audience, deferUntilConsent: true, guardianConsent: false });
      expect(allowEvent('x', learning, waiting)).toEqual({ ok: false, reason: 'awaiting_consent' });
      expect(allowEvent('x', essential, waiting)).toEqual({ ok: false, reason: 'awaiting_consent' });
    }
    expect(allowEvent('x', learning, ctx({ audience: 'teen', deferUntilConsent: true, guardianConsent: true })).ok).toBe(true);
    expect(allowEvent('x', product, ctx({ deferUntilConsent: true })).ok).toBe(true); // adults unaffected
  });
});

describe('audienceFromAgeBand', () => {
  it('maps bands and treats a missing band as unknown', () => {
    expect(audienceFromAgeBand('u10')).toBe('little');
    expect(audienceFromAgeBand('10_12')).toBe('child');
    expect(audienceFromAgeBand('13_17')).toBe('teen');
    expect(audienceFromAgeBand('18p')).toBe('adult');
    expect(audienceFromAgeBand(null)).toBe('unknown');
    expect(audienceFromAgeBand(undefined)).toBe('unknown');
  });
});

describe('stripForAudience', () => {
  const props = { mode: 'quick', campaign_id: 'diwali', utm_medium: 'x', referrer: 'y', share_target: 'whatsapp' };
  it('removes behavioural-tracking props for minors', () => {
    for (const a of ['teen', 'child', 'little', 'unknown'] as const) expect(stripForAudience(props, a)).toEqual({ mode: 'quick' });
  });
  it('leaves adults alone (the guard still blocks utm_* and ad ids for everyone)', () => {
    expect(stripForAudience(props, 'adult')).toBe(props);
  });
});
