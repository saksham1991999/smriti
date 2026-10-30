import type { ReactNode } from "react";
import { Button, IconButton, PetLine, SegmentedProgress, Text } from "@smriti/ui-web";
import { useT } from "../lib/i18n";

export interface PrimaryAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

/**
 * Full-screen step layout (onboarding, checkout, sign-in): back or close, an optional segmented
 * bar, headline and helper, the content, a pet line, and the main button pinned to the bottom.
 * 480 px wide at most, centred on large screens.
 */
export function StepFrame({
  onBack,
  backIcon = "CaretLeft",
  progress,
  title,
  helper,
  children,
  pet,
  primary,
  secondary,
  footer,
  testID,
  wide,
}: {
  onBack?: () => void;
  backIcon?: "CaretLeft" | "X";
  progress?: { done: number; total: number };
  title?: string;
  helper?: string;
  children?: ReactNode;
  pet?: { species: "cat" | "dog"; name: string; text: string };
  primary?: PrimaryAction;
  secondary?: PrimaryAction;
  footer?: ReactNode;
  testID?: string;
  wide?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex min-h-dvh flex-col bg-bg" data-testid={testID}>
      <div className={`mx-auto flex w-full flex-1 flex-col px-4 ${wide ? "max-w-[720px]" : "max-w-[480px]"}`}>
        <header className="flex h-14 items-center gap-2">
          {onBack && <IconButton icon={backIcon} label={backIcon === "X" ? t("ui:common.close") : t("ui:common.back")} onPress={onBack} testID="frame-back" />}
          {progress && (
            <SegmentedProgress className="flex-1" total={progress.total} done={progress.done} current={progress.done} label={t("ui:progress.segments", { done: progress.done + 1, total: progress.total })} />
          )}
        </header>
        <main id="main" className="flex flex-1 flex-col gap-4 pb-4">
          {title && (
            <Text variant="title" heading as="h1">
              {title}
            </Text>
          )}
          {helper && <Text tone="muted">{helper}</Text>}
          {children}
          {pet && <PetLine pet={{ species: pet.species }} petName={pet.name} text={pet.text} />}
        </main>
        {(primary || secondary || footer) && (
          <div className="sticky bottom-0 flex flex-col gap-2 bg-bg pt-2 pb-[max(16px,env(safe-area-inset-bottom))]">
            {primary && <Button label={primary.label} onPress={primary.onPress} disabled={primary.disabled} loading={primary.loading} testID={primary.testID ?? "primary"} />}
            {secondary && <Button label={secondary.label} variant="ghost" onPress={secondary.onPress} disabled={secondary.disabled} testID={secondary.testID ?? "secondary"} />}
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
