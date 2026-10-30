import { AuthError, devIdToken, type DevIdentity, type IdTokenCredential, type Nonce } from '@smriti/app-core';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

/**
 * Native identity providers. Each returns an ID token obtained with `nonce.hashed`, plus the raw
 * nonce, for app-core's `AuthClient.linkIdentity` (guest upgrade) or `signInWithIdToken` (restore)
 * (TRD §6). `null` means the student closed the system sheet: one "Later" (auth flow §4).
 */
export interface GoogleSignInProvider {
  readonly kind: 'dev' | 'native';
  signIn(nonce: Nonce, dev?: DevIdentity): Promise<IdTokenCredential | null>;
  /** Clears the provider's own credential state on sign-out (TRD §6 sign-out). */
  signOut(): Promise<void>;
}

export interface AppleSignInProvider {
  isAvailable(): Promise<boolean>;
  signIn(nonce: Nonce): Promise<(IdTokenCredential & { fullName: string | null }) | null>;
}

/**
 * Local and test: no Google. The dev form on AUTH-04 asks for an email and a name, and the dev
 * API (`POST /v1/dev/auth/google`) mints a Supabase-shaped session for that identity
 * (sync contract "Dev auth"). Selected when EXPO_PUBLIC_GOOGLE_SIGNIN is not `native`.
 */
export class DevGoogleSignIn implements GoogleSignInProvider {
  readonly kind = 'dev' as const;
  async signIn(nonce: Nonce, dev?: DevIdentity): Promise<IdTokenCredential | null> {
    if (!dev) return null;
    return { provider: 'google', idToken: devIdToken(dev), nonce: nonce.raw };
  }
  async signOut() {}
}

/**
 * Production Google sign-in (decision D5): `@react-native-google-signin/google-signin`'s Universal
 * Sign In module, Credential Manager on Android and GoogleSignIn-iOS on iOS, with the hashed
 * nonce. The licensed module and the per-variant iOS client ids are not available in this
 * environment, so the native module is not linked yet; this class keeps the seam.
 * To turn it on: add the package and its config plugin (iosUrlScheme from the variant), set
 * EXPO_PUBLIC_GOOGLE_SIGNIN=native, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and the variant's
 * GOOGLE_IOS_CLIENT_ID_<VARIANT>, and implement `signIn` with
 * `GoogleOneTapSignIn.signIn({ nonce: nonce.hashed })`, returning `{ provider: 'google', idToken, nonce: nonce.raw }`.
 */
export class NativeGoogleSignIn implements GoogleSignInProvider {
  readonly kind = 'native' as const;
  constructor(private readonly config: { webClientId?: string; iosClientId?: string }) {}
  async signIn(): Promise<IdTokenCredential | null> {
    if (!this.config.webClientId) throw new AuthError('unknown', 'google_signin_not_configured');
    throw new AuthError('unknown', 'google_signin_module_not_linked');
  }
  async signOut() {}
}

/** Sign in with Apple, iOS only (App Store guideline 4.8), through expo-apple-authentication. */
export class ExpoAppleSignIn implements AppleSignInProvider {
  async isAvailable() {
    if (Platform.OS !== 'ios') return false;
    return AppleAuthentication.isAvailableAsync();
  }
  async signIn(nonce: Nonce) {
    try {
      const c = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: nonce.hashed,
      });
      if (!c.identityToken) throw new AuthError('unknown', 'apple_no_token');
      // Apple sends the name only on the first authorisation, so it is kept straight away (TRD §6).
      const fullName = [c.fullName?.givenName, c.fullName?.familyName].filter(Boolean).join(' ') || null;
      return { provider: 'apple' as const, idToken: c.identityToken, nonce: nonce.raw, fullName };
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
      throw err;
    }
  }
}

/** Android and web: no Apple button. */
export const noApple: AppleSignInProvider = {
  isAvailable: async () => false,
  signIn: async () => null,
};
