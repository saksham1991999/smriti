import { useMemo } from 'react';

import { createHaptics, type Haptics } from '../platform/haptics';
import { useApp } from '../services/context';

/** Haptics that follow the Settings switch (SET-08); the OS setting applies on iOS by itself. */
export function useHaptics(): Haptics {
  const app = useApp();
  return useMemo(() => createHaptics(() => app.ui.getState().haptics), [app]);
}

/** Minutes, rounded up, for "{minutes} min" tiles. */
export function minutesOf(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}
