import type { CryptoLike, KeyValueStore } from '@smriti/app-core';

const KEY = 'device.id.v1';

/** A random UUID v4 (the sync contract's `device_id`). Not tied to hardware or ad ids (DPDP). */
export function randomUuid(crypto: CryptoLike): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The per-install id, made once and kept in the profile's key-value store. */
export async function installDeviceId(kv: KeyValueStore, crypto: CryptoLike): Promise<string> {
  const existing = await kv.get(KEY);
  if (existing) return existing;
  const id = randomUuid(crypto);
  await kv.set(KEY, id);
  return id;
}
