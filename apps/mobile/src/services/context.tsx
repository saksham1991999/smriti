import { useStoreSelector } from '@smriti/app-core/react';
import type { MessageKey, MessageValues } from '@smriti/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from '@smriti/api-client/react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import type { SmritiApp, UiState } from './app';

const AppContext = createContext<SmritiApp | null>(null);

/** Server data that is not progress (practice hub, mocks, tutor) goes through TanStack Query. */
function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000, gcTime: 5 * 60_000 } } });
}

export function AppProvider({ app, children }: { app: SmritiApp; children: ReactNode }) {
  const [queries] = useState(newQueryClient);
  // api-client's hooks key queries without the account, so a different account or plan starts
  // from an empty cache (our own keys carry useQueryScope as well).
  useEffect(() => {
    let scope = scopeOf(app);
    return app.store.subscribe(() => {
      const next = scopeOf(app);
      if (next !== scope) {
        scope = next;
        queries.clear();
      }
    });
  }, [app, queries]);
  return (
    <AppContext.Provider value={app}>
      <QueryClientProvider client={queries}>
        <ApiProvider client={app.api}>{children}</ApiProvider>
      </QueryClientProvider>
    </AppContext.Provider>
  );
}

function scopeOf(app: SmritiApp): string {
  const s = app.store.getState();
  return `${s.session.userId ?? 'none'}|${s.entitlement?.plan ?? 'free'}`;
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

/**
 * The part of a server-data query key that changes with who is asking: the user, guest or signed
 * in, and free or Pro. Linking or buying Pro then refetches the hub, mocks and tutor quota.
 */
export function useQueryScope(): string {
  return useStoreSelector(useApp().store, (s) => `${s.session.userId ?? 'none'}|${s.session.status}|${s.entitlement?.plan ?? 'free'}`);
}
