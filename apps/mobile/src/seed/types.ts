import type { ImageSourcePropType } from 'react-native';

/** The seed pack files for one locale, as require()d by src/seed/generated/index.ts. */
export interface SeedPackFiles {
  pack: SeedPackJson;
  /** Path in the pack → lazy JSON loader. */
  manifests: Record<string, () => unknown>;
  bundles: Record<string, () => unknown>;
  /** `assets/<sha256>.webp` → bundled image. */
  assets: Record<string, ImageSourcePropType>;
}

export interface SeedPackJson {
  schema: 'seed-pack@1';
  variant_id: string;
  locale: 'en' | 'hi';
  fixture?: boolean;
  hash: string;
  manifests: { exam_profile: string; path: string; hash: string; version: number }[];
  bundles: { id: string; hash: string; path: string; size_bytes: number }[];
}
