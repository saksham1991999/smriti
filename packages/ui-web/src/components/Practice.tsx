import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { mockPalette } from "@smriti/tokens";
import {
  applyKeypadKey,
  formatScore,
  formatShortDuration,
  heatCell,
  keypadKeyFromKeyboard,
  keypadLayout,
  limitState,
  paletteShapePoints,
  paletteStateKey,
  timeResultKey,
  timerState,
  timeStripHeights,
  type HeatMapCellContract,
  type IconName,
  type KeypadKey,
  type LeaderboardRowContract,
  type LimitMeterContract,
  type MockPaletteCellContract,
  type NumericKeypadContract,
  type OmrBubbleRowContract,
  type ScoreRingContract,
  type SectionTabsContract,
  type TimerContract,
  type TimerPhase,
  type TimeStripContract,
} from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, focusRing, hitArea, pressable, subjectAttr } from "../util";
import { Icon } from "./Icon";
import { PetAvatar } from "./Illustration";
import { ProgressBar, ProgressRing } from "./Progress";

// ---------- Mock palette cell ----------

const cellClass = {
  notVisited: "bg-mock-not-visited-fill text-mock-not-visited-text ring-[1.5px] ring-inset ring-mock-not-visited-border rounded-[4px]",
  notAnswered: "bg-mock-not-answered-fill text-mock-not-answered-text",
  answered: "bg-mock-answered-fill text-mock-answered-text",
  marked: "bg-mock-marked-fill text-mock-marked-text rounded-full",
  answeredMarked: "bg-mock-answered-marked-fill text-mock-answered-marked-text rounded-full ring-[3px] ring-inset ring-mock-answered-marked-border",
} as const;

export interface MockPaletteCellProps extends MockPaletteCellContract {
  className?: string;
}

/** 40 x 40, exam-standard colours plus a shape per state (DESIGN.md §2.4), question number in `label`. */
export function MockPaletteCell({ number, state, current, onPress, testID, className }: MockPaletteCellProps) {
  const { t } = useUI();
  const pts = paletteShapePoints(mockPalette[state].shape);
  const clip = pts ? `polygon(${pts.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(", ")})` : undefined;
  const label = `${t("palette.cell", { n: number, state: t(paletteStateKey[state]) })}${current ? `, ${t("palette.current")}` : ""}`;
  return (
    <button
      type="button"
      data-testid={testID}
      data-state={state}
      aria-label={label}
      aria-current={current ? "step" : undefined}
      onClick={onPress}
      className={cx("relative inline-grid size-12 shrink-0 place-items-center rounded-xs", focusRing, current && "ring-2 ring-ink", className)}
    >
      <span aria-hidden className={cx("grid size-10 place-items-center text-label font-bold tabular-nums", cellClass[state])} style={clip ? { clipPath: clip } : undefined}>
        {number}
      </span>
      {state === "answeredMarked" && (
        <span aria-hidden className="absolute right-0 bottom-0 grid size-4 place-items-center rounded-full bg-mock-answered-fill text-mock-answered-text">
          <Icon name="Check" size={16} className="scale-75" />
        </span>
      )}
    </button>
  );
}

// ---------- Timer ----------

const phaseLook: Record<TimerPhase, { icon: IconName; text: string }> = {
  default: { icon: "Timer", text: "text-ink" },
  warning: { icon: "Warning", text: "text-warning-text" },
  final: { icon: "WarningOctagon", text: "text-error-text" },
  paused: { icon: "PauseCircle", text: "text-ink" },
  done: { icon: "WarningOctagon", text: "text-error-text" },
};

function useNow(now: () => number, running: boolean): number {
  const [tick, setTick] = useState(() => now());
  useEffect(() => {
    if (!running) return;
    setTick(now());
    const id = setInterval(() => setTick(now()), 1000);
    return () => clearInterval(id);
  }, [now, running]);
  return tick;
}

export interface TimerProps extends TimerContract {
  className?: string;
}

/** Count-down or count-up in `title` with tabular figures. Warning and final add an icon; count-up never warns. */
export function Timer({ mode, endsAt, startedAt, now = Date.now, warnAtMs, finalAtMs, paused, pausedMs, sectional, announce = "warnings", size = "header", caption, hideCaption, testID, className }: TimerProps) {
  const { t } = useUI();
  const current = useNow(now, !paused);
  const s = timerState({ mode, endsAt, startedAt, now: current, warnAtMs, finalAtMs, paused, pausedMs });
  const look = phaseLook[s.phase];
  const [announced, setAnnounced] = useState<string>("");
  const lastPhase = useRef<TimerPhase>(s.phase);
  useEffect(() => {
    if (s.phase !== lastPhase.current) {
      lastPhase.current = s.phase;
      if (announce === "warnings" && (s.phase === "warning" || s.phase === "final")) setAnnounced(`${t(s.phase === "warning" ? "timer.warning" : "timer.final")}: ${s.text}`);
    }
  }, [s.phase, s.text, announce, t]);
  const capText = caption ?? (s.phase === "paused" ? t("timer.paused") : mode === "countdown" ? t("timer.left") : t("timer.taken"));
  const sect = sectional ? timerState({ mode: "countdown", endsAt: sectional.endsAt, now: current }) : null;
  return (
    <div data-testid={testID} data-phase={s.phase} className={cx("inline-flex flex-col items-center", className)}>
      <span role="timer" aria-label={`${capText} ${s.text}`} className={cx("inline-flex items-center gap-1.5 tabular-nums", look.text, size === "header" ? "text-title" : "text-label font-bold")}>
        <Icon name={look.icon} size={size === "header" ? 24 : 20} weight={s.phase === "paused" ? "fill" : "bold"} />
        <span aria-hidden>{s.text}</span>
      </span>
      {!hideCaption && <span className="text-caption text-ink-muted">{capText}</span>}
      {sect && (
        <span className="text-caption text-ink-muted tabular-nums">
          {sectional?.label} {sect.text}
        </span>
      )}
      <span aria-live="polite" className="sr-only">
        {announced}
      </span>
    </div>
  );
}

// ---------- Section tabs ----------

export interface SectionTabsProps extends SectionTabsContract {
  className?: string;
}

/** 40 px scrollable tabs with an "{answered}/{total}" badge. Active: 3 px primary underline. Locked: Lock icon. */
export function SectionTabs({ sections, activeCode, onSelect, label, testID, className }: SectionTabsProps) {
  const { t } = useUI();
  return (
    <Tabs.Root value={activeCode} onValueChange={onSelect} activationMode="manual" data-testid={testID} className={className}>
      <Tabs.List aria-label={label} className="flex h-10 gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
        {sections.map((s) => {
          const blocked = s.state !== "open";
          const a11y = `${s.title}, ${t("sectionTabs.count", { answered: s.answered, total: s.total })}${s.state === "locked" ? `, ${t("sectionTabs.closed")}` : s.state === "not_open" ? `, ${t("sectionTabs.notOpen")}` : ""}`;
          return (
            <Tabs.Trigger
              key={s.code}
              value={s.code}
              disabled={blocked}
              aria-label={a11y}
              className={cx(
                "relative inline-flex h-10 shrink-0 items-center gap-1.5 px-3 text-label whitespace-nowrap",
                "data-[state=active]:text-ink data-[state=inactive]:text-ink-muted",
                "after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-full data-[state=active]:after:bg-primary",
                blocked && "text-ink-disabled data-[state=inactive]:text-ink-disabled",
                focusRing,
              )}
            >
              {s.state === "locked" && <Icon name="Lock" size={16} />}
              <span>{s.title}</span>
              <span className="rounded-full bg-surface-sunken px-1.5 text-caption tabular-nums text-ink-muted">
                {s.answered}/{s.total}
              </span>
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
    </Tabs.Root>
  );
}

// ---------- Numeric keypad ----------

export interface NumericKeypadProps extends NumericKeypadContract {
  className?: string;
}

const keyLabelKey = { "-": "keypad.minus", ".": "keypad.decimal", backspace: "keypad.backspace", clear: "keypad.clear" } as const;

/** 4 x 4 grid of 56 px keys on surfaceSunken under the answer field. Hardware keys work too. */
export function NumericKeypad({ value, onChange, allowDecimal = true, allowNegative = true, maxLength = 8, hardwareKeys = true, disabled, error, label, onKey, testID, className }: NumericKeypadProps) {
  const { t } = useUI();
  const opts = { allowDecimal, allowNegative, maxLength };
  const press = (k: KeypadKey) => {
    if (disabled) return;
    onKey?.(k);
    onChange(applyKeypadKey(value, k, opts));
  };
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    if (!hardwareKeys || disabled) return;
    const on = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const k = keypadKeyFromKeyboard(e.key);
      if (k) {
        e.preventDefault();
        pressRef.current(k);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [hardwareKeys, disabled]);
  const fieldLabel = label ?? t("keypad.answer");
  return (
    <div data-testid={testID} className={cx("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-1">
        <output
          aria-label={fieldLabel}
          aria-live="polite"
          className={cx("flex h-14 items-center rounded-md bg-surface px-4 text-heading tabular-nums ring-[1.5px] ring-inset", error ? "ring-error" : "ring-line", !value && "text-ink-muted")}
        >
          {value || fieldLabel}
        </output>
        {error && (
          <span className="flex items-center gap-1 text-caption text-error-text">
            <Icon name="WarningOctagon" size={16} />
            {error}
          </span>
        )}
      </div>
      <div role="group" aria-label={fieldLabel} className="grid grid-cols-4 gap-2 rounded-card bg-surface-sunken p-2">
        {keypadLayout.flat().map((k, i) =>
          k === null || (k === "." && !allowDecimal) || (k === "-" && !allowNegative) ? (
            <span key={i} aria-hidden />
          ) : (
            <button
              key={k}
              type="button"
              disabled={disabled}
              aria-label={k in keyLabelKey ? t(keyLabelKey[k as keyof typeof keyLabelKey]) : k}
              onClick={() => press(k)}
              className={cx("grid h-14 place-items-center rounded-md bg-surface text-title tabular-nums text-ink shadow-card disabled:text-ink-disabled", focusRing, pressable)}
            >
              {k === "backspace" ? <Icon name="Backspace" /> : k === "clear" ? <span className="text-label">C</span> : k === "-" ? "−" : k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

// ---------- OMR bubble row ----------

export interface OmrBubbleRowProps extends OmrBubbleRowContract {
  className?: string;
}

/** Question number and 32 px option bubbles in 48 px hit areas, with an optional flag. */
export function OmrBubbleRow({ questionNo, options, selected = null, flagged, onSelect, onClear, readOnly, testID, className }: OmrBubbleRowProps) {
  const { t } = useUI();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: ReactKeyboardEvent, i: number) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + options.length) % options.length;
    refs.current[next]?.focus();
  };
  return (
    <div data-testid={testID} className={cx("flex items-center gap-1", className)}>
      <span className="w-10 shrink-0 text-label font-bold tabular-nums text-ink">{questionNo}</span>
      <div role="radiogroup" aria-label={String(questionNo)} aria-readonly={readOnly || undefined} className="flex">
        {options.map((o, i) => {
          const on = selected === i;
          return (
            <button
              key={o}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t("omr.option", { n: questionNo, x: o, state: t(on ? "omr.filled" : "omr.empty") })}
              tabIndex={on || (selected === null && i === 0) ? 0 : -1}
              disabled={readOnly}
              onClick={() => onSelect?.(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cx("grid size-12 place-items-center rounded-full", focusRing)}
            >
              <span className={cx("grid size-8 place-items-center rounded-full text-label font-bold", on ? "bg-ink text-surface" : "bg-surface text-ink ring-[1.5px] ring-inset ring-line")}>{o}</span>
            </button>
          );
        })}
      </div>
      {flagged && <Icon name="Flag" size={20} weight="fill" color="warningText" label={t("omr.flagged")} className="ml-1" />}
      {onClear && selected !== null && !readOnly && (
        <button type="button" onClick={onClear} className={cx("relative ml-auto rounded-xs px-2 text-label text-primary-text", hitArea, focusRing)}>
          {t("omr.clear")}
        </button>
      )}
    </div>
  );
}

// ---------- Score ring ----------

export interface ScoreRingProps extends ScoreRingContract {
  className?: string;
}

/** The progress ring at stroke 12 with the score in `display`. Negative scores show "−n" with an empty ring. */
export function ScoreRing({ score, max, label, size = "lg", loading, testID, className }: ScoreRingProps) {
  const { t } = useUI();
  const px = size === "lg" ? 152 : 112;
  const value = loading || max <= 0 ? 0 : Math.max(0, score) / max;
  return (
    <ProgressRing
      testID={testID}
      value={value}
      size={px}
      stroke={12}
      tone="primary"
      label={label ?? t("score.a11y", { score: formatScore(score), max })}
      valueText={loading ? t("common.loading") : t("score.a11y", { score: formatScore(score), max })}
      className={className}
    >
      {loading ? (
        <span className="h-9 w-16 rounded-xs bg-surface-sunken motion-safe:animate-pulse" />
      ) : (
        <span className="flex flex-col items-center">
          <span className={cx("tabular-nums", size === "lg" ? "text-display" : "text-title")}>{formatScore(score)}</span>
          <span className="text-caption text-ink-muted tabular-nums">{t("score.of", { max })}</span>
        </span>
      )}
    </ProgressRing>
  );
}

// ---------- Heat map cell ----------

export interface HeatMapCellProps extends HeatMapCellContract {
  className?: string;
}

const heatFill = ["bg-heat-0 text-heat-0-text", "bg-heat-1 text-heat-1-text", "bg-heat-2 text-heat-2-text", "bg-heat-3 text-heat-3-text", "bg-heat-4 text-heat-4-text"];

/** 44 x 44 with the percentage printed inside; too few answers are hatched. Never colour alone. */
export function HeatMapCell({ value, count, minCount, label, selected, disabled, onPress, testID, className }: HeatMapCellProps) {
  const { t } = useUI();
  const c = heatCell(value, count, minCount);
  const a11y = c.kind === "tooFew" ? `${label}: ${t("heat.notEnough")}` : t("heat.a11y", { label, percent: c.percent });
  const cls = cx(
    "relative grid size-11 shrink-0 place-items-center rounded-xs text-caption tabular-nums",
    c.kind === "filled" ? heatFill[c.step] : "bg-surface-sunken text-ink-muted bg-[repeating-linear-gradient(135deg,var(--sm-line)_0_2px,transparent_2px_7px)]",
    selected && "ring-2 ring-ink",
    disabled && "opacity-60",
    onPress && !disabled && cx(focusRing, pressable, hitArea),
    className,
  );
  const content = c.kind === "filled" ? `${c.percent}%` : "–";
  return onPress ? (
    <button type="button" data-testid={testID} aria-label={a11y} aria-pressed={selected} disabled={disabled} onClick={onPress} title={a11y} className={cls}>
      <span aria-hidden>{content}</span>
    </button>
  ) : (
    <span data-testid={testID} role="img" aria-label={a11y} title={a11y} className={cls}>
      <span aria-hidden>{content}</span>
    </span>
  );
}

// ---------- Time strip ----------

export interface TimeStripProps extends TimeStripContract {
  className?: string;
  height?: number;
}

const resultIcon = { right: "Check", wrong: "X", skipped: "Minus", not_scored: "Minus" } as const;
const resultColor = { right: "successText", wrong: "errorText", skipped: "inkMuted", not_scored: "inkMuted" } as const;

/** One bar per question (height = time), a result glyph under each, optional dashed target, and a table view. */
export function TimeStrip({ items, label, subject, selectedIndex, onSelect, showTarget = true, targetCaption, view: viewProp, onViewChange, height = 120, testID, className }: TimeStripProps) {
  const { t, locale } = useUI();
  const [own, setOwn] = useState<"chart" | "table">("chart");
  const view = viewProp ?? own;
  const setView = (v: "chart" | "table") => (onViewChange ? onViewChange(v) : setOwn(v));
  const { heights, targets } = timeStripHeights(items, height);
  const hasTarget = showTarget && targets.some((x) => x !== null);
  return (
    <section data-testid={testID} {...subjectAttr(subject)} aria-label={label} className={cx("flex flex-col gap-3", className)}>
      <div className="flex justify-end">
        <button type="button" onClick={() => setView(view === "chart" ? "table" : "chart")} className={cx("relative rounded-xs text-label font-bold text-primary-text", hitArea, focusRing)}>
          {view === "chart" ? t("timeStrip.showTable") : t("timeStrip.showChart")}
        </button>
      </div>
      {view === "chart" ? (
        <>
          <div role="list" className="flex items-end gap-1 overflow-x-auto pb-1">
            {items.map((it, i) => {
              const result = t(timeResultKey[it.result]);
              const target = targets[i];
              return (
                <button
                  key={`${it.sectionCode ?? ""}${it.questionNo}`}
                  type="button"
                  role="listitem"
                  aria-label={t("timeStrip.bar", { n: it.questionNo, time: formatShortDuration(it.timeMs, locale), result })}
                  aria-pressed={selectedIndex === i}
                  onClick={() => onSelect?.(i)}
                  className={cx("flex w-6 shrink-0 flex-col items-center gap-1 rounded-xs", focusRing)}
                >
                  <span className="relative flex w-full items-end justify-center" style={{ height }}>
                    <span
                      className={cx("w-4 rounded-t-[4px] bg-subject-strong", selectedIndex === i && "ring-2 ring-ink ring-offset-1 ring-offset-surface")}
                      style={{ height: heights[i] }}
                    />
                    {hasTarget && target !== null && target !== undefined && (
                      <span aria-hidden className="absolute inset-x-0 border-t-2 border-dashed border-ink" style={{ bottom: target }} />
                    )}
                  </span>
                  <Icon name={resultIcon[it.result]} size={16} color={resultColor[it.result]} />
                  <span className="text-caption tabular-nums text-ink-muted">{it.questionNo}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-muted">
            {(["right", "wrong", "skipped"] as const).map((r) => (
              <span key={r} className="inline-flex items-center gap-1">
                <Icon name={resultIcon[r]} size={16} color={resultColor[r]} />
                {t(timeResultKey[r])}
              </span>
            ))}
            {hasTarget ? (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden className="inline-block w-4 border-t-2 border-dashed border-ink" />
                {t("timeStrip.targetLine")}
              </span>
            ) : (
              <span>{t("timeStrip.noTarget")}</span>
            )}
          </div>
          {targetCaption && hasTarget && <p className="m-0 text-caption text-ink-muted">{targetCaption}</p>}
        </>
      ) : (
        <table className="w-full border-collapse text-start text-label">
          <thead>
            <tr className="text-caption text-ink-muted">
              <th className="py-2 text-start font-semibold">{t("timeStrip.question")}</th>
              <th className="py-2 text-start font-semibold">{t("timeStrip.time")}</th>
              {hasTarget && <th className="py-2 text-start font-semibold">{t("timeStrip.target")}</th>}
              <th className="py-2 text-start font-semibold">{t("timeStrip.result")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={`${it.sectionCode ?? ""}${it.questionNo}`} className="border-t border-line">
                <td className="py-2 tabular-nums">{it.questionNo}</td>
                <td className="py-2 tabular-nums">{formatShortDuration(it.timeMs, locale)}</td>
                {hasTarget && <td className="py-2 tabular-nums">{it.targetMs === undefined ? "–" : formatShortDuration(it.targetMs, locale)}</td>}
                <td className="py-2">
                  <span className="inline-flex items-center gap-1">
                    <Icon name={resultIcon[it.result]} size={16} color={resultColor[it.result]} />
                    {t(timeResultKey[it.result])}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------- Leaderboard row ----------

export interface LeaderboardRowProps extends LeaderboardRowContract {
  className?: string;
}

/** Rank, 32 px avatar, name, score. The name is already resolved by privacy rules; self row is primaryTint. */
export function LeaderboardRow({ rank, avatar, name, score, time, percentile, isSelf, pinned, rankPending, onPress, testID, className }: LeaderboardRowProps) {
  const { t } = useUI();
  const shownName = isSelf ? t("leaderboard.you") : name;
  const top3 = rank !== null && rank <= 3;
  const rankText = rank === null ? (rankPending ? t("leaderboard.rankSoon") : t("leaderboard.notRanked")) : String(rank);
  const a11y = t("leaderboard.a11y", { rank: rankText, name: shownName, score });
  const Tag = onPress ? "button" : "div";
  const avatarSize = top3 ? 40 : 32;
  return (
    <Tag
      type={onPress ? "button" : undefined}
      data-testid={testID}
      aria-label={a11y}
      onClick={onPress}
      className={cx(
        "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start",
        isSelf ? "bg-primary-tint" : "bg-surface",
        pinned && "sticky bottom-0 z-[1] shadow-raised",
        onPress && cx(focusRing, "cursor-pointer"),
        className,
      )}
    >
      <span aria-hidden className={cx("min-w-8 shrink-0 text-center whitespace-nowrap tabular-nums", top3 ? "text-title" : rank === null ? "text-caption text-ink-muted" : "text-label font-bold")}>
        {rankText}
      </span>
      {avatar.kind === "pet" ? (
        <PetAvatar species={avatar.species} size={avatarSize} />
      ) : (
        <span aria-hidden className="grid shrink-0 place-items-center rounded-full bg-surface-sunken text-label font-bold text-ink-muted" style={{ width: avatarSize, height: avatarSize }}>
          {avatar.initials}
        </span>
      )}
      <span aria-hidden className={cx("min-w-0 flex-1 truncate text-label", isSelf ? "font-extrabold text-ink" : "text-ink")}>
        {shownName}
      </span>
      {(time || percentile) && (
        <span aria-hidden className="text-caption text-ink-muted tabular-nums">
          {[time, percentile].filter(Boolean).join(" · ")}
        </span>
      )}
      <span aria-hidden className="text-label font-extrabold tabular-nums text-ink">
        {score}
      </span>
    </Tag>
  );
}

// ---------- Limit meter ----------

export interface LimitMeterProps extends LimitMeterContract {
  className?: string;
}

/** Label, 8 px bar and "{used} of {limit}". Never pulses or shakes. Under-13s get "Ask a grown-up". */
export function LimitMeter({ label, used, limit, lastFewAt, proAction = "pro_link", onProPress, hidden, period = "day", testID, className }: LimitMeterProps) {
  const { t } = useUI();
  if (hidden) return null;
  const s = limitState(used, limit, lastFewAt);
  const ofText = t("limit.of", { used: s.used, limit: s.limit });
  return (
    <div data-testid={testID} data-phase={s.phase} className={cx("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-label text-ink">{label}</span>
        <span className="text-label tabular-nums text-ink-muted">{ofText}</span>
      </div>
      <ProgressBar value={s.fraction} tone="primary" label={label} valueText={ofText} />
      {(s.phase !== "in_range" || proAction !== "none") && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-caption text-ink-muted">
            {s.phase === "full" ? t(period === "week" ? "limit.fullWeek" : "limit.full") : s.phase === "last_few" ? t(period === "week" ? "limit.leftWeek" : "limit.left", { remaining: s.remaining }) : ""}
          </span>
          {proAction !== "none" && onProPress && (
            <button type="button" onClick={onProPress} className={cx("relative rounded-xs text-label font-bold text-primary-text", hitArea, focusRing)}>
              {proAction === "ask_grown_up" ? t("pro.askGrownUp") : t("limit.getPro")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
