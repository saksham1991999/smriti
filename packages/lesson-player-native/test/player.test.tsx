import type { TypedBundle } from "@smriti/content-schema";
import { createI18n } from "@smriti/i18n";
import { lessonConfig, planLesson, type EventEnvelope, type LessonState } from "@smriti/lesson-core";
import { UIProvider } from "@smriti/ui-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LessonPlayer, cardKind, safeSvg, shuffleStable } from "../src";

/** The fixture seed pack from tools/content-publish (`pnpm --filter @smriti/content-publish publish:fixtures`). */
const SEED = join(__dirname, "../../../tools/content-publish/out/seed/fx/en/bundles");
function bundle(topic: string, mode = "deep_dive"): { bundle: TypedBundle; hash: string } {
  const file = readdirSync(SEED).find((f) => f.startsWith(`${topic}.${mode}.en.`));
  if (!file) throw new Error(`run publish:fixtures first: no ${topic}.${mode} in ${SEED}`);
  return { bundle: JSON.parse(readFileSync(join(SEED, file), "utf8")) as TypedBundle, hash: file.split(".").at(-2)! };
}

const XP = { firstTry: 10, secondTry: 5, attempt: 1, complete: 20, combo: 10 };
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const i18n = createI18n({ locale: "en", brand: "Smriti" });

async function renderPlayer(mode: "onboarding" | "deep_dive", topic = "fx.chapter-a.topic-a", biteId?: string) {
  const { bundle: b, hash } = bundle(topic);
  const config = lessonConfig(XP);
  const plan = planLesson(b, { mode, bundleVersion: hash, examDepth: null, config, biteId });
  const events: EventEnvelope[] = [];
  const done: LessonState[] = [];
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <UIProvider mode="light" locale="en" reducedMotion>
        <LessonPlayer
          plan={plan}
          bundle={b}
          config={config}
          tz="Asia/Kolkata"
          t={i18n.t}
          resolveMedia={() => undefined}
          onEvent={(e) => events.push(e)}
          onComplete={(s) => done.push(s)}
          onPreviewEnd={() => undefined}
          onRequestExit={() => undefined}
          clock={() => Date.parse("2026-10-30T04:30:00Z")}
        />
      </UIProvider>
    </SafeAreaProvider>,
  );
  return { plan, events, done };
}

describe("LessonPlayer", () => {
  it("plays the onboarding bite: cards, a drag-sort task, an MCQ, then complete", async () => {
    const { events, done } = await renderPlayer("onboarding");
    expect(screen.getByTestId("card-story")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    expect(screen.getByTestId("card-explainer")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("lesson-continue"));

    // Drag-sort by tapping: the task blocks Continue until every item is placed.
    expect(screen.getByTestId("card-interactive")).toBeTruthy();
    expect(screen.getByTestId("lesson-continue").props.accessibilityState).toMatchObject({ disabled: true });
    for (const [item, bin] of [["i1", "b1"], ["i2", "b2"], ["i3", "b1"]] as const) {
      await fireEvent.press(screen.getByTestId(`item-${item}`));
      await fireEvent.press(screen.getByTestId(`bin-${bin}`));
    }
    expect(screen.getByTestId("widget-feedback")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("lesson-continue"));

    // The MCQ: a wrong first try gives a hint, the second try is right.
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-hint")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("lesson-try-again"));
    await fireEvent.press(screen.getByTestId("option-c"));
    await fireEvent.press(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-correct")).toBeTruthy();
    expect(screen.getByText("Correct on the second try!")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("lesson-continue"));

    // Summary, then onboarding ends without LES-07.
    expect(screen.getByTestId("card-summary")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    expect(done).toHaveLength(1);
    expect(done[0]!.summary).toMatchObject({ correct: 1, total: 1, xp: XP.secondTry + XP.complete });

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("lesson_started");
    expect(types.filter((t) => t === "answer_submitted")).toHaveLength(2);
    expect(types.at(-1)).toBe("lesson_completed");
    expect(events.every((e) => e.tz === "Asia/Kolkata")).toBe(true);
  });

  it("explains after I don't know yet, and a Deep Dive ends on LES-07", async () => {
    const { done } = await renderPlayer("deep_dive");
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    await fireEvent.press(screen.getByTestId("skip-task"));
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    await fireEvent.press(screen.getByTestId("lesson-dont-know"));
    expect(screen.getByTestId("feedback-explain")).toBeTruthy();
    expect(screen.getByText("No worries. Here's the idea.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("lesson-got-it"));
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    expect(screen.getByTestId("lesson-confidence")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("confidence-4"));
    expect(done).toHaveLength(1);
    expect(done[0]!.topicConfidence).toBe("sure");
  });

  it("renders formula, worked example and derivation cards with build-time maths", async () => {
    await renderPlayer("deep_dive", "fx.chapter-a.topic-a", "bite-2");
    expect(screen.getByTestId("card-formula")).toBeTruthy();
    expect(screen.getByTestId("formula-box")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    expect(screen.getByTestId("card-worked_example")).toBeTruthy();
    // Inline maths in the problem comes from bundle.math as an image with its TeX as the label.
    expect(screen.getAllByLabelText("x = 2").length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId("show-step"));
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    expect(screen.getByTestId("card-derivation")).toBeTruthy();
  });

  it("maps every card type to a renderer kind and strips unsafe SVG", () => {
    const kinds = new Set<string>();
    for (const t of ["a", "b", "c", "d"]) for (const c of bundle(`fx.chapter-a.topic-${t}`).bundle.cards) kinds.add(cardKind(c));
    expect([...kinds]).toEqual(expect.arrayContaining(["concept", "interactive", "recap", "formula", "worked_example", "derivation", "sim", "online_only"]));
    expect(safeSvg('<svg onload="x()"><script>x()</script><use href="https://e.test/a"/><use href="#g"/></svg>')).toBe('<svg><use/><use href="#g"/></svg>');
    const order = shuffleStable(["s1", "s2", "s3"], "q1");
    expect(order).not.toEqual(["s1", "s2", "s3"]);
    expect(shuffleStable(["s1", "s2", "s3"], "q1")).toEqual(order);
  });
});
