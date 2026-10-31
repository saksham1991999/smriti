import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain ESM script without types
import * as gen from '../scripts/generate.mjs';
import { CATALOGUE, isBlockedPropName, type EventDef } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const docs = join(pkg, '..', '..', 'docs', 'flows');
const entries = Object.entries(CATALOGUE as Record<string, EventDef>);

describe('catalogue', () => {
  it('has snake_case names and known streams', () => {
    expect(entries.length).toBeGreaterThan(300);
    for (const [name, def] of entries) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(['learning', 'product', 'server']).toContain(def.stream);
      expect(def.areas.length).toBeGreaterThan(0);
    }
  });

  it('puts the core learning events in the learning stream', () => {
    const c = CATALOGUE as Record<string, EventDef>;
    for (const n of ['lesson_completed', 'review_rated', 'answer_submitted']) expect(c[n]?.stream).toBe('learning');
    expect(c.answer_submitted?.props.question_id?.type).toBe('id');
    expect(c.answer_submitted?.props.is_correct?.type).toBe('boolean');
    expect(c.answer_submitted?.props.time_ms?.type).toBe('number');
  });

  it('marks server events and essential events from several areas', () => {
    const server = entries.filter(([, d]) => d.stream === 'server');
    expect(server.length).toBeGreaterThan(5);
    expect((CATALOGUE as Record<string, EventDef>).account_deleted?.stream).toBe('server');
    const essentialAreas = new Set(entries.filter(([, d]) => d.essential).flatMap(([, d]) => d.areas));
    for (const a of ['auth', 'onboarding']) expect(essentialAreas.has(a)).toBe(true);
    expect(entries.filter(([, d]) => d.essential).length).toBeGreaterThan(20);
  });

  it('never declares a personal-data or ad-id prop', () => {
    const bad = entries.flatMap(([n, d]) => Object.keys(d.props).filter(isBlockedPropName).map((p) => `${n}.${p}`));
    expect(bad).toEqual([]);
    expect((CATALOGUE as Record<string, EventDef>).lab_reading_recorded?.props.quantity).toEqual({ type: 'token' });
  });

  it('reads "prop: value (screens)" cells as one enum', () => {
    expect((CATALOGUE as Record<string, EventDef>).paywall_viewed?.props.trigger).toEqual({
      type: 'enum',
      values: ['practice_limit', 'mock_limit', 'analytics_lock', 'offline_download'],
    });
  });

  it.skipIf(!existsSync(docs))('is up to date with docs/flows', () => {
    expect(() => execFileSync('node', [join(pkg, 'scripts', 'generate.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('generator', () => {
  it('parses event names with suffix shorthand and server notes', () => {
    expect(gen.parseEventNames('`nudge_shown` / `_tapped`')).toEqual([
      { name: 'nudge_shown', server: false },
      { name: 'nudge_tapped', server: false },
    ]);
    expect(gen.parseEventNames('`account_merged` (server)')).toEqual([{ name: 'account_merged', server: true }]);
  });

  it('infers prop types', () => {
    expect(gen.parseProp('`mode` (`quick`, `full`)')).toEqual({ name: 'mode', type: 'enum', values: ['quick', 'full'] });
    expect(gen.parseProp('`reasons[]` (`a`, `b`)')).toEqual({ name: 'reasons', type: 'enum_list', values: ['a', 'b'] });
    expect(gen.parseProp('`flag` (bool)')).toMatchObject({ type: 'boolean' });
    expect(gen.parseProp('`n` (count)')).toMatchObject({ type: 'number' });
    expect(gen.parseProp('`topic_id`')).toMatchObject({ type: 'id' });
    expect(gen.parseProp('`card_ids`')).toMatchObject({ type: 'list' });
    expect(gen.parseProp('`wait_bucket`')).toMatchObject({ type: 'bucket' });
    expect(gen.parseProp('`has_pro`')).toMatchObject({ type: 'boolean' });
    expect(gen.parseProp('`duration_ms`')).toMatchObject({ type: 'number' });
    expect(gen.parseProp('`source`')).toMatchObject({ type: 'token' });
    // ruling references are not enum values
    expect(gen.parseProp('`kind` (`a`, `b`, R21)')).toEqual({ name: 'kind', type: 'enum', values: ['a', 'b'] });
    expect(gen.parseProps('none')).toEqual({});
  });

  it('extracts a table with stream and minors columns', () => {
    const md = [
      '## 9. Analytics events',
      '',
      '| Event | Kind | Props | Minors |',
      '|---|---|---|---|',
      '| `x_opened` | product | `source` | ✓ |',
      '| `x_done` | learning | `topic_id`, `ok` (bool) | |',
      '| `x_saved` (server) | | none | E |',
      '',
      '## 10. Next',
      '| Event | Kind |',
      '|---|---|',
      '| `ignored` | product |',
    ].join('\n');
    const ev = gen.extractEvents(md, 'test');
    expect(ev.map((e: { name: string }) => e.name)).toEqual(['x_opened', 'x_done', 'x_saved']);
    expect(ev[0]).toMatchObject({ stream: 'product', essential: true });
    expect(ev[1]).toMatchObject({ stream: 'learning', essential: false });
    expect(ev[2]).toMatchObject({ stream: 'server', essential: true });
  });

  it('merges duplicates: learning wins, essential sticks, enums widen', () => {
    const merged = gen.mergeEvents([
      { name: 'a', area: 'learn', stream: 'product', essential: false, props: { k: { name: 'k', type: 'token' } } },
      { name: 'a', area: 'practice', stream: 'learning', essential: true, props: { k: { name: 'k', type: 'enum', values: ['x'] } } },
      { name: 'a', area: 'practice', stream: 'product', essential: false, props: { k: { name: 'k', type: 'enum', values: ['y'] } } },
    ]);
    expect(merged).toEqual([
      { name: 'a', stream: 'learning', essential: true, areas: ['learn', 'practice'], props: { k: { name: 'k', type: 'enum', values: ['x', 'y'] } } },
    ]);
  });
});
