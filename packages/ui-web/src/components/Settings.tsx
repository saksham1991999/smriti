import { Children, useId, type ReactNode } from "react";
import type { PriceBlockContract, SettingsGroupContract, SettingsRowContract, TrialTimelineContract } from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, focusRing } from "../util";
import { Icon } from "./Icon";
import { Switch } from "./Inputs";

export interface SettingsRowProps extends SettingsRowContract {
  className?: string;
}

/** 56 px row: leading icon in inkMuted, title in `label`, optional value, then a caret or a switch. */
export function SettingsRow({ title, icon, value, trailing = "caret", checked = false, onCheckedChange, onPress, destructive, disabled, testID, className }: SettingsRowProps) {
  const content = (
    <>
      {icon && <Icon name={icon} color={destructive ? "errorText" : "inkMuted"} />}
      <span className={cx("min-w-0 flex-1 text-label", destructive ? "text-error-text" : "text-ink")}>{title}</span>
      {value && <span className="max-w-[50%] truncate text-caption text-ink-muted">{value}</span>}
      {trailing === "caret" && <Icon name="CaretRight" size={20} color="inkMuted" />}
    </>
  );
  const cls = cx("flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-start", disabled && "opacity-60", className);
  if (trailing === "switch") {
    return (
      <div data-testid={testID} className={cls}>
        {icon && <Icon name={icon} color="inkMuted" />}
        <Switch label={title} checked={checked} onCheckedChange={(v) => onCheckedChange?.(v)} disabled={disabled} className="flex-1 justify-between" />
      </div>
    );
  }
  return onPress ? (
    <button type="button" data-testid={testID} disabled={disabled} onClick={onPress} className={cx(cls, "cursor-pointer active:bg-surface-sunken", focusRing)}>
      {content}
    </button>
  ) : (
    <div data-testid={testID} className={cls}>
      {content}
    </div>
  );
}

export interface SettingsGroupProps extends SettingsGroupContract {
  className?: string;
  children: ReactNode;
}

/** Rows grouped in a surface card, radius 20, with line dividers, under an optional caption heading. */
export function SettingsGroup({ title, children, testID, className }: SettingsGroupProps) {
  const id = useId();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <section data-testid={testID} aria-labelledby={title ? id : undefined} className={cx("flex flex-col gap-2", className)}>
      {title && (
        <h2 id={id} className="m-0 px-1 text-caption tracking-[0.6px] text-ink-muted uppercase">
          {title}
        </h2>
      )}
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {rows.map((r, i) => (
          <div key={i} className={cx(i > 0 && "border-t border-line")}>
            {r}
          </div>
        ))}
      </div>
    </section>
  );
}

export interface PriceBlockProps extends PriceBlockContract {
  className?: string;
}

/** The price as live text in `display`, the "then" line in `body`, fine print in `caption`. Tax-inclusive. */
export function PriceBlock({ price, thenLine, finePrint, testID, className }: PriceBlockProps) {
  return (
    <div data-testid={testID} className={cx("flex flex-col gap-1", className)}>
      <span className="text-display tabular-nums text-ink">{price}</span>
      {thenLine && <span className="text-body text-ink">{thenLine}</span>}
      {finePrint && <span className="text-caption text-ink-muted">{finePrint}</span>}
    </div>
  );
}

export interface TrialTimelineProps extends TrialTimelineContract {
  className?: string;
}

/** R33: today ₹1, the reminder date, the renewal date and price, on real dates. No countdown, no anchors. */
export function TrialTimeline({ eligible, todayLabel, reminderDate, renewDate, trialPrice, renewPrice, testID, className }: TrialTimelineProps) {
  const { t } = useUI();
  if (!eligible) {
    return (
      <p data-testid={testID} className={cx("m-0 flex items-start gap-3 text-label text-ink", className)}>
        <Icon name="CalendarCheck" color="primaryText" />
        <span>{t("trial.notEligible", { date: renewDate, price: renewPrice })}</span>
      </p>
    );
  }
  const rows = [
    { icon: "CheckCircle" as const, text: t("trial.today", { price: trialPrice }), sub: todayLabel, done: true },
    { icon: "Bell" as const, text: t("trial.reminder", { date: reminderDate }) },
    { icon: "CalendarCheck" as const, text: t("trial.renew", { date: renewDate, price: renewPrice }) },
  ];
  return (
    <div data-testid={testID} className={cx("flex flex-col gap-3", className)}>
      <ol className="relative m-0 flex list-none flex-col gap-4 p-0">
        <span aria-hidden className="absolute top-4 bottom-4 left-[15px] w-0.5 bg-line" />
        {rows.map((r, i) => (
          <li key={i} className="relative flex items-start gap-3">
            <span className={cx("relative z-[1] grid size-8 shrink-0 place-items-center rounded-full", r.done ? "bg-primary text-on-primary" : "bg-surface-sunken text-ink-muted")}>
              <Icon name={r.icon} size={20} weight={r.done ? "fill" : "bold"} />
            </span>
            <span className="flex flex-col pt-1">
              <span className="text-label font-bold text-ink">{r.text}</span>
              {r.sub && <span className="text-caption text-ink-muted">{r.sub}</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="m-0 text-caption text-primary-text">{t("trial.cancel")}</p>
    </div>
  );
}
