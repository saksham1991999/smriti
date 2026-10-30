import { useId } from "react";
import {
  truncateEmailMiddle,
  type ChipContract,
  type ChipTone,
  type ChoiceChipsContract,
  type CitationChipContract,
  type IconName,
  type ProChipContract,
  type SaveState,
  type SaveStateChipContract,
  type StreakPillContract,
} from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, focusRing, hitArea, pressable, subjectAttr } from "../util";
import { Icon } from "./Icon";

export const chipToneClass: Record<ChipTone, string> = {
  neutral: "bg-surface-raised text-ink ring-1 ring-inset ring-line",
  subject: "bg-subject-tint text-subject-text",
  primary: "bg-primary-tint text-primary-text",
  success: "bg-success-tint text-success-text",
  warning: "bg-warning-tint text-warning-text",
  error: "bg-error-tint text-error-text",
  streak: "bg-streak-tint text-streak-text",
  sunken: "bg-surface-sunken text-ink-muted",
};

export interface ChipProps extends ChipContract {
  className?: string;
  /** For chips inside a radio/checkbox group (ChoiceChips). */
  role?: "radio" | "checkbox" | "button";
}

/** 32 tall, fully round (DESIGN.md §5). Filter chips select; status chips are a tint with its *Text colour. */
export function Chip({ label, kind = "status", tone, icon, selected, subject, onPress, accessibilityLabel, testID, className, role }: ChipProps) {
  const interactive = Boolean(onPress);
  const resolvedTone: ChipTone = tone ?? (kind === "filter" ? "neutral" : "sunken");
  const cls = cx(
    "relative inline-flex h-8 max-w-full shrink-0 items-center gap-1.5 rounded-full px-3 text-label whitespace-nowrap",
    kind === "filter" && selected ? "bg-primary text-on-primary" : chipToneClass[resolvedTone],
    interactive && cx(focusRing, pressable, hitArea, "cursor-pointer"),
    className,
  );
  const content = (
    <>
      {kind === "filter" && selected && !icon ? <Icon name="Check" size={16} /> : icon ? <Icon name={icon} size={16} weight={icon === "Plant" ? "fill" : "bold"} /> : null}
      <span className="truncate">{label}</span>
    </>
  );
  if (!interactive) {
    return (
      <span data-testid={testID} {...subjectAttr(subject)} className={cls} aria-label={accessibilityLabel}>
        {content}
      </span>
    );
  }
  const isToggle = kind === "filter" || role === "radio" || role === "checkbox";
  return (
    <button
      type="button"
      data-testid={testID}
      {...subjectAttr(subject)}
      role={role === "button" ? undefined : role}
      aria-pressed={isToggle && !role ? Boolean(selected) : undefined}
      aria-checked={role === "radio" || role === "checkbox" ? Boolean(selected) : undefined}
      aria-label={accessibilityLabel}
      onClick={onPress}
      className={cls}
    >
      {content}
    </button>
  );
}

export interface ChoiceChipsProps extends ChoiceChipsContract {
  className?: string;
}

/** A radio or checkbox group of chips for short answers. Selected: primaryTint, primary text, check icon. */
export function ChoiceChips({ label, hideLabel, options, value, multiple, onChange, testID, className }: ChoiceChipsProps) {
  const id = useId();
  const toggle = (v: string) => {
    if (multiple) onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    else onChange([v]);
  };
  return (
    <div data-testid={testID} className={cx("flex flex-col gap-2", className)}>
      <span id={id} className={cx("text-label text-ink-muted", hideLabel && "sr-only")}>
        {label}
      </span>
      <div role={multiple ? "group" : "radiogroup"} aria-labelledby={id} className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <Chip
              key={o.value}
              label={o.label}
              role={multiple ? "checkbox" : "radio"}
              tone={on ? "primary" : "neutral"}
              icon={on ? "Check" : undefined}
              selected={on}
              onPress={() => toggle(o.value)}
              className={on ? "ring-2 ring-inset ring-primary" : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

export interface ProChipProps extends ProChipContract {
  className?: string;
}

/** "Pro" on primaryTint with LockSimple. Never gold (R11). Under-13s get "Ask a grown-up" instead (R14). */
export function ProChip({ askGrownUp, onPress, testID, className }: ProChipProps) {
  const { t } = useUI();
  return (
    <Chip
      testID={testID}
      tone="primary"
      icon="LockSimple"
      label={askGrownUp ? t("pro.askGrownUp") : t("pro.label")}
      accessibilityLabel={askGrownUp ? undefined : t("pro.a11y")}
      onPress={onPress}
      className={className}
    />
  );
}

export interface CitationChipProps extends CitationChipContract {
  className?: string;
}

/** "{exam_short} {year} · {session_label}" on every PYQ; dropped or changed keys add a warning state. */
export function CitationChip({ examShort, year, sessionLabel, keyStatus = "final", onPress, testID, className }: CitationChipProps) {
  const { t } = useUI();
  const flagged = keyStatus === "dropped" || keyStatus === "changed";
  const base = `${examShort} ${year} · ${sessionLabel}`;
  const extra = keyStatus === "dropped" ? t("citation.dropped") : keyStatus === "changed" ? t("citation.changed") : keyStatus === "provisional" ? t("citation.provisional") : null;
  return (
    <Chip
      testID={testID}
      tone={flagged ? "warning" : "sunken"}
      icon={flagged ? "Warning" : "FileText"}
      label={extra ? `${base} · ${extra}` : base}
      accessibilityLabel={`${t("citation.a11y", { exam: examShort, year, session: sessionLabel })}${extra ? ` ${extra}.` : ""}`}
      onPress={onPress}
      className={cx(!flagged && "text-ink", className)}
    />
  );
}

const saveStateLook: Record<SaveState, { tone: ChipTone; icon: IconName }> = {
  guest: { tone: "warning", icon: "CloudSlash" },
  saving: { tone: "sunken", icon: "CloudArrowUp" },
  saved: { tone: "success", icon: "CloudCheck" },
  saved_offline: { tone: "success", icon: "CloudCheck" },
};

export interface SaveStateChipProps extends SaveStateChipContract {
  className?: string;
  /** Max characters before the email is shortened in the middle. */
  maxChars?: number;
}

/** AUTH-33: whether progress is only on this phone, saving, saved, or saved but offline. Icon plus text. */
export function SaveStateChip({ state, email, provider = "google", managed, layout = "chip", onPress, maxChars = 22, testID, className }: SaveStateChipProps) {
  const { t } = useUI();
  const full =
    state === "guest"
      ? t("saveState.guest")
      : state === "saving"
        ? t("saveState.saving")
        : state === "saved_offline"
          ? t("saveState.savedOffline")
          : managed
            ? t("saveState.savedManaged")
            : provider === "apple" || !email
              ? t("saveState.savedApple")
              : t("saveState.saved", { email });
  const shown = state === "saved" && email && !managed && provider !== "apple" ? t("saveState.saved", { email: truncateEmailMiddle(email, maxChars) }) : full;
  const look = saveStateLook[state];
  if (layout === "row") {
    return (
      <p data-testid={testID} className={cx("m-0 flex items-center gap-2 text-body text-ink", className)} aria-label={full} aria-live="polite">
        <Icon name={look.icon} size={20} color={state === "guest" ? "warningText" : state === "saving" ? "inkMuted" : "successText"} />
        <span>{shown}</span>
      </p>
    );
  }
  return (
    <span aria-live="polite" className="inline-flex">
      <Chip
        testID={testID}
        tone={look.tone}
        icon={look.icon}
        label={shown}
        accessibilityLabel={state === "guest" ? t("saveState.guestHint") : full}
        onPress={onPress}
        className={className}
      />
    </span>
  );
}

export interface StreakPillProps extends StreakPillContract {
  className?: string;
}

/** The streak count with Phosphor Plant (fill) in streak gold, never a flame (R28). */
export function StreakPill({ days, onPress, testID, className }: StreakPillProps) {
  const { t } = useUI();
  const cls = cx(
    "relative inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-streak-tint pl-2 pr-3 text-label font-extrabold text-ink tabular-nums",
    onPress && cx(focusRing, pressable, hitArea),
    className,
  );
  const inner = (
    <>
      <Icon name="Plant" size={20} weight="fill" color="streak" />
      <span aria-hidden>{days}</span>
    </>
  );
  return onPress ? (
    <button type="button" data-testid={testID} aria-label={t("streak.pill", { n: days })} onClick={onPress} className={cls}>
      {inner}
    </button>
  ) : (
    <span data-testid={testID} role="img" aria-label={t("streak.pill", { n: days })} className={cls}>
      {inner}
    </span>
  );
}
