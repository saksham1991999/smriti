/** The lazily loaded half of `LazySupabaseAuthClient`: app-core's Supabase client on supabase-js. */
import { SupabaseAuthClient, createSupabaseClientForProfile, type AuthClient } from "@smriti/app-core";
import type { SupabaseAuthOptions } from "./lazyAuth";

export function createSupabaseAuth(opts: SupabaseAuthOptions): AuthClient {
  return new SupabaseAuthClient(createSupabaseClientForProfile(opts));
}
