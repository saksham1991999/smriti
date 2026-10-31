import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ActivityCompletion, AudioEvent, AudioPort } from "@smriti/lesson-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayPlayer, SongPlayer, StoryPlayer, type PlayRoundInfo } from "../src";
import { activityBundle, readyMedia, tEn, tHi } from "./bundles";

const T0 = Date.parse("2026-10-31T04:30:00Z");

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
  const emit = (e: AudioEvent) => act(() => listeners.forEach((l) => l(e)));
  return { port, calls, emit };
}

function base() {
  let now = T0;
  const done: ActivityCompletion[] = [];
  const exits: string[] = [];
  return {
    done,
    exits,
    common: {
      contentBaseUrl: "https://cdn.test/content",
      clock: () => (now += 1000),
      onComplete: (c: ActivityCompletion) => done.push(c),
      onExit: (r: "close" | "done") => exits.push(r),
    },
  };
}

// jsdom has no 2D canvas: the trace pad falls back to the glyph as text and the injected mask.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("StoryPlayer", () => {
  it("reads page by page to The end, then Done completes it", () => {
    const { bundle, hash } = activityBundle("topic-a", "story");
    const { done, exits, common } = base();
    const pages: number[] = [];
    render(<StoryPlayer bundle={bundle} activityId="sb.fx.chapter-a" bundleVersion={hash} t={tEn} onPageViewed={(p) => pages.push(p)} {...common} />);
    const total = (bundle.activities["sb.fx.chapter-a"] as { pages: unknown[] }).pages.length;
    expect(screen.getByTestId("story-page-count").textContent).toBe(`Page 1 of ${total}`);
    // No narration is ready in the fixtures, so there is no Read to me toggle.
    expect(screen.queryByTestId("story-read-to-me")).toBeNull();
    expect(screen.getByTestId("story-back")).toBeDisabled();
    for (let i = 1; i < total; i++) fireEvent.click(screen.getByTestId("story-next"));
    expect(screen.getByTestId("story-page-count").textContent).toBe(`Page ${total} of ${total}`);
    fireEvent.click(screen.getByTestId("story-next"));
    expect(screen.getByTestId("story-end").textContent).toBe("The end!");
    fireEvent.click(screen.getByTestId("story-done"));
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ kind: "story", activityId: "sb.fx.chapter-a", topicId: "fx.chapter-a.topic-a", stars: 1, bundleVersion: hash, locale: "en" });
    expect(exits).toEqual(["done"]);
    expect(pages[0]).toBe(0);
    expect(pages.at(-1)).toBe(total - 1);
  });

  it("narrates with Read to me on, in Hindi, and turns the page after the narration", () => {
    vi.useFakeTimers();
    try {
      const { bundle, hash } = activityBundle("topic-a", "story", "hi");
      // The fixture pages have no narration: give the first two a ready track (test data).
      const story = bundle.activities["sb.fx.chapter-a"] as { pages: { narration?: string }[] };
      for (const [i, ref] of ["audio.test.page-1", "audio.test.page-2"].entries()) {
        story.pages[i]!.narration = ref;
        bundle.media[ref] = { ref, kind: "audio_tts", status: "ready", url: `assets/${ref}.bin`, alt: null, decorative: false, label_anchors: [], transcript: "Fixture narration" };
      }
      const audio = fakeAudio();
      let now = T0;
      render(
        <StoryPlayer
          bundle={bundle}
          activityId="sb.fx.chapter-a"
          bundleVersion={hash}
          t={tHi}
          audio={audio.port}
          contentBaseUrl="https://cdn.test/content"
          clock={() => now}
          onComplete={() => undefined}
          onExit={() => undefined}
        />,
      );
      const toggle = screen.getByTestId("story-read-to-me");
      expect(toggle.textContent).toBe("मुझे पढ़कर सुनाओ");
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("story-page-count").textContent).toMatch(/^पेज 1 \/ \d+$/);
      expect(audio.calls).toContain("play https://cdn.test/content/assets/audio.test.page-1.bin");
      audio.emit({ type: "ended" });
      now += 2500;
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByTestId("story-page-count").textContent).toMatch(/^पेज 2 \//);
      expect(audio.calls).toContain("play https://cdn.test/content/assets/audio.test.page-2.bin");
      fireEvent.click(toggle);
      expect(screen.getByTestId("story-read-to-me")).toHaveAttribute("aria-pressed", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes from the close button", () => {
    const { bundle, hash } = activityBundle("topic-a", "story");
    const { exits, common } = base();
    render(<StoryPlayer bundle={bundle} activityId="sb.fx.chapter-a" bundleVersion={hash} t={tEn} {...common} />);
    fireEvent.click(screen.getByTestId("activity-close"));
    expect(exits).toEqual(["close"]);
    expect(screen.getByTestId("activity-close")).toHaveAccessibleName("Close");
  });
});

describe("SongPlayer", () => {
  it("lights the line being sung, shows its action and completes at the end", () => {
    const { bundle, hash } = activityBundle("topic-a", "song");
    readyMedia(bundle, "audio.chapter-a.fx-song-en", "assets/song-en.m4a");
    const audio = fakeAudio();
    const { done, exits, common } = base();
    render(<SongPlayer bundle={bundle} activityId="sg.fx.topic-a" bundleVersion={hash} t={tEn} audio={audio.port} {...common} />);
    expect(screen.getByRole("list", { name: "Words of the song" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("song-play"));
    expect(audio.calls).toContain("play https://cdn.test/content/assets/song-en.m4a");
    audio.emit({ type: "position", ms: 2500 });
    expect(screen.getByTestId("song-line-1")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("song-line-0")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("song-action").textContent).toBe("Do this: Fixture action cue");
    expect(screen.getByTestId("song-now").textContent).toBe("Now singing: Fixture lyric line 2");
    expect(screen.getByLabelText("Fixture action cue")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("song-pause"));
    expect(audio.calls.at(-1)).toBe("pause");
    fireEvent.click(screen.getByTestId("song-play"));
    expect(audio.calls.at(-1)).toBe("resume");
    audio.emit({ type: "position", ms: 4500 });
    expect(screen.queryByTestId("song-action")).toBeNull();
    audio.emit({ type: "ended" });
    expect(screen.getByTestId("song-done-line").textContent).toContain("Yay! You sang it!");
    expect(done).toEqual([expect.objectContaining({ kind: "song", activityId: "sg.fx.topic-a", stars: 1, locale: "en" })]);
    fireEvent.click(screen.getByTestId("song-again"));
    expect(screen.getByTestId("song-pause")).toBeInTheDocument();
    audio.emit({ type: "ended" });
    expect(done).toHaveLength(1);
    fireEvent.click(screen.getByTestId("song-done"));
    expect(exits).toEqual(["done"]);
  });

  it("waits quietly while the sung audio is not ready, in Hindi", () => {
    const { bundle, hash } = activityBundle("topic-a", "song", "hi");
    const { common } = base();
    render(<SongPlayer bundle={bundle} activityId="sg.fx.topic-a" bundleVersion={hash} t={tHi} audio={fakeAudio().port} {...common} />);
    expect(screen.getByTestId("song-play")).toBeDisabled();
    expect(screen.getByTestId("song-play").textContent).toBe("साथ में गाओ");
    expect(screen.getByTestId("song-not-ready").textContent).toBe("यह गाना जल्दी आएगा।");
    expect(screen.getByTestId("song-line-0").textContent).toContain("फ़िक्स्चर गीत पंक्ति 1");
  });
});

describe("PlayPlayer", () => {
  // A 10 x 10 glyph mask: a vertical bar in column 4.
  const bar = { width: 10, height: 10, ink: Array.from({ length: 100 }, (_, i) => (i % 10 === 4 ? 1 : 0)) };

  it("plays every round kind and ends each on a win", () => {
    const { bundle, hash } = activityBundle("topic-a", "play");
    const { done, exits, common } = base();
    const rounds: PlayRoundInfo[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    render(<PlayPlayer bundle={bundle} activityId="pl.fx.topic-a" bundleVersion={hash} t={tEn} glyphMask={() => bar} onRoundComplete={(r) => rounds.push(r)} {...common} />);
    expect(screen.getByTestId("activity-dots")).toHaveAccessibleName("Game 1 of 5");
    expect(screen.getByTestId("play-pet-line").textContent).toContain("Fixture tap prompt");

    // Tap: try again, then the hint, then the right tile glows.
    fireEvent.click(screen.getByTestId("tile-tile-2"));
    expect(screen.getByTestId("play-feedback")).toHaveAttribute("data-tone", "try_again");
    expect(screen.getByTestId("play-feedback").textContent).toBe("Fixture try again line");
    fireEvent.click(screen.getByTestId("tile-tile-2"));
    expect(screen.getByTestId("play-pet-line").textContent).toContain("Fixture tap hint");
    fireEvent.click(screen.getByTestId("tile-tile-2"));
    expect(screen.getByTestId("play-pet-line").textContent).toContain("Look here!");
    expect(screen.getByTestId("tile-tile-1")).toHaveAttribute("data-glow", "true");
    fireEvent.click(screen.getByTestId("tile-tile-1"));
    expect(screen.getByTestId("tile-tile-1")).toHaveAttribute("data-state", "done");
    expect(screen.getByTestId("tile-tile-1")).toHaveAccessibleName("Fixture tile 1, done");
    fireEvent.click(screen.getByTestId("tile-tile-3"));
    expect(screen.getByTestId("play-pet-line").textContent).toContain("Fixture success line");
    expect(rounds[0]).toEqual({ roundIndex: 0, kind: "tap", attempts: 3, guided: true });
    fireEvent.click(screen.getByTestId("play-next"));

    // Match: a picture, then its partner.
    expect(screen.getByTestId("round-match")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("left-tile-1"));
    expect(screen.getByTestId("left-tile-1")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("right-tile-4"));
    expect(screen.getByTestId("play-feedback")).toHaveAttribute("data-tone", "try_again");
    fireEvent.click(screen.getByTestId("left-tile-1"));
    fireEvent.click(screen.getByTestId("right-tile-2"));
    fireEvent.click(screen.getByTestId("right-tile-4"));
    fireEvent.click(screen.getByTestId("left-tile-3"));
    expect(rounds[1]).toEqual({ roundIndex: 1, kind: "match", attempts: 1, guided: false });
    fireEvent.click(screen.getByTestId("play-next"));

    // Sort: a picture, then its basket.
    for (const [item, bucket] of [["tile-1", "bucket-a"], ["tile-2", "bucket-b"], ["tile-3", "bucket-a"]] as const) {
      fireEvent.click(screen.getByTestId(`item-${item}`));
      fireEvent.click(screen.getByTestId(`bucket-${bucket}`));
    }
    expect(rounds[2]).toMatchObject({ kind: "sort", attempts: 0 });
    fireEvent.click(screen.getByTestId("play-next"));

    // Drag: drop one picture, tap-then-tap the other.
    const data = { getData: () => "tile-1", setData: () => undefined };
    fireEvent.drop(screen.getByTestId("target-spot-1"), { dataTransfer: data });
    expect(screen.getByTestId("target-spot-1")).toHaveAccessibleName("Fixture spot 1, done");
    fireEvent.click(screen.getByTestId("item-tile-2"));
    fireEvent.click(screen.getByTestId("target-spot-2"));
    expect(rounds[3]).toMatchObject({ kind: "drag", attempts: 0 });
    fireEvent.click(screen.getByTestId("play-next"));

    // Trace: off the letter bounces; down the bar is the win.
    const pad = () => screen.getByTestId("trace-pad");
    expect(screen.getByTestId("trace-done")).toBeDisabled();
    fireEvent.pointerDown(pad(), { clientX: 95, clientY: 0 });
    fireEvent.pointerMove(pad(), { clientX: 95, clientY: 100 });
    fireEvent.pointerUp(pad());
    fireEvent.click(screen.getByTestId("trace-done"));
    expect(screen.getByTestId("play-feedback")).toHaveAttribute("data-tone", "try_again");
    fireEvent.pointerDown(pad(), { clientX: 45, clientY: 0 });
    fireEvent.pointerMove(pad(), { clientX: 45, clientY: 100 });
    fireEvent.pointerUp(pad());
    fireEvent.click(screen.getByTestId("trace-done"));
    expect(rounds[4]).toMatchObject({ kind: "trace", attempts: 1 });
    fireEvent.click(screen.getByTestId("play-next"));

    expect(screen.getByTestId("play-stars").textContent).toContain("You got 5 stars!");
    expect(done).toEqual([expect.objectContaining({ kind: "play", activityId: "pl.fx.topic-a", stars: 5 })]);
    fireEvent.click(screen.getByTestId("play-done"));
    expect(exits).toEqual(["done"]);
  });

  it("speaks Hindi and labels every tile", () => {
    const { bundle, hash } = activityBundle("topic-a", "play", "hi");
    const { common } = base();
    render(<PlayPlayer bundle={bundle} activityId="pl.fx.topic-a" bundleVersion={hash} t={tHi} {...common} />);
    expect(screen.getByTestId("activity-dots")).toHaveAccessibleName("खेल 1 / 5");
    expect(screen.getByTestId("play-help").textContent).toBe("तस्वीरों पर टैप करो");
    for (const b of screen.getByTestId("round-tap").querySelectorAll("button")) expect(b.getAttribute("aria-label")).toMatch(/^फ़िक्स्चर टाइल \d$/);
  });
});
