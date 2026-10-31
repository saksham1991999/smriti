/**
 * Expo config for one exam app variant (TRD §3.1). `APP_VARIANT` picks the variant from
 * `@smriti/config` (name, bundle id, scheme, icon, accent); everything else is shared.
 *
 *   APP_VARIANT=jee npx expo config
 *
 * Colours come from `packages/tokens/tokens.json` by token name, never as raw hex here.
 * Public env (`EXPO_PUBLIC_*`) is validated by `parseClientEnv` at runtime (src/env.ts).
 */
import { createRequire } from 'node:module';

import type { ConfigContext, ExpoConfig } from 'expo/config';
import type { Variant } from '@smriti/config';

// Expo loads this file with Node's own TypeScript support, which cannot follow @smriti/config's
// extensionless imports and JSON imports. So the variant JSON is read directly here; the app
// itself uses getVariant (with its zod validation), and `pnpm test` checks the two agree.
const require = createRequire(import.meta.url);
const tokens = require('../../packages/tokens/tokens.json') as unknown;
// The brand domain (TRD D7: a working name) lives once, in packages/config/brand.json.
const brandDomain = (require('../../packages/config/brand.json') as { domain: string }).domain;
const VARIANT_IDS = ['all', 'jee', 'neet', 'upsc', 'ssc'] as const;

function readVariant(id: string | undefined, overrides: { googleIosClientId?: string; googleIosUrlScheme?: string }): Variant {
  const key = id === undefined || id === '' ? 'all' : id;
  if (!(VARIANT_IDS as readonly string[]).includes(key)) throw new Error(`Unknown APP_VARIANT "${key}". Expected one of ${VARIANT_IDS.join(', ')}`);
  const v = require(`../../packages/config/variants/${key}.json`) as Omit<Variant, 'deepLinkPrefix'>;
  if (v.id !== key || v.scheme !== `smriti-${key}`) throw new Error(`packages/config/variants/${key}.json is not variant ${key}`);
  // Same rule as deepLinkPrefix in @smriti/config.
  const deepLinkPrefix = v.deepLinkPath === '/' ? `https://${brandDomain}` : `https://${brandDomain}${v.deepLinkPath}`;
  return { ...v, deepLinkPrefix, googleIosClientId: overrides.googleIosClientId ?? v.googleIosClientId, googleIosUrlScheme: overrides.googleIosUrlScheme ?? v.googleIosUrlScheme };
}

type AccentRef = `examAccent.${string}`;

/** Resolves `examAccent.jee` / `examAccent.jee.light` to the token's hex value. */
function accentHex(ref: AccentRef, mode: 'light' | 'dark' = 'light'): string {
  const [, exam, explicit] = ref.split('.') as [string, string, string | undefined];
  const table = (tokens as unknown as { examAccent: Record<string, Record<string, string>> }).examAccent;
  const entry = table[exam];
  const value = entry?.[explicit ?? mode];
  if (!value) throw new Error(`Unknown token ${ref}`);
  return value;
}

/** Brand files live in the repo's brand/ folder (DESIGN.md §12). */
const brand = (path: string) => `../../${path}`;

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = readVariant(process.env.APP_VARIANT, {
    googleIosClientId: process.env[`GOOGLE_IOS_CLIENT_ID_${(process.env.APP_VARIANT ?? 'all').toUpperCase()}`],
    googleIosUrlScheme: process.env[`GOOGLE_IOS_URL_SCHEME_${(process.env.APP_VARIANT ?? 'all').toUpperCase()}`],
  });
  const appEnv = process.env.EXPO_PUBLIC_APP_ENV ?? 'local';
  // Staging builds are release candidates on the stores' internal tracks (TRD §17), so they are
  // the production app; preview builds install beside it as `.preview`, local ones as `.dev`.
  const storeApp = appEnv === 'production' || appEnv === 'staging';
  const suffix = storeApp ? '' : appEnv === 'preview' ? '.preview' : '.dev';
  // EAS (infra/eas/README.md): one EAS project per variant, since each is its own store app.
  // EAS_PROJECT_ID_<VARIANT> wins; EAS_PROJECT_ID is the fallback a single-variant build sets.
  const variantKey = (process.env.APP_VARIANT || 'all').toUpperCase();
  const easProjectId = process.env[`EAS_PROJECT_ID_${variantKey}`] || process.env.EAS_PROJECT_ID;

  const name = appEnv === 'production' ? variant.appName.en : `${variant.appName.en} (${appEnv})`;
  const deepLink = new URL(variant.deepLinkPrefix);
  const accent = accentHex(variant.accentColor as AccentRef);
  const splashBg = accentHex(variant.splash.backgroundToken as AccentRef);
  const adaptiveBg = accentHex(variant.androidAdaptiveIcon.backgroundToken as AccentRef);

  return {
    ...config,
    name,
    slug: `smriti-${variant.id}`,
    version: '1.0.0',
    runtimeVersion: { policy: 'appVersion' },
    // EAS Update: each variant's channel (eas.json) on its own project.
    ...(easProjectId ? { updates: { url: `https://u.expo.dev/${easProjectId}` } } : {}),
    orientation: 'portrait',
    scheme: variant.scheme,
    userInterfaceStyle: 'automatic',
    icon: brand(variant.icon),
    primaryColor: accent,
    ios: {
      bundleIdentifier: `${variant.bundleId}${suffix}`,
      supportsTablet: true,
      usesAppleSignIn: true,
      // Universal links on the brand domain; the site serves the apple-app-site-association file.
      associatedDomains: [`applinks:${deepLink.host}`],
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        // One OAuth URL scheme per variant bundle id (public, not a secret).
        CFBundleURLTypes: variant.googleIosUrlScheme ? [{ CFBundleURLSchemes: [variant.googleIosUrlScheme] }] : [],
      },
      // Widgets (NTF-08..10): the App Group the snapshot is written to, one per environment so
      // dev, preview and production builds installed side by side keep their own data.
      entitlements: {
        'com.apple.security.application-groups': [`group.${variant.bundleId}${suffix}`],
        // App Attest (G-10): the production environment for store builds, development otherwise
        // (matches the API's APP_ATTEST_ENVIRONMENT).
        'com.apple.developer.devicecheck.appattest-environment': storeApp ? 'production' : 'development',
      },
    },
    android: {
      package: `${variant.androidPackage}${suffix}`,
      adaptiveIcon: {
        foregroundImage: brand(variant.androidAdaptiveIcon.foreground),
        monochromeImage: brand(variant.androidAdaptiveIcon.monochrome),
        backgroundColor: adaptiveBg,
      },
      // No advertising id, ever (AGENTS.md rule 8).
      blockedPermissions: ['com.google.android.gms.permission.AD_ID'],
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host: deepLink.host, pathPrefix: deepLink.pathname }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    web: { bundler: 'metro', output: 'single' },
    plugins: [
      // Web preview: each route is its own chunk, loaded when opened (heavy screens such as the
      // mock runner, labs and the tutor stay out of the first load). Native keeps one bundle.
      ['expo-router', { asyncRoutes: { web: true, default: 'development' } }],
      'expo-font',
      'expo-secure-store',
      'expo-sqlite',
      'expo-localization',
      'expo-apple-authentication',
      // PRC-13: the result card is captured on the device and handed to the OS share sheet.
      'expo-sharing',
      ['expo-notifications', { color: accent }],
      // AI photo doubts (AI-07 / PRC-01 "Snap a doubt"): one photo of one question, never the mic.
      ['expo-image-picker', { photosPermission: 'Choose a photo of a question you want help with.', cameraPermission: 'Take a photo of a question you want help with.', microphonePermission: false }],
      ['expo-splash-screen', { image: brand(variant.splash.image), imageWidth: 160, backgroundColor: splashBg }],
      // Home-screen widgets (G-5, NTF-08..10): WidgetKit extension and Android AppWidgets.
      './plugins/widgets/index.cjs',
    ],
    experiments: { typedRoutes: false },
    extra: {
      variantId: variant.id,
      router: { origin: false },
      eas: easProjectId ? { projectId: easProjectId } : undefined,
    },
  };
};
