import type { BundleCard } from "@smriti/content-schema";
import { describe, expect, it } from "vitest";

import { checkInteractive, checkSimTask, widgetHasTask } from "../src/index.js";
import { fixtureBundle } from "./fixture.js";

type Interactive = Extract<BundleCard, { type: "interactive" }>;
type Sim = Extract<BundleCard, { type: "sim" }>;

function card<T extends BundleCard>(topic: "a" | "b" | "c", n: string): T {
  const { bundle } = fixtureBundle(topic, "deep_dive");
  const found = bundle.cards.find((c) => c.id === `fx.chapter-a.topic-${topic}:dd:${n}`);
  if (!found) throw new Error(`no card ${topic} ${n}`);
  return found as T;
}

describe("interactive widgets", () => {
  it("drag sort: done when every item is placed, with the wrong ones listed", () => {
    const c = card<Interactive>("a", "03");
    expect(checkInteractive(c, { widget: "drag_sort", placements: [{ item: "i1", bin: "b1" }] })).toMatchObject({ done: false });
    expect(
      checkInteractive(c, { widget: "drag_sort", placements: [{ item: "i1", bin: "b2" }, { item: "i2", bin: "b2" }, { item: "i3", bin: "b1" }] }),
    ).toEqual({ correct: false, done: true, wrong: ["i1"] });
    expect(checkInteractive(c, { widget: "slider", value: 1 })).toEqual({ correct: false, done: false, wrong: [] });
  });

  it("label diagram", () => {
    const c = card<Interactive>("c", "03");
    expect(checkInteractive(c, { widget: "label_diagram", placements: [{ spot: "p1", label: "l1" }, { spot: "p2", label: "l2" }] }).correct).toBe(true);
    expect(checkInteractive(c, { widget: "label_diagram", placements: [{ spot: "p1", label: "l2" }, { spot: "p2", label: "l1" }] }).wrong).toEqual(["p1", "p2"]);
  });

  it("order steps", () => {
    const c = card<Interactive>("b", "03");
    expect(checkInteractive(c, { widget: "order_steps", order: ["s1", "s2", "s3"] }).correct).toBe(true);
    expect(checkInteractive(c, { widget: "order_steps", order: ["s2", "s1", "s3"] })).toEqual({ correct: false, done: true, wrong: ["s1", "s2"] });
  });

  it("slider and graph targets, within tolerance", () => {
    const slider = card<Interactive>("b", "02"); // target 4 ± 0.5
    expect(checkInteractive(slider, { widget: "slider", value: 4.5 }).correct).toBe(true);
    expect(checkInteractive(slider, { widget: "slider", value: 5 }).correct).toBe(false);
    const graph = card<Interactive>("c", "04"); // (3, 7) ± 0.5
    expect(checkInteractive(graph, { widget: "graph", x: 3.4, y: 6.6 }).correct).toBe(true);
    expect(checkInteractive(graph, { widget: "graph", x: 3, y: 8 })).toEqual({ correct: false, done: true, wrong: ["point"] });
  });

  it("tap reveal has nothing to get right and never blocks", () => {
    const tap = card<Interactive>("b", "08");
    expect(widgetHasTask(tap)).toBe(false);
    expect(widgetHasTask(card<Interactive>("a", "03"))).toBe(true);
    expect(checkInteractive(tap, { widget: "tap_reveal", revealed: ["t1"] })).toEqual({ correct: null, done: false, wrong: [] });
    expect(checkInteractive(tap, { widget: "tap_reveal", revealed: ["t2", "t1"] }).done).toBe(true);
  });
});

describe("sim tasks", () => {
  it("checks a measurement against the task, converting units", () => {
    const sim = card<Sim>("b", "07"); // 2 A ± 5%
    expect(checkSimTask(sim, "task-1", { value: 2.05, unit: "A" })).toEqual({ correct: true, known: true });
    expect(checkSimTask(sim, "task-1", { value: 2000, unit: "mA" }).correct).toBe(true);
    expect(checkSimTask(sim, "task-1", { value: 2.5, unit: "A" }).correct).toBe(false);
    expect(checkSimTask(sim, "task-1", { value: 2, unit: "m" })).toEqual({ correct: false, known: true });
    expect(checkSimTask(sim, "task-9", { value: 2, unit: "A" })).toEqual({ correct: false, known: false });
  });
});
