import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_BYTES, hostMessage, simMessage } from '../src/protocol';
import { parseHostMessage, parseSimMessage, validateTasks } from '../src/validate';
import { sampleTasks } from './helpers';

const init = hostMessage('init', {
  protocolVersion: '1.0.0',
  locale: 'hi',
  theme: 'dark',
  reducedMotion: true,
  lowPower: false,
  params: { voltage: 6, arrangement: 'series', switchOn: true },
  tasks: sampleTasks,
});

describe('parseHostMessage', () => {
  it('accepts a valid init, as an object or a JSON string', () => {
    expect(parseHostMessage(init).ok).toBe(true);
    expect(parseHostMessage(JSON.stringify(init)).ok).toBe(true);
  });

  it('rejects other namespaces, versions and directions', () => {
    expect(parseHostMessage({ ...init, ns: 'other' })).toMatchObject({ ok: false, error: 'not_envelope' });
    expect(parseHostMessage({ ...init, v: 2 })).toMatchObject({ ok: false, error: 'wrong_version' });
    // `ready` is sim → host only.
    const ready = simMessage('ready', {
      protocolVersion: '1.0.0',
      simId: 'x',
      simVersion: '1.0.0',
      capabilities: ['tasks'],
      readings: [],
    });
    expect(parseHostMessage(ready)).toMatchObject({ ok: false, error: 'unknown_type' });
    expect(parseSimMessage(ready).ok).toBe(true);
  });

  it('rejects bad JSON and oversize messages', () => {
    expect(parseHostMessage('{not json')).toMatchObject({ ok: false, error: 'not_json' });
    expect(parseHostMessage('x'.repeat(MAX_MESSAGE_BYTES + 1))).toMatchObject({ ok: false, error: 'too_large' });
  });

  it('names the failing field', () => {
    const bad = { ...init, payload: { ...init.payload, locale: 'fr', lowPower: 'yes' } };
    const result = parseHostMessage(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain('$.payload.locale');
    expect(paths).toContain('$.payload.lowPower');
  });

  it('rejects non-finite numbers and bad ids', () => {
    const r1 = parseHostMessage({ ...init, payload: { ...init.payload, params: { voltage: Number.NaN } } });
    expect(r1.ok).toBe(false);
    const r2 = parseHostMessage(hostMessage('check', { taskId: 'bad id with spaces' }));
    expect(r2.ok).toBe(false);
  });

  it('validates every message type with an empty payload', () => {
    for (const type of ['reset', 'pause', 'resume', 'save'] as const) {
      expect(parseHostMessage(hostMessage(type, {})).ok).toBe(true);
    }
    expect(parseHostMessage({ ns: 'smriti.sim', v: 1, type: 'reset' }).ok).toBe(true);
  });
});

describe('parseSimMessage', () => {
  it('accepts state with readings and a snapshot', () => {
    const msg = simMessage('state', {
      readings: [{ name: 'current', value: 0.5, unit: 'A', label: { en: 'Current', hi: 'धारा' }, precision: 2 }],
      snapshot: { v: 1, data: { voltage: 6, list: [1, 2, { a: null }] } },
    });
    expect(parseSimMessage(msg).ok).toBe(true);
  });

  it('rejects a reading without a unit or with an infinite value', () => {
    expect(parseSimMessage(simMessage('state', { readings: [{ name: 'i', value: 1 } as never] })).ok).toBe(false);
    expect(
      parseSimMessage(simMessage('state', { readings: [{ name: 'i', value: Number.POSITIVE_INFINITY, unit: 'A' }] })).ok,
    ).toBe(false);
  });

  it('checks error codes', () => {
    expect(parseSimMessage(simMessage('error', { code: 'internal', message: 'x', fatal: false })).ok).toBe(true);
    expect(parseSimMessage({ ns: 'smriti.sim', v: 1, type: 'error', payload: { code: 'boom', message: 'x', fatal: false } }).ok).toBe(false);
  });
});

describe('validateTasks', () => {
  it('accepts every check kind, including nested all', () => {
    const issues = validateTasks([
      ...sampleTasks,
      { id: 'a', prompt: { en: 'a', hi: 'a' }, check: { kind: 'range', quantity: 'ph', min: 11 } },
      { id: 'b', prompt: { en: 'b', hi: 'b' }, check: { kind: 'condition', rule: 'image_virtual' } },
      { id: 'c', prompt: { en: 'c', hi: 'c' }, check: { kind: 'readings', quantity: 'current', count: 3, distinctBy: 'voltage', sameBy: ['resistance'] } },
      {
        id: 'd',
        prompt: { en: 'd', hi: 'd' },
        check: { kind: 'all', of: [{ kind: 'condition', rule: 'parallel' }, { kind: 'target', quantity: 'current', value: 1, tolerance: 0.01 }] },
      },
    ]);
    expect(issues).toEqual([]);
  });

  it('requires both languages and a known kind', () => {
    expect(validateTasks([{ id: 'x', prompt: { en: 'only english' }, check: { kind: 'range', quantity: 'q' } }]).length).toBeGreaterThan(0);
    const issues = validateTasks([{ id: 'x', prompt: { en: 'a', hi: 'b' }, check: { kind: 'guess' } }]);
    expect(issues[0]?.message).toMatch(/unknown check kind/);
  });

  it('limits nesting depth', () => {
    let check: unknown = { kind: 'range', quantity: 'q' };
    for (let i = 0; i < 6; i += 1) check = { kind: 'all', of: [check] };
    expect(validateTasks([{ id: 'x', prompt: { en: 'a', hi: 'b' }, check }]).length).toBeGreaterThan(0);
  });
});
