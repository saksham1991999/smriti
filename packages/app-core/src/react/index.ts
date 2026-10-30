/**
 * `@smriti/app-core/react`: React bindings for the shared stores. Depends only on `react`
 * (works in React DOM and React Native alike).
 */
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { StoreApi } from 'zustand/vanilla';

import type { AppState, AppStore } from '../store/appStore';
import type { SyncClient, SyncStatus } from '../sync/client';

/** Subscribes to a vanilla Zustand store with a selector (use stable selectors or primitives). */
export function useStoreSelector<S, T>(store: StoreApi<S>, selector: (state: S) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

const AppStoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider(props: { store: AppStore; children?: ReactNode }) {
  return createElement(AppStoreContext.Provider, { value: props.store }, props.children);
}

export function useAppStoreApi(): AppStore {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error('useAppStore needs <AppStoreProvider store={…}>');
  return store;
}

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStoreSelector(useAppStoreApi(), selector);
}

/** Convenience hooks for the Home header. */
export const useStreak = () => useAppStore((s) => s.streak);
export const usePlant = () => useAppStore((s) => s.plant);
export const usePet = () => useAppStore((s) => s.pet);
export const useWallet = () => useAppStore((s) => s.wallet);
export const useSession = () => useAppStore((s) => s.session);
export const useEntitlement = () => useAppStore((s) => s.entitlement);

/** The sync client's status ("Saving…", offline banner). */
export function useSyncStatus(client: Pick<SyncClient, 'getStatus' | 'onStatus'>): SyncStatus {
  return useSyncExternalStore(
    (cb) => client.onStatus(() => cb()),
    () => client.getStatus(),
    () => client.getStatus(),
  );
}
