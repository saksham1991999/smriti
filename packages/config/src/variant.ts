import { z } from 'zod/mini';

import brandJson from '../brand.json';
import allJson from '../variants/all.json';
import jeeJson from '../variants/jee.json';
import neetJson from '../variants/neet.json';
import sscJson from '../variants/ssc.json';
import upscJson from '../variants/upsc.json';

/** Every app variant published to the stores (TRD §3.1). */
export const VARIANT_IDS = ['all', 'jee', 'neet', 'upsc', 'ssc'] as const;
export type VariantId = (typeof VARIANT_IDS)[number];

const localised = z.object({ en: z.string().check(z.minLength(1)), hi: z.string().check(z.minLength(1)) });
const assetPath = z.string().check(z.regex(/^brand\/[a-z0-9/_.-]+\.png$/, 'a PNG under brand/'));
const tokenRef = z.string().check(z.regex(/^examAccent\.(all|jee|neet|upsc|ssc)(\.(light|dark))?$/, 'an examAccent token'));
const reverseDns = z.string().check(z.regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/, 'a reverse-DNS id'));

export const variantSchema = z
  .object({
    id: z.enum(VARIANT_IDS),
    /** Brand strings live in config (AGENTS.md: "Smriti" is a working name). */
    appName: localised,
    bundleId: reverseDns,
    androidPackage: reverseDns,
    scheme: z.string().check(z.regex(/^smriti-[a-z]+$/)),
    authCallbackScheme: z.string().check(z.regex(/^smriti-[a-z]+$/)),
    /** Path on the brand domain this variant's app links claim: `/` for all exams, `/jee` for JEE. */
    deepLinkPath: z.string().check(z.regex(/^\/([a-z]+)?$/, 'a path like / or /jee')),
    icon: assetPath,
    androidAdaptiveIcon: z.object({
      foreground: assetPath,
      monochrome: assetPath,
      backgroundToken: tokenRef,
    }),
    splash: z.object({ image: assetPath, backgroundToken: tokenRef }),
    /** A token name in packages/tokens/tokens.json, never a raw hex value. */
    accentColor: tokenRef,
    /** Stable exam ids (`content.exams.id`). The API resolves each exam's active profile. */
    examIds: z.array(z.string().check(z.regex(/^[a-z0-9-]+$/))).check(z.minLength(1)),
    /** Current-cycle exam profile ids (`content.exam_profiles.id`), refreshed each cycle. */
    examProfileIds: z.array(z.string().check(z.regex(/^[a-z0-9-]+$/))),
    showExamSwitcher: z.boolean(),
    /** Release phase (PRD §17, R7): SSC ships in Phase 2. */
    phase: z.int().check(z.gte(1), z.lte(3)),
    storeListing: z.object({
      titleKey: z.string(),
      subtitleKey: z.string(),
      descriptionKey: z.string(),
    }),
    revenuecatOfferingId: z.string().check(z.minLength(1)),
    products: z.object({ proMonthlyIntro: z.string().check(z.minLength(1)), proMonthly: z.string().check(z.minLength(1)) }),
    /** Public ids, one iOS OAuth client per bundle id. Empty until the Google Cloud project exists. */
    googleIosClientId: z.string(),
    googleIosUrlScheme: z.string(),
  })
  .check(
    z.superRefine((v, ctx) => {
      if (v.scheme !== `smriti-${v.id}`) {
        ctx.addIssue({ code: 'custom', path: ['scheme'], message: `scheme must be smriti-${v.id}` });
      }
      if (v.authCallbackScheme !== v.scheme) {
        ctx.addIssue({ code: 'custom', path: ['authCallbackScheme'], message: 'must equal scheme' });
      }
      if (!v.accentColor.startsWith(`examAccent.${v.id}`)) {
        ctx.addIssue({ code: 'custom', path: ['accentColor'], message: `must be examAccent.${v.id}` });
      }
      if (v.googleIosClientId !== '' && !v.googleIosClientId.endsWith('.apps.googleusercontent.com')) {
        ctx.addIssue({ code: 'custom', path: ['googleIosClientId'], message: 'not a Google client id' });
      }
    }),
  );

const brandSchema = z.object({
  domain: z.string().check(z.regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'a bare domain like example.org')),
});

export type Brand = z.infer<typeof brandSchema>;

/** The brand domain (packages/config/brand.json). The site and app links live on it. */
export function brand(): Brand {
  return brandSchema.parse(brandJson);
}

/** `https://<brand domain><path>`, without a trailing slash except for the bare origin. */
export function deepLinkPrefix(path: string, domain: string = brand().domain): string {
  return path === '/' ? `https://${domain}` : `https://${domain}${path}`;
}

/** A variant file plus `deepLinkPrefix`, its app-link origin and path on the brand domain. */
export type Variant = z.infer<typeof variantSchema> & { deepLinkPrefix: string };

function withPrefix(v: z.infer<typeof variantSchema>): Variant {
  return { ...v, deepLinkPrefix: deepLinkPrefix(v.deepLinkPath) };
}

const RAW: Record<VariantId, unknown> = {
  all: allJson,
  jee: jeeJson,
  neet: neetJson,
  upsc: upscJson,
  ssc: sscJson,
};

let cache: Record<VariantId, Variant> | undefined;

/** All variants, validated once. Throws if a variant file is invalid. */
export function allVariants(): Record<VariantId, Variant> {
  if (!cache) {
    const out = {} as Record<VariantId, Variant>;
    for (const id of VARIANT_IDS) {
      const parsed = variantSchema.parse(RAW[id]);
      if (parsed.id !== id) throw new Error(`variants/${id}.json has id ${parsed.id}`);
      out[id] = withPrefix(parsed);
    }
    cache = out;
  }
  return cache;
}

export function isVariantId(value: unknown): value is VariantId {
  return typeof value === 'string' && (VARIANT_IDS as readonly string[]).includes(value);
}

export interface VariantOverrides {
  /** From env: `GOOGLE_IOS_CLIENT_ID_<VARIANT>` (public ids, not secrets). */
  googleIosClientId?: string;
  googleIosUrlScheme?: string;
}

/**
 * The variant for `APP_VARIANT` (defaults to `all`), with the public Google ids filled from env.
 */
export function getVariant(id: string | undefined, overrides: VariantOverrides = {}): Variant {
  const key: VariantId = id === undefined || id === '' ? 'all' : assertVariantId(id);
  const base = allVariants()[key];
  const { deepLinkPrefix: _prefix, ...file } = base;
  return withPrefix(
    variantSchema.parse({
      ...file,
      googleIosClientId: overrides.googleIosClientId ?? base.googleIosClientId,
      googleIosUrlScheme: overrides.googleIosUrlScheme ?? base.googleIosUrlScheme,
    }),
  );
}

function assertVariantId(id: string): VariantId {
  if (!isVariantId(id)) throw new Error(`Unknown APP_VARIANT "${id}". Expected one of ${VARIANT_IDS.join(', ')}`);
  return id;
}
