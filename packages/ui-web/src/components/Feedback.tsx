import { useEffect } from "react";
import {
  meterAmountKey,
  type BannerContract,
  type DayDotsContract,
  type IconName,
  type MeterContract,
  type PetLineContract,
  type ToastContract,
} from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, focusRing, hitArea } from "../util";
import { Icon } from "./Icon";
import { PetAvatar } from "./Illustration";
import { ProgressBar } from "./Progress";

const bannerLook: Record<BannerContract["tone"], { cls: string; icon: IconName; iconColor: "primary" | "warningText" | "inkMuted" }> = {
  info: { cls: "bg-primary-tint text-ink", icon: "Info", iconColor: "primary" },
  warning: { cls: "bg-warning-tint text-warning-text", icon: "Warning", iconColor: "warningText" },
  offline: { cls: "bg-surface-sunken text-ink-muted", icon: "WifiSlash", iconColor: "inkMuted" },
};

export interface BannerProps extends BannerContract {
  className?: string;
}

/** Full-width strip under the top bar: icon, one line, optional action and close. Never an error fill. */
export function Banner({ tone, text, icon, action, onClose, testID, className }: BannerProps) {
  const { t } = useUI();
  const look = bannerLook[tone];
  return (
    <div data-testid={testID} role={tone === "warning" ? "alert" : "status"} className={cx("flex min-h-12 items-center gap-2 rounded-md px-3 py-2 text-label", look.cls, className)}>
      <Icon name={icon ?? look.icon} size={20} color={look.iconColor} />
      <span className="min-w-0 flex-1">{text}</span>
      {action && (
        <button type="button" onClick={action.onPress} className={cx("relative shrink-0 rounded-xs px-1 font-bold underline-offset-2 hover:underline", tone === "info" ? "text-primary-text" : "", hitArea, focusRing)}>
          {action.label}
        </button>
      )}
      {onClose && (
        <button type="button" aria-label={t("common.close")} onClick={onClose} className={cx("relative grid size-8 shrink-0 place-items-center rounded-full", hitArea, focusRing)}>
          <Icon name="X" size={20} />
        </button>
      )}
    </div>
  );
}

export interface ToastProps extends ToastContract {
  className?: string;
}

/** Bottom, above the tab bar, 4 s, one action at most. Errors stay until dismissed. Position it in the screen layout. */
export function Toast({ open, message, tone = "default", icon, action, onDismiss, durationMs = 4000, testID, className }: ToastProps) {
  const { t } = useUI();
  useEffect(() => {
    if (!open || tone === "error") return;
    const id = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(id);
  }, [open, tone, durationMs, onDismiss]);
  if (!open) return null;
  return (
    <div
      data-testid={testID}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cx("flex items-center gap-2.5 rounded-md bg-ink px-3.5 py-3 text-label text-bg shadow-raised motion-safe:animate-[sm-rise_var(--sm-duration-base)_var(--sm-ease-enter)]", className)}
    >
      {(icon || tone === "error") && <Icon name={icon ?? "WarningOctagon"} size={20} />}
      <span className="min-w-0 flex-1">{message}</span>
      {action && (
        <button type="button" onClick={action.onPress} className={cx("relative shrink-0 rounded-xs font-bold", hitArea, focusRing)}>
          {action.label}
        </button>
      )}
      {tone === "error" && (
        <button type="button" aria-label={t("common.dismiss")} onClick={onDismiss} className={cx("relative grid size-8 shrink-0 place-items-center rounded-full", hitArea, focusRing)}>
          <Icon name="X" size={20} />
        </button>
      )}
    </div>
  );
}

export interface MeterProps extends MeterContract {
  className?: string;
}

/** Labelled bar for pet mood (streak gold) and energy (gem blue). Never error or warning colours. Read as words. */
export function Meter({ kind, label, stateWord, value, testID, className }: MeterProps) {
  const { t } = useUI();
  const words = t("meter.a11y", { label, state: stateWord, amount: t(meterAmountKey(value)) });
  return (
    <div data-testid={testID} className={cx("flex flex-col gap-1.5", className)}>
      <span aria-hidden className="text-label text-ink">
        {label} · {stateWord}
      </span>
      <ProgressBar value={value / 100} tone={kind === "mood" ? "streak" : "gem"} thickness={10} label={label} valueText={words} />
    </div>
  );
}

export interface DayDotsProps extends DayDotsContract {
  className?: string;
}

/** 3 to 7 circles: done (success fill with a check), today (2 px primary ring), to do (track outline). */
export function DayDots({ days, label, testID, className }: DayDotsProps) {
  const { t } = useUI();
  return (
    <ol data-testid={testID} aria-label={label} className={cx("m-0 flex list-none justify-between gap-2 p-0", className)}>
      {days.map((d, i) => (
        <li key={i} aria-label={`${d.label}, ${t(`dayDots.${d.state}`)}`} className="flex flex-col items-center gap-1">
          <span
            aria-hidden
            className={cx(
              "grid size-9 place-items-center rounded-full",
              d.state === "done" && "bg-success text-on-success",
              d.state === "today" && "bg-surface ring-2 ring-inset ring-primary",
              d.state === "todo" && "bg-surface ring-2 ring-inset ring-track",
            )}
          >
            {d.state === "done" && <Icon name="Check" size={20} />}
          </span>
          <span aria-hidden className={cx("text-caption", d.state === "today" ? "text-ink" : "text-ink-muted")}>
            {d.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface PetLineProps extends PetLineContract {
  className?: string;
}

/** The pet's 40 px avatar plus a speech bubble on surface, at most two lines, read by screen readers. */
export function PetLine({ pet, petName, text, avatarSize = 40, live = true, testID, className }: PetLineProps) {
  const { t } = useUI();
  return (
    <div data-testid={testID} className={cx("flex items-end gap-2", className)}>
      <PetAvatar species={pet.species} mood={pet.mood} size={avatarSize} />
      <p
        aria-live={live ? "polite" : undefined}
        aria-label={t("pet.says", { pet_name: petName, text })}
        className="m-0 line-clamp-2 max-w-[38ch] rounded-[18px] rounded-bl-[6px] bg-surface px-3.5 py-2.5 text-label text-ink shadow-card"
      >
        {text}
      </p>
    </div>
  );
}
