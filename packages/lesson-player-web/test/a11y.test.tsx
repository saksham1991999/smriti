/**
 * Little learner accessibility on the web players: axe (axe-core) finds no serious or critical
 * violation in any state a child reaches, every control has a name, and reduced motion swaps the
 * story slide for a fade, drops the glow pulse and keeps the play cheer still.
 *
 * axe's colour-contrast rule is off: jsdom loads no CSS (`css: false`), so it cannot measure.
 * The players use token classes only, and @smriti/tokens' contrast test holds every token pair
 * they use (ink, inkMuted, *Text and primaryText on surfaces and tints) to WCAG AA.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@smriti/ui-web";
import type { AudioEvent, AudioPort } from "@smriti/lesson-core";
import { LessonPlayer, PlayPlayer, SongPlayer, StoryPlayer } from "../src";
import { activityBundle, CONFIG, plan, readyMedia, tEn, tHi } from "./bundles";

async function serious(): Promise<string[]> {
  const r = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } }, resultTypes: ["violations"] });
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/** Every button, link and form control has an accessible name. */
function everyControlNamed(): void {
  for (const el of document.body.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=radio], [role=checkbox]")) {
    const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
    expect(name, el.outerHTML.slice(0, 120)).not.toBe("");
  }
}

function withUI(ui: ReactElement, reducedMotion: boolean, locale: "en" | "hi" = "en") {
  return render(
    <UIProvider locale={locale} reducedMotion={reducedMotion}>
      {ui}
    </UIProvider>,
  );
}

function fakeAudio() {
  const listeners = new Set<(e: AudioEvent) => void>();
  const port: AudioPort = {
    play: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    stop: () => undefined,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return { port, emit: (e: AudioEvent) => act(() => listeners.forEach((l) => l(e))) };
}

const common = () => {
  let now = Date.parse("2026-10-31T04:30:00Z");
  return { contentBaseUrl: "https://cdn.test/content", clock: () => (now += 1000), onComplete: () => undefined, onExit: () => undefined };
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("the axe check", () => {
  it("finds a serious violation when there is one", async () => {
    render(
      <main>
        <button type="button" />
        <img src="x.png" />
      </main>,
    );
    const found = await serious();
    expect(found.some((v) => v.startsWith("button-name"))).toBe(true);
    expect(found.some((v) => v.startsWith("image-alt"))).toBe(true);
  });
});

describe("StoryPlayer", () => {
  it.each([true, false])("has no serious axe violations, page to end (reduced motion %s)", async (reducedMotion) => {
    const { bundle, hash } = activityBundle("topic-a", "story");
    withUI(<StoryPlayer bundle={bundle} activityId="sb.fx.chapter-a" bundleVersion={hash} t={tEn} pet={{ species: "cat", name: "Miko" }} {...common()} />, reducedMotion);
    expect(screen.getByTestId("story-page")).toHaveAttribute("data-motion", reducedMotion ? "fade" : "slide");
    expect(await serious()).toEqual([]);
    everyControlNamed();
    const total = (bundle.activities["sb.fx.chapter-a"] as { pages: unknown[] }).pages.length;
    for (let i = 0; i < total; i++) fireEvent.click(screen.getByTestId("story-next"));
    expect(screen.getByTestId("story-end")).toBeInTheDocument();
    expect(await serious()).toEqual([]);
    everyControlNamed();
  });

  it("auto-turns after the narration with reduced motion too, as a fade", () => {
    vi.useFakeTimers();
    try {
      const { bundle, hash } = activityBundle("topic-a", "story");
      const story = bundle.activities["sb.fx.chapter-a"] as { pages: { narration?: string }[] };
      story.pages[0]!.narration = "audio.test.page-1";
      bundle.media["audio.test.page-1"] = { ref: "audio.test.page-1", kind: "audio_tts", status: "ready", url: "assets/p1.bin", alt: null, decorative: false, label_anchors: [], transcript: "Fixture narration" };
      const audio = fakeAudio();
      let now = Date.parse("2026-10-31T04:30:00Z");
      const clock = () => now;
      withUI(<StoryPlayer bundle={bundle} activityId="sb.fx.chapter-a" bundleVersion={hash} t={tEn} audio={audio.port} {...common()} clock={clock} />, true);
      audio.emit({ type: "ended" });
      now += 2500;
      act(() => vi.advanceTimersByTime(500));
      expect(screen.getByTestId("story-page-count").textContent).toMatch(/^Page 2 of/);
      expect(screen.getByTestId("story-page")).toHaveAttribute("data-motion", "fade");
      expect(screen.getByTestId("story-page").className).not.toContain("sm-slide-in");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SongPlayer", () => {
  it("has no serious axe violations while singing an action line and at the end, in Hindi", async () => {
    const { bundle, hash } = activityBundle("topic-a", "song", "hi");
    readyMedia(bundle, "audio.chapter-a.fx-song-hi", "assets/song-hi.m4a");
    const audio = fakeAudio();
    withUI(<SongPlayer bundle={bundle} activityId="sg.fx.topic-a" bundleVersion={hash} t={tHi} audio={audio.port} {...common()} />, true, "hi");
    expect(await serious()).toEqual([]);
    fireEvent.click(screen.getByTestId("song-play"));
    audio.emit({ type: "position", ms: 2500 });
    expect(screen.getByTestId("song-action")).toBeInTheDocument();
    expect(await serious()).toEqual([]);
    everyControlNamed();
    audio.emit({ type: "ended" });
    expect(await serious()).toEqual([]);
    everyControlNamed();
  });
});

describe("PlayPlayer", () => {
  it.each([true, false])("labels every tile and the shown move, keeps the cheer still with reduced motion (%s), and passes axe", async (reducedMotion) => {
    const { bundle, hash } = activityBundle("topic-a", "play");
    withUI(<PlayPlayer bundle={bundle} activityId="pl.fx.topic-a" bundleVersion={hash} t={tEn} pet={{ species: "dog", name: "Bholu" }} {...common()} />, reducedMotion);
    expect(await serious()).toEqual([]);
    everyControlNamed();
    // Two wrong taps (try again, then the hint), a third shows the move.
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId("tile-tile-2"));
    const shown = screen.getByTestId("tile-tile-1");
    expect(shown).toHaveAttribute("data-glow", "true");
    expect(shown).toHaveAccessibleDescription("Look here!");
    expect(shown.className.includes("animate-pulse")).toBe(!reducedMotion);
    expect(screen.getByTestId("tile-tile-3")).not.toHaveAccessibleDescription("Look here!");
    expect(await serious()).toEqual([]);
    everyControlNamed();
    fireEvent.click(shown);
    fireEvent.click(screen.getByTestId("tile-tile-3"));
    // The cheer.
    const cheer = screen.getByTestId("play-cheer");
    expect(cheer).toHaveAttribute("data-motion", reducedMotion ? "static" : "pop");
    expect(cheer.className.includes("sm-pop")).toBe(!reducedMotion);
    expect(await serious()).toEqual([]);
    everyControlNamed();
  });

  it("passes axe on every round kind and the stars", async () => {
    const { bundle, hash } = activityBundle("topic-a", "play");
    withUI(<PlayPlayer bundle={bundle} activityId="pl.fx.topic-a" bundleVersion={hash} t={tEn} glyphMask={() => null} {...common()} />, true);
    const step = async () => {
      expect(await serious()).toEqual([]);
      everyControlNamed();
    };
    for (const id of ["tile-tile-1", "tile-tile-3"]) fireEvent.click(screen.getByTestId(id));
    fireEvent.click(screen.getByTestId("play-next"));
    await step(); // match
    for (const [l, r] of [["tile-1", "tile-2"], ["tile-3", "tile-4"]]) {
      fireEvent.click(screen.getByTestId(`left-${l}`));
      fireEvent.click(screen.getByTestId(`right-${r}`));
    }
    fireEvent.click(screen.getByTestId("play-next"));
    fireEvent.click(screen.getByTestId("item-tile-1"));
    await step(); // sort, an item picked
    for (const [item, bucket] of [["tile-1", "bucket-a"], ["tile-2", "bucket-b"], ["tile-3", "bucket-a"]] as const) {
      fireEvent.click(screen.getByTestId(`item-${item}`));
      fireEvent.click(screen.getByTestId(`bucket-${bucket}`));
    }
    fireEvent.click(screen.getByTestId("play-next"));
    await step(); // drag
    for (const [item, target] of [["tile-1", "spot-1"], ["tile-2", "spot-2"]]) {
      fireEvent.click(screen.getByTestId(`item-${item}`));
      fireEvent.click(screen.getByTestId(`target-${target}`));
    }
    fireEvent.click(screen.getByTestId("play-next"));
    await step(); // trace
    fireEvent.pointerDown(screen.getByTestId("trace-pad"), { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(screen.getByTestId("trace-pad"));
    fireEvent.click(screen.getByTestId("trace-done"));
    fireEvent.click(screen.getByTestId("play-next"));
    expect(screen.getByTestId("play-stars")).toBeInTheDocument();
    await step();
  });
});

describe("LessonPlayer (little learner)", () => {
  it("passes axe on the question, the gentle hint, the guided finish and the win", async () => {
    const p = plan("topic-a", { mode: "little" });
    const user = userEvent.setup();
    withUI(
      <LessonPlayer
        plan={p.plan}
        bundle={p.bundle}
        config={CONFIG}
        tz="Asia/Kolkata"
        t={tEn}
        contentBaseUrl="/c/"
        resumeIndex={3}
        pet={{ species: "cat", name: "Miko" }}
        onEvent={() => undefined}
        onComplete={() => undefined}
        onPreviewEnd={() => undefined}
        onRequestExit={() => undefined}
      />,
      true,
    );
    const step = async () => {
      expect(await serious()).toEqual([]);
      everyControlNamed();
    };
    await step();
    await user.click(screen.getByTestId("option-b"));
    await user.click(screen.getByTestId("lesson-check"));
    await step(); // gentle hint
    await user.click(screen.getByTestId("lesson-try-again"));
    await user.click(screen.getByTestId("option-a"));
    await user.click(screen.getByTestId("lesson-check"));
    expect(screen.getByTestId("feedback-guided")).toBeInTheDocument();
    await step(); // guided
    await user.click(screen.getByTestId("option-c"));
    expect(screen.getByTestId("feedback-correct")).toBeInTheDocument();
    await step();
  });
});
