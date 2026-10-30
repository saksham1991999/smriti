/**
 * Sign-in actions (auth flow §6): link a guest to Google, the `identity_already_exists` merge,
 * sign-in on a new device, sign-out and account deletion. Locally a dev identity (an email the
 * tester types) stands in for Google; with AUTH_MODE=supabase the same calls take a real ID token.
 */
import { AuthError, devIdToken, type DevIdentity, type IdTokenCredential } from "@smriti/app-core";
import { ApiError, newIdempotencyKey, unwrap } from "@smriti/api-client";
import type { Services } from "../boot/services";
import { useOnboarding } from "./onboarding";
import { prefs } from "../platform/web";

export type ConnectOutcome = { path: "link"; consentNeeded: boolean } | { path: "merge" } | { path: "restore" };

const credential = (identity: DevIdentity): IdTokenCredential => ({ provider: "google", idToken: devIdToken(identity), nonce: crypto.randomUUID() });

const idem = () => ({ header: { "Idempotency-Key": newIdempotencyKey() } });

/** Remembers the signed-in email for the save-state chip (on this device only, never logged). */
export const savedEmail = {
  get: () => prefs.get("account_email"),
  set: (email: string | null) => prefs.set("account_email", email),
};

async function finishSignIn(s: Services, userId: string) {
  s.store.getState().setSession({ status: "signed_in", userId, isGuest: false });
  await s.softPrompt.clear();
  void s.sync.resume();
  await s.refreshState(true);
}

/**
 * The Google button. A guest is linked in place (their user id stays); if that Google account
 * already has a Smriti account, the guest proves control with a merge intent, signs in to the
 * existing account and asks the server to merge (flow §6.4). Without a session it is a plain sign-in.
 */
export async function connectGoogle(s: Services, identity: DevIdentity, reason: string): Promise<ConnectOutcome> {
  const cred = credential(identity);
  const current = await s.auth.getSession().catch(() => null);
  if (!current || !current.user.isAnonymous) {
    const session = await s.auth.signInWithIdToken(cred);
    savedEmail.set(identity.email);
    await finishSignIn(s, session.user.id);
    s.analytics.track("auth_linked", { provider: "google", path: "restore", reason });
    return { path: "restore" };
  }
  // Push the guest's unsent events first, so a merge carries everything.
  await s.sync.flush().catch(() => undefined);
  const r = await s.auth.linkIdentity(cred);
  if (r.status === "linked") {
    savedEmail.set(identity.email);
    let consentNeeded = false;
    try {
      const res = await unwrap(s.client.POST("/v1/auth/linked", { body: {}, params: idem() }), s.client);
      consentNeeded = res.consent_needed;
    } catch {
      // The link itself worked; finalising is retried on the next sign-in.
      s.logger.warn("auth.linked_finalise_failed", { code: "linked" });
    }
    await finishSignIn(s, r.session.user.id);
    s.analytics.track("auth_linked", { provider: "google", path: "link", reason });
    return { path: "link", consentNeeded };
  }

  // identity_already_exists: merge this guest into the existing account.
  const unsent = await s.storage.outbox.count();
  const intent = await unwrap(s.client.POST("/v1/account/merge-intents", { body: { has_unsent_events: unsent > 0 } }), s.client);
  const session = await s.auth.signInWithIdToken(cred);
  savedEmail.set(identity.email);
  s.store.getState().setSession({ status: "signed_in", userId: session.user.id, isGuest: false });
  const merge = await unwrap(s.client.POST("/v1/account/merges", { body: { merge_intent: intent.merge_intent, include_progress: true, convert_guardian: false }, params: idem() }), s.client);
  for (let i = 0; i < 20; i++) {
    const st = await unwrap(s.client.GET("/v1/account/merges/{merge_id}", { params: { path: { merge_id: merge.merge_id } } }), s.client).catch(() => null);
    if (!st || st.status === "done" || st.status === "failed") break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  await finishSignIn(s, session.user.id);
  s.analytics.track("auth_linked", { provider: "google", path: "merge", reason });
  return { path: "merge" };
}

/** The message for a failed sign-in (the code only; no details reach the screen or the logs). */
export function signInErrorCode(err: unknown): string {
  if (err instanceof AuthError) return err.code;
  if (err instanceof ApiError) return err.code ?? `http_${err.status}`;
  return "unknown";
}

/** AUTH-12: sign out and clear this browser for the next person. */
export async function signOut(s: Services) {
  s.sync.stop();
  await s.auth.signOut();
  await s.storage.wipe();
  s.kv.clearAll();
  savedEmail.set(null);
  useOnboarding.getState().reset();
  s.store.getState().reset();
}

/** AUTH-12 guest variant: erase this guest's progress on the server, then here. */
export async function eraseGuest(s: Services) {
  await unwrap(s.client.DELETE("/v1/account", {}), s.client).catch(() => undefined);
  await signOut(s);
}

/** AUTH-13: schedule deletion (the server asks for a fresh sign-in; the caller handles `reauth_required`). */
export async function requestDeletion(s: Services) {
  return unwrap(s.client.POST("/v1/account/deletion", { params: idem() }), s.client);
}
