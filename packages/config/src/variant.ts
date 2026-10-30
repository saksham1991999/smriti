import { z } from 'zod';

import allJson from '../variants/all.json';
import jeeJson from '../variants/jee.json';
import neetJson from '../variants/neet.json';
import sscJson from '../variants/ssc.json';
import upscJson from '../variants/upsc.json';

/** Every app variant published to the stores (TRD §3.1). */
export const VARIANT_IDS = ['all', 'jee', 'neet', 'upsc', 'ssc'] as const;
export type VariantId = (typeof VARIANT_IDS)[number];

const localised = z.object({ en: z.string().min(1), hi: z.string().min(1) });
const assetPath = z.string().regex(/^brand\/[a-z0-9/_.-]+\.png$/, 'a PNG under brand/');
const tokenRef = z.string().regex(/^examAccent\.(all|jee|neet|upsc|ssc)(\.(light|dark))?$/, 'an examAccent token');
const reverseDns = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/, 'a reverse-DNS id');

export const variantSchema = z
  .object({
    id: z.enum(VARIANT_IDS),
    /** Brand strings live in config (AGENTS.md: "Smriti" is a working name). */
    appName: localised,
    bundleId: reverseDns,
    androidPackage: reverseDns,
    scheme: z.string().regex(/^smriti-[a-z]+$/),
    authCallbackScheme: z.string().regex(/^smriti-[a-z]+$/),
    deepLinkPrefix: z.string().url(),
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
    examIds: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
    /** Current-cycle exam profile ids (`content.exam_profiles.id`), refreshed each cycle. */
    examProfileIds: z.array(z.string().regex(/^[a-z0-9-]+$/)),
    showExamSwitcher: z.boolean(),
    /** Release phase (PRD §17, R7): SSC ships in Phase 2. */
    phase: z.number().int().min(1).max(3),
    storeListing: z.object({
      titleKey: z.string(),
      subtitleKey: z.string(),
      descriptionKey: z.string(),
    }),
    revenuecatOfferingId: z.string().min(1),
    products: z.object({ proMonthlyIntro: z.string().min(1), proMonthly: z.string().min(1) }),
    /** Public ids, one iOS OAuth client per bundle id. Empty until the Google Cloud project exists. */
    googleIosClientId: z.string(),
    googleIosUrlScheme: z.string(),
  })
  .superRefine((v, ctx) => {
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
  });

export type Variant = z.infer<typeof variantSchema>;

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
      out[id] = parsed;
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
  return variantSchema.parse({
    ...base,
    googleIosClientId: overrides.googleIosClientId ?? base.googleIosClientId,
    googleIosUrlScheme: overrides.googleIosUrlScheme ?? base.googleIosUrlScheme,
  });
}

function assertVariantId(id: string): VariantId {
  if (!isVariantId(id)) throw new Error(`Unknown APP_VARIANT "${id}". Expected one of ${VARIANT_IDS.join(', ')}`);
  return id;
}
