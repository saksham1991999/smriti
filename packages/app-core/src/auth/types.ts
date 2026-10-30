export type AuthProvider = 'google' | 'apple';

export interface AuthUser {
  id: string;
  isAnonymous: boolean;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch seconds. */
  expiresAt: number | null;
  user: AuthUser;
}

/** An ID token from Google or Apple, obtained with `nonce.hashed`; `nonce` here is the raw value. */
export interface IdTokenCredential {
  provider: AuthProvider;
  idToken: string;
  nonce: string;
  accessToken?: string;
}

export type LinkResult = { status: 'linked'; session: AuthSession } | { status: 'identity_already_exists' };

export type AuthErrorCode =
  | 'identity_already_exists'
  | 'network'
  | 'rate_limited'
  | 'session_ended'
  | 'user_banned'
  | 'nonce_mismatch'
  | 'invalid_credentials'
  | 'not_signed_in'
  | 'unknown';

/** Errors carry a code from a fixed list (analytics `auth_provider_result.error_code`). */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message?: string,
    readonly status?: number,
  ) {
    super(message ?? code);
    this.name = 'AuthError';
  }
}

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED';

/**
 * One auth interface for Supabase (staging, production) and the dev API (local, test), so
 * switching is config only (sync contract "Dev auth").
 */
export interface AuthClient {
  getSession(): Promise<AuthSession | null>;
  getAccessToken(): Promise<string | null>;
  /** First launch: a real `auth.users` row flagged anonymous (TRD §6). Web passes a Turnstile token. */
  signInAnonymously(opts?: { captchaToken?: string }): Promise<AuthSession>;
  /** Upgrade the current guest in place. `identity_already_exists` starts the merge path. */
  linkIdentity(credential: IdTokenCredential): Promise<LinkResult>;
  /** Restore, merge and switch-account: sign in to the account that owns the identity. */
  signInWithIdToken(credential: IdTokenCredential): Promise<AuthSession>;
  refreshSession(): Promise<AuthSession | null>;
  signOut(opts?: { scope?: 'local' | 'global' }): Promise<void>;
  onAuthStateChange(listener: (event: AuthEvent, session: AuthSession | null) => void): () => void;
}

/** Reads the claims of a JWT without verifying it (the API verifies). */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = base64Decode(b64);
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Decode(input: string): string {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of input) {
    if (ch === '=') break;
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('bad base64');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  // UTF-8 decode
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++] ?? 0;
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b < 0xe0) cp = ((b & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    else if (b < 0xf0) cp = ((b & 0x0f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    else
      cp =
        ((b & 0x07) << 18) |
        (((bytes[i++] ?? 0) & 0x3f) << 12) |
        (((bytes[i++] ?? 0) & 0x3f) << 6) |
        ((bytes[i++] ?? 0) & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}
