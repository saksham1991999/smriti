import type { ReactNode } from "react";
import {
  clamp01,
  ringGeometry,
  toPercent,
  type ProgressBarContract,
  type ProgressRingContract,
  type ProgressTone,
  type SegmentedProgressContract,
} from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, subjectAttr } from "../util";

export const toneFill: Record<ProgressTone, string> = {
  subject: "bg-subject-strong",
  primary: "bg-primary",
  streak: "bg-streak",
  success: "bg-success",
  gem: "bg-gem",
  onStrong: "bg-subject-on-strong",
};
const toneStroke: Record<ProgressTone, string> = {
  subject: "stroke-subject-strong",
  primary: "stroke-primary",
  streak: "stroke-streak",
  success: "stroke-success",
  gem: "stroke-gem",
  onStrong: "stroke-subject-on-strong",
};

export interface ProgressBarProps extends ProgressBarContract {
  className?: string;
}

/** 8 px bar, radius 4, `track` behind (DESIGN.md §5). On a strong fill use tone="onStrong". */
export function ProgressBar({ value, tone = "subject", subject, label, valueText, thickness = 8, className, testID }: ProgressBarProps) {
  const { t } = useUI();
  const pct = toPercent(value);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={valueText ?? t("progress.percent", { percent: pct })}
      data-testid={testID}
      {...subjectAttr(subject)}
      className={cx("w-full overflow-hidden rounded-full", tone === "onStrong" ? "bg-[color-mix(in_srgb,var(--sm-subject-on-strong)_28%,transparent)]" : "bg-track", className)}
      style={{ height: thickness }}
    >
      <div
        className={cx("h-full rounded-full transition-[width] duration-slow ease-standard", toneFill[tone])}
        style={{ width: `${clamp01(value) * 100}%` }}
      />
    </div>
  );
}

export interface ProgressRingProps extends ProgressRingContract {
  className?: string;
  /** Custom centre content (replaces centerText). */
  children?: ReactNode;
}

/** Ring with stroke 10-12 (DESIGN.md §5). */
export function ProgressRing({ value, size = 56, stroke = 10, tone = "subject", subject, label, valueText, centerText, children, className, testID }: ProgressRingProps) {
  const { t } = useUI();
  const g = ringGeometry(size, stroke, value);
  const pct = toPercent(value);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={valueText ?? t("progress.percent", { percent: pct })}
      data-testid={testID}
      {...subjectAttr(subject)}
      className={cx("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={g.cx} cy={g.cy} r={g.r} fill="none" strokeWidth={stroke} className="stroke-track" />
        <circle
          cx={g.cx}
          cy={g.cy}
          r={g.r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={g.circumference}
          strokeDashoffset={g.dashOffset}
          className={cx(toneStroke[tone], "transition-[stroke-dashoffset] duration-slow ease-standard", value <= 0 && "opacity-0")}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        {children ?? (centerText ? <span className="text-label font-extrabold tabular-nums">{centerText}</span> : null)}
      </div>
    </div>
  );
}

export interface SegmentedProgressProps extends SegmentedProgressContract {
  className?: string;
}

/** Lesson progress: one segment per card (or per onboarding question). */
export function SegmentedProgress({ total, done, current, tone = "primary", subject, label, className, testID }: SegmentedProgressProps) {
  const { t } = useUI();
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={t("progress.segments", { done, total })}
      data-testid={testID}
      {...subjectAttr(subject)}
      className={cx("flex w-full gap-1", className)}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="relative h-2 flex-1 overflow-hidden rounded-full bg-track">
          <span
            className={cx("absolute inset-y-0 left-0 rounded-full transition-[width] duration-slow ease-standard", toneFill[tone])}
            style={{ width: i < done ? "100%" : i === current ? "50%" : "0%" }}
          />
        </span>
      ))}
    </div>
  );
}
