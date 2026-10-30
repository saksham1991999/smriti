import { realScheduler, type Fetch, type HttpRequestInit } from '@smriti/app-core';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { DevGoogleSignIn, ExpoAppleSignIn, NativeGoogleSignIn, noApple } from '../auth/providers';
import { ContentRepo } from '../content/repo';
import { FakeApiServer } from '../dev/fake-api/server';
import { readClientEnv, readSwitches } from '../env';
import { getVariant } from '@smriti/config';
import { expoCrypto } from '../platform/crypto';
import { installDeviceId } from '../platform/deviceId';
import { NetInfoNetwork, onForeground } from '../platform/network';
import { ExpoNotifier, MemoryNotifier } from '../platform/notifications';
import { openProfileStores } from '../platform/profileDb';
import { seedPacks } from '../seed/generated';
import { SmritiApp } from './app';

let singleton: Promise<SmritiApp> | null = null;

/** The device's IANA time zone (the outbox envelope's `tz`, read at each event). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}

const platformFetch: Fetch = (url: string, init?: HttpRequestInit) =>
  fetch(url, init as RequestInit).then((r) => ({
    status: r.status,
    ok: r.ok,
    json: () => r.json() as Promise<unknown>,
    text: () => r.text(),
    headers: { get: (n: string) => r.headers.get(n) },
  }));

/** Builds the app for this device and boots it (once). */
export function getDeviceApp(): Promise<SmritiApp> {
  if (!singleton) singleton = createDeviceApp();
  return singleton;
}

/** Tests render the real routes on a test-built app (in-memory storage and the dev fake API). */
export function provideAppForTests(app: SmritiApp | null): void {
  singleton = app ? Promise.resolve(app) : null;
}

async function createDeviceApp(): Promise<SmritiApp> {
  const extraVariant = (Constants.expoConfig?.extra as { variantId?: string } | undefined)?.variantId;
  const env = readClientEnv();
  const variant = getVariant(process.env.EXPO_PUBLIC_APP_VARIANT ?? extraVariant ?? env.APP_VARIANT);
  const switches = readSwitches(env);
  // The web preview runs on the in-app fake API unless EXPO_PUBLIC_FAKE_API=0 points it at apps/api.
  const useFake = switches.fakeApi || (Platform.OS === 'web' && process.env.EXPO_PUBLIC_FAKE_API !== '0');
  // The in-app fake has its own webhook value (it is not the API's); FakeBilling sends it.
  const fakeWebhookAuth = 'fake-in-app-revenuecat';
  const fake = useFake ? new FakeApiServer({ revenuecatWebhookAuth: fakeWebhookAuth }) : null;
  const network = new NetInfoNetwork();
  network.start();
  const stores = await openProfileStores(variant.id);
  const deviceId = await installDeviceId(stores.kv, expoCrypto);
  const app = new SmritiApp({
    env: useFake ? { ...env, AUTH_MODE: 'dev', API_BASE_URL: 'http://fake.local' } : env,
    variant,
    switches: useFake ? { ...switches, billing: 'fake', googleSignIn: 'dev', devRevenueCatWebhookAuth: fakeWebhookAuth } : switches,
    stores,
    deviceId,
    fetch: fake ? fake.asFetch() : platformFetch,
    network,
    crypto: expoCrypto,
    clock: () => Date.now(),
    scheduler: realScheduler,
    timeZone: deviceTimeZone,
    notifier: Platform.OS === 'web' ? new MemoryNotifier() : new ExpoNotifier(),
    google:
      switches.googleSignIn === 'native' && !useFake
        ? new NativeGoogleSignIn({ webClientId: env.GOOGLE_WEB_CLIENT_ID, iosClientId: env.GOOGLE_IOS_CLIENT_ID })
        : new DevGoogleSignIn(),
    apple: Platform.OS === 'ios' ? new ExpoAppleSignIn() : noApple,
    content: new ContentRepo(seedPacks),
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    appVersion: Constants.expoConfig?.version ?? '1.0.0',
  });
  await app.boot();
  onForeground(() => {
    void app.ensureSession();
    void app.sync.flush();
    void app.refreshReminders();
  });
  return app;
}
