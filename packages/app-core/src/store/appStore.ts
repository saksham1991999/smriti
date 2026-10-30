import { createStore, type StoreApi } from 'zustand/vanilla';

import { SNAPSHOT_SECTIONS, applyServerState, type SyncStatus } from '../sync/client';
import type {
  EntitlementSection,
  PetSection,
  PlantSection,
  ProfileSection,
  StreakSection,
  SyncStateResponse,
  WalletSection,
} from '../sync/types';
import type { Storage } from '../storage/types';

/**
 * The shared UI store (Zustand, vanilla: no React import here). Holds the session and the Home
 * header sections: profile, streak, plant, pet and wallet, plus the entitlement. Server data wins:
 * `applyServerState` replaces each section it receives; optimistic updates are `patch` calls that
 * the next sync overwrites.
 */

export type SessionStatus = 'booting' | 'local_guest' | 'guest' | 'signed_in' | 'session_ended';

export interface SessionSlice {
  status: SessionStatus;
  userId: string | null;
  isGuest: boolean;
}

export interface AppState {
  session: SessionSlice;
  profile: ProfileSection | null;
  streak: StreakSection | null;
  plant: PlantSection | null;
  pet: PetSection | null;
  wallet: WalletSection | null;
  entitlement: EntitlementSection | null;
  syncStatus: SyncStatus;
  stateVersion: number;
  /** ISO time of the last server state applied ("Updated {time}" when offline). */
  updatedAt: string | null;

  setSession(session: Partial<SessionSlice>): void;
  setSyncStatus(status: SyncStatus): void;
  /** Server wins: each section present replaces the local one. */
  applyServerState(state: SyncStateResponse, nowIso: string): void;
  /** Optimistic local change (LES-08 renders instantly; the server replaces it on sync). */
  patch<K extends AppSectionKey>(key: K, value: Partial<NonNullable<AppState[K]>>): void;
  /** Sign-out: back to an empty booting state. */
  reset(): void;
}

export type AppSectionKey = 'profile' | 'streak' | 'plant' | 'pet' | 'wallet' | 'entitlement';

export type AppStore = StoreApi<AppState>;

type Data = Omit<AppState, 'setSession' | 'setSyncStatus' | 'applyServerState' | 'patch' | 'reset'>;

const EMPTY: Data = {
  session: { status: 'booting', userId: null, isGuest: true },
  profile: null,
  streak: null,
  plant: null,
  pet: null,
  wallet: null,
  entitlement: null,
  syncStatus: 'idle',
  stateVersion: 0,
  updatedAt: null,
};

export function createAppStore(initial: Partial<Data> = {}): AppStore {
  return createStore<AppState>()((set) => ({
    ...EMPTY,
    ...initial,
    setSession: (s) => set((st) => ({ session: { ...st.session, ...s } })),
    setSyncStatus: (syncStatus) => set({ syncStatus }),
    applyServerState: (state, nowIso) =>
      set((st) => {
        const next: Partial<Data> = { stateVersion: Math.max(st.stateVersion, state.state_version), updatedAt: nowIso };
        if (state.profile) next.profile = state.profile;
        if (state.streak) next.streak = state.streak;
        if (state.plant) next.plant = state.plant;
        if (state.pet !== undefined) next.pet = state.pet;
        if (state.wallet) next.wallet = state.wallet;
        if (state.entitlement) next.entitlement = state.entitlement;
        if (state.profile) next.session = { ...st.session, isGuest: state.profile.is_guest, userId: state.profile.id };
        return next;
      }),
    patch: (key, value) =>
      set((st) => {
        const current = st[key];
        if (!current) return {};
        return { [key]: { ...current, ...value } } as Partial<Data>;
      }),
    reset: () => set({ ...EMPTY }),
  }));
}

/** Fills the store from the profile snapshot so Home renders before any network call. */
export async function hydrateAppStore(store: AppStore, storage: Pick<Storage, 'profile_snapshot' | 'session_state'>): Promise<void> {
  const rows = await storage.profile_snapshot.getMany([...SNAPSHOT_SECTIONS]);
  const patch: Partial<Data> = {};
  let updatedAt: string | null = null;
  for (const row of rows) {
    (patch as Record<string, unknown>)[row.key] = row.data;
    if (!updatedAt || row.updated_at > updatedAt) updatedAt = row.updated_at;
  }
  const version = await storage.session_state.get('sync.state_version');
  store.setState({ ...patch, updatedAt, stateVersion: typeof version?.data === 'number' ? version.data : 0 });
}

/** Writes server state to storage (in one transaction) and then to the store. */
export async function applyStateEverywhere(store: AppStore, storage: Storage, state: SyncStateResponse, nowMs: number): Promise<void> {
  await storage.transaction((tx) => applyServerState(tx, state, nowMs));
  store.getState().applyServerState(state, new Date(nowMs).toISOString());
}
