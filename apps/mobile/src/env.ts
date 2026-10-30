import { getVariant, parseClientEnv, type ClientEnv, type Variant } from '@smriti/config';

/**
 * Public client config. Expo inlines `process.env.EXPO_PUBLIC_*` at build time, but only when each
 * name is written out in full, so they are listed one by one. Nothing here is a secret
 * (AGENTS.md rule 5): `findLeakedSecrets` runs in CI over the same names.
 */
export function readClientEnv(): ClientEnv {
  return parseClientEnv({
    EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
    EXPO_PUBLIC_APP_VARIANT: process.env.EXPO_PUBLIC_APP_VARIANT,
    // Local default: the API on the developer's machine (apps/api, `uv run fastapi dev`).
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000',
    EXPO_PUBLIC_CDN_BASE_URL: process.env.EXPO_PUBLIC_CDN_BASE_URL,
    EXPO_PUBLIC_AUTH_MODE: process.env.EXPO_PUBLIC_AUTH_MODE,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME: process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME,
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_ANALYTICS_URL: process.env.EXPO_PUBLIC_ANALYTICS_URL,
  });
}

/** Mobile-only switches, also public. Each one turns a fake into the real implementation. */
export interface MobileSwitches {
  /** `revenuecat` uses react-native-purchases (needs EXPO_PUBLIC_REVENUECAT_*_KEY); `fake` is FakeBilling. */
  billing: 'fake' | 'revenuecat';
  /** `native` uses @react-native-google-signin (needs the Google client ids); `dev` is the dev form. */
  googleSignIn: 'dev' | 'native';
  /** In-app fake API (dev/fake-api) instead of the network: web preview and demos without apps/api. */
  fakeApi: boolean;
  revenuecatAppleKey?: string;
  revenuecatGoogleKey?: string;
  simBaseUrl?: string;
  /**
   * Local only: the header the local API accepts on `/v1/webhooks/revenuecat`, so FakeBilling
   * can play RevenueCat. Ignored outside APP_ENV local/test; the API refuses it elsewhere too.
   */
  devRevenueCatWebhookAuth?: string;
}

export function readSwitches(env: ClientEnv): MobileSwitches {
  const devLike = env.APP_ENV === 'local' || env.APP_ENV === 'test';
  return {
    billing: process.env.EXPO_PUBLIC_BILLING === 'revenuecat' ? 'revenuecat' : devLike ? 'fake' : 'revenuecat',
    googleSignIn: process.env.EXPO_PUBLIC_GOOGLE_SIGNIN === 'native' || !devLike ? 'native' : 'dev',
    fakeApi: devLike && process.env.EXPO_PUBLIC_FAKE_API === '1',
    revenuecatAppleKey: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY,
    revenuecatGoogleKey: process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY,
    simBaseUrl: process.env.EXPO_PUBLIC_SIM_BASE_URL,
    ...(devLike && process.env.EXPO_PUBLIC_DEV_REVENUECAT_WEBHOOK_AUTH ? { devRevenueCatWebhookAuth: process.env.EXPO_PUBLIC_DEV_REVENUECAT_WEBHOOK_AUTH } : {}),
  };
}

export function readVariant(env: ClientEnv): Variant {
  return getVariant(env.APP_VARIANT);
}
