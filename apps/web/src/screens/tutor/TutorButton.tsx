/**
 * AI-01: the tutor one tap away on study screens, with the screen's context. A 56 px pet button
 * at the bottom right on phones; from 600 px an [Ask {pet_name}] button (Ctrl/⌘ + I opens the
 * panel). Never placed in the drill or mock runners (R24). Routes that use it load `tutor_social`.
 */
import { useEffect } from "react";
import { useAppStore } from "@smriti/app-core/react";
import { PetAvatar, cx, focusRing } from "@smriti/ui-web";
import { useI18n } from "../../lib/i18n";
import { useOnline } from "../../lib/network";
import { useTutorUI, type TutorContext } from "../../lib/tutor";

export function TutorButton({ context, raised = false }: { context: TutorContext | null; raised?: boolean }) {
  const { t } = useI18n();
  const online = useOnline();
  const pet = useAppStore((x) => x.pet);
  const open = useTutorUI((x) => x.open);
  const setAvailable = useTutorUI((x) => x.setAvailable);
  const openTutor = useTutorUI((x) => x.openTutor);
  const ref = context?.ref ?? null;
  const title = context?.title ?? null;
  const kind = context?.kind ?? null;
  useEffect(() => {
    setAvailable(ref && kind ? { ref, kind, title: title ?? "" } : null);
    return () => setAvailable(undefined);
  }, [ref, kind, title, setAvailable]);
  if (open) return null;
  const petName = pet?.name ?? "";
  const label = t("tutor_social:AI-01.accessibility_label", { pet_name: petName });
  const hint = context ? t("tutor_social:AI-01.accessibility_hint_with_context", { context_title: context.title }) : undefined;
  return (
    <button
      type="button"
      onClick={() => openTutor(context)}
      aria-label={label}
      title={hint}
      data-testid="ai-01"
      className={cx(
        "fixed end-4 z-30 flex items-center gap-2 rounded-full bg-primary text-on-primary shadow-raised",
        "size-14 justify-center sm:size-auto sm:py-1.5 sm:ps-1.5 sm:pe-4",
        raised ? "bottom-[168px] md:bottom-24" : "bottom-[96px] md:bottom-6",
        !online && "opacity-70",
        focusRing,
      )}
    >
      <PetAvatar species={pet?.species === "dog" ? "dog" : "cat"} mood="curious" size={40} />
      <span className="hidden text-label font-bold sm:inline">{label}</span>
    </button>
  );
}
