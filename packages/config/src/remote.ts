import { z } from 'zod';

import { createFlags, type Flags } from './flags';

/**
 * The parts of `GET /v1/config` the shared packages read (TRD §5.1). The API's Pydantic model is
 * the source of truth; unknown fields pass through so a newer server never breaks an older app.
 */
export const remoteConfigSchema = z
  .object({
    variant: z.string(),
    min_version: z.string(),
    latest_version: z.string(),
    flags: z.record(z.string(), z.unknown()).default({}),
    maintenance: z
      .object({ active: z.boolean(), mode: z.string().optional(), until: z.string().optional() })
      .partial()
      .optional(),
  })
  .passthrough();

export type RemoteConfig = z.infer<typeof remoteConfigSchema>;

export interface ResolvedConfig {
  raw: RemoteConfig;
  flags: Flags;
  /** True when the running app is older than `min_version` (forced update). */
  updateRequired: boolean;
  updateAvailable: boolean;
}

/** Compares dotted numeric versions ("1.10.2" > "1.9.9"). Non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function resolveRemoteConfig(input: unknown, appVersion: string): ResolvedConfig {
  const raw = remoteConfigSchema.parse(input);
  return {
    raw,
    flags: createFlags(raw.flags),
    updateRequired: compareVersions(appVersion, raw.min_version) < 0,
    updateAvailable: compareVersions(appVersion, raw.latest_version) < 0,
  };
}
