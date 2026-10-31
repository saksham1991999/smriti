/** Mounts AUTH-08 (lazily, with the `auth` copy) while a merge notice is open or a merge is still running. */
import { Suspense, lazy } from "react";
import { withNamespaces } from "../lib/i18n";
import { useMergeNotice } from "../lib/merge";

const MergeNotice = lazy(
  withNamespaces(["auth"], () =>
    import("../screens/auth/MergeNotice").then((m) => ({ default: m.MergeNotice })),
  ),
);

export function MergeHost() {
  const active = useMergeNotice((x) => x.result !== null || x.pendingId !== null);
  if (!active) return null;
  return (
    <Suspense fallback={null}>
      <MergeNotice />
    </Suspense>
  );
}
