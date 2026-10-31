import { useId, useRef, type KeyboardEvent } from "react";
import type { Confidence, ConfidenceRowContract, PickerContract, Rating, RatingButtonsContract, SwitchContract } from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, focusRing, pressable } from "../util";
import { Icon } from "./Icon";

/** Arrow-key movement inside a radio group (roving focus). */
function useRovingRadios(count: number) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    refs.current[(i + dir + count) % count]?.focus();
  };
  return { refs, onKeyDown };
}

const confidences: Confidence[] = ["sure", "half", "guess"];

export interface ConfidenceRowProps extends ConfidenceRowContract {
  className?: string;
}

/** Sure / 50:50 / Guess (R21). Optional, no default, never blocks [Check]. Tap the selected chip again to clear. */
export function ConfidenceRow({ value, onChange, showLabel = true, disabled, testID, className }: ConfidenceRowProps) {
  const { t } = useUI();
  const id = useId();
  const { refs, onKeyDown } = useRovingRadios(3);
  return (
    <div data-testid={testID} className={cx("flex flex-col gap-2", className)}>
      <span id={id} className={cx("text-caption text-ink-muted", !showLabel && "sr-only")}>
        {t("confidence.label")}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex gap-1.5">
        {confidences.map((c, i) => {
          const on = value === c;
          return (
            <button
              key={c}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              tabIndex={on || (value === null && i === 0) ? 0 : -1}
              onClick={() => onChange(on ? null : c)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cx(
                "h-12 flex-1 rounded-full text-label font-bold",
                on ? "bg-primary-tint text-primary-text ring-2 ring-inset ring-primary" : "bg-surface-raised text-ink ring-1 ring-inset ring-line",
                focusRing,
                pressable,
                disabled && "opacity-60",
              )}
            >
              {t(`confidence.${c}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ratingLook: Record<Rating, { cls: string; icon: "ArrowCounterClockwise" | "Barbell" | "Check" | "Lightning" }> = {
  again: { cls: "bg-error-tint text-error-text", icon: "ArrowCounterClockwise" },
  hard: { cls: "bg-warning-tint text-warning-text", icon: "Barbell" },
  good: { cls: "bg-success-tint text-success-text", icon: "Check" },
  easy: { cls: "bg-primary-tint text-primary-text", icon: "Lightning" },
};

export interface RatingButtonsProps extends RatingButtonsContract {
  className?: string;
}

/** Again / Hard / Good / Easy (R18), each with an icon, a label and the next interval (memory-labs P1). */
export function RatingButtons({ intervals, onRate, layout = "row", disabled, testID, className }: RatingButtonsProps) {
  const { t } = useUI();
  return (
    <div data-testid={testID} role="group" className={cx("grid gap-3", layout === "row" ? "grid-cols-4" : "grid-cols-2", className)}>
      {(Object.keys(ratingLook) as Rating[]).map((r) => {
        const label = t(`rating.${r}`);
        return (
          <button
            key={r}
            type="button"
            disabled={disabled}
            aria-label={t("rating.a11y", { label, interval: intervals[r] })}
            onClick={() => onRate(r)}
            className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-button px-1 py-2", ratingLook[r].cls, focusRing, pressable, disabled && "opacity-60")}
          >
            <Icon name={ratingLook[r].icon} size={20} />
            <span className="text-label font-extrabold">{label}</span>
            <span className="text-caption tabular-nums">{intervals[r]}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface PickerProps extends PickerContract {
  className?: string;
}

/** On web the Picker is a native <select> (DESIGN.md §5), styled as a 56-tall row on surfaceSunken. */
export function Picker({ label, options, value, onChange, placeholder, testID, className }: PickerProps) {
  const { t } = useUI();
  const id = useId();
  return (
    <div data-testid={testID} className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-label text-ink-muted">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={cx("h-14 w-full appearance-none rounded-md bg-surface-sunken pr-12 pl-4 text-heading tabular-nums text-ink", focusRing, value === null && "text-ink-muted")}
        >
          {value === null && (
            <option value="" disabled>
              {placeholder ?? t("picker.placeholder")}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="CaretDown" size={20} color="inkMuted" className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2" />
      </div>
    </div>
  );
}

export interface SwitchProps extends SwitchContract {
  className?: string;
  /** Hide the visible label (it stays as the accessible name). */
  hideLabel?: boolean;
}

export function Switch({ checked, onCheckedChange, label, disabled, hideLabel, testID, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      disabled={disabled}
      data-testid={testID}
      onClick={() => onCheckedChange(!checked)}
      className={cx("relative inline-flex min-h-12 items-center gap-3 text-start text-label text-ink", focusRing, "rounded-xs", disabled && "opacity-60", className)}
    >
      {!hideLabel && <span className="min-w-0">{label}</span>}
      <span aria-hidden className={cx("relative inline-block h-7 w-[46px] shrink-0 rounded-full transition-colors duration-fast", checked ? "bg-primary" : "bg-track ring-1 ring-inset ring-ink-disabled")}>
        <span className={cx("absolute top-[3px] size-[22px] rounded-full bg-surface shadow-card transition-[left] duration-fast ease-standard", checked ? "left-[21px]" : "left-[3px]")}>
          {checked && <Icon name="Check" size={16} color="primary" className="m-[3px]" />}
        </span>
      </span>
    </button>
  );
}
