/**
 * The six interactive widgets (content-format §7.5). Each is keyboard and screen-reader usable:
 * sorting and labelling use selects instead of drag-only gestures. lesson-core checks the response.
 */
import { useId, useMemo, useState } from "react";
import type { BundleCard } from "@smriti/content-schema";
import { checkInteractive, type WidgetResponse, type WidgetResult } from "@smriti/lesson-core";
import { Button, Text, cx, focusRing } from "@smriti/ui-web";
import { usePlayer } from "./context";
import { Media } from "./Media";
import { initialOrder, MoveButton } from "./questions";
import { RichText } from "./RichText";

type Interactive = Extract<BundleCard, { type: "interactive" }>;

export interface WidgetProps {
  card: Interactive;
  locked: boolean;
  onResponse: (r: WidgetResponse) => void;
}

export function InteractiveCardView({ card, locked, onResponse }: WidgetProps) {
  const { t } = usePlayer();
  const [result, setResult] = useState<WidgetResult | null>(null);
  const send = (r: WidgetResponse) => {
    setResult(checkInteractive(card, r));
    onResponse(r);
  };
  const feedback =
    result && result.correct !== null ? (
      <div role="status" className={cx("rounded-md p-3", result.correct ? "bg-success-tint" : "bg-error-tint")} data-testid={result.correct ? "widget-right" : "widget-wrong"}>
        <Text variant="label" tone={result.correct ? "success" : "error"}>
          {result.correct ? t("learn:WEB-02.widget_right") : t("learn:WEB-02.widget_wrong")}
        </Text>
        {(result.correct ? card.feedback?.correct : card.feedback?.wrong) && <RichText text={(result.correct ? card.feedback?.correct : card.feedback?.wrong) ?? ""} />}
      </div>
    ) : null;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 text-heading font-bold text-ink">
        <RichText as="span" text={card.prompt} className="text-heading font-bold" />
      </h2>
      {card.media && card.widget !== "label_diagram" && <Media refId={card.media} />}
      <Widget card={card} locked={locked} send={send} wrong={result?.wrong ?? []} />
      {feedback}
    </div>
  );
}

function Widget({ card, locked, send, wrong }: { card: Interactive; locked: boolean; send: (r: WidgetResponse) => void; wrong: string[] }) {
  switch (card.widget) {
    case "drag_sort":
      return <Placements locked={locked} wrong={wrong} hintKey="learn:WEB-02.sort_hint" items={card.config.items} targets={card.config.bins.map((b) => ({ id: b.id, text: b.label }))} labelFor={(item) => ({ key: "learn:WEB-02.box_for_item", values: { item } })} onCheck={(p) => send({ widget: "drag_sort", placements: p.map((x) => ({ item: x.from, bin: x.to })) })} />;
    case "label_diagram":
      return (
        <div className="flex flex-col gap-3">
          <Media refId={card.config.media} />
          <Placements
            locked={locked}
            wrong={wrong}
            items={card.config.spots.map((s, i) => ({ id: s.id, text: String(i + 1) }))}
            targets={card.config.labels}
            labelFor={(_item, i) => ({ key: "learn:WEB-02.label_for_spot", values: { n: i + 1 } })}
            onCheck={(p) => send({ widget: "label_diagram", placements: p.map((x) => ({ spot: x.from, label: x.to })) })}
          />
        </div>
      );
    case "order_steps":
      return <OrderWidget steps={card.config.steps} seed={card.id} locked={locked} wrong={wrong} onCheck={(order) => send({ widget: "order_steps", order })} />;
    case "slider":
      return <SliderWidget cfg={card.config} locked={locked} onCheck={(value) => send({ widget: "slider", value })} />;
    case "graph":
      return <GraphWidget cfg={card.config} locked={locked} onCheck={(x, y) => send({ widget: "graph", x, y })} />;
    case "tap_reveal":
      return <TapReveal tiles={card.config.tiles} onReveal={(revealed) => send({ widget: "tap_reveal", revealed })} />;
  }
}

type Key = Parameters<ReturnType<typeof usePlayer>["t"]>[0];

function Placements({
  items,
  targets,
  labelFor,
  onCheck,
  locked,
  wrong,
  hintKey,
}: {
  items: { id: string; text: string }[];
  targets: { id: string; text: string }[];
  labelFor: (itemText: string, index: number) => { key: Key; values: Record<string, string | number> };
  onCheck: (p: { from: string; to: string }[]) => void;
  locked: boolean;
  wrong: string[];
  hintKey?: Key;
}) {
  const { t } = usePlayer();
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const complete = items.every((i) => placed[i.id]);
  return (
    <div className="flex flex-col gap-3">
      {hintKey && (
        <Text variant="label" tone="muted">
          {t(hintKey)}
        </Text>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item, i) => {
          const l = labelFor(item.text, i);
          return (
            <li key={item.id} className={cx("grid grid-cols-[1fr_minmax(0,1fr)] items-center gap-2 rounded-md bg-surface-sunken p-2 ps-3", wrong.includes(item.id) && "bg-error-tint")}>
              <RichText as="span" text={item.text} className="font-semibold" />
              <select
                aria-label={t(l.key, l.values)}
                value={placed[item.id] ?? ""}
                disabled={locked}
                onChange={(e) => setPlaced({ ...placed, [item.id]: e.target.value })}
                className={cx("h-12 min-w-0 rounded-md bg-surface px-3 text-body text-ink ring-[1.5px] ring-inset ring-line", focusRing)}
                data-testid={`place-${item.id}`}
              >
                <option value="">{t("learn:WEB-02.choose")}</option>
                {targets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.text}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      {!locked && <Button label={t("learn:LES-01.check")} variant="secondary" disabled={!complete} onPress={() => onCheck(items.map((i) => ({ from: i.id, to: placed[i.id] as string })))} testID="widget-check" />}
    </div>
  );
}

function OrderWidget({ steps, seed, locked, wrong, onCheck }: { steps: { id: string; text: string }[]; seed: string; locked: boolean; wrong: string[]; onCheck: (order: string[]) => void }) {
  const { t } = usePlayer();
  const ids = steps.map((s) => s.id);
  const [order, setOrder] = useState(() => initialOrder(ids, ids, seed));
  const text = new Map(steps.map((s) => [s.id, s.text]));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    setOrder(next);
  };
  return (
    <div className="flex flex-col gap-3">
      <Text variant="label" tone="muted">
        {t("learn:WEB-02.order_hint")}
      </Text>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {order.map((id, i) => (
          <li key={id} className={cx("flex items-center gap-2 rounded-md bg-surface-sunken p-2 ps-3", wrong.includes(id) && "bg-error-tint")}>
            <span aria-hidden className="w-5 text-label font-bold text-ink-muted">
              {i + 1}
            </span>
            <RichText as="span" text={text.get(id) ?? id} className="flex-1" />
            {!locked && (
              <span className="flex gap-1">
                <MoveButton label={t("learn:WEB-02.move_up_a11y", { step: i + 1 })} up disabled={i === 0} onPress={() => move(i, -1)} />
                <MoveButton label={t("learn:WEB-02.move_down_a11y", { step: i + 1 })} disabled={i === order.length - 1} onPress={() => move(i, 1)} />
              </span>
            )}
          </li>
        ))}
      </ol>
      {!locked && <Button label={t("learn:LES-01.check")} variant="secondary" onPress={() => onCheck(order)} testID="widget-check" />}
    </div>
  );
}

function SliderWidget({ cfg, locked, onCheck }: { cfg: Extract<Interactive, { widget: "slider" }>["config"]; locked: boolean; onCheck: (v: number) => void }) {
  const { t } = usePlayer();
  const id = useId();
  const [v, setV] = useState(cfg.initial ?? cfg.min);
  return (
    <div className="flex flex-col gap-3">
      {cfg.guidance && <RichText text={cfg.guidance} className="text-ink-muted" />}
      <label htmlFor={id} className="flex items-center justify-between text-label font-bold text-ink">
        <span>{t("learn:WEB-02.slider_value")}</span>
        <output htmlFor={id} className="tabular-nums" data-testid="slider-value">
          {v}
          {cfg.unit ? ` ${cfg.unit}` : ""}
        </output>
      </label>
      <input id={id} type="range" min={cfg.min} max={cfg.max} step={cfg.step} value={v} disabled={locked} onChange={(e) => setV(Number(e.target.value))} className="w-full accent-[var(--color-primary)]" data-testid="slider" />
      {!locked && <Button label={t("learn:LES-01.check")} variant="secondary" onPress={() => onCheck(v)} testID="widget-check" />}
    </div>
  );
}

function GraphWidget({ cfg, locked, onCheck }: { cfg: Extract<Interactive, { widget: "graph" }>["config"]; locked: boolean; onCheck: (x: number, y: number) => void }) {
  const { t } = usePlayer();
  const [x, setX] = useState(cfg.initial?.x ?? cfg.x.min);
  const [y, setY] = useState(cfg.initial?.y ?? cfg.y.min);
  const axes = useMemo(
    () => [
      { key: "x", axis: cfg.x, v: x, set: setX, label: t("learn:WEB-02.graph_x") },
      { key: "y", axis: cfg.y, v: y, set: setY, label: t("learn:WEB-02.graph_y") },
    ],
    [cfg, x, y, t],
  );
  return (
    <div className="flex flex-col gap-3">
      {axes.map((a) => (
        <label key={a.key} className="flex flex-col gap-1">
          <span className="flex justify-between text-label font-bold text-ink">
            <span>
              {a.label} · {a.axis.label}
            </span>
            <span className="tabular-nums">
              {a.v}
              {a.axis.unit ? ` ${a.axis.unit}` : ""}
            </span>
          </span>
          <input type="range" min={a.axis.min} max={a.axis.max} step={a.axis.step} value={a.v} disabled={locked} onChange={(e) => a.set(Number(e.target.value))} className="w-full accent-[var(--color-primary)]" data-testid={`graph-${a.key}`} />
        </label>
      ))}
      {!locked && <Button label={t("learn:LES-01.check")} variant="secondary" onPress={() => onCheck(x, y)} testID="widget-check" />}
    </div>
  );
}

function TapReveal({ tiles, onReveal }: { tiles: { id: string; label: string; text: string }[]; onReveal: (ids: string[]) => void }) {
  const { t } = usePlayer();
  const [open, setOpen] = useState<string[]>([]);
  return (
    <div className="flex flex-col gap-3">
      <Text variant="label" tone="muted">
        {t("learn:WEB-02.tap_reveal_hint")}
      </Text>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tiles.map((tile) => {
          const shown = open.includes(tile.id);
          return (
            <button
              key={tile.id}
              type="button"
              aria-expanded={shown}
              onClick={() => {
                if (shown) return;
                const next = [...open, tile.id];
                setOpen(next);
                onReveal(next);
              }}
              className={cx("flex min-h-14 flex-col items-start gap-1 rounded-md p-3 text-start", shown ? "bg-subject-tint" : "bg-surface-sunken", focusRing)}
              data-testid={`tile-${tile.id}`}
            >
              <span className="text-label font-bold text-ink">{tile.label}</span>
              {shown && <RichText as="span" text={tile.text} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
