import type { TypedBundle } from '@smriti/content-schema/runtime';
import { PlayerProvider } from '@smriti/lesson-player-native';
import { useMemo, type ReactNode } from 'react';

import { useT } from '../services/context';

/**
 * lesson-player-native's question renderers outside a lesson (mocks, drills, the daily challenge,
 * solutions). Server questions come without a lesson bundle, so maths with no build-time SVG shows
 * its TeX source (RichText's fallback) and media resolves from the CDN only.
 */
const EMPTY_BUNDLE = { math: {}, cards: [], questions: {}, mnemonics: {}, sheets: {} } as unknown as TypedBundle;

export function QuestionHost({ children, online = true }: { children: ReactNode; online?: boolean }) {
  const t = useT();
  const ctx = useMemo(() => ({ t, bundle: EMPTY_BUNDLE, resolveMedia: () => undefined, online }), [t, online]);
  return <PlayerProvider value={ctx}>{children}</PlayerProvider>;
}
