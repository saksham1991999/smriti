/**
 * Loads the tutor panel (AI-02) only when it opens, so the first route never pays for it, and
 * binds Ctrl/⌘ + I on screens that show the tutor button (AI-01).
 */
import { Suspense, lazy, useEffect } from "react";
import { withNamespaces } from "../lib/i18n";
import { useTutorUI } from "../lib/tutor";

const TutorPanel = lazy(
  withNamespaces(["tutor_social", "me_money"], () =>
    import("../screens/tutor/Tutor").then((m) => ({ default: m.TutorPanel })),
  ),
);

export function TutorHost() {
  const open = useTutorUI((x) => x.open);
  const available = useTutorUI((x) => x.available);
  useEffect(() => {
    if (available === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        const ui = useTutorUI.getState();
        if (ui.open) ui.close();
        else ui.openTutor();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [available]);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <TutorPanel />
    </Suspense>
  );
}
