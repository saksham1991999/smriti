import { useEffect, useRef, useState } from "react";
import type {
  CheerButtonContract,
  DuelAnswer,
  DuelScoreBarContract,
  DuelSide,
  FriendRowContract,
  LeagueTierBadgeContract,
  SquadCardContract,
} from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, focusRing, hitArea, pressable } from "../util";
import { Icon } from "./Icon";
import { Illustration, PetAvatar } from "./Illustration";
import { ProgressBar } from "./Progress";

// ---------- FriendRow ----------

export interface FriendRowProps extends FriendRowContract {
  className?: string;
}

/**
 * One friend in a list (SOC-01 friends, SOC-15 pick a friend): pet avatar 40, name, today's status as an
 * icon and a word, the streak with the Plant icon. Selectable rows are radios. Status is never colour alone.
 */
export function FriendRow({ name, avatar, studiedToday, streakDays, studyingNow, selectable, selected, disabled, note, onPress, testID, className }: FriendRowProps) {
  const { t } = useUI();
  const interactive = Boolean(onPress) || Boolean(selectable);
  const status =
    studyingNow ? (
      <span className="inline-flex items-center gap-1 text-success-text">
        <span aria-hidden className="size-2 rounded-full bg-success" />
        {t("friend.studyingNow")}
      </span>
    ) : studiedToday === undefined ? null : studiedToday ? (
      <span className="inline-flex items-center gap-1 text-success-text">
        <Icon name="CheckCircle" size={16} weight="fill" />
        {t("friend.studied")}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-ink-muted">
        <Icon name="Circle" size={16} />
        {t("friend.notYet")}
      </span>
    );
  const body = (
    <>
      <PetAvatar species={avatar.species} mood={avatar.mood} size={40} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-bold text-ink">{name}</span>
        {(status || note) && (
          <span className="flex flex-wrap items-center gap-x-3 text-caption">
            {status}
            {note && <span className="text-ink-muted">{note}</span>}
          </span>
        )}
      </span>
      {streakDays !== undefined && streakDays > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-streak-tint px-2.5 py-1 text-label font-bold text-streak-text tabular-nums" aria-label={t("streak.pill", { n: streakDays })}>
          <Icon name="Plant" size={16} weight="fill" />
          <span aria-hidden>{streakDays}</span>
        </span>
      )}
      {selectable && (
        <span aria-hidden className={cx("grid size-6 shrink-0 place-items-center rounded-full ring-2 ring-inset", selected ? "ring-primary" : "ring-line")}>
          {selected && <span className="size-3 rounded-full bg-primary" />}
        </span>
      )}
    </>
  );
  const cls = cx("flex min-h-16 w-full items-center gap-3 rounded-card px-3 py-2 text-start", disabled && "opacity-60", className);
  if (!interactive) {
    return (
      <div data-testid={testID} className={cls}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid={testID}
      role={selectable ? "radio" : undefined}
      aria-checked={selectable ? Boolean(selected) : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onPress}
      className={cx(cls, focusRing, !disabled && cx(pressable, "cursor-pointer hover:bg-surface-sunken"), selected && "bg-primary-tint hover:bg-primary-tint")}
    >
      {body}
    </button>
  );
}

// ---------- LeagueTierBadge ----------

const crestSize = { sm: 40, md: 56, lg: 96, xl: 120 } as const;

export interface LeagueTierBadgeProps extends LeagueTierBadgeContract {
  className?: string;
}

/**
 * A plant-tier league crest (SOC-08). The tier name and crest come from config, never hard-coded.
 * past: full colour; current: one step larger, primary ring, bold name; future: dimmed with an inkDisabled outline.
 */
export function LeagueTierBadge({ name, crest, state = "current", size = "md", showName = true, testID, className }: LeagueTierBadgeProps) {
  const { t } = useUI();
  const base = crestSize[size];
  const px = state === "current" && (size === "sm" || size === "md") ? base + 16 : base;
  const stateWord = state === "current" ? t("league.current") : state === "past" ? t("league.reached") : t("league.notReached");
  return (
    <span data-testid={testID} data-state={state} role="img" aria-label={`${t("league.crest", { tier_name: name })}, ${stateWord}`} className={cx("inline-flex w-min flex-col items-center gap-1", className)}>
      <span
        aria-hidden
        className={cx(
          "grid place-items-center rounded-full",
          state === "current" && "bg-primary-tint ring-[3px] ring-primary",
          state === "future" && "border-2 border-dashed border-ink-disabled",
        )}
        style={{ width: px, height: px }}
      >
        <Illustration name={crest} decorative width={Math.round(px * 0.86)} height={Math.round(px * 0.86)} className={cx(state === "future" && "opacity-40 grayscale")} />
      </span>
      {showName && (
        <span aria-hidden className={cx("max-w-24 text-center text-caption leading-tight", state === "current" ? "font-bold text-ink" : state === "future" ? "text-ink-muted" : "text-ink")}>
          {name}
        </span>
      )}
    </span>
  );
}

// ---------- DuelScoreBar ----------

const dotClass: Record<DuelAnswer, string> = {
  open: "ring-2 ring-inset ring-line",
  answered: "bg-ink-muted",
  right: "bg-success text-on-success",
  wrong: "bg-error text-on-error",
};

function DuelRow({ side, count, you }: { side: DuelSide; count: number; you?: boolean }) {
  const { t } = useUI();
  const answered = side.answers.filter((a) => a !== "open").length;
  const dots = Array.from({ length: count }, (_, i) => side.answers[i] ?? "open");
  return (
    <div role="group" aria-label={t("duel.a11y", { name: side.name, score: side.score, answered, count })} className={cx("flex items-center gap-3", side.dropped && "opacity-60")} data-you={you || undefined}>
      <PetAvatar species={side.avatar.species} mood={side.avatar.mood} size={32} />
      <div aria-hidden className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-label font-bold text-ink">{side.name}</span>
        <span className="flex flex-wrap gap-1">
          {dots.map((a, i) => (
            <span key={i} data-answer={a} className={cx("grid size-5 place-items-center rounded-full", dotClass[a])}>
              {a === "right" && <Icon name="Check" size={16} weight="bold" />}
              {a === "wrong" && <Icon name="X" size={16} weight="bold" />}
            </span>
          ))}
        </span>
        {side.dropped && (
          <span className="inline-flex items-center gap-1 text-caption text-ink-muted">
            <Icon name="WifiSlash" size={16} />
            {t("duel.dropped")}
          </span>
        )}
      </div>
      <span aria-hidden className="shrink-0 text-title font-bold text-ink tabular-nums">
        {side.score}
      </span>
    </div>
  );
}

export interface DuelScoreBarProps extends DuelScoreBarContract {
  className?: string;
}

/** The live duel score strip (SOC-18): one row per player with a dot per question and a tabular score. Solo shows one row. */
export function DuelScoreBar({ count, you, opponent, testID, className }: DuelScoreBarProps) {
  const { t } = useUI();
  return (
    <div data-testid={testID} className={cx("flex flex-col gap-2.5 rounded-card bg-surface p-3 shadow-card", className)}>
      <DuelRow side={you} count={count} you />
      {opponent ? (
        <>
          <div aria-hidden className="h-px bg-line" />
          <DuelRow side={opponent} count={count} />
        </>
      ) : (
        <p className="m-0 text-caption text-ink-muted">{t("duel.solo")}</p>
      )}
    </div>
  );
}

// ---------- SquadCard ----------

export interface SquadCardProps extends SquadCardContract {
  className?: string;
}

/** A squad row (SOC-01): crest 40, name, the shared quest as "{done} of {target}" with a streak bar, days left. */
export function SquadCard({ name, crest, done, target, daysLeft, onPress, testID, className }: SquadCardProps) {
  const { t } = useUI();
  const Tag = onPress ? "button" : "div";
  return (
    <Tag
      type={onPress ? "button" : undefined}
      data-testid={testID}
      aria-label={t("squad.a11y", { name, done, target })}
      onClick={onPress}
      className={cx("flex w-full items-center gap-3 rounded-card bg-surface p-4 text-start shadow-card", onPress && cx(focusRing, pressable, "cursor-pointer"), className)}
    >
      <Illustration name={crest} decorative width={40} height={40} />
      <span aria-hidden className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-body font-bold text-ink">{name}</span>
          <span className="shrink-0 text-label text-ink-muted tabular-nums">{t("squad.progress", { done, target })}</span>
        </span>
        <ProgressBar value={target > 0 ? Math.min(1, done / target) : 0} tone="streak" label={t("squad.progress", { done, target })} />
        {daysLeft !== undefined && <span className="text-caption text-ink-muted">{t("squad.daysLeft", { n: daysLeft })}</span>}
      </span>
      {onPress && <Icon name="CaretRight" size={20} className="shrink-0 text-ink-muted rtl:rotate-180" />}
    </Tag>
  );
}

// ---------- CheerButton ----------

export interface CheerButtonProps extends CheerButtonContract {
  className?: string;
}

/**
 * reaction: 40 tall, icon + word + count; the icon pops once when sent and a second tap does nothing (SOC-01).
 * message: a 48-tall surfaceRaised preset chip with an icon (SOC-22 grid); shows "Sent!" once sent.
 */
export function CheerButton({ label, icon, kind = "reaction", count, sent, disabled, onPress, testID, className }: CheerButtonProps) {
  const { t } = useUI();
  const [justSent, setJustSent] = useState(false);
  const prev = useRef(sent);
  useEffect(() => {
    if (sent && !prev.current) setJustSent(true);
    prev.current = sent;
  }, [sent]);
  const inactive = disabled || sent;
  const iconEl = (
    <span className={cx("inline-grid", justSent && "motion-safe:animate-[sm-pop_0.3s_ease-out_1]")} onAnimationEnd={() => setJustSent(false)}>
      <Icon name={sent && kind === "message" ? "Check" : icon} size={20} weight={sent ? "fill" : "bold"} />
    </span>
  );
  if (kind === "message") {
    return (
      <button
        type="button"
        data-testid={testID}
        aria-disabled={inactive || undefined}
        disabled={disabled}
        onClick={inactive ? undefined : onPress}
        className={cx(
          "inline-flex min-h-12 w-full items-center gap-2 rounded-full px-4 py-2 text-start text-label",
          sent ? "bg-success-tint text-success-text" : disabled ? "bg-surface-sunken text-ink-muted" : cx("bg-surface-raised text-ink shadow-card", pressable, "cursor-pointer"),
          focusRing,
          className,
        )}
      >
        {iconEl}
        <span className="min-w-0 flex-1">{label}</span>
        {sent && <span className="shrink-0 text-caption font-bold">{t("cheer.sent")}</span>}
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid={testID}
      aria-pressed={Boolean(sent)}
      aria-label={count !== undefined ? t("cheer.count", { label, n: count }) : label}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={inactive ? undefined : onPress}
      className={cx(
        "relative inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-label",
        sent ? "bg-primary-tint text-primary-text" : "bg-surface-raised text-ink ring-1 ring-inset ring-line",
        disabled && "opacity-60",
        !inactive && cx(pressable, "cursor-pointer"),
        focusRing,
        hitArea,
        className,
      )}
    >
      {iconEl}
      <span aria-hidden>{label}</span>
      {count !== undefined && (
        <span aria-hidden className="font-bold tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}
