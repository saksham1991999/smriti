import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@smriti/ui-web";
import { PET_REACTION_MS } from "@smriti/lesson-core";
import { StoryPlayer } from "../src";
import { activityBundle, tEn } from "./bundles";

function show(reducedMotion: boolean, pet = true, little = true) {
  const { bundle, hash } = activityBundle("topic-a", "story");
  let now = Date.parse("2026-10-31T04:30:00Z");
  render(
    <UIProvider locale="en" reducedMotion={reducedMotion}>
      <StoryPlayer
        bundle={bundle}
        activityId="sb.fx.chapter-a"
        bundleVersion={hash}
        t={tEn}
        little={little}
        pet={pet ? { species: "cat", name: "Miko" } : undefined}
        contentBaseUrl="https://cdn.test/content"
        clock={() => (now += 1000)}
        onComplete={() => undefined}
        onExit={() => undefined}
      />
    </UIProvider>,
  );
  return (bundle.activities["sb.fx.chapter-a"] as { pages: unknown[] }).pages.length;
}

afterEach(() => vi.useRealTimers());

describe("StoryPlayer pet reactions", () => {
  it("reacts at each page turn with a hop, then settles", () => {
    vi.useFakeTimers();
    show(false);
    const pet = () => screen.getByTestId("story-pet");
    expect(pet()).toHaveAttribute("data-mood", "happy");
    expect(pet()).not.toHaveAttribute("data-hop");
    expect(pet()).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(screen.getByTestId("story-next"));
    expect(pet()).toHaveAttribute("data-mood", "excited");
    expect(pet()).toHaveAttribute("data-hop", "true");
    expect(pet().className).toContain("sm-hop");
    act(() => vi.advanceTimersByTime(PET_REACTION_MS));
    expect(pet()).toHaveAttribute("data-mood", "happy");
    fireEvent.click(screen.getByTestId("story-back"));
    expect(pet()).toHaveAttribute("data-mood", "excited");
  });

  it("changes mood without a hop under reduced motion, and cheers at the end", () => {
    const total = show(true);
    const pet = () => screen.getByTestId("story-pet");
    fireEvent.click(screen.getByTestId("story-next"));
    expect(pet()).toHaveAttribute("data-mood", "excited");
    expect(pet()).not.toHaveAttribute("data-hop");
    expect(pet().className).not.toContain("sm-hop");
    for (let i = 1; i < total; i++) fireEvent.click(screen.getByTestId("story-next"));
    expect(screen.getByTestId("story-end")).toBeInTheDocument();
    expect(pet()).toHaveAttribute("data-mood", "excited");
  });

  it("shows no corner pet without a pet", () => {
    show(false, false);
    expect(screen.queryByTestId("story-pet")).toBeNull();
  });

  it("shows no corner pet for an older reader", () => {
    show(false, true, false);
    expect(screen.queryByTestId("story-pet")).toBeNull();
  });
});
