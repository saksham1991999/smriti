import type { ReactNode } from "react";
import type {
  CardContract,
  ContinueCardContract,
  EmptyStateContract,
  OptionCardContract,
  StatTileContract,
  StreakCardContract,
  SubjectTileContract,
} from "@smriti/tokens/ui";
import { pluralCategory } from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, focusRing, pressable, subjectAttr } from "../util";
import { Button } from "./Button";
import { Chip } from "./Chips";
import { Icon } from "./Icon";
import { Illustration, PetView, PlantView } from "./Illustration";
import { ProgressBar } from "./Progress";

const cardTone = {
  surface: "bg-surface shadow-card",
  tint: "bg-subject-tint",
  strong: "bg-subject-strong text-subject-on-strong",
  sunken: "bg-surface-sunken",
};

export interface CardProps extends CardContract {
  className?: string;
  children: ReactNode;
}

/** Card surface: radius 20 (24 for large hero cards), one soft shadow, none in dark mode. */
export function Card({ tone = "surface", subject, size = "md", outlined, onPress, accessibilityLabel, testID, className, children }: CardProps) {
  const cls = cx(
    "relative block text-start",
    size === "lg" ? "rounded-card-large p-[18px]" : "rounded-card p-4",
    cardTone[tone],
    outlined && "shadow-none ring-[1.5px] ring-inset ring-line",
    onPress && cx(focusRing, pressable, "w-full cursor-pointer"),
    className,
  );
  return onPress ? (
    <button type="button" data-testid={testID} {...subjectAttr(subject)} aria-label={accessibilityLabel} onClick={onPress} className={cls}>
      {children}
    </button>
  ) : (
    <div data-testid={testID} {...subjectAttr(subject)} aria-label={accessibilityLabel} className={cls}>
      {children}
    </div>
  );
}

export interface SubjectTileProps extends SubjectTileContract {
  className?: string;
}

/** Tint background, radius 20, illustration top-right (may overlap), name, progress in strong, caption. */
export function SubjectTile({ subject, name, progress, caption, next, illustration, chip, offline, onPress, testID, className }: SubjectTileProps) {
  const { t } = useUI();
  const Tag = onPress ? "button" : "div";
  return (
    <Tag
      type={onPress ? "button" : undefined}
      data-testid={testID}
      {...subjectAttr(subject)}
      onClick={onPress}
      className={cx(
        "relative flex min-h-32 w-full flex-col justify-end gap-1.5 rounded-card bg-subject-tint p-3.5 text-start text-ink",
        onPress && cx(focusRing, pressable, "cursor-pointer"),
        className,
      )}
    >
      {illustration && (
        <Illustration name={illustration} decorative width={74} height={74} dimmed={offline} className="pointer-events-none absolute -top-2.5 -right-1.5" />
      )}
      {chip && <Chip label={chip.label} icon={chip.icon} tone={chip.tone ?? "neutral"} className="mb-auto self-start" />}
      <span className="pr-12 text-heading">{name}</span>
      {next && <span className="text-label text-ink-muted">{next}</span>}
      {progress !== undefined && <ProgressBar value={progress} tone="subject" label={name} valueText={t("progress.percent", { percent: Math.round(progress * 100) })} />}
      {caption && <span className="text-caption text-ink-muted">{caption}</span>}
    </Tag>
  );
}

export interface ContinueCardProps extends ContinueCardContract {
  className?: string;
}

/** Subject strong fill, onStrong text, big illustration overlapping the right edge, progress, [Resume]. One per screen. */
export function ContinueCard({ subject, eyebrow, eyebrowIcon, title, meta, progress, progressLabel, illustration, actionLabel, onPress, testID, className }: ContinueCardProps) {
  const { t } = useUI();
  return (
    <section
      data-testid={testID}
      {...subjectAttr(subject)}
      aria-label={eyebrow ? `${eyebrow}: ${title}` : title}
      className={cx("relative flex flex-col gap-2.5 rounded-card-large bg-subject-strong p-[18px] text-subject-on-strong", className)}
    >
      {illustration && <Illustration name={illustration} decorative width={118} height={118} className="pointer-events-none absolute -top-[18px] -right-2.5" />}
      {eyebrow && (
        <span className="flex items-center gap-1.5 text-label">
          {eyebrowIcon && <Icon name={eyebrowIcon} size={16} />}
          {eyebrow}
        </span>
      )}
      <h2 className="m-0 max-w-[70%] text-title text-balance">{title}</h2>
      {meta && <span className="text-label">{meta}</span>}
      {progress !== undefined && <ProgressBar value={progress} tone="onStrong" label={title} className="max-w-[90%]" />}
      <div className="mt-1 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onPress}
          className={cx("inline-flex h-12 items-center gap-2 rounded-md bg-subject-on-strong px-[18px] text-body font-bold text-subject-strong", focusRing, pressable)}
        >
          {actionLabel ?? t("continue.resume")}
          <Icon name="ArrowRight" size={20} />
        </button>
        {progressLabel && <span className="text-label">{progressLabel}</span>}
      </div>
    </section>
  );
}

export interface StreakCardProps extends StreakCardContract {
  className?: string;
}

/** streakTint (warningTint at risk), plant on the right, one line of state copy, daily goal and freeze slots. */
export function StreakCard({ message, goal, freezes, atRisk, plant, onPress, testID, className }: StreakCardProps) {
  const { t, locale } = useUI();
  const freezeLabel =
    freezes?.label ??
    (freezes
      ? freezes.ready === 0
        ? t("streak.freezesReady.zero")
        : t(pluralCategory(freezes.ready, locale) === "one" ? "streak.freezesReady.one" : "streak.freezesReady.other", { n: freezes.ready })
      : "");
  const Tag = onPress ? "button" : "section";
  return (
    <Tag
      type={onPress ? "button" : undefined}
      data-testid={testID}
      onClick={onPress}
      className={cx(
        "relative flex w-full items-center gap-3 rounded-card-large p-4 text-start text-ink",
        atRisk ? "bg-warning-tint" : "bg-streak-tint",
        onPress && cx(focusRing, pressable, "cursor-pointer"),
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex items-start gap-1.5 text-heading">
          {atRisk && <Icon name="Warning" size={20} color="warningText" label={t("streak.atRisk")} className="mt-0.5" />}
          <span>{message}</span>
        </span>
        {goal && (
          <>
            <ProgressBar value={goal.target ? goal.done / goal.target : 0} tone="primary" label={goal.label ?? t("streak.goal", { done: goal.done, target: goal.target })} />
            <span className="text-caption text-ink-muted tabular-nums">{goal.label ?? t("streak.goal", { done: goal.done, target: goal.target })}</span>
          </>
        )}
        {freezes && (
          <div className="flex items-center gap-2">
            <ul className="m-0 flex list-none gap-1.5 p-0" aria-label={freezeLabel}>
              {Array.from({ length: freezes.slots }, (_, i) => (
                <li key={i} className="inline-flex">
                  {i < freezes.ready ? (
                    <span className="inline-grid size-7 place-items-center rounded-full bg-surface text-primary shadow-card">
                      <Icon name="Snowflake" size={16} label={t("streak.freezeReady")} />
                    </span>
                  ) : (
                    <span role="img" aria-label={t("streak.freezeEmpty")} className="inline-block size-7 rounded-full border-2 border-dashed border-ink-muted/60" />
                  )}
                </li>
              ))}
            </ul>
            <span aria-hidden className="text-caption text-ink-muted">
              {freezeLabel}
            </span>
          </div>
        )}
      </div>
      <PlantView stage={plant.stage} health={plant.health} alt={plant.alt} decorative={!plant.alt} size={86} className="-my-3.5 -mr-1 shrink-0" />
    </Tag>
  );
}

export interface OptionCardProps extends OptionCardContract {
  className?: string;
  /** Position in a radio group for roving focus (set by the parent). */
  tabIndex?: number;
}

/** Question option or choice card. Selected: 2 px primary border; correct/wrong add tint and an icon, never colour alone. */
export function OptionCard({ label, keyLabel, state = "idle", kind = "question", multiple, description, illustration, disabled, onPress, testID, className, tabIndex }: OptionCardProps) {
  const { t, reducedMotion } = useUI();
  const selected = state === "selected";
  const checked = state !== "idle";
  const stateText = state === "correct" ? t("option.correct") : state === "wrong" ? t("option.wrong") : undefined;
  return (
    <button
      type="button"
      role={multiple ? "checkbox" : "radio"}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-description={stateText}
      data-testid={testID}
      data-state={state}
      tabIndex={tabIndex}
      onClick={disabled ? undefined : onPress}
      className={cx(
        "relative flex min-h-14 w-full items-center gap-3 text-start text-body font-semibold text-ink",
        kind === "choice" ? "rounded-card p-3.5" : "rounded-md px-4 py-3.5",
        state === "idle" && "bg-surface ring-[1.5px] ring-inset ring-line",
        selected && (kind === "choice" ? "bg-primary-tint ring-2 ring-inset ring-primary" : "bg-surface ring-2 ring-inset ring-primary"),
        state === "correct" && "bg-success-tint ring-2 ring-inset ring-success",
        state === "wrong" && cx("bg-error-tint ring-2 ring-inset ring-error", !reducedMotion && "motion-safe:animate-[sm-shake_0.3s_ease-in-out_1]"),
        !disabled && cx(focusRing, pressable, "cursor-pointer"),
        disabled && state === "idle" && "opacity-60",
        className,
      )}
    >
      {kind === "question" && keyLabel && (
        <span
          aria-hidden
          className={cx(
            "grid size-[30px] shrink-0 place-items-center rounded-[10px] text-label font-extrabold",
            state === "idle" && "bg-surface-sunken text-ink-muted",
            selected && "bg-primary text-on-primary",
            state === "correct" && "bg-success text-on-success",
            state === "wrong" && "bg-error text-on-error",
          )}
        >
          {keyLabel}
        </span>
      )}
      {illustration && <Illustration name={illustration} decorative width={56} height={56} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{label}</span>
        {description && <span className="text-label font-medium text-ink-muted">{description}</span>}
      </span>
      {state === "correct" && <Icon name="CheckCircle" weight="fill" color="successText" label={stateText} className="motion-safe:animate-[sm-pop_0.3s_ease-out_1]" />}
      {state === "wrong" && <Icon name="XCircle" weight="fill" color="errorText" label={stateText} />}
      {kind === "choice" && selected && <Icon name="CheckCircle" weight="fill" color="primary" className="absolute -top-2 -right-2 rounded-full bg-surface" />}
    </button>
  );
}

export interface StatTileProps extends StatTileContract {
  className?: string;
}

/** Number in `title` with tabular figures, label in `caption`, optional tint. */
export function StatTile({ value, label, tint, subject, icon, testID, className }: StatTileProps) {
  return (
    <div
      data-testid={testID}
      {...subjectAttr(subject)}
      className={cx("flex flex-col gap-0.5 rounded-md p-3", tint ? "bg-subject-tint" : "bg-surface shadow-card", className)}
    >
      {icon && <Icon name={icon} size={20} color="subjectText" className="mb-1" />}
      <span className="text-title tabular-nums">{value}</span>
      <span className="text-caption text-ink-muted">{label}</span>
    </div>
  );
}

export interface EmptyStateProps extends EmptyStateContract {
  className?: string;
}

/** Illustration (pet or plant), one line of copy, one action (DESIGN.md §5). */
export function EmptyState({ illustration, pet, plant, alt, text, action, testID, className }: EmptyStateProps) {
  return (
    <div data-testid={testID} className={cx("flex flex-col items-center gap-4 px-6 py-8 text-center", className)}>
      {pet ? (
        <PetView species={pet.species} mood={pet.mood ?? "curious"} size={160} alt={alt} decorative={!alt} />
      ) : plant ? (
        <PlantView stage={plant.stage} health={plant.health} size={160} alt={alt} decorative={!alt} />
      ) : illustration ? (
        <Illustration name={illustration} alt={alt} decorative={!alt} width={200} height={150} />
      ) : null}
      <p className="m-0 max-w-[32ch] text-body text-ink">{text}</p>
      {action && <Button label={action.label} onPress={action.onPress} variant="secondary" size="sm" />}
    </div>
  );
}
