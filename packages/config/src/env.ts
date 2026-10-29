import { z } from 'zod';

import { VARIANT_IDS } from './variant';

/**
 * Public client configuration (mobile and web). Every value here ships inside the app bundle,
 * so it must never hold a secret (AGENTS.md rule 5). Expo reads `EXPO_PUBLIC_*`, Vite reads
 * `VITE_*`; `parseClientEnv` strips either prefix.
 */
export const APP_ENVS = ['local', 'test', 'preview', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const optionalUrl = z
  .string()
  .url()
  .optional()
  .or(z.literal('').transform(() => undefined));
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const clientEnvSchema = z
  .object({
    APP_ENV: z.enum(APP_ENVS).default('local'),
    APP_VARIANT: z.enum(VARIANT_IDS).default('all'),
    /** Base URL of the FastAPI service, without `/v1`. */
    API_BASE_URL: z.string().url(),
    CDN_BASE_URL: optionalUrl,
    /** `supabase` uses Supabase Auth; `dev` uses `/v1/dev/auth/*` (only APP_ENV local or test). */
    AUTH_MODE: z.enum(['supabase', 'dev']).default('dev'),
    SUPABASE_URL: optionalUrl,
    /** The anon key is public by design (RLS protects data). */
    SUPABASE_ANON_KEY: optionalString,
    /** Public OAuth client ids. Android and web use the web client id. */
    GOOGLE_WEB_CLIENT_ID: optionalString,
    GOOGLE_IOS_CLIENT_ID: optionalString,
    GOOGLE_IOS_URL_SCHEME: optionalString,
    TURNSTILE_SITE_KEY: optionalString,
    SENTRY_DSN: optionalString,
    /** Product analytics ingest (the API's event endpoint); empty turns product analytics off. */
    ANALYTICS_URL: optionalUrl,
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'supabase') {
      if (!env.SUPABASE_URL) ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'required when AUTH_MODE=supabase' });
      if (!env.SUPABASE_ANON_KEY) {
        ctx.addIssue({ code: 'custom', path: ['SUPABASE_ANON_KEY'], message: 'required when AUTH_MODE=supabase' });
      }
    }
    if (env.AUTH_MODE === 'dev' && env.APP_ENV !== 'local' && env.APP_ENV !== 'test') {
      ctx.addIssue({ code: 'custom', path: ['AUTH_MODE'], message: 'dev auth only runs with APP_ENV local or test' });
    }
  });

export type ClientEnv = z.infer<typeof clientEnvSchema>;

const PREFIXES = ['EXPO_PUBLIC_', 'VITE_'] as const;
const CLIENT_KEYS = Object.keys(clientEnvSchema.shape ?? {});

/**
 * Reads the client env from `process.env` (Expo) or `import.meta.env` (Vite), accepting the
 * platform prefixes. Throws a readable error listing the invalid names (never their values).
 */
export function parseClientEnv(raw: Record<string, string | undefined>): ClientEnv {
  const picked: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    let key = name;
    for (const p of PREFIXES) if (key.startsWith(p)) key = key.slice(p.length);
    if (CLIENT_KEYS.includes(key) && !(key in picked && name === key)) picked[key] = value;
  }
  const result = clientEnvSchema.safeParse(picked);
  if (!result.success) {
    const names = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid client env: ${names}`);
  }
  return result.data;
}

/**
 * Server-only variable names (TRD §17). Values live in Railway, Cloudflare and EAS secrets.
 * Listed so tools can check a deployment has them; clients must never read these.
 */
export const SERVER_ENV_NAMES = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWKS_URL',
  'DATABASE_URL',
  'REDIS_URL',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_ASSETS',
  'R2_BUCKET_CONTENT',
  'R2_BUCKET_UPLOADS',
  'R2_BUCKET_STAGING',
  'CDN_BASE_URL',
  'AGNES_AI_API_KEY',
  'AGNES_BASE_URL',
  'AI_TIER_TUTOR_MODEL',
  'AI_TIER_CHEAP_MODEL',
  'AI_TIER_AUTHOR_MODEL',
  'GEMINI_API_KEY',
  'DEEPGRAM_API_KEY',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
  'CLICKHOUSE_URL',
  'CLICKHOUSE_USER',
  'CLICKHOUSE_PASSWORD',
  'CLICKHOUSE_DATABASE',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'REVENUECAT_API_KEY',
  'REVENUECAT_WEBHOOK_SECRET',
  'EXPO_ACCESS_TOKEN',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'GOOGLE_OAUTH_WEB_CLIENT_ID',
  'AUTH_IDENTITY_HASH_PEPPER',
  'AUTH_MANAGED_IDENTITY_DOMAIN',
  'WEB_APP_URL',
  'TURNSTILE_SECRET_KEY',
] as const;

/** Names that are secret: a client env containing any of them is a build error. */
export const SECRET_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'R2_SECRET_ACCESS_KEY',
  'AGNES_AI_API_KEY',
  'GEMINI_API_KEY',
  'DEEPGRAM_API_KEY',
  'CLICKHOUSE_PASSWORD',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'REVENUECAT_API_KEY',
  'REVENUECAT_WEBHOOK_SECRET',
  'EXPO_ACCESS_TOKEN',
  'AUTH_IDENTITY_HASH_PEPPER',
  'TURNSTILE_SECRET_KEY',
] as const;

/** Returns the public-prefixed names that would leak a secret into a client bundle. */
export function findLeakedSecrets(raw: Record<string, string | undefined>): string[] {
  const leaked: string[] = [];
  for (const name of Object.keys(raw)) {
    for (const p of PREFIXES) {
      if (name.startsWith(p) && (SECRET_ENV_NAMES as readonly string[]).includes(name.slice(p.length))) leaked.push(name);
    }
  }
  return leaked;
}
