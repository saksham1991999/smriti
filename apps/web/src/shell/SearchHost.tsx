/**
 * HOME-05 global search: "/" opens it on any screen (not while typing), and the palette loads only
 * when it opens, so the first route never pays for it.
 */
import { Suspense, lazy, useEffect } from "react";
import { create } from "zustand";
import { withNamespaces } from "../lib/i18n";

export const useSearchUI = create<{ open: boolean; show(): void; close(): void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

const SearchPalette = lazy(
  withNamespaces(["learn", "memory_labs", "tutor_social"], () =>
    import("../screens/home/Search").then((m) => ({ default: m.SearchPalette })),
  ),
);

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function SearchHost() {
  const open = useSearchUI((x) => x.open);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      // Not inside a lesson, a mock or a sim, where "/" may be part of the task.
      if (
        /^\/(lesson|practice\/attempt|practice\/mock|labs\/|onboarding|focus)/.test(
          location.pathname,
        )
      )
        return;
      e.preventDefault();
      useSearchUI.getState().show();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SearchPalette />
    </Suspense>
  );
}
