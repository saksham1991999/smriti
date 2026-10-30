import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UIProvider } from "@smriti/ui-web";
import type { EventEnvelope, LessonState } from "@smriti/lesson-core";
import { LessonPlayer, safeSvg, type LessonPlayerProps } from "../src";
import { CONFIG, plan, tEn, tHi } from "./bundles";

function setup(p: ReturnType<typeof plan>, extra: Partial<LessonPlayerProps> = {}) {
  const events: EventEnvelope[] = [];
  const onComplete = vi.fn<(s: LessonState) => void>();
  const onPreviewEnd = vi.fn<(s: LessonState) => void>();
  const onRequestExit = vi.fn();
  let now = 1_760_000_000_000;
  const user = userEvent.setup();
  render(
    <UIProvider locale={extra.t === tHi ? "hi" : "en"}>
      <LessonPlayer
        plan={p.plan}
        bundle={p.bundle}
        config={CONFIG}
        tz="Asia/Kolkata"
        t={tEn}
        contentBaseUrl="/c/"
        clock={() => (now += 1000)}
        onEvent={(e) => events.push(e)}
        onComplete={onComplete}
        onPreviewEnd={onPreviewEnd}
        onRequestExit={onRequestExit}
        {...extra}
      />
    </UIProvider>,
  );
  return { events, onComplete, onPreviewEnd, onRequestExit, user };
}

const cont = () => screen.getByTestId("lesson-continue");

describe("LessonPlayer on lesson-core with published fixture bundles", () => {
  it("plays topic A bite 1: cards, a widget task, a hint then a right second try, LES-07, complete", async () => {
    const { events, onComplete, user } = setup(plan("topic-a"));
    expect(screen.getByTestId("lesson-counter")).toHaveTextContent("1 of 5");
    expect(screen.getByTestId("lesson-card-kind")).toHaveTextContent("Story");
    await user.click(cont());
    expect(screen.getByTestId("lesson-card-kind")).toHaveTextContent("Explainer");
    // A published image with its alt text from the bundle.
    expect(screen.getByAltText("Fixture image 2", { exact: false })).toHaveAttribute("src", expect.stringMatching(/^\/c\/assets\/[0-9a-f]{64}\.webp$/));
    await user.click(cont());

    // Interactive drag-sort: Continue stays blocked until the task is done.
    expect(screen.getByTestId("lesson-card-kind")).toHaveTextContent("Try it");
    expect(cont()).toBeDisabled();
    expect(screen.getByTestId("task-first")).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId("place-i1"), "b1");
    await user.selectOptions(screen.getByTestId("place-i2"), "b2");
    await user.selectOptions(screen.getByTestId("place-i3"), "b1");
    await user.click(screen.getByTestId("widget-check"));
    expect(screen.getByTestId("widget-right")).toHaveTextContent("Fixture explanation correct");
    await user.click(cont());

    // Question: wrong first (trap hint, option struck), right on the second try.
    expect(screen.getByTestId("lesson-check")).toBeDisabled();
    await user.click(screen.getByTestId("option-b"));
    await user.click(screen.getByRole("radio", { name: /Sure/ }));
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-retry")).toHaveTextContent("Fixture trap A1.b");
    await user.click(screen.getByTestId("lesson-try-again"));
    expect(screen.getByTestId("option-b")).toHaveAttribute("data-state", "wrong");
    expect(screen.getByTestId("option-b")).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByTestId("option-c"));
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-correct")).toHaveTextContent("Correct on the second try!");
    expect(screen.getByTestId("xp-chip")).toHaveTextContent(`+${CONFIG.xp.secondTry} XP`);
    await user.click(cont());

    expect(screen.getByTestId("lesson-card-kind")).toHaveTextContent("Summary");
    await user.click(cont());

    // LES-07 then complete.
    expect(screen.getByTestId("lesson-confidence")).toHaveTextContent("How sure does");
    await user.click(screen.getByTestId("confidence-4"));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const final = onComplete.mock.calls[0]![0];
    expect(final.summary).toMatchObject({ xp: CONFIG.xp.secondTry + CONFIG.xp.complete, correct: 1, total: 1, cardsSeen: 5 });
    expect(final.topicConfidence).toBe("sure");

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("lesson_started");
    expect(types.at(-1)).toBe("lesson_completed");
    expect(types.filter((x) => x === "lesson_card_viewed")).toHaveLength(5);
    const answers = events.filter((e) => e.type === "answer_submitted");
    expect(answers.map((e) => e.payload)).toMatchObject([
      { card_id: "fx.chapter-a.topic-a:dd:04", correct: false, attempt: 1, confidence: "sure", response: { option_ids: ["b"] } },
      { card_id: "fx.chapter-a.topic-a:dd:04", correct: true, attempt: 2, confidence: "sure", response: { option_ids: ["c"] } },
    ]);
    expect(events.every((e) => e.tz === "Asia/Kolkata" && /^[0-9a-f-]{36}$/.test(e.event_id))).toBe(true);
    expect(new Set(events.map((e) => e.event_id)).size).toBe(events.length);
  });

  it("stops a Pro-locked deep dive at the preview limit (R16: 4 cards)", async () => {
    const { onPreviewEnd, onComplete, user } = setup(plan("topic-a", { previewLimited: true }));
    expect(screen.getByTestId("lesson-counter")).toHaveTextContent("1 of 4");
    await user.click(cont());
    await user.click(cont());
    await user.click(screen.getByTestId("place-i1"));
    for (const [item, bin] of [["i1", "b1"], ["i2", "b1"], ["i3", "b1"]] as const) await user.selectOptions(screen.getByTestId(`place-${item}`), bin);
    await user.click(screen.getByTestId("widget-check"));
    // A wrong placement still finishes the task: the student may move on.
    expect(screen.getByTestId("widget-wrong")).toBeInTheDocument();
    await user.click(cont());
    await user.click(screen.getByTestId("option-c"));
    await user.click(screen.getByTestId("lesson-check"));
    await user.click(cont());
    expect(onPreviewEnd).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("lesson-player")).toBeNull();
  });

  it("'I don't know yet' shows the worked solution and queues the card for review", async () => {
    const { onComplete, events, user } = setup(plan("topic-a"), { resumeIndex: 3 });
    expect(screen.getByTestId("lesson-counter")).toHaveTextContent("4 of 5");
    await user.click(screen.getByTestId("lesson-dont-know"));
    const panel = screen.getByTestId("feedback-revealed");
    expect(panel).toHaveTextContent("No worries. Here's the idea.");
    expect(panel).toHaveTextContent("Fixture explanation A1");
    expect(panel).toHaveTextContent("Fixture step A1.1");
    expect(panel).toHaveTextContent("We'll bring this back in your review.");
    expect(screen.getByTestId("option-c")).toHaveAttribute("data-state", "correct");
    await user.click(screen.getByTestId("lesson-continue"));
    await user.click(cont());
    await user.click(screen.getByTestId("confidence-skip"));
    const s = onComplete.mock.calls[0]![0];
    expect(s.reviewQueue).toEqual([expect.objectContaining({ cardRef: "c:fx.chapter-a.topic-a:dd:04", reason: "dont_know" })]);
    expect(s.summary?.xp).toBe(CONFIG.xp.attempt + CONFIG.xp.complete);
    expect(events.find((e) => e.type === "answer_submitted")?.payload).toMatchObject({ response: null, correct: false });
  });

  it("renders every question type in topic D and records ids, numbers and keys, never typed text", async () => {
    const { events, onComplete, user } = setup(plan("topic-d"));
    await user.click(cont()); // derivation
    await user.click(cont()); // explainer
    // Paragraph child 1 (mcq) with its passage.
    expect(screen.getByText("Read the passage", { selector: "span" })).toBeInTheDocument();
    await user.click(screen.getByTestId("option-b"));
    await user.click(screen.getByTestId("lesson-check"));
    await user.click(cont());
    // Paragraph child 2 (numerical in grams).
    await user.type(screen.getByTestId("numeric-input"), "1500");
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-correct")).toBeInTheDocument();
    await user.click(cont());
    // Matrix match.
    for (const cell of ["cell-p-one", "cell-p-three", "cell-q-two"]) await user.click(screen.getByTestId(cell));
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-correct")).toBeInTheDocument();
    await user.click(cont());
    // Fill in the blanks: a choice and a typed word.
    await user.selectOptions(screen.getByTestId("blank-b1"), "c2");
    await user.type(screen.getByTestId("blank-b2"), "Fixtures");
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-correct")).toBeInTheDocument();
    await user.click(cont());
    // Integer.
    await user.type(screen.getByTestId("numeric-input"), "-3");
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-correct")).toBeInTheDocument();
    await user.click(cont());
    // Match list by pairs.
    await user.selectOptions(screen.getByTestId("pair-p"), "two");
    await user.selectOptions(screen.getByTestId("pair-q"), "one");
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-correct")).toBeInTheDocument();
    await user.click(cont());
    await user.click(cont());
    await user.click(cont());
    await user.click(cont());
    await user.click(screen.getByTestId("confidence-5"));
    expect(onComplete.mock.calls[0]![0].summary).toMatchObject({ correct: 6, total: 6 });
    const payloads = events.filter((e) => e.type === "answer_submitted").map((e) => e.payload as { response: unknown; question_id?: string });
    expect(payloads[0]).toMatchObject({ question_id: "q.fx.chapter-a.topic-d.0002" });
    expect(payloads.map((p) => p.response)).toEqual([
      { option_ids: ["b"] },
      { value: 1500, unit: "g" },
      { rows: [{ row: "p", columns: ["one", "three"] }, { row: "q", columns: ["two"] }] },
      { blanks: [{ blank: "b1", key: "c2" }, { blank: "b2", key: "fixture-word" }] },
      { value: -3, unit: null },
      { pairs: [{ left: "p", right: "two" }, { left: "q", right: "one" }] },
    ]);
    expect(JSON.stringify(events)).not.toContain("Fixtures");
  });

  it("renders bundle maths as safe SVG and lets the student go back to a read-only card", async () => {
    const { user } = setup(plan("topic-a", { biteId: "bite-2" }));
    expect(screen.getByTestId("lesson-card-kind")).toHaveTextContent("Formula");
    expect(document.querySelector("figure svg")).not.toBeNull();
    await user.click(cont());
    expect(screen.getByTestId("lesson-card-kind")).toHaveTextContent("Worked example");
    await user.click(screen.getByTestId("show-solution"));
    await user.click(screen.getByTestId("lesson-back"));
    expect(screen.getByTestId("lesson-card-kind")).toHaveTextContent("Formula");
    expect(screen.getByTestId("lesson-forward")).toBeInTheDocument();
    await user.click(screen.getByTestId("lesson-forward"));
    expect(screen.getByTestId("lesson-card-kind")).toHaveTextContent("Worked example");
  });

  it("asks the host before leaving, with the cards left", async () => {
    const { onRequestExit, user } = setup(plan("topic-a"));
    await user.click(cont());
    await user.click(screen.getByTestId("lesson-close"));
    expect(onRequestExit).toHaveBeenCalledWith(4);
  });

  it("shows Hindi labels and Hindi bundle text", async () => {
    setup(plan("topic-a", { locale: "hi" }), { t: tHi });
    expect(screen.getByTestId("lesson-card-kind")).toHaveTextContent("कहानी");
    expect(cont()).toHaveTextContent(tHi("learn:LES-01.continue"));
    expect(within(screen.getByTestId("lesson-player")).getByRole("button", { name: tHi("learn:LES-01.close_a11y") })).toBeInTheDocument();
  });

  it("skips online-only cards when offline without counting a miss, and sim fallbacks can skip the task", async () => {
    const p = plan("topic-c", { biteId: "bite-2" });
    const { user, onComplete } = setup(p, { online: false });
    // bite-2: question, summary, memory_hook, video, question, roleplay, experiment, summary (order from the bundle)
    let guard = 0;
    while (!onComplete.mock.calls.length && guard++ < 30) {
      const skip = screen.queryByTestId("lesson-skip-online");
      if (skip) {
        expect(screen.getByTestId("online-only")).toHaveTextContent("Needs internet");
        await user.click(skip);
        continue;
      }
      if (screen.queryByTestId("lesson-check")) {
        await user.click(screen.getByTestId("lesson-dont-know"));
        await user.click(cont());
        continue;
      }
      if (screen.queryByTestId("confidence-skip")) {
        await user.click(screen.getByTestId("confidence-skip"));
        continue;
      }
      await act(async () => cont().click());
    }
    const s = onComplete.mock.calls[0]![0];
    const skipped = Object.values(s.outcomes).filter((o) => o.skipped);
    expect(skipped.length).toBeGreaterThanOrEqual(1);
    expect(skipped.every((o) => o.correct === null)).toBe(true);
  });

  it("refuses unsafe math SVG", () => {
    expect(safeSvg('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>')).not.toBeNull();
    expect(safeSvg('<svg onload="alert(1)"></svg>')).toBeNull();
    expect(safeSvg("<svg><script>alert(1)</script></svg>")).toBeNull();
    expect(safeSvg("<img src=x>")).toBeNull();
  });
});
