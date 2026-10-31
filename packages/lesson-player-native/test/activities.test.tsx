import type { ActivityBundle, Manifest } from "@smriti/content-schema";
import { createI18n } from "@smriti/i18n";
import type { ActivityCompletion, AudioEvent, AudioPort } from "@smriti/lesson-core";
import { UIProvider } from "@smriti/ui-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PlayPlayer, SongPlayer, StoryPlayer, type PlayRoundInfo } from "../src";

/** The published fixture course (`pnpm --filter @smriti/content-publish publish:fixtures`); its text is test data. */
const OUT = join(__dirname, "../../../tools/content-publish/out");
function activityBundle(mode: "story" | "song" | "play", locale: "en" | "hi" = "en"): { bundle: ActivityBundle; hash: string } {
  const manifest = JSON.parse(readFileSync(join(OUT, "manifests", `fx-exam-2027.${locale}.json`), "utf8")) as Manifest;
  const entry = manifest.topics["fx.chapter-a.topic-a"]?.bundles[mode];
  if (!entry) throw new Error(`run publish:fixtures first: no ${mode} bundle`);
  return { bundle: JSON.parse(readFileSync(join(OUT, entry.path), "utf8")) as ActivityBundle, hash: entry.hash };
}
function readyMedia(b: ActivityBundle, ref: string, url: string): void {
  const m = b.media[ref];
  if (!m) throw new Error(`no media ${ref}`);
  b.media[ref] = { ...m, status: "ready", url };
}

const tEn = createI18n({ locale: "en", brand: "Smriti" }).t;
const tHi = createI18n({ locale: "hi", brand: "Smriti" }).t;
const T0 = Date.parse("2026-10-31T04:30:00Z");
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function fakeAudio() {
  const listeners = new Set<(e: AudioEvent) => void>();
  const calls: string[] = [];
  const port: AudioPort = {
    play: (src) => void calls.push(`play ${src}`),
    pause: () => void calls.push("pause"),
    resume: () => void calls.push("resume"),
    stop: () => void calls.push("stop"),
    subscribe: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
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
      resolveMedia: () => undefined,
      resolveAudio: (url: string) => `file:///seed/${url}`,
      clock: () => (now += 1000),
      onComplete: (c: ActivityCompletion) => void done.push(c),
      onExit: (r: "close" | "done") => void exits.push(r),
    },
  };
}

const show = (ui: ReactElement, locale: "en" | "hi" = "en") =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <UIProvider mode="light" locale={locale} reducedMotion>
        {ui}
      </UIProvider>
    </SafeAreaProvider>,
  );

const label = (id: string): string | undefined => screen.getByTestId(id).props.accessibilityLabel;
const disabled = (id: string): boolean => Boolean(screen.getByTestId(id).props.accessibilityState?.disabled);
const press = (id: string) => fireEvent.press(screen.getByTestId(id));
/** Every button on screen has a spoken name. */
function everyPressableLabelled(): void {
  const buttons = screen.getAllByRole("button");
  expect(buttons.length).toBeGreaterThan(0);
  const nameless = buttons.filter((b) => String(b.props.accessibilityLabel ?? "").trim() === "").map((b) => String(b.props.testID));
  expect(nameless).toEqual([]);
}

describe("StoryPlayer", () => {
  it("reads page by page to The end, then Done completes it", async () => {
    const { bundle, hash } = activityBundle("story");
    const { done, exits, common } = base();
    const pages: number[] = [];
    await show(<StoryPlayer bundle={bundle} activityId="sb.fx.chapter-a" bundleVersion={hash} t={tEn} onPageViewed={(p) => pages.push(p)} {...common} />);
    const total = (bundle.activities["sb.fx.chapter-a"] as { pages: unknown[] }).pages.length;
    expect(screen.getByTestId("story-page-count")).toHaveTextContent(`Page 1 of ${total}`);
    // No narration is ready in the fixtures, so there is no Read to me toggle.
    expect(screen.queryByTestId("story-read-to-me")).toBeNull();
    expect(disabled("story-back")).toBe(true);
    // With reduced motion each page fades in instead of sliding (LRN-11).
    expect(screen.getByTestId("story-page")).toBeTruthy();
    everyPressableLabelled();
    for (let i = 1; i < total; i++) await press("story-next");
    expect(screen.getByTestId("story-page-count")).toHaveTextContent(`Page ${total} of ${total}`);
    await press("story-next");
    expect(screen.getByTestId("story-end")).toHaveTextContent("The end!");
    everyPressableLabelled();
    await press("story-done");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ kind: "story", activityId: "sb.fx.chapter-a", topicId: "fx.chapter-a.topic-a", stars: 1, bundleVersion: hash, locale: "en" });
    expect(exits).toEqual(["done"]);
    expect(pages[0]).toBe(0);
    expect(pages.at(-1)).toBe(total - 1);
  });

  it("narrates with Read to me on, in Hindi, and turns the page after the narration", async () => {
    jest.useFakeTimers();
    try {
      const { bundle, hash } = activityBundle("story", "hi");
      // The fixture pages have no narration: give the first two a ready track (test data).
      const story = bundle.activities["sb.fx.chapter-a"] as { pages: { narration?: string }[] };
      for (const [i, ref] of ["audio.test.page-1", "audio.test.page-2"].entries()) {
        story.pages[i]!.narration = ref;
        bundle.media[ref] = { ref, kind: "audio_tts", status: "ready", url: `assets/${ref}.bin`, alt: null, decorative: false, label_anchors: [], transcript: "Fixture narration" };
      }
      const audio = fakeAudio();
      let now = T0;
      const { common } = base();
      await show(<StoryPlayer bundle={bundle} activityId="sb.fx.chapter-a" bundleVersion={hash} t={tHi} audio={audio.port} {...common} clock={() => now} />, "hi");
      expect(label("story-read-to-me")).toBe("मुझे पढ़कर सुनाओ");
      expect(screen.getByTestId("story-read-to-me").props.accessibilityState).toMatchObject({ checked: true });
      expect(screen.getByTestId("story-page-count")).toHaveTextContent(/^पेज 1 \/ \d+$/);
      expect(audio.calls).toContain("play file:///seed/assets/audio.test.page-1.bin");
      await audio.emit({ type: "ended" });
      now += 2500;
      await act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(screen.getByTestId("story-page-count")).toHaveTextContent(/^पेज 2 \//);
      expect(audio.calls).toContain("play file:///seed/assets/audio.test.page-2.bin");
      await press("story-read-to-me");
      expect(screen.getByTestId("story-read-to-me").props.accessibilityState).toMatchObject({ checked: false });
    } finally {
      jest.useRealTimers();
    }
  });

  it("closes from the labelled close button", async () => {
    const { bundle, hash } = activityBundle("story");
    const { exits, common } = base();
    await show(<StoryPlayer bundle={bundle} activityId="sb.fx.chapter-a" bundleVersion={hash} t={tEn} {...common} />);
    expect(label("activity-close")).toBe("Close");
    await press("activity-close");
    expect(exits).toEqual(["close"]);
  });
});

describe("SongPlayer", () => {
  it("lights the line being sung, shows its action and completes at the end", async () => {
    const { bundle, hash } = activityBundle("song");
    readyMedia(bundle, "audio.chapter-a.fx-song-en", "assets/song-en.m4a");
    const audio = fakeAudio();
    const { done, exits, common } = base();
    await show(<SongPlayer bundle={bundle} activityId="sg.fx.topic-a" bundleVersion={hash} t={tEn} audio={audio.port} {...common} />);
    expect(label("song-lyrics")).toBe("Words of the song");
    await press("song-play");
    expect(audio.calls).toContain("play file:///seed/assets/song-en.m4a");
    await audio.emit({ type: "position", ms: 2500 });
    expect(screen.getByTestId("song-line-1").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("song-line-0").props.accessibilityState).toMatchObject({ selected: false });
    expect(label("song-line-1")).toBe("Fixture lyric line 2. Fixture action cue");
    expect(screen.getByTestId("song-action")).toHaveTextContent("Do this: Fixture action cue");
    everyPressableLabelled();
    await press("song-pause");
    expect(audio.calls.at(-1)).toBe("pause");
    await press("song-play");
    expect(audio.calls.at(-1)).toBe("resume");
    await audio.emit({ type: "position", ms: 4500 });
    expect(screen.queryByTestId("song-action")).toBeNull();
    await audio.emit({ type: "ended" });
    expect(screen.getByTestId("song-done-line")).toHaveTextContent("Yay! You sang it!");
    expect(done).toEqual([expect.objectContaining({ kind: "song", activityId: "sg.fx.topic-a", stars: 1, locale: "en" })]);
    await press("song-again");
    expect(screen.getByTestId("song-pause")).toBeTruthy();
    await audio.emit({ type: "ended" });
    expect(done).toHaveLength(1);
    await press("song-done");
    expect(exits).toEqual(["done"]);
  });

  it("waits quietly while the sung audio is not ready, in Hindi", async () => {
    const { bundle, hash } = activityBundle("song", "hi");
    const { common } = base();
    await show(<SongPlayer bundle={bundle} activityId="sg.fx.topic-a" bundleVersion={hash} t={tHi} audio={fakeAudio().port} {...common} />, "hi");
    expect(disabled("song-play")).toBe(true);
    expect(label("song-play")).toBe("साथ में गाओ");
    expect(screen.getByTestId("song-not-ready")).toHaveTextContent("यह गाना जल्दी आएगा।");
    expect(screen.getByTestId("song-line-0")).toHaveTextContent(/फ़िक्स्चर गीत पंक्ति 1/);
  });
});

describe("PlayPlayer", () => {
  // A 10 x 10 glyph mask: a vertical bar in column 4.
  const bar = { width: 10, height: 10, ink: Array.from({ length: 100 }, (_, i) => (i % 10 === 4 ? 1 : 0)) };
  const at = (x: number, y: number) => ({ nativeEvent: { locationX: x, locationY: y } });

  it("plays every round kind and ends each on a win", async () => {
    const { bundle, hash } = activityBundle("play");
    const { done, exits, common } = base();
    const rounds: PlayRoundInfo[] = [];
    await show(<PlayPlayer bundle={bundle} activityId="pl.fx.topic-a" bundleVersion={hash} t={tEn} glyphMask={() => bar} onRoundComplete={(r) => rounds.push(r)} {...common} />);
    expect(label("activity-dots")).toBe("Game 1 of 5");
    expect(screen.getByTestId("play-pet-line")).toHaveTextContent("Fixture tap prompt");

    // Tap: try again, then the hint, then the right tile is shown.
    await press("tile-tile-2");
    expect(screen.getByTestId("play-feedback")).toHaveTextContent("Fixture try again line");
    await press("tile-tile-2");
    expect(screen.getByTestId("play-pet-line")).toHaveTextContent("Fixture tap hint");
    await press("tile-tile-2");
    expect(screen.getByTestId("play-pet-line")).toHaveTextContent("Look here!");
    // The shown move is announced, not only drawn as a ring.
    expect(screen.getByTestId("tile-tile-1").props.accessibilityHint).toBe("Look here!");
    expect(screen.getByTestId("tile-tile-3").props.accessibilityHint).toBeUndefined();
    everyPressableLabelled();
    await press("tile-tile-1");
    expect(label("tile-tile-1")).toBe("Fixture tile 1, done");
    expect(disabled("tile-tile-1")).toBe(true);
    await press("tile-tile-3");
    expect(screen.getByTestId("play-pet-line")).toHaveTextContent("Fixture success line");
    // The cheer shows (still: these tests run with reduced motion, so it has no entering animation).
    expect(screen.getByTestId("play-cheer").props.entering).toBeUndefined();
    expect(rounds[0]).toEqual({ roundIndex: 0, kind: "tap", attempts: 3, guided: true });
    await press("play-next");

    // Match: a picture, then its partner.
    expect(screen.getByTestId("round-match")).toBeTruthy();
    await press("left-tile-1");
    expect(label("left-tile-1")).toBe("Fixture tile 1, picked");
    await press("right-tile-4");
    expect(screen.getByTestId("play-feedback")).toHaveTextContent("Fixture try again line");
    await press("left-tile-1");
    await press("right-tile-2");
    await press("right-tile-4");
    await press("left-tile-3");
    expect(rounds[1]).toEqual({ roundIndex: 1, kind: "match", attempts: 1, guided: false });
    await press("play-next");

    // Sort: a picture, then its basket (the baskets wait for a picked picture).
    expect(disabled("bucket-bucket-a")).toBe(true);
    for (const [item, bucket] of [["tile-1", "bucket-a"], ["tile-2", "bucket-b"], ["tile-3", "bucket-a"]] as const) {
      await press(`item-${item}`);
      expect(label(`bucket-${bucket}`)).toMatch(/, put it here$/);
      await press(`bucket-${bucket}`);
    }
    expect(rounds[2]).toMatchObject({ kind: "sort", attempts: 0 });
    await press("play-next");

    // Drag: tap-then-tap on the scene's places.
    await fireEvent(screen.getByTestId("drag-scene"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 200 } } });
    await press("item-tile-1");
    await press("target-spot-1");
    expect(label("target-spot-1")).toBe("Fixture spot 1, done");
    await press("item-tile-2");
    await press("target-spot-2");
    expect(rounds[3]).toMatchObject({ kind: "drag", attempts: 0 });
    await press("play-next");

    // Trace: off the letter bounces; down the bar is the win.
    const pad = () => screen.getByTestId("trace-pad");
    expect(label("trace-pad")).toMatch(/^Trace the letter with your finger: /);
    await fireEvent(pad(), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 100 } } });
    expect(disabled("trace-done")).toBe(true);
    await fireEvent(pad(), "responderGrant", at(95, 0));
    await fireEvent(pad(), "responderMove", at(95, 100));
    await press("trace-done");
    expect(screen.getByTestId("play-feedback")).toHaveTextContent("Fixture try again line");
    await fireEvent(pad(), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 100 } } });
    await fireEvent(pad(), "responderGrant", at(45, 0));
    await fireEvent(pad(), "responderMove", at(45, 100));
    await press("trace-done");
    expect(rounds[4]).toMatchObject({ kind: "trace", attempts: 1 });
    await press("play-next");

    expect(screen.getByTestId("play-stars")).toHaveTextContent("You got 5 stars!");
    expect(done).toEqual([expect.objectContaining({ kind: "play", activityId: "pl.fx.topic-a", stars: 5 })]);
    await press("play-done");
    expect(exits).toEqual(["done"]);
  });

  it("counts any trace without a glyph mask, and starts again on request", async () => {
    const { bundle, hash } = activityBundle("play");
    const { common } = base();
    const rounds: PlayRoundInfo[] = [];
    // Jump straight to the trace round: a bundle with only that round (test data).
    const play = bundle.activities["pl.fx.topic-a"] as { rounds: { kind: string }[] };
    play.rounds = play.rounds.filter((r) => r.kind === "trace");
    await show(<PlayPlayer bundle={bundle} activityId="pl.fx.topic-a" bundleVersion={hash} t={tEn} onRoundComplete={(r) => rounds.push(r)} {...common} />);
    const pad = screen.getByTestId("trace-pad");
    await fireEvent(pad, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 100 } } });
    await fireEvent(pad, "responderGrant", at(10, 10));
    expect(disabled("trace-done")).toBe(false);
    await press("trace-again");
    expect(disabled("trace-done")).toBe(true);
    await fireEvent(pad, "responderGrant", at(90, 90));
    await press("trace-done");
    expect(rounds).toEqual([{ roundIndex: 0, kind: "trace", attempts: 0, guided: false }]);
  });

  it("speaks Hindi and labels every tile", async () => {
    const { bundle, hash } = activityBundle("play", "hi");
    const { common } = base();
    await show(<PlayPlayer bundle={bundle} activityId="pl.fx.topic-a" bundleVersion={hash} t={tHi} {...common} />, "hi");
    expect(label("activity-dots")).toBe("खेल 1 / 5");
    expect(screen.getByTestId("play-help")).toHaveTextContent("तस्वीरों पर टैप करो");
    const tiles = (bundle.activities["pl.fx.topic-a"] as { rounds: { items?: { id: string }[] }[] }).rounds[0]!.items!;
    for (const it of tiles) expect(label(`tile-${it.id}`)).toMatch(/^फ़िक्स्चर टाइल \d$/);
  });
});
