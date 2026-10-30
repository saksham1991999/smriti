import type { KeyValueStore } from '@smriti/app-core';
import * as SecureStore from 'expo-secure-store';

/**
 * Tokens in the Keychain / Keystore (TRD §3: excluded from backups, this device only).
 * Keys are namespaced per app variant so two Smriti apps never share a session.
 */
export class SecureKeyValueStore implements KeyValueStore {
  constructor(private readonly prefix: string) {}
  private key(k: string) {
    // SecureStore keys allow [A-Za-z0-9._-] only.
    return `${this.prefix}.${k}`.replace(/[^A-Za-z0-9._-]/g, '_');
  }
  async get(key: string) {
    return SecureStore.getItemAsync(this.key(key), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  }
  async set(key: string, value: string) {
    await SecureStore.setItemAsync(this.key(key), value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  }
  async delete(key: string) {
    await SecureStore.deleteItemAsync(this.key(key));
  }
}
