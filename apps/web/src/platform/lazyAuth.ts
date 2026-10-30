/**
 * Supabase Auth, loaded after first paint. supabase-js is about a third of the entry chunk, and no
 * screen needs it to render: every AuthClient call is async, so the first call waits for the chunk
 * (TRD §15 first-route budget). `onAuthStateChange` subscribes as soon as the chunk arrives.
 */
import type { AuthClient, AuthEvent, AuthSession, IdTokenCredential, KeyValueStore, LinkResult } from "@smriti/app-core";

export interface SupabaseAuthOptions {
  url: string;
  anonKey: string;
  storage: KeyValueStore;
  storageKey: string;
  detectSessionInUrl: boolean;
}

export class LazySupabaseAuthClient implements AuthClient {
  private client: Promise<AuthClient> | null = null;

  constructor(private readonly opts: SupabaseAuthOptions) {}

  private load(): Promise<AuthClient> {
    this.client ??= import("./supabaseAuth").then((m) => m.createSupabaseAuth(this.opts));
    return this.client;
  }

  async getSession(): Promise<AuthSession | null> {
    return (await this.load()).getSession();
  }
  async getAccessToken(): Promise<string | null> {
    return (await this.load()).getAccessToken();
  }
  async signInAnonymously(opts?: { captchaToken?: string }): Promise<AuthSession> {
    return (await this.load()).signInAnonymously(opts);
  }
  async linkIdentity(credential: IdTokenCredential): Promise<LinkResult> {
    return (await this.load()).linkIdentity(credential);
  }
  async signInWithIdToken(credential: IdTokenCredential): Promise<AuthSession> {
    return (await this.load()).signInWithIdToken(credential);
  }
  async refreshSession(): Promise<AuthSession | null> {
    return (await this.load()).refreshSession();
  }
  async signOut(opts?: { scope?: "local" | "global" }): Promise<void> {
    return (await this.load()).signOut(opts);
  }
  onAuthStateChange(listener: (event: AuthEvent, session: AuthSession | null) => void): () => void {
    let off: (() => void) | null = null;
    let cancelled = false;
    void this.load().then((c) => {
      if (!cancelled) off = c.onAuthStateChange(listener);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }
}
