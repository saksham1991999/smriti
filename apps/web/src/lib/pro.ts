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
