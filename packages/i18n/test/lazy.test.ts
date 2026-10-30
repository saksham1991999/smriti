import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createI18n, type CatalogueLoader, type Locale, type Namespace } from '../src/core';
import { catalogueLoaders, loadCatalogue } from '../src/loaders';
import { resources } from '../src';

const fakeLoader = () => {
  const calls: string[] = [];
  const load: CatalogueLoader = async (locale: Locale, ns: Namespace) => {
    calls.push(`${locale}:${ns}`);
    return { default: resources[locale][ns] as Record<string, string> };
  };
  return { load, calls };
};

describe('createI18n with a loader', () => {
  it('starts empty and translates once a namespace loads', async () => {
    const { load, calls } = fakeLoader();
    const tr = createI18n({ locale: 'en', brand: 'Smriti', load });
    expect(tr.hasNamespace('learn')).toBe(false);
    expect(tr.t('learn:WEB-01.tab_learn')).toBe('WEB-01.tab_learn');
    await tr.loadNamespaces(['learn', 'ui']);
    expect(tr.t('learn:WEB-01.tab_learn')).toBe('Learn');
    expect(tr.loadedNamespaces()).toEqual(['learn', 'ui']);
    expect(calls).toEqual(['en:learn', 'en:ui']);
  });

  it('loads each catalogue once, even when asked twice at the same time', async () => {
    const { load, calls } = fakeLoader();
    const tr = createI18n({ locale: 'en', brand: 'Smriti', load });
    await Promise.all([tr.loadNamespaces(['learn']), tr.loadNamespaces(['learn'])]);
    await tr.loadNamespaces(['learn']);
    expect(calls).toEqual(['en:learn']);
  });

  it('retries a failed load', async () => {
    let fail = true;
    const load: CatalogueLoader = async (locale, ns) => {
      if (fail) throw new Error('offline');
      return resources[locale][ns] as Record<string, string>;
    };
    const tr = createI18n({ locale: 'en', brand: 'Smriti', load });
    await expect(tr.loadNamespaces(['learn'])).rejects.toThrow('offline');
    fail = false;
    await tr.loadNamespaces(['learn']);
    expect(tr.hasNamespace('learn')).toBe(true);
  });

  it('schedules the English fallback for Hindi and tells listeners', async () => {
    const { load, calls } = fakeLoader();
    const tasks: (() => void)[] = [];
    const tr = createI18n({ locale: 'hi', brand: 'स्मृति', load, scheduleFallback: (task) => tasks.push(task) });
    const listener = vi.fn();
    const off = tr.onLoaded(listener);
    await tr.loadNamespaces(['learn']);
    expect(tr.t('learn:WEB-01.tab_learn')).toBe('सीखें');
    expect(calls).toEqual(['hi:learn']);
    expect(tasks).toHaveLength(1);
    tasks[0]!();
    await vi.waitFor(() => expect(calls).toEqual(['hi:learn', 'en:learn']));
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });

  it('loads the open namespaces for the new locale before switching', async () => {
    const { load, calls } = fakeLoader();
    const tr = createI18n({ locale: 'en', brand: 'Smriti', load });
    await tr.loadNamespaces(['learn', 'me_money']);
    await tr.setLocale('hi');
    expect(tr.locale).toBe('hi');
    expect(tr.hasNamespace('me_money', 'hi')).toBe(true);
    expect(calls.slice(2).sort()).toEqual(['hi:learn', 'hi:me_money']);
    expect(tr.t('learn:WEB-01.tab_learn')).toBe('सीखें');
  });

  it('formats ICU plurals and prices from a lazily loaded catalogue', async () => {
    const { load } = fakeLoader();
    const tr = createI18n({ locale: 'en', brand: 'Smriti', load });
    await tr.loadNamespaces(['learn', 'me_money']);
    expect(tr.t('learn:WEB-01.topics_count', { n: 1 })).toBe('1 topic');
    expect(tr.t('learn:WEB-01.topics_count', { n: 3 })).toBe('3 topics');
    expect(tr.t('me_money:PAY-01.plan_price_not_eligible', { price: '₹99' })).toBe('₹99/month');
  });
});

describe('loaders', () => {
  it('has a loader for every locale and namespace that returns the catalogue', async () => {
    for (const locale of ['en', 'hi'] as const) {
      expect(Object.keys(catalogueLoaders[locale]).sort()).toEqual(Object.keys(resources[locale]).sort());
    }
    const m = await loadCatalogue('hi', 'auth');
    expect('default' in m ? m.default : m).toEqual(resources.hi.auth);
  });

  it('core imports no catalogue at runtime', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'core.ts'), 'utf8');
    expect(src).not.toMatch(/^import [^\n]*\.json/m);
    expect(src).not.toMatch(/(?<!typeof )import\(['"][^'"]+\.json['"]\)/);
  });
});
