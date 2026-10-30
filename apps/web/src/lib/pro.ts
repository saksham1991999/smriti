import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@smriti/app-core/react";
import { isPro } from "@smriti/app-core";
import { useServices } from "../boot/context";
import { useOnline } from "./network";

/** Pro right now, with the offline grace (`billing.offline_grace_days`). */
export function useIsPro(): boolean {
  const ent = useAppStore((s) => s.entitlement);
  const online = useOnline();
  const s = useServices();
  return isPro(ent, { now: Date.now(), online, offlineGraceDays: s.flags.get("billing.offline_grace_days") });
}

/** The ₹1 first month: only when the API says so (R38). A guest sees the server's hint. */
export function useIntroEligibility() {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({ queryKey: ["billing", "eligibility", userId], enabled: !!userId, queryFn: () => s.billing.eligibility(), staleTime: 60_000 });
}

/** True when the ₹1 offer applies; false while unknown, so no screen promises it early. */
export function useIntroEligible(): boolean {
  const q = useIntroEligibility();
  return q.data ? (q.data.eligible ?? q.data.eligibleHint) : false;
}
