/**
 * Which account Parent mode (SET-13 to SET-17) talks to. A grown-up who signs in on the learner's
 * device (AUTH-24) gets a separate guardian session, so the learner stays signed in; if they chose
 * "stay signed in" it is remembered on this browser. A parent using their own adult account on
 * their own device needs no second sign-in: Parent mode then uses the app's own client.
 */
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import type { ApiClient } from "@smriti/api-client";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../boot/context";
import type { Services } from "../boot/services";
import { useAgeBand } from "../components/SignIn";
import { createGuardianSession, type GuardianSession } from "./guardian";

interface ParentSessionState {
  session: GuardianSession | null;
  /** The remembered (persisted) session, if this one is it. */
  persisted: boolean;
  set(session: GuardianSession, persisted: boolean): void;
  clear(): void;
}

export const useParentSession = create<ParentSessionState>((set) => ({
  session: null,
  persisted: false,
  set: (session, persisted) => set({ session, persisted }),
  clear: () => set({ session: null, persisted: false }),
}));

/** Can the app's own account act as the parent? Only a signed-in adult. */
export function useOwnAccountIsAdult(): boolean {
  const guest = useAppStore((x) => x.session.isGuest);
  const band = useAgeBand();
  return !guest && band === "18p";
}

/** The client Parent mode screens call: the guardian session's, else the app's own. */
export function useParentClient(): ApiClient {
  const s = useServices();
  const session = useParentSession((x) => x.session);
  return session?.client ?? s.client;
}

/** A new guardian session; `persist` keeps it on this browser ("stay signed in"). */
export const newParentSession = (s: Services, persist: boolean) =>
  createGuardianSession(s, { persist });

/**
 * Restores a remembered guardian session once. Returns "checking" until it knows, then whether
 * Parent mode has an account to use ("ready") or needs the SET-13 / AUTH-24 sign-in ("gate").
 */
export function useParentGate(): "checking" | "ready" | "gate" {
  const s = useServices();
  const own = useOwnAccountIsAdult();
  const session = useParentSession((x) => x.session);
  const remembered = useMemo(() => createGuardianSession(s, { persist: true }), [s]);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (session) {
      setChecked(true);
      return;
    }
    let live = true;
    void remembered.auth
      .getSession()
      .catch(() => null)
      .then((current) => {
        if (!live) return;
        if (current && !current.user.isAnonymous) {
          useParentSession.getState().set(remembered, true);
          s.analytics.track("parent_mode_opened", { entry: "device" });
        }
        setChecked(true);
      });
    return () => {
      live = false;
    };
  }, [remembered, session, s]);
  if (session || own) return "ready";
  return checked ? "gate" : "checking";
}
