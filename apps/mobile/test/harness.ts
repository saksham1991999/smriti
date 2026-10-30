import { InMemoryStorage, ManualNetwork, MemoryKeyValueStore, realScheduler, type CryptoLike, type Fetch } from '@smriti/app-core';
import { getVariant, parseClientEnv } from '@smriti/config';
import { webcrypto } from 'node:crypto';

import { DevGoogleSignIn, noApple } from '../src/auth/providers';
import { ContentRepo } from '../src/content/repo';
import { FakeApiServer } from '../src/dev/fake-api/server';
import { readSwitches } from '../src/env';
import { randomUuid } from '../src/platform/deviceId';
import { MemoryNotifier } from '../src/platform/notifications';
import { seedPacks } from '../src/seed/generated';
import { SmritiApp } from '../src/services/app';

export const nodeCrypto: CryptoLike = {
  getRandomValues: <T extends Uint8Array>(a: T) => webcrypto.getRandomValues(a),
  subtle: { digest: (_alg, data) => webcrypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>) },
};

export interface TestRig {
  app: SmritiApp;
  fake: FakeApiServer;
  network: ManualNetwork;
  notifier: MemoryNotifier;
  clock: { now: number; advance(ms: number): void };
}

/**
 * A whole app on in-memory storage: the real store, outbox and sync client. By default it talks
 * to the dev fake API; pass `live: { baseUrl, fetch }` to run against a real apps/api.
 */
export function createTestApp(opts: { variant?: string; now?: number; fake?: FakeApiServer; live?: { baseUrl: string; fetch: Fetch } } = {}): TestRig {
  const clock = {
    // 30 Oct 2026, 10:00 IST
    now: opts.now ?? Date.parse('2026-10-30T04:30:00.000Z'),
    advance(ms: number) {
      this.now += ms;
    },
  };
  const fake = opts.fake ?? new FakeApiServer({ clock: () => clock.now });
  const env = parseClientEnv({ EXPO_PUBLIC_APP_ENV: 'test', EXPO_PUBLIC_API_BASE_URL: opts.live?.baseUrl ?? 'http://fake.local', EXPO_PUBLIC_AUTH_MODE: 'dev' });
  const network = new ManualNetwork(true);
  const notifier = new MemoryNotifier(true);
  const app = new SmritiApp({
    env,
    variant: getVariant(opts.variant ?? 'all'),
    switches: { ...readSwitches(env), billing: 'fake', googleSignIn: 'dev', fakeApi: !opts.live },
    stores: { storage: new InMemoryStorage(), kv: new MemoryKeyValueStore(), secure: new MemoryKeyValueStore(), kind: 'memory' },
    deviceId: randomUuid(nodeCrypto),
    fetch: opts.live?.fetch ?? fake.asFetch(),
    network,
    crypto: nodeCrypto,
    // A live server checks occurred_at against its own time, so live runs use the real clock.
    clock: opts.live ? () => Date.now() : () => clock.now,
    scheduler: realScheduler,
    timeZone: () => 'Asia/Kolkata',
    notifier,
    google: new DevGoogleSignIn(),
    apple: noApple,
    content: new ContentRepo(seedPacks),
    platform: 'android',
  });
  return { app, fake, network, notifier, clock };
}

/** Lets pending promises and the 250 ms flush debounce settle. */
export async function settle(ms = 300): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
