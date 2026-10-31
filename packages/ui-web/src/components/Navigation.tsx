import type { ReactNode } from "react";
import type { SidebarNavContract, TabBarContract, TopBarContract } from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, focusRing } from "../util";
import { IconButton } from "./Button";
import { Icon } from "./Icon";

export interface TabBarProps extends TabBarContract {
  className?: string;
}

/**
 * 82 tall with the safe area. Filled icon and primary for the active tab, bold outline and inkMuted otherwise.
 * Phase 1 ships four tabs, little learners three (R14, R46): pass the items for the student.
 */
export function TabBar({ items, activeKey, onSelect, testID, className }: TabBarProps) {
  return (
    <nav data-testid={testID} className={cx("grid border-t border-line bg-surface px-1 pt-2 pb-[max(22px,env(safe-area-inset-bottom))]", className)} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it) => {
        const on = it.key === activeKey;
        return (
          <button
            key={it.key}
            type="button"
            data-testid={`${testID ?? "tab"}-${it.key}`}
            aria-current={on ? "page" : undefined}
            onClick={() => onSelect(it.key)}
            className={cx("relative flex min-h-12 flex-col items-center gap-[3px] rounded-md text-caption font-bold", on ? "text-primary-text" : "text-ink-muted", focusRing)}
          >
            <span className={cx("grid h-7 w-11 place-items-center rounded-full transition-colors duration-fast", on && "bg-primary-tint text-primary")}>
              <Icon name={it.icon} weight={on ? "fill" : "bold"} />
            </span>
            <span className="max-w-full truncate text-[11px] leading-[14px]">{it.label}</span>
            {it.badge && <span className="absolute top-0 right-[22%] min-w-4 rounded-full bg-error px-1 text-center text-[11px] leading-4 text-on-error">{it.badge}</span>}
          </button>
        );
      })}
    </nav>
  );
}

export interface SidebarNavProps extends SidebarNavContract {
  className?: string;
  /** Streak, plant and pet card at the top (UX_FLOW §6). */
  header?: ReactNode;
  footer?: ReactNode;
}

/** The web sidebar that replaces the tab bar at 600 px and wider. */
export function SidebarNav({ items, activeKey, onSelect, header, footer, testID, className }: SidebarNavProps) {
  return (
    <nav data-testid={testID} className={cx("flex w-[248px] shrink-0 flex-col gap-1.5 border-r border-line bg-surface px-3.5 py-[18px]", className)}>
      {header}
      {items.map((it) => {
        const on = it.key === activeKey;
        return (
          <button
            key={it.key}
            type="button"
            data-testid={`${testID ?? "sidebar"}-${it.key}`}
            aria-current={on ? "page" : undefined}
            onClick={() => onSelect(it.key)}
            className={cx("flex h-12 items-center gap-3 rounded-[14px] px-3 text-start text-label font-bold", on ? "bg-primary-tint text-primary-text" : "text-ink-muted hover:bg-surface-sunken", focusRing)}
          >
            <Icon name={it.icon} weight={on ? "fill" : "bold"} />
            <span className="flex-1">{it.label}</span>
            {it.badge && <span className="rounded-full bg-error px-1.5 text-caption text-on-error">{it.badge}</span>}
          </button>
        );
      })}
      {footer && <div className="mt-auto">{footer}</div>}
    </nav>
  );
}

export interface TopBarProps extends TopBarContract {
  className?: string;
  /** Left slot instead of the back button (the exam chip on Home). */
  leading?: ReactNode;
  trailing?: ReactNode;
}

/** 56 tall top bar: back (CaretLeft, labelled "Back") or close, title in `title`, up to a couple of actions. */
export function TopBar({ title, onBack, backIcon = "CaretLeft", actions, leading, trailing, testID, className }: TopBarProps) {
  const { t } = useUI();
  return (
    <header data-testid={testID} className={cx("flex h-14 shrink-0 items-center gap-2 px-3", className)}>
      {leading ?? (onBack && <IconButton icon={backIcon} label={backIcon === "X" ? t("common.close") : t("common.back")} onPress={onBack} size={48} />)}
      {title && <h1 className="m-0 min-w-0 flex-1 truncate text-title">{title}</h1>}
      {!title && <span className="flex-1" />}
      {actions?.map((a) => (
        <IconButton key={a.label} icon={a.icon} label={a.label} onPress={a.onPress} size={48} />
      ))}
      {trailing}
    </header>
  );
}
