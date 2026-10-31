import type { TypedBundle } from "@smriti/content-schema/runtime";
import { createI18n } from "@smriti/i18n";
import { lessonConfig, planLesson, type AudioEvent, type AudioPort, type EventEnvelope, type LessonState } from "@smriti/lesson-core";
import { UIProvider } from "@smriti/ui-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LessonPlayer, cardKind, safeSvg, shuffleStable, type LessonPlayerProps } from "../src";

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

async function renderPlayer(mode: "onboarding" | "deep_dive" | "little", topic = "fx.chapter-a.topic-a", biteId?: string, resumeIndex?: number, extra: Partial<LessonPlayerProps> = {}, prepare?: (b: TypedBundle) => void) {
  const { bundle: b, hash } = bundle(topic);
  prepare?.(b);
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
          resumeIndex={resumeIndex}
          {...extra}
        />
      </UIProvider>
    </SafeAreaProvider>,
  );
  return { plan, events, done };
}

function fakeAudio() {
  const listeners = new Set<(e: AudioEvent) => void>();
  const calls: string[] = [];
  const port: AudioPort = {
    play: (s) => void calls.push(`play ${s}`),
    pause: () => void calls.push("pause"),
    resume: () => void calls.push("resume"),
    stop: () => void calls.push("stop"),
    subscribe: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
  return { port, calls, emit: (e: AudioEvent) => act(() => listeners.forEach((l) => l(e))) };
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

  it("plays a little learner question: gentle hint, then the guided finish where the child taps the shown answer", async () => {
    const { events, done } = await renderPlayer("little", "fx.chapter-a.topic-a", undefined, 3);
    expect(screen.queryByTestId("lesson-counter")).toBeNull();
    expect(screen.queryByTestId("confidence-row")).toBeNull();
    await fireEvent.press(screen.getByTestId("option-b"));
    await fireEvent.press(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-hint")).toBeTruthy();
    expect(screen.getByText("Let's try again together!")).toBeTruthy();
    expect(screen.queryByText("Not quite")).toBeNull();
    await fireEvent.press(screen.getByTestId("lesson-try-again"));
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("lesson-check"));

    // Second wrong try: the answer is shown and only it can be tapped.
    expect(screen.getByTestId("feedback-guided")).toBeTruthy();
    expect(screen.getByText("Here is the answer. Tap it!")).toBeTruthy();
    expect(screen.queryByTestId("lesson-check")).toBeNull();
    const shown = screen.getByTestId("option-c");
    expect(shown.props.accessibilityState).toMatchObject({ checked: true, disabled: false });
    expect(shown.props.accessibilityLabel).toMatch(/Correct/);
    expect(screen.getByTestId("option-a").props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId("option-a"));
    expect(screen.getByTestId("feedback-guided")).toBeTruthy();
    await fireEvent.press(shown);

    // Every question ends on a win, without an XP chip.
    expect(screen.getByTestId("feedback-correct")).toBeTruthy();
    expect(screen.getByText("Yay! You did it!")).toBeTruthy();
    expect(screen.queryByText(/XP/)).toBeNull();
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    expect(screen.queryByTestId("lesson-confidence")).toBeNull();
    expect(done).toHaveLength(1);
    // The two real tries are sent; the guided tap sends nothing.
    const answers = events.filter((e) => e.type === "answer_submitted").map((e) => e.payload);
    expect(answers).toMatchObject([
      { correct: false, attempt: 1, response: { option_ids: ["b"] } },
      { correct: false, attempt: 2, response: { option_ids: ["a"] } },
    ]);
  });

  it("goes from I don't know yet to the guided finish, and Continue submits the key on a numerical question", async () => {
    const { events } = await renderPlayer("little", "fx.chapter-a.topic-d");
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    await fireEvent.press(screen.getByTestId("lesson-dont-know"));
    expect(screen.getByTestId("feedback-guided")).toBeTruthy();
    expect(screen.queryByTestId("feedback-explain")).toBeNull();
    await fireEvent.press(screen.getByTestId("option-b"));
    expect(screen.getByText("Yay! You did it!")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("lesson-continue"));
    await fireEvent.press(screen.getByTestId("lesson-dont-know"));
    expect(screen.getByTestId("feedback-guided")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("lesson-guided-continue"));
    expect(screen.getByTestId("feedback-correct")).toBeTruthy();
    expect(events.filter((e) => e.type === "answer_submitted").map((e) => e.payload)).toMatchObject([
      { correct: false, response: null },
      { correct: false, response: null },
    ]);
  });

  it("says the LES-02 pet lines on hint, guided finish and win, as on the web", async () => {
    await renderPlayer("little", "fx.chapter-a.topic-a", undefined, 3, { pet: { species: "cat", name: "Miko" } });
    await fireEvent.press(screen.getByTestId("option-b"));
    await fireEvent.press(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("pet-line")).toHaveTextContent("Close! Look again.");
    await fireEvent.press(screen.getByTestId("lesson-try-again"));
    await fireEvent.press(screen.getByTestId("option-a"));
    await fireEvent.press(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("pet-line")).toHaveTextContent("Look here!");
    await fireEvent.press(screen.getByTestId("option-c"));
    expect(screen.getByTestId("pet-line")).toHaveTextContent(/Nailed it!|You're on a roll!|That's the one!/);
  });

  it("shows no pet line without a pet", async () => {
    await renderPlayer("little", "fx.chapter-a.topic-a", undefined, 3);
    await fireEvent.press(screen.getByTestId("option-b"));
    await fireEvent.press(screen.getByTestId("lesson-check"));
    expect(screen.queryByTestId("pet-line")).toBeNull();
    expect(screen.getByTestId("feedback-hint")).toHaveTextContent(/Fixture trap A1\.b/);
  });

  describe("card narration", () => {
    const ready = (b: TypedBundle) => {
      const ref = (b.cards[0] as { narration?: string }).narration!;
      b.media[ref] = { ...b.media[ref]!, status: "ready", url: "assets/narration-a.m4a" };
    };
    const src = "play file:///seed/assets/narration-a.m4a";
    const resolveAudio = (u: string) => `file:///seed/${u}`;

    it("auto-plays for little learners, pauses on request, and stops when the card changes", async () => {
      const a = fakeAudio();
      const played: boolean[] = [];
      await renderPlayer("little", "fx.chapter-a.topic-a", undefined, undefined, { audio: a.port, resolveAudio, onNarrationPlayed: (p) => played.push(p.auto) }, ready);
      expect(a.calls).toContain(src);
      expect(played).toEqual([true]);
      expect(screen.getByTestId("lesson-listen").props.accessibilityLabel).toBe("Pause");
      await fireEvent.press(screen.getByTestId("lesson-listen"));
      expect(a.calls.at(-1)).toBe("pause");
      expect(screen.getByTestId("lesson-listen").props.accessibilityLabel).toBe("Listen");
      await a.emit({ type: "ended" });
      await fireEvent.press(screen.getByTestId("lesson-continue"));
      expect(a.calls.at(-1)).toBe("stop");
      expect(screen.queryByTestId("lesson-listen")).toBeNull();
    });

    it("never starts by itself when muted, but Listen still plays on request", async () => {
      const a = fakeAudio();
      await renderPlayer("little", "fx.chapter-a.topic-a", undefined, undefined, { audio: a.port, resolveAudio, muted: true }, ready);
      expect(a.calls).not.toContain(src);
      await fireEvent.press(screen.getByTestId("lesson-listen"));
      expect(a.calls).toContain(src);
    });

    it("never auto-plays in a Deep Dive", async () => {
      const a = fakeAudio();
      await renderPlayer("deep_dive", "fx.chapter-a.topic-a", undefined, undefined, { audio: a.port, resolveAudio }, ready);
      expect(a.calls).not.toContain(src);
      expect(screen.getByTestId("lesson-listen").props.accessibilityLabel).toBe("Listen");
    });

    it("is silent and fully usable without an audio port", async () => {
      await renderPlayer("little", "fx.chapter-a.topic-a", undefined, undefined, {}, ready);
      expect(screen.queryByTestId("lesson-listen")).toBeNull();
      await fireEvent.press(screen.getByTestId("lesson-continue"));
      expect(screen.getByTestId("card-explainer")).toBeTruthy();
    });
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
