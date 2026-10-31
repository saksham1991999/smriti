import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../../../boot/context";
import type { T } from "../../../lib/i18n";
import { useIsPro } from "../../../lib/pro";
import { whenFrom } from "./logic";
import { loadPalace, savePalace, type PalaceDoc } from "./store";

export const palaceKeys = { all: ["palaces"] as const };

/**
 * Sends a free student to the paywall (building and quizzing are Pro), but only once the
 * entitlement is known, so a Pro student opening a link never bounces off it while it loads.
 */
export function useProOnly(source: string): boolean {
  const isPro = useIsPro();
  const known = useAppStore((x) => x.entitlement !== null);
  const navigate = useNavigate();
  useEffect(() => {
    if (known && !isPro) void navigate({ to: "/pro", search: { source }, replace: true });
  }, [known, isPro, navigate, source]);
  return isPro;
}

/** "now", "later today", "tomorrow", "in 3 days" for "next walk {when}". */
export function whenText(t: T, at: number | null, now = Date.now()): string {
  const w = whenFrom(at, now);
  return w.key === "days" ? t("memory_labs:MEM-12.when_days", { n: w.n }) : t(`memory_labs:MEM-12.when_${w.key}`);
}

/**
 * One palace, loaded from the device and edited in memory. `commit` updates the screen at once
 * and writes the palace back (local only, so a write never waits on the network).
 */
export function usePalaceDoc(id: string) {
  const s = useServices();
  const queryClient = useQueryClient();
  const [doc, setDoc] = useState<PalaceDoc | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadPalace(s, id).then((d) => live && setDoc(d));
    return () => {
      live = false;
    };
  }, [s, id]);
  const commit = useCallback(
    async (next: PalaceDoc) => {
      setDoc(next);
      const saved = await savePalace(s, next);
      void queryClient.invalidateQueries({ queryKey: palaceKeys.all });
      return saved;
    },
    [s, queryClient],
  );
  return { doc, commit };
}

/** True when the student asked for less motion (no zoom or pan on the walk). */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}
