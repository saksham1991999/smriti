/**
 * AUTH-08: the numbers from `account_merges.stats` after a guest is merged into an existing
 * account (flow §6.4). A merge still running after the wait shows the pending variant; the host
 * keeps polling and toasts when it finishes.
 */
import { create } from "zustand";

export interface MergeStats {
  lessonsAdded: number;
  xpAdded: number;
  streakAfter: number;
  petKept: "account" | "guest" | "both" | null;
}

export interface MergeResult {
  mergeId: string;
  status: "done" | "pending";
  stats: MergeStats | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function parseStats(raw: Record<string, unknown> | null | undefined): MergeStats | null {
  if (!raw) return null;
  const pet = raw.pet_kept;
  return {
    lessonsAdded: num(raw.lessons_added),
    xpAdded: num(raw.xp_added),
    streakAfter: num(raw.streak_after),
    petKept: pet === "account" || pet === "guest" || pet === "both" ? pet : null,
  };
}

/** A failed merge shows as pending to the student (support follows up, flow §7). */
export function mergeResult(
  mergeId: string,
  status: { status: string; stats: Record<string, unknown> | null } | null,
): MergeResult {
  if (status?.status === "done")
    return { mergeId, status: "done", stats: parseStats(status.stats) };
  return { mergeId, status: "pending", stats: null };
}

/** True when the merge added something worth a notice (an empty guest gets AUTH-06 instead). */
export function mergeAddedSomething(m: MergeResult): boolean {
  if (m.status === "pending") return true;
  const st = m.stats;
  return (
    !!st &&
    (st.lessonsAdded > 0 || st.xpAdded > 0 || st.petKept === "guest" || st.petKept === "both")
  );
}

interface MergeNotice {
  result: MergeResult | null;
  /** A merge still running: polled until it ends, even after the notice is closed. */
  pendingId: string | null;
  show(r: MergeResult): void;
  close(): void;
  settle(): void;
}

export const useMergeNotice = create<MergeNotice>((set) => ({
  result: null,
  pendingId: null,
  show: (result) => set({ result, pendingId: result.status === "pending" ? result.mergeId : null }),
  close: () => set({ result: null }),
  settle: () => set({ pendingId: null }),
}));
