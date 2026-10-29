import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { DialogContract, SheetContract, TooltipContract } from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, focusRing } from "../util";
import { Button } from "./Button";
import { Icon } from "./Icon";

export interface SheetProps extends SheetContract {
  className?: string;
  children?: ReactNode;
  /** Pinned area under the scrolling content (primary action). */
  footer?: ReactNode;
  /** Where the sheet portals to; defaults to document.body. Use inside a themed subtree that is not <html>. */
  portalContainer?: HTMLElement | null;
}

/** Minimum heights; content can grow the sheet to full height (dynamic type, Hindi). */
const sheetHeight = { "40": "min-h-[40dvh] max-h-[calc(100dvh-24px)]", "60": "min-h-[60dvh] max-h-[calc(100dvh-24px)]", full: "h-[calc(100dvh-24px)]" };

/** Bottom sheet on Radix Dialog: radius 28 at the top, grabber, scrim. Heights 40%, 60%, full; grows with content. */
export function Sheet({ open, onOpenChange, title, hideTitle, description, height = "60", tone = "default", dismissible = true, children, footer, portalContainer, testID, className }: SheetProps) {
  const { t } = useUI();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (dismissible || o ? onOpenChange(o) : undefined)}>
      <DialogPrimitive.Portal container={portalContainer ?? undefined}>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim motion-safe:animate-[sm-fade_var(--sm-duration-slow)_var(--sm-ease-standard)]" />
        <DialogPrimitive.Content
          data-testid={testID}
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          className={cx(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-[640px] flex-col rounded-t-sheet px-5 pt-2.5 pb-[max(26px,env(safe-area-inset-bottom))] text-ink shadow-raised outline-none",
            tone === "success" ? "bg-success-tint" : tone === "error" ? "bg-error-tint" : "bg-surface-raised",
            sheetHeight[height],
            "motion-safe:animate-[sm-sheet-up_var(--sm-duration-slow)_var(--sm-ease-enter)] motion-reduce:animate-[sm-fade_var(--sm-duration-base)_linear]",
            className,
          )}
        >
          <div aria-hidden className="mx-auto mb-2 h-[5px] w-10 shrink-0 rounded-full bg-line" />
          <div className="flex items-start gap-3">
            <DialogPrimitive.Title className={cx("m-0 flex-1 text-title", hideTitle && "sr-only")}>{title}</DialogPrimitive.Title>
            {dismissible && (
              <DialogPrimitive.Close aria-label={t("common.close")} className={cx("relative -mt-1 -mr-2 grid size-12 shrink-0 place-items-center rounded-full text-ink", focusRing)}>
                <Icon name="X" />
              </DialogPrimitive.Close>
            )}
          </div>
          {description ? (
            <DialogPrimitive.Description className="m-0 mt-1 text-body text-ink-muted">{description}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="mt-3 flex flex-col gap-2.5">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface DialogProps extends DialogContract {
  className?: string;
  children?: ReactNode;
  portalContainer?: HTMLElement | null;
}

/** Centred confirm dialog (sign out, leave a duel). One main action, Cancel beside it. */
export function Dialog({ open, onOpenChange, title, description, confirm, cancel, children, portalContainer, testID, className }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={portalContainer ?? undefined}>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim motion-safe:animate-[sm-fade_var(--sm-duration-base)_var(--sm-ease-standard)]" />
        <DialogPrimitive.Content
          data-testid={testID}
          className={cx(
            "fixed top-1/2 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-card-large bg-surface-raised p-6 text-ink shadow-raised outline-none",
            "motion-safe:animate-[sm-fade_var(--sm-duration-base)_var(--sm-ease-enter)]",
            className,
          )}
        >
          <DialogPrimitive.Title className="m-0 text-title">{title}</DialogPrimitive.Title>
          {description ? <DialogPrimitive.Description className="m-0 text-body text-ink-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          {children}
          <div className="mt-2 flex flex-col gap-2.5">
            {confirm && <Button label={confirm.label} variant={confirm.destructive ? "destructive" : "primary"} onPress={confirm.onPress} />}
            {cancel && <Button label={cancel.label} variant="ghost" onPress={cancel.onPress} />}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface TooltipProps extends TooltipContract {
  children: ReactNode;
}

/** Hover and focus hint for icon buttons on web. Wrap the app once in <TooltipProvider>. */
export function Tooltip({ label, children }: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={400}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content sideOffset={6} className="z-50 rounded-xs bg-ink px-2.5 py-1.5 text-caption text-bg shadow-raised">
          {label}
          <TooltipPrimitive.Arrow className="fill-ink" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
