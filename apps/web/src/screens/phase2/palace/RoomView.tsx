/**
 * One room of a palace (MEM-14, MEM-17, MEM-18): the room's illustration at 3:2, a dashed walk
 * path through its spots, and the numbered spot markers. In the builder the markers are buttons;
 * on a walk they're plain marks and the view zooms towards the current spot (no zoom with reduced
 * motion, where the ring alone shows the spot).
 */
import type { DragEvent } from "react";
import { Icon, cx, useUI } from "@smriti/ui-web";
import { useI18n } from "../../../lib/i18n";
import { shortLabel, spotPositions, SPOTS_PER_ROOM } from "./logic";

export interface RoomSpot {
  index: number;
  label: string | null;
  /** Hidden in the quiz: the marker shows "?" instead of the label. */
  hidden?: boolean;
  result?: "right" | "wrong";
}

export function RoomView({
  art,
  alt,
  roomName,
  spots,
  current,
  selected,
  placing,
  zoom,
  onSpot,
  onDropItem,
  testID,
}: {
  art: string;
  alt: string;
  roomName: string;
  spots: RoomSpot[];
  current?: number | null;
  selected?: number | null;
  /** An item is picked up: every spot offers "Place here". */
  placing?: boolean;
  zoom?: boolean;
  onSpot?: (index: number) => void;
  onDropItem?: (index: number, ref: string) => void;
  testID?: string;
}) {
  const { t } = useI18n();
  const { assetUrl } = useUI();
  const pos = spotPositions(SPOTS_PER_ROOM);
  const focus = current != null ? pos[current] : undefined;
  const origin = focus ? `${focus.x * 100}% ${focus.y * 100}%` : "50% 50%";
  return (
    <div className="relative aspect-[3/2] w-full overflow-hidden rounded-card bg-surface-sunken" data-testid={testID}>
      <div
        className="absolute inset-0 transition-transform duration-[400ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
        style={{ transformOrigin: origin, transform: zoom && focus ? "scale(1.3)" : undefined }}
        data-zoom={zoom && focus ? "on" : "off"}
      >
        {/* A plain img: the room is often already cached, and Illustration can miss a cached load (see report). */}
        <img src={assetUrl(art)} alt={alt} className="absolute inset-0 size-full select-none object-cover" draggable={false} decoding="async" />
        <svg className="pointer-events-none absolute inset-0 size-full text-ink-muted opacity-40" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={pos.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 1.6" vectorEffect="non-scaling-stroke" />
        </svg>
        {spots.map((s) => {
          const p = pos[s.index];
          if (!p) return null;
          const filled = !!s.label;
          const isCurrent = current === s.index;
          const isSelected = selected === s.index;
          const n = s.index + 1;
          const a11y = filled && !s.hidden ? t("memory_labs:MEM-14.spot_holds_a11y", { n, room_name: roomName, item_label: s.label ?? "" }) : t("memory_labs:MEM-14.spot_empty_a11y", { n, room_name: roomName });
          const marker = (
            <span
              className={cx(
                "relative grid size-12 place-items-center rounded-full border-2 text-label font-bold tabular-nums shadow-card",
                filled ? "border-subject-strong bg-surface text-ink" : "border-line bg-surface text-ink-muted",
                isCurrent && "ring-4 ring-streak motion-safe:animate-pulse",
                isSelected && "ring-4 ring-primary",
                s.result === "right" && "border-success bg-success-tint",
                s.result === "wrong" && "border-error bg-error-tint",
                current != null && !isCurrent && "opacity-70",
              )}
            >
              {s.result === "right" ? <Icon name="Check" size={20} weight="bold" /> : s.result === "wrong" ? <Icon name="X" size={20} weight="bold" /> : n}
            </span>
          );
          const chip =
            filled && (s.hidden ? true : !onSpot || !placing) ? (
              <span className="pointer-events-none mt-1 max-w-[132px] rounded-full bg-surface px-2 py-0.5 text-caption text-ink shadow-card max-[599px]:hidden">{s.hidden ? "?" : shortLabel(s.label ?? "", 22)}</span>
            ) : null;
          const style = { left: `${p.x * 100}%`, top: `${p.y * 100}%` };
          if (!onSpot) {
            return (
              <span key={s.index} className="absolute flex -translate-x-1/2 -translate-y-6 flex-col items-center" style={style} aria-hidden="true" data-testid={testID ? `${testID}-spot-${s.index}` : undefined} data-current={isCurrent || undefined}>
                {marker}
                {chip}
              </span>
            );
          }
          const drop = {
            onDragOver: (e: DragEvent) => {
              if (onDropItem) e.preventDefault();
            },
            onDrop: (e: DragEvent) => {
              const ref = e.dataTransfer.getData("text/plain");
              if (ref && onDropItem) {
                e.preventDefault();
                onDropItem(s.index, ref);
              }
            },
          };
          return (
            <button
              key={s.index}
              type="button"
              onClick={() => onSpot(s.index)}
              aria-label={a11y}
              aria-pressed={isSelected}
              className="absolute flex -translate-x-1/2 -translate-y-6 cursor-pointer flex-col items-center rounded-full focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary"
              style={style}
              data-testid={testID ? `${testID}-spot-${s.index}` : undefined}
              {...drop}
            >
              {marker}
              {placing ? <span className="mt-1 rounded-full bg-primary px-2 py-0.5 text-caption font-bold text-on-primary shadow-card">{t("memory_labs:MEM-14.place_here")}</span> : chip}
            </button>
          );
        })}
      </div>
    </div>
  );
}
