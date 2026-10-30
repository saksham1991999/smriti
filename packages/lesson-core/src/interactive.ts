/** Checking interactive widgets and sim tasks inside lessons. */
import type {
  BundleCard,
  DragSortConfig,
  GraphConfig,
  LabelDiagramConfig,
  OrderStepsConfig,
  SliderConfig,
  TapRevealConfig,
} from "@smriti/content-schema";
import { convertUnit } from "@smriti/content-schema";

export type InteractiveCardB = Extract<BundleCard, { type: "interactive" }>;
export type SimCardB = Extract<BundleCard, { type: "sim" }>;

export type WidgetResponse =
  | { widget: "drag_sort"; placements: { item: string; bin: string }[] }
  | { widget: "label_diagram"; placements: { spot: string; label: string }[] }
  | { widget: "order_steps"; order: string[] }
  | { widget: "slider"; value: number }
  | { widget: "graph"; x: number; y: number }
  | { widget: "tap_reveal"; revealed: string[] };

export interface WidgetResult {
  /** null for widgets with nothing to get right (tap reveal, a slider without a target). */
  correct: boolean | null;
  /** The task is finished and the student may move on. */
  done: boolean;
  /** Ids placed wrongly, for highlighting. */
  wrong: string[];
}

const near = (v: number, target: number, tol: { abs?: number; rel?: number } | undefined) => {
  const d = Math.abs(v - target);
  if (!tol || (tol.abs === undefined && tol.rel === undefined)) return d <= 1e-9;
  return (tol.abs !== undefined && d <= tol.abs + 1e-12) || (tol.rel !== undefined && d <= Math.abs(target) * tol.rel + 1e-12);
};

/** The widget configs, by widget. Only ids and numbers are read, so locale does not matter. */
interface WidgetConfigs {
  drag_sort: DragSortConfig;
  label_diagram: LabelDiagramConfig;
  order_steps: OrderStepsConfig;
  slider: SliderConfig;
  graph: GraphConfig;
  tap_reveal: TapRevealConfig;
}

function configOf<W extends keyof WidgetConfigs>(card: InteractiveCardB, _widget: W): WidgetConfigs[W] {
  return (card as unknown as { config: WidgetConfigs[W] }).config;
}

function placementResult(key: Map<string, string>, got: Map<string, string>): WidgetResult {
  const wrong = [...key.keys()].filter((id) => got.get(id) !== key.get(id));
  return { correct: wrong.length === 0, done: got.size >= key.size, wrong };
}

export function checkInteractive(card: InteractiveCardB, response: WidgetResponse): WidgetResult {
  if (card.widget !== response.widget) return { correct: false, done: false, wrong: [] };
  switch (response.widget) {
    case "drag_sort": {
      const cfg = configOf(card, "drag_sort");
      return placementResult(
        new Map(cfg.answer.map((a) => [a.item, a.bin])),
        new Map(response.placements.map((p) => [p.item, p.bin])),
      );
    }
    case "label_diagram": {
      const cfg = configOf(card, "label_diagram");
      return placementResult(
        new Map(cfg.answer.map((a) => [a.spot, a.label])),
        new Map(response.placements.map((p) => [p.spot, p.label])),
      );
    }
    case "order_steps": {
      const key = configOf(card, "order_steps").steps.map((s) => s.id);
      const wrong = key.filter((id, i) => response.order[i] !== id);
      return { correct: wrong.length === 0 && response.order.length === key.length, done: true, wrong };
    }
    case "slider": {
      const target = configOf(card, "slider").target;
      if (!target) return { correct: null, done: true, wrong: [] };
      const ok = near(response.value, target.value, target.tolerance);
      return { correct: ok, done: true, wrong: ok ? [] : ["value"] };
    }
    case "graph": {
      const target = configOf(card, "graph").target;
      if (!target) return { correct: null, done: true, wrong: [] };
      const tol = { abs: target.tolerance };
      const ok = near(response.x, target.x, tol) && near(response.y, target.y, tol);
      return { correct: ok, done: true, wrong: ok ? [] : ["point"] };
    }
    case "tap_reveal": {
      const tiles = configOf(card, "tap_reveal").tiles.map((t) => t.id);
      const seen = new Set(response.revealed);
      return { correct: null, done: tiles.every((t) => seen.has(t)), wrong: [] };
    }
  }
}

/** True when the widget asks for something before the student can move on. */
export function widgetHasTask(card: InteractiveCardB): boolean {
  return card.widget !== "tap_reveal";
}

/** Check a sim measurement against a task (unit-aware, within the task's tolerance). */
export function checkSimTask(
  card: SimCardB,
  taskId: string,
  measurement: { value: number; unit: string | null },
): { correct: boolean; known: boolean } {
  const task = card.tasks.find((t) => t.id === taskId);
  if (!task) return { correct: false, known: false };
  const want = task.expected;
  let value = measurement.value;
  if (want.unit && measurement.unit && measurement.unit !== want.unit) {
    const converted = convertUnit(value, measurement.unit, want.unit);
    if (converted === undefined) return { correct: false, known: true };
    value = converted;
  }
  return { correct: near(value, want.value, want.tolerance), known: true };
}
