import type { CryptoLike } from '@smriti/app-core';
import * as ExpoCrypto from 'expo-crypto';

/** app-core's `CryptoLike` on expo-crypto (random bytes and SHA-256). */
export const expoCrypto: CryptoLike = {
  getRandomValues<T extends Uint8Array>(array: T): T {
    return ExpoCrypto.getRandomValues(array);
  },
  subtle: {
    async digest(_algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> {
      return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(data) as Uint8Array<ArrayBuffer>);
    },
  },
};
