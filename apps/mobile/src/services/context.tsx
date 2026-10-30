import { useStoreSelector } from '@smriti/app-core/react';
import type { MessageKey, MessageValues } from '@smriti/i18n';
import { createContext, useCallback, useContext, type ReactNode } from 'react';

import type { SmritiApp, UiState } from './app';

const AppContext = createContext<SmritiApp | null>(null);

export function AppProvider({ app, children }: { app: SmritiApp; children: ReactNode }) {
  return <AppContext.Provider value={app}>{children}</AppContext.Provider>;
}

export function useApp(): SmritiApp {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp needs <AppProvider>');
  return app;
}

export function useUiState<T>(selector: (s: UiState) => T): T {
  return useStoreSelector(useApp().ui, selector);
}

/** Screen copy from the i18n catalogues (`onboarding:ONB-01.headline_all_exams`). Re-renders on locale change. */
export function useT(): (key: MessageKey, values?: MessageValues) => string {
  const app = useApp();
  const locale = useUiState((s) => s.locale);
  return useCallback((key: MessageKey, values?: MessageValues) => app.t(key, values), [app, locale]);
}
