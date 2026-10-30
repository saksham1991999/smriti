import { InMemoryStorage, MemoryKeyValueStore } from '@smriti/app-core';

import type { ProfileStores } from './profileDb';

/**
 * Web preview only (`expo start --web`, react-native-web). The real web app is apps/web with
 * IndexedDB. The preview keeps the whole profile in memory, so a reload starts a fresh guest.
 */
export async function openProfileStores(_variantId: string): Promise<ProfileStores> {
  return { storage: new InMemoryStorage(), kv: new MemoryKeyValueStore(), secure: new MemoryKeyValueStore(), kind: 'memory' };
}
