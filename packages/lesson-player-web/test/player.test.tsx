import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LessonPlayer, type AnswerRecord, type LessonResult } from "../src";
import { fixtureLesson, strings } from "./fixture";

describe("LessonPlayer", () => {
  it("plays the fixture end to end and reports the result", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn<(r: LessonResult) => void>();
    const answers: AnswerRecord[] = [];
    render(<LessonPlayer lesson={fixtureLesson} strings={strings} onComplete={onComplete} onAnswer={(a) => answers.push(a)} onRequestExit={() => {}} />);

    expect(screen.getByTestId("lesson-counter")).toHaveTextContent("1 of 5");
    await user.click(screen.getByTestId("lesson-continue"));
    await user.click(screen.getByTestId("lesson-continue"));

    // MCQ: wrong first, then right.
    expect(screen.getByTestId("lesson-check")).toBeDisabled();
    await user.click(screen.getByTestId("option-a"));
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-retry")).toHaveTextContent("Placeholder hint.");
    await user.click(screen.getByTestId("option-b"));
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-correct")).toHaveTextContent("Correct on the second try!");
    await user.click(screen.getByTestId("lesson-continue"));

    // Numeric.
    await user.type(screen.getByTestId("numeric-input"), "4");
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-correct")).toHaveTextContent("+10 XP");
    await user.click(screen.getByTestId("lesson-continue"));
    await user.click(screen.getByTestId("lesson-continue"));

    expect(onComplete).toHaveBeenCalledTimes(1);
    const r = onComplete.mock.calls[0]?.[0];
    expect(r).toMatchObject({ cardsSeen: 5, correct: 2, total: 2, firstTry: 1, missed: [] });
    expect(answers.map((a) => [a.card.id, a.correct, a.attempt])).toEqual([
      ["c3", false, 1],
      ["c3", true, 2],
      ["c4", true, 1],
    ]);
  });

  it("asks the app before leaving, with the cards left", async () => {
    const user = userEvent.setup();
    const onRequestExit = vi.fn();
    render(<LessonPlayer lesson={fixtureLesson} strings={strings} onComplete={() => {}} onRequestExit={onRequestExit} />);
    await user.click(screen.getByRole("button", { name: "Close lesson" }));
    expect(onRequestExit).toHaveBeenCalledWith(5);
  });

  it("ends a Pro preview after the preview cards", async () => {
    const user = userEvent.setup();
    const onPreviewEnd = vi.fn();
    render(<LessonPlayer lesson={fixtureLesson} strings={strings} previewCards={2} onComplete={() => {}} onPreviewEnd={onPreviewEnd} onRequestExit={() => {}} />);
    expect(screen.getByTestId("lesson-counter")).toHaveTextContent("1 of 2");
    await user.click(screen.getByTestId("lesson-continue"));
    await user.click(screen.getByTestId("lesson-continue"));
    expect(onPreviewEnd).toHaveBeenCalledTimes(1);
  });
});
