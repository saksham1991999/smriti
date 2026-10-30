import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppStoreProvider, useStreak, useSyncStatus } from '../src/react';
import { InMemoryStorage, applyStateEverywhere, createAppStore, hydrateAppStore, readSnapshotSection } from '../src';

const streak = { current: 4, longest: 9, today_qualified: false, freezes_equipped: 1, freezes_available: 1, rest_day: null, at_risk: true };

describe('app store', () => {
  it('server wins; patches are optimistic; reset empties', () => {
    const store = createAppStore();
    store.getState().applyServerState(
      { state_version: 3, streak, profile: { id: 'u1', display_name: null, locale: 'hi', is_guest: false, age_band: '13_17', exam_profile_ids: [], daily_goal_minutes: 10 } },
      '2026-10-29T00:00:00.000Z',
    );
    expect(store.getState()).toMatchObject({ stateVersion: 3, streak: { current: 4 }, session: { userId: 'u1', isGuest: false } });
    store.getState().patch('streak', { current: 5, today_qualified: true });
    expect(store.getState().streak).toMatchObject({ current: 5, longest: 9 });
    store.getState().patch('wallet', { gems: 3 }); // no wallet yet: ignored
    expect(store.getState().wallet).toBeNull();
    store.getState().applyServerState({ state_version: 2 }, 'x');
    expect(store.getState().stateVersion).toBe(3);
    store.getState().reset();
    expect(store.getState()).toMatchObject({ streak: null, stateVersion: 0, session: { status: 'booting' } });
  });

  it('hydrates from storage before any network call', async () => {
    const storage = new InMemoryStorage();
    const store = createAppStore();
    await applyStateEverywhere(store, storage, { state_version: 7, streak, wallet: { xp_total: 1, xp_today: 1, gems: 2 } }, Date.UTC(2026, 9, 29));
    expect(await readSnapshotSection(storage, 'streak')).toEqual(streak);
    const fresh = createAppStore();
    await hydrateAppStore(fresh, storage);
    expect(fresh.getState()).toMatchObject({ stateVersion: 7, streak, wallet: { gems: 2 }, updatedAt: '2026-10-29T00:00:00.000Z' });
  });

  it('React bindings render from the store (server render)', () => {
    const store = createAppStore({ streak });
    function Pill() {
      const s = useStreak();
      const status = useSyncStatus({ getStatus: () => 'offline', onStatus: () => () => {} });
      return createElement('span', null, `${s?.current ?? 0} ${status}`);
    }
    const html = renderToString(createElement(AppStoreProvider, { store }, createElement(Pill)));
    expect(html).toBe('<span>4 offline</span>');
    expect(() => renderToString(createElement(Pill))).toThrow(/AppStoreProvider/);
  });
});

describe('platform-free source', () => {
  const root = join(__dirname, '..', 'src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(root);

  it('never imports DOM, React Native or Node-only modules', () => {
    const banned = /from ['"](react-native[^'"]*|expo[^'"]*|node:[^'"]+|fs|path|crypto|os|http|https|react-dom[^'"]*)['"]/;
    const globals = /\b(window|document|localStorage|sessionStorage|navigator|process\.env|Buffer)\b/;
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(banned.test(src), `${f} imports a platform module`).toBe(false);
      expect(globals.test(src), `${f} touches a platform global`).toBe(false);
    }
  });

  it('only the react entry imports react', () => {
    for (const f of files) {
      if (f.includes(`${join('src', 'react')}`)) continue;
      expect(/from ['"]react['"]/.test(readFileSync(f, 'utf8')), f).toBe(false);
    }
  });

  it('no model identifiers or secrets in the source', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(/\b(gpt-|claude-|gemini-\d|sk_live|service_role)/i.test(src), f).toBe(false);
    }
  });
});
