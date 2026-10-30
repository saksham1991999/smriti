/**
 * The small slice of WebCrypto the shared code needs. Web passes `globalThis.crypto`; React
 * Native passes `expo-crypto` or `react-native-quick-crypto` wrapped to this shape; tests pass
 * Node's `webcrypto`.
 */
export interface CryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
  subtle: {
    digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
  };
}

/** UTF-8 bytes of a string (no TextEncoder dependency). */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(out);
}

export function toHex(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of view) s += b.toString(16).padStart(2, '0');
  return s;
}

export async function sha256Hex(crypto: CryptoLike, data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? utf8Encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

export interface Nonce {
  /** Passed to Supabase (`linkIdentity` / `signInWithIdToken`). */
  raw: string;
  /** SHA-256 hex of `raw`, passed to Google or Apple (TRD §6). */
  hashed: string;
}

/** A fresh sign-in nonce: 32 random bytes as hex, plus its SHA-256 hex digest. */
export async function createNonce(crypto: CryptoLike, byteLength = 32): Promise<Nonce> {
  const raw = toHex(crypto.getRandomValues(new Uint8Array(byteLength)));
  return { raw, hashed: await sha256Hex(crypto, raw) };
}

/**
 * A UUIDv7 (RFC 9562): 48-bit Unix milliseconds, version 7, variant 10, random tail.
 * Event ids are UUIDv7 so they sort by time and double as idempotency keys (sync contract).
 */
export function uuidv7(crypto: Pick<CryptoLike, 'getRandomValues'>, nowMs: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ts = Math.max(0, Math.floor(nowMs));
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const h = toHex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Monotonic UUIDv7 generator: ids made in the same millisecond still sort in call order. */
export function createIdGenerator(crypto: Pick<CryptoLike, 'getRandomValues'>, clock: () => number): () => string {
  let last = 0;
  return () => {
    const now = clock();
    last = now > last ? now : last + 1;
    return uuidv7(crypto, last);
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
