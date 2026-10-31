import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UIProvider } from "@smriti/ui-web";
import { LessonPlayer, type LessonPlayerProps } from "../src";
import { CONFIG, plan, tEn } from "./bundles";

function setup(p: ReturnType<typeof plan>, extra: Partial<LessonPlayerProps> = {}, reducedMotion = false) {
  const user = userEvent.setup();
  render(
    <UIProvider locale="en" reducedMotion={reducedMotion}>
      <LessonPlayer
        plan={p.plan}
        bundle={p.bundle}
        config={CONFIG}
        tz="Asia/Kolkata"
        t={tEn}
        contentBaseUrl="/c/"
        onEvent={() => undefined}
        onComplete={() => undefined}
        onPreviewEnd={() => undefined}
        onRequestExit={() => undefined}
        {...extra}
      />
    </UIProvider>,
  );
  return { user };
}

const PET = { species: "cat" as const, name: "Miko" };
const petEl = () => screen.getByTestId("lesson-pet");

describe("LessonPlayer corner pet (LES-01 little learner)", () => {
  it("sits on every card, hidden from screen readers, and thinks on a wrong try then hops on the win", async () => {
    const { user } = setup(plan("topic-a", { mode: "little" }), { resumeIndex: 3, pet: PET });
    expect(petEl()).toHaveAttribute("aria-hidden", "true");
    expect(petEl()).toHaveAttribute("data-mood", "happy");
    expect(petEl()).not.toHaveAttribute("data-hop");

    await user.click(screen.getByTestId("option-b"));
    await user.click(screen.getByTestId("lesson-check"));
    expect(petEl()).toHaveAttribute("data-mood", "curious");
    expect(petEl()).not.toHaveAttribute("data-hop");

    await user.click(screen.getByTestId("lesson-try-again"));
    expect(petEl()).toHaveAttribute("data-mood", "happy");
    await user.click(screen.getByTestId("option-c"));
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-correct")).toBeInTheDocument();
    expect(petEl()).toHaveAttribute("data-mood", "excited");
    expect(petEl()).toHaveAttribute("data-hop", "true");
    expect(petEl().className).toContain("motion-safe:animate-[sm-hop");

    // The next card: the pet is still there, at rest.
    await user.click(screen.getByTestId("lesson-continue"));
    expect(petEl()).toHaveAttribute("data-mood", "happy");
  });

  it("never hops with reduced motion; the mood still changes", async () => {
    const { user } = setup(plan("topic-a", { mode: "little" }), { resumeIndex: 3, pet: PET }, true);
    await user.click(screen.getByTestId("option-c"));
    await user.click(screen.getByTestId("lesson-check"));
    expect(petEl()).toHaveAttribute("data-mood", "excited");
    expect(petEl()).not.toHaveAttribute("data-hop");
    expect(petEl().className).not.toContain("sm-hop");
  });

  it("is only for little learners, and only when the host passes a pet", () => {
    setup(plan("topic-a", { mode: "deep_dive" }), { pet: PET });
    expect(screen.queryByTestId("lesson-pet")).toBeNull();
  });

  it("is absent without a pet", () => {
    setup(plan("topic-a", { mode: "little" }));
    expect(screen.queryByTestId("lesson-pet")).toBeNull();
  });
});
