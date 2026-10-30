import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FLAG_KEYS,
  FLAG_REGISTRY,
  VARIANT_IDS,
  allVariants,
  compareVersions,
  createFlags,
  defaultFlags,
  findLeakedSecrets,
  flagMapSchema,
  getVariant,
  parseClientEnv,
  resolveRemoteConfig,
  variantSchema,
} from '../src';

const DOCS_DIR = process.env['SMRITI_DOCS_DIR'] ?? resolve(__dirname, '../../../docs');
const TOKENS = resolve(__dirname, '../../tokens/tokens.json');

describe('variants', () => {
  it('has one valid file per variant id', () => {
    const all = allVariants();
    expect(Object.keys(all).sort()).toEqual([...VARIANT_IDS].sort());
    for (const id of VARIANT_IDS) {
      const v = all[id];
      expect(v.id).toBe(id);
      expect(v.bundleId).toBe(`app.smriti.${id}`);
      expect(v.scheme).toBe(`smriti-${id}`);
      expect(v.googleIosClientId).toBe('');
    }
  });

  it('only the all-exams app and multi-exam variants show the exam switcher', () => {
    const all = allVariants();
    expect(all.all.showExamSwitcher).toBe(true);
    expect(all.jee.showExamSwitcher).toBe(true); // JEE Main and Advanced
    expect(all.neet.showExamSwitcher).toBe(false);
    for (const v of Object.values(all)) {
      if (v.examIds.length === 1) expect(v.showExamSwitcher).toBe(false);
    }
  });

  it('points accent tokens at real tokens and icons at real files', () => {
    const tokens = JSON.parse(readFileSync(TOKENS, 'utf8')) as { examAccent: Record<string, unknown> };
    const repoRoot = resolve(__dirname, '../../..');
    for (const v of Object.values(allVariants())) {
      const accent = v.accentColor.split('.')[1] ?? '';
      expect(tokens.examAccent[accent]).toBeDefined();
      for (const p of [v.icon, v.splash.image, v.androidAdaptiveIcon.foreground, v.androidAdaptiveIcon.monochrome]) {
        expect(existsSync(join(repoRoot, p)), p).toBe(true);
      }
    }
  });

  it('fills public Google ids from env overrides and validates them', () => {
    const v = getVariant('jee', { googleIosClientId: '123-abc.apps.googleusercontent.com' });
    expect(v.googleIosClientId).toBe('123-abc.apps.googleusercontent.com');
    expect(() => getVariant('jee', { googleIosClientId: 'nope' })).toThrow();
    expect(getVariant(undefined).id).toBe('all');
    expect(() => getVariant('banking')).toThrow(/Unknown APP_VARIANT/);
  });

  it('rejects a raw hex accent', () => {
    const bad = { ...allVariants().neet, accentColor: '#1F9D55' };
    expect(variantSchema.safeParse(bad).success).toBe(false);
  });
});

describe('flags', () => {
  it('every default parses with its own schema', () => {
    for (const key of FLAG_KEYS) {
      const d: { schema: { safeParse(v: unknown): { success: boolean } }; default: unknown; nullable: boolean } =
        FLAG_REGISTRY[key];
      if (d.nullable) expect(d.default, key).toBeNull();
      else expect(d.schema.safeParse(d.default).success, key).toBe(true);
    }
  });

  it('uses the ruling values', () => {
    expect(defaultFlags.get('auth.soft_prompt_cooldown_days')).toBe(7);
    expect(defaultFlags.get('auth.soft_prompt_later_limit')).toBe(2);
    expect(defaultFlags.get('auth.soft_prompt_pause_days')).toBe(14);
    expect(defaultFlags.get('streak.freeze_slots_max')).toBe(2);
    expect(defaultFlags.get('free.deep_dive_preview_cards')).toBe(4);
    expect(defaultFlags.get('free.practice_questions_per_day')).toBe(30);
    expect(defaultFlags.get('free.tutor_messages_per_day')).toBe(5);
    expect(defaultFlags.get('free.sectional_mocks_per_week')).toBe(1);
    expect(defaultFlags.get('game.plant.stage_days')).toEqual([1, 7, 30, 100]);
    expect(defaultFlags.get('game.plant.revival_days')).toEqual({ droopy: 1, dry: 2, wilted: 3, dormant: 5 });
    expect(defaultFlags.get('streak.reviews_to_qualify')).toBe(10);
    expect(defaultFlags.get('goal.default_minutes')).toBe(10);
    expect(defaultFlags.get('league.tier_names')[9]).toEqual({ en: 'Banyan', hi: 'बरगद' });
    expect(defaultFlags.get('notify.autopause_after_ignored')).toBe(7);
  });

  it('owner flags are null until the server sets them', () => {
    expect(defaultFlags.get('mock.min_attempts_for_percentile')).toBeNull();
    expect(() => defaultFlags.require('mock.min_attempts_for_percentile')).toThrow(/not set/);
    const f = createFlags({ 'mock.min_attempts_for_percentile': 500 });
    expect(f.require('mock.min_attempts_for_percentile')).toBe(500);
    expect(f.isFromServer('mock.min_attempts_for_percentile')).toBe(true);
  });

  it('falls back to the default on an invalid server value and reports the key, not the value', () => {
    const f = createFlags({ 'free.practice_questions_per_day': 'lots', 'made.up': 1 });
    expect(f.get('free.practice_questions_per_day')).toBe(30);
    expect(f.issues.map((i) => [i.key, i.problem])).toEqual([
      ['free.practice_questions_per_day', 'invalid'],
      ['made.up', 'unknown'],
    ]);
    expect(JSON.stringify(f.issues)).not.toContain('lots');
  });

  it('maps doc aliases to the canonical key, and the canonical key wins', () => {
    expect(createFlags({ 'streak.freeze_slots': 1 }).get('streak.freeze_slots_max')).toBe(1);
    expect(createFlags({ free_tutor_messages_per_day: 3 }).get('free.tutor_messages_per_day')).toBe(3);
    expect(createFlags({ 'plant.thresholds': [2, 8, 31, 101] }).get('game.plant.stage_days')).toEqual([2, 8, 31, 101]);
    expect(createFlags({ 'streak.freeze_slots_max': 2, 'streak.freeze_slots': 1 }).get('streak.freeze_slots_max')).toBe(2);
  });

  it('the flag map schema accepts partial maps and rejects unknown keys', () => {
    expect(flagMapSchema.safeParse({ 'free.deep_dive_preview_cards': 3 }).success).toBe(true);
    expect(flagMapSchema.safeParse({ nope: 1 }).success).toBe(false);
    expect(flagMapSchema.safeParse({ 'free.deep_dive_preview_cards': -1 }).success).toBe(false);
  });

  const flowsDir = join(DOCS_DIR, 'flows');
  it.skipIf(!existsSync(flowsDir))('registers every config key named in docs/flows', () => {
    const namespaces = [
      'analytics', 'auth', 'comeback', 'community', 'feature', 'focus', 'free', 'home', 'lab', 'labs', 'league',
      'live', 'maintenance', 'memory', 'merge', 'metacog', 'minor', 'mock', 'onb', 'parent', 'pay', 'perf', 'plan',
      'practice', 'pro', 'search', 'share', 'sim', 'streak', 'widget',
    ];
    const notFlags = new Set(['auth.identities', 'auth.sessions', 'auth.users', 'onboarding.v1']);
    const found = new Set<string>();
    for (const file of readdirSync(flowsDir)) {
      const text = readFileSync(join(flowsDir, file), 'utf8');
      for (const m of text.matchAll(/`([a-z][a-z0-9_]*)\.([a-z0-9_.]*[a-z0-9_])`/g)) {
        if (namespaces.includes(m[1] ?? '')) found.add(`${m[1]}.${m[2]}`);
      }
      for (const m of text.matchAll(/`(game\.(?:plant\.stage_days|rest_days_per_week|economy)|billing\.trial_reminder_days_before|social\.(?:deck_listing|duo_max_partners)|notify\.(?:autopause_after_ignored|bandit|cap\.[a-z]+|[a-z_]+\.(?:lead_min|min_cards|offset_hours|min_per_kind|repeat_gap_days)))`/g)) {
        found.add(m[1] ?? '');
      }
    }
    const known = new Set<string>([...FLAG_KEYS]);
    for (const k of FLAG_KEYS) for (const a of (FLAG_REGISTRY[k] as { aliases?: readonly string[] }).aliases ?? []) known.add(a);
    const missing = [...found].filter((k) => !notFlags.has(k) && !known.has(k) && !k.startsWith('game.economy') && k !== 'metacog.target_sure');
    expect(missing).toEqual([]);
  });
});

describe('env', () => {
  it('strips Expo and Vite prefixes', () => {
    const env = parseClientEnv({
      EXPO_PUBLIC_API_BASE_URL: 'http://localhost:8000',
      EXPO_PUBLIC_APP_VARIANT: 'neet',
      VITE_CDN_BASE_URL: '',
      PATH: '/usr/bin',
    });
    expect(env.API_BASE_URL).toBe('http://localhost:8000');
    expect(env.APP_VARIANT).toBe('neet');
    expect(env.AUTH_MODE).toBe('dev');
    expect(env.CDN_BASE_URL).toBeUndefined();
  });

  it('requires Supabase settings in supabase mode and forbids dev auth outside local and test', () => {
    expect(() => parseClientEnv({ API_BASE_URL: 'https://api.example.com', AUTH_MODE: 'supabase' })).toThrow(/SUPABASE_URL/);
    expect(() =>
      parseClientEnv({ API_BASE_URL: 'https://api.example.com', AUTH_MODE: 'dev', APP_ENV: 'production' }),
    ).toThrow(/dev auth/);
  });

  it('flags secrets exposed with a public prefix', () => {
    expect(findLeakedSecrets({ VITE_RAZORPAY_KEY_SECRET: 'x', VITE_API_BASE_URL: 'y' })).toEqual(['VITE_RAZORPAY_KEY_SECRET']);
  });
});

describe('remote config', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('0.9.1', '1.0.0')).toBe(-1);
  });

  it('resolves flags and update state', () => {
    const r = resolveRemoteConfig(
      { variant: 'jee', min_version: '1.2.0', latest_version: '1.4.0', flags: { 'free.deep_dive_preview_cards': 2 }, extra: true },
      '1.1.9',
    );
    expect(r.updateRequired).toBe(true);
    expect(r.updateAvailable).toBe(true);
    expect(r.flags.get('free.deep_dive_preview_cards')).toBe(2);
  });
});
