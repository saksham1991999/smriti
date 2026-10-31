import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UIProvider } from "@smriti/ui-web";
import { cardNarration, type AudioEvent, type AudioPort } from "@smriti/lesson-core";
import { LessonPlayer, type LessonPlayerProps } from "../src";
import { CONFIG, plan, tEn } from "./bundles";

function fakeAudio() {
  const listeners = new Set<(e: AudioEvent) => void>();
  const calls: string[] = [];
  const port: AudioPort = {
    play: (src) => calls.push(`play ${src}`),
    pause: () => calls.push("pause"),
    resume: () => calls.push("resume"),
    stop: () => calls.push("stop"),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return { port, calls, emit: (e: AudioEvent) => act(() => listeners.forEach((l) => l(e))) };
}

/** Topic A bite 1 with its story card's narration marked ready (test data; fixture media is never approved). */
function narrated(mode: "little" | "deep_dive") {
  const p = plan("topic-a", { mode });
  const ref = cardNarration(p.plan.cards[0])!;
  p.bundle.media[ref] = { ...p.bundle.media[ref]!, status: "ready", url: "assets/narration-a.m4a" };
  return p;
}

function setup(p: ReturnType<typeof plan>, extra: Partial<LessonPlayerProps> = {}) {
  const played: { cardId: string | null; auto: boolean }[] = [];
  const user = userEvent.setup();
  const view = render(
    <UIProvider locale="en" reducedMotion>
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
        onNarrationPlayed={(x) => played.push(x)}
        {...extra}
      />
    </UIProvider>,
  );
  return { played, user, view };
}

const SRC = "play /c/assets/narration-a.m4a";

describe("LessonPlayer narration", () => {
  it("auto-plays for little learners, shows Pause while playing, and stops when the card changes", async () => {
    const audio = fakeAudio();
    const { played, user } = setup(narrated("little"), { audio: audio.port });
    expect(audio.calls).toContain(SRC);
    expect(played).toEqual([{ cardId: "fx.chapter-a.topic-a:dd:01", auto: true }]);
    expect(screen.getByTestId("lesson-listen")).toHaveAccessibleName("Pause");
    await user.click(screen.getByTestId("lesson-listen"));
    expect(audio.calls.at(-1)).toBe("pause");
    expect(screen.getByTestId("lesson-listen")).toHaveAccessibleName("Listen");
    await user.click(screen.getByTestId("lesson-listen"));
    expect(audio.calls.at(-1)).toBe("resume");
    audio.emit({ type: "ended" });
    expect(screen.getByTestId("lesson-listen")).toHaveAccessibleName("Listen");
    await user.click(screen.getByTestId("lesson-continue"));
    // The explainer has no ready narration: the last track stops and there is no button.
    expect(audio.calls.at(-1)).toBe("stop");
    expect(screen.queryByTestId("lesson-listen")).toBeNull();
    // Going back to the story card does not read it again by itself.
    const before = audio.calls.filter((c) => c === SRC).length;
    await user.click(screen.getByTestId("lesson-back"));
    expect(audio.calls.filter((c) => c === SRC)).toHaveLength(before);
    expect(screen.getByTestId("lesson-listen")).toHaveAccessibleName("Listen");
  });

  it("never starts by itself when muted, but [Listen] still plays on request", async () => {
    const audio = fakeAudio();
    const { played, user } = setup(narrated("little"), { audio: audio.port, muted: true });
    expect(audio.calls).not.toContain(SRC);
    await user.click(screen.getByTestId("lesson-listen"));
    expect(audio.calls).toContain(SRC);
    expect(played).toEqual([{ cardId: "fx.chapter-a.topic-a:dd:01", auto: false }]);
  });

  it("muting stops narration that is playing", () => {
    const audio = fakeAudio();
    const p = narrated("little");
    const { view } = setup(p, { audio: audio.port });
    expect(screen.getByTestId("lesson-listen")).toHaveAccessibleName("Pause");
    view.rerender(
      <UIProvider locale="en" reducedMotion>
        <LessonPlayer
          plan={p.plan}
          bundle={p.bundle}
          config={CONFIG}
          tz="Asia/Kolkata"
          t={tEn}
          contentBaseUrl="/c/"
          audio={audio.port}
          muted
          onEvent={() => undefined}
          onComplete={() => undefined}
          onPreviewEnd={() => undefined}
          onRequestExit={() => undefined}
        />
      </UIProvider>,
    );
    expect(audio.calls.at(-1)).toBe("stop");
    expect(screen.getByTestId("lesson-listen")).toHaveAccessibleName("Listen");
  });

  it("never auto-plays in a Deep Dive", () => {
    const audio = fakeAudio();
    setup(narrated("deep_dive"), { audio: audio.port });
    expect(audio.calls).not.toContain(SRC);
    expect(screen.getByTestId("lesson-listen")).toHaveAccessibleName("Listen");
  });

  it("is silent and fully usable without an audio port or ready audio", async () => {
    const { user } = setup(narrated("little"));
    expect(screen.queryByTestId("lesson-listen")).toBeNull();
    await user.click(screen.getByTestId("lesson-continue"));
    expect(screen.getByTestId("lesson-card-kind")).toHaveTextContent("Explainer");
    const audio = fakeAudio();
    setup(plan("topic-a", { mode: "little" }), { audio: audio.port });
    expect(screen.queryAllByTestId("lesson-listen")).toHaveLength(0);
    expect(audio.calls.filter((c) => c.startsWith("play"))).toEqual([]);
  });
});
