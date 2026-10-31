import type { ReactNode } from "react";
import { TopBar } from "@smriti/ui-web";
import type { IconName } from "@smriti/ui-web";

/**
 * Full-page layout for the Phase 2 and 3 screens: a top bar with close or back, the title and up
 * to two actions, then the content, then an optional footer pinned to the bottom. `wide` pages
 * use two columns from 600 px (`PageColumns`).
 */
export function Page({
  title,
  onBack,
  backIcon = "CaretLeft",
  actions,
  trailing,
  children,
  footer,
  width = "md",
  testID,
}: {
  title?: string;
  onBack?: () => void;
  backIcon?: "CaretLeft" | "X";
  actions?: { icon: IconName; label: string; onPress: () => void }[];
  trailing?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg" | "xl";
  testID?: string;
}) {
  const max = width === "xl" ? "max-w-[1120px]" : width === "lg" ? "max-w-[960px]" : "max-w-[640px]";
  return (
    <div className="flex min-h-dvh flex-col bg-bg" data-testid={testID}>
      <div className={`mx-auto flex w-full flex-1 flex-col px-4 ${max}`}>
        <TopBar className="-mx-3" title={title} onBack={onBack} backIcon={backIcon} actions={actions} trailing={trailing} />
        <main id="main" className="flex flex-1 flex-col gap-4 pb-6">
          {children}
        </main>
        {footer && <div className="sticky bottom-0 flex flex-col gap-2 bg-bg pt-2 pb-[max(16px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

/** Two columns from 600 px (left narrower), one column on phones. */
export function PageColumns({ left, right, className = "" }: { left: ReactNode; right: ReactNode; className?: string }) {
  return (
    <div className={`grid gap-4 min-[600px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] min-[600px]:gap-6 ${className}`}>
      <div className="flex min-w-0 flex-col gap-4">{left}</div>
      <div className="flex min-w-0 flex-col gap-4">{right}</div>
    </div>
  );
}

/** A section heading inside a page (h2, `heading` style). */
export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="m-0 text-heading">
      {children}
    </h2>
  );
}
