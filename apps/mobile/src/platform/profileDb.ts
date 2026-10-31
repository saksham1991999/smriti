import type { KeyValueStore, Storage } from '@smriti/app-core';
import * as SQLite from 'expo-sqlite';

import { SecureKeyValueStore } from './secureStore';
import { SqliteKeyValueStore, SqliteStorage, type SqlDb } from './sqliteStorage';

export interface ProfileStores {
  storage: Storage;
  /** Non-secret key-value data: onboarding state, soft-prompt budget, settings. */
  kv: KeyValueStore;
  /** Tokens (Keychain / Keystore). */
  secure: KeyValueStore;
  /** "sqlite" on device; "memory" in the web preview. */
  kind: 'sqlite' | 'memory';
}

/**
 * Opens the local profile database. The file starts as `smriti-local.db` (onboarding §6.1 gap:
 * there is no user id offline); sign-out wipes it and the next guest reuses the file.
 */
export async function openProfileStores(variantId: string): Promise<ProfileStores> {
  const db = await SQLite.openDatabaseAsync(`smriti-${variantId}-local.db`);
  const sql = db as unknown as SqlDb;
  const storage = await SqliteStorage.open(sql);
  const kv = await SqliteKeyValueStore.open(sql);
  return { storage, kv, secure: new SecureKeyValueStore(`smriti.${variantId}`), kind: 'sqlite' };
}
