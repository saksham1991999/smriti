/**
 * LRN-18 Play activity for a `play@1` in a play bundle, on lesson-core's play reducer: tap, match,
 * sort, drag and trace rounds with no score, timer or fail state. A wrong move bounces back, the
 * second shows the hint, then the right move glows ("Look here!") so every round ends on a win.
 * Every drag has a tap-then-tap alternative, and the trace has [All done], so nothing depends on
 * a gesture alone.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  initialPlay,
  nextMove,
  planPlay,
  reducePlay,
  traceCoverage,
  type GlyphMask,
  type PlayAction,
  type PlayMove,
  type PlayState,
  type TracePoint,
} from "@smriti/lesson-core";
import { Button, Icon, IconButton, Text, cx, useUI } from "@smriti/ui-web";
import { ActivityShell, Dots, mediaUrl, PetSays, useClocked, useCompletion, type ActivityPlayerProps } from "./activity";
import { usePlayer } from "./context";
import { Media } from "./Media";
import { canvasGlyphMask, drawTrace } from "./trace";

export interface PlayRoundInfo {
  roundIndex: number;
  kind: "tap" | "match" | "sort" | "drag" | "trace";
  /** Wrong moves in the round (for `play_round_completed.attempts`); never shown to the child. */
  attempts: number;
  /** The round was finished with the move shown. */
  guided: boolean;
}

export interface PlayPlayerProps extends ActivityPlayerProps {
  /** Each finished round, for `play_round_completed`. */
  onRoundComplete?: (info: PlayRoundInfo) => void;
  /** Rasterises a trace glyph from the app font; default: a canvas with the token font. */
  glyphMask?: (glyph: string, script: "latin" | "devanagari" | "digits") => GlyphMask | null;
  /** Renders a trace round's stroke-order guide (a Rive animation ref) while the move is shown. */
  renderGuide?: (animationRef: string) => ReactNode;
}

type Tile = { id: string; label: string; media: string };
type TileState = "idle" | "picked" | "done";

function TileButton({ tile, state, glow, onPress, testID, draggable }: { tile: Tile; state: TileState; glow: boolean; onPress: () => void; testID: string; draggable?: boolean }) {
  const { t } = usePlayT();
  const { reducedMotion } = useUI();
  const label = state === "picked" ? t("learn:LRN-18.little_learner_picked_a11y", { label: tile.label }) : state === "done" ? t("learn:LRN-18.little_learner_placed_a11y", { label: tile.label }) : tile.label;
  return (
    <button
      type="button"
      aria-label={label}
      // The shown move is announced, not only drawn as a ring (never colour or motion alone).
      aria-description={glow ? t("learn:LRN-18.little_learner_show_me") : undefined}
      aria-pressed={state === "picked" || undefined}
      data-testid={testID}
      data-state={state}
      data-glow={glow || undefined}
      draggable={draggable && state !== "done"}
      onDragStart={(e) => e.dataTransfer?.setData("text/plain", tile.id)}
      onClick={state === "done" ? undefined : onPress}
      className={cx(
        "relative flex min-h-16 min-w-16 flex-col items-center gap-1 rounded-lg bg-surface p-2 shadow-card outline-none focus-visible:outline-[3px] focus-visible:outline-primary",
        state === "picked" && "ring-4 ring-primary",
        state === "done" && "bg-success-tint",
        glow && "ring-4 ring-primary",
        // Reduced motion: a static ring, no glow pulse (LRN-18 states).
        glow && !reducedMotion && "motion-safe:animate-pulse",
      )}
    >
      <Media refId={tile.media} className="aspect-square w-20" />
      <span className="text-label text-ink">{tile.label}</span>
      {state === "done" && (
        <span className="absolute right-1 top-1">
          <Icon name="CheckCircle" size={24} color="successText" />
        </span>
      )}
    </button>
  );
}

// The player's translator, through the shell's context.
const usePlayT = () => usePlayer();

const same = (a: PlayMove | null, b: PlayMove): boolean => !!a && JSON.stringify(a) === JSON.stringify(b);

export function PlayPlayer(props: PlayPlayerProps) {
  const { bundle, activityId, bundleVersion, t, audio, contentBaseUrl } = props;
  const plan = useMemo(() => planPlay(bundle, activityId, { bundleVersion }), [bundle, activityId, bundleVersion]);
  const { reducedMotion } = useUI();
  const [s, dispatch] = useClocked<PlayState, PlayAction>(reducePlay, () => reducePlay(initialPlay(), { type: "start", plan, now: (props.clock ?? Date.now)() }), props.clock);
  const [picked, setPicked] = useState<{ side: "left" | "right" | "item"; id: string } | null>(null);
  useCompletion(s.completion, props.onComplete);

  const round = plan.rounds[s.round]!;
  const hint = s.phase === "round" ? nextMove(s) : null;
  const glowMove = s.guided ? hint : null;
  const promptSrc = mediaUrl(bundle, round.audio, contentBaseUrl);

  // The prompt is read aloud once when a round opens (little learners: narration auto-plays).
  useEffect(() => {
    setPicked(null);
    if (audio && promptSrc && s.phase === "round") audio.play(promptSrc);
  }, [s.round]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => audio?.stop(), [audio]);

  const move = (m: PlayMove) => {
    const before = s;
    const after = dispatch({ type: "move", move: m });
    setPicked(null);
    if (before.phase === "round" && after.phase === "cheer") {
      props.onRoundComplete?.({ roundIndex: before.round, kind: round.kind, attempts: after.tries, guided: before.guided });
    }
  };

  const pick = (side: "left" | "right" | "item", id: string, complete: (other: { side: string; id: string }) => PlayMove | null) => {
    if (picked && picked.side !== side) {
      const m = complete(picked);
      if (m) return move(m);
    }
    setPicked(picked?.side === side && picked.id === id ? null : { side, id });
  };

  const done = (id: string) => s.done.includes(id);
  const tileState = (side: "left" | "right" | "item", id: string, isDone: boolean): TileState => (isDone ? "done" : picked?.side === side && picked.id === id ? "picked" : "idle");

  let body: ReactNode = null;
  let help = "";
  if (s.phase === "round") {
    switch (round.kind) {
      case "tap":
        help = t("learn:LRN-18.little_learner_tap_help");
        body = (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="round-tap">
            {round.items.map((it) => (
              <TileButton key={it.id} tile={it} state={done(it.id) ? "done" : "idle"} glow={same(glowMove, { type: "tap", item: it.id })} onPress={() => move({ type: "tap", item: it.id })} testID={`tile-${it.id}`} />
            ))}
          </div>
        );
        break;
      case "match": {
        help = t("learn:LRN-18.little_learner_match_help");
        const rightDone = (id: string) => round.pairs.some((p) => p.right.id === id && done(p.left.id));
        const glowL = glowMove?.type === "match" ? glowMove.left : null;
        const glowR = glowMove?.type === "match" ? glowMove.right : null;
        body = (
          <div className="grid grid-cols-2 gap-6" data-testid="round-match">
            <div className="flex flex-col gap-3">
              {round.pairs.map(({ left }) => (
                <TileButton key={left.id} tile={left} state={tileState("left", left.id, done(left.id))} glow={glowL === left.id} testID={`left-${left.id}`} onPress={() => pick("left", left.id, (o) => ({ type: "match", left: left.id, right: o.id }))} />
              ))}
            </div>
            <div className="flex flex-col gap-3">
              {round.pairs.map(({ right }) => (
                <TileButton key={right.id} tile={right} state={tileState("right", right.id, rightDone(right.id))} glow={glowR === right.id} testID={`right-${right.id}`} onPress={() => pick("right", right.id, (o) => ({ type: "match", left: o.id, right: right.id }))} />
              ))}
            </div>
          </div>
        );
        break;
      }
      case "sort": {
        help = t("learn:LRN-18.little_learner_move_help");
        const glowItem = glowMove?.type === "place" ? glowMove.item : null;
        const glowTarget = glowMove?.type === "place" ? glowMove.target : null;
        body = (
          <div className="flex flex-col gap-4" data-testid="round-sort">
            <div className="flex flex-wrap justify-center gap-3">
              {round.items.map((it) => (
                <TileButton key={it.id} tile={it} state={tileState("item", it.id, done(it.id))} glow={glowItem === it.id} testID={`item-${it.id}`} onPress={() => setPicked({ side: "item", id: it.id })} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {round.buckets.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-label={t("learn:LRN-18.little_learner_place_a11y", { label: b.label })}
                  aria-description={glowTarget === b.id && picked ? t("learn:LRN-18.little_learner_show_me") : undefined}
                  data-testid={`bucket-${b.id}`}
                  data-glow={(glowTarget === b.id && !!picked) || undefined}
                  disabled={!picked}
                  onClick={() => picked && move({ type: "place", item: picked.id, target: b.id })}
                  className={cx("flex min-h-24 flex-col items-center gap-2 rounded-lg bg-surface-sunken p-3 outline-none focus-visible:outline-[3px] focus-visible:outline-primary", glowTarget === b.id && "ring-4 ring-primary")}
                >
                  {b.media && <Media refId={b.media} className="aspect-square w-16" />}
                  <span className="text-heading text-ink">{b.label}</span>
                  <span className="text-caption text-ink-muted">
                    {round.items
                      .filter((i) => i.bucket === b.id && done(i.id))
                      .map((i) => i.label)
                      .join(", ")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
        break;
      }
      case "drag": {
        help = t("learn:LRN-18.little_learner_move_help");
        const filled = (targetId: string) => {
          const tg = round.targets.find((x) => x.id === targetId)!;
          return done(tg.accepts);
        };
        const glowItem = glowMove?.type === "place" ? glowMove.item : null;
        const glowTarget = glowMove?.type === "place" ? glowMove.target : null;
        body = (
          <div className="flex flex-col gap-4" data-testid="round-drag">
            <div className="relative">
              <Media refId={round.scene} className="aspect-[3/2]" fit="cover" />
              {round.targets.map((tg) => (
                <button
                  key={tg.id}
                  type="button"
                  aria-label={filled(tg.id) ? t("learn:LRN-18.little_learner_placed_a11y", { label: tg.label }) : t("learn:LRN-18.little_learner_place_a11y", { label: tg.label })}
                  aria-description={glowTarget === tg.id ? t("learn:LRN-18.little_learner_show_me") : undefined}
                  data-testid={`target-${tg.id}`}
                  data-glow={glowTarget === tg.id || undefined}
                  onClick={() => picked && move({ type: "place", item: picked.id, target: tg.id })}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const item = e.dataTransfer?.getData("text/plain");
                    if (item) move({ type: "place", item, target: tg.id });
                  }}
                  style={{ left: `${tg.x * 100}%`, top: `${tg.y * 100}%`, width: `${tg.radius * 200}%`, transform: "translate(-50%, -50%)" }}
                  className={cx(
                    "absolute aspect-square rounded-full border-4 border-dashed outline-none focus-visible:outline-[3px] focus-visible:outline-primary",
                    filled(tg.id) ? "border-success bg-success-tint" : "border-primary bg-primary-tint",
                    glowTarget === tg.id && "ring-4 ring-primary",
                  )}
                >
                  {filled(tg.id) && <Icon name="CheckCircle" size={24} color="successText" />}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              {round.items.map((it) => (
                <TileButton key={it.id} draggable tile={it} state={tileState("item", it.id, done(it.id))} glow={glowItem === it.id} testID={`item-${it.id}`} onPress={() => setPicked({ side: "item", id: it.id })} />
              ))}
            </div>
          </div>
        );
        break;
      }
      case "trace":
        help = t("learn:LRN-18.little_learner_trace_help");
        body = (
          <TraceArea
            key={`${s.round}-${s.tries}`}
            glyph={round.glyph}
            script={round.script}
            mask={props.glyphMask}
            guide={s.guided && round.guide && props.renderGuide ? props.renderGuide(round.guide) : null}
            onDone={(coverage) => move({ type: "trace", coverage })}
          />
        );
        break;
    }
  }

  const success = s.feedback === plan.feedback.success;
  const petText = s.phase === "cheer" ? plan.feedback.success : s.guided ? t("learn:LRN-18.little_learner_show_me") : (s.hint ?? round.prompt);

  return (
    <ActivityShell
      props={props}
      testID="play-player"
      header={<Dots total={plan.rounds.length} current={s.phase === "complete" ? plan.rounds.length : s.round} label={t("learn:LRN-18.little_learner_round_a11y", { n: s.round + 1, total: plan.rounds.length })} />}
      footer={
        s.phase === "cheer" ? (
          <Button icon="ArrowRight" iconPosition="end" label={t("learn:LRN-18.little_learner_next")} onPress={() => dispatch({ type: "next" })} testID="play-next" />
        ) : s.phase === "complete" ? (
          <Button icon="Check" label={t("learn:LRN-18.little_learner_done")} onPress={() => props.onExit("done")} testID="play-done" />
        ) : null
      }
    >
      {s.phase === "complete" ? (
        <div className="flex flex-col items-center gap-3 py-8" data-testid="play-stars">
          <Icon name="Star" size={32} color="primaryText" weight="fill" />
          <Text variant="title" align="center">
            {t("learn:LRN-18.little_learner_stars", { n: s.stars })}
          </Text>
        </div>
      ) : (
        <>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <PetSays pet={props.pet} text={petText} testID="play-pet-line" />
            </div>
            {s.phase === "cheer" && (
              // The cheer: a clap that pops in, or just appears with reduced motion. The pet line carries the words.
              <span data-testid="play-cheer" data-motion={reducedMotion ? "static" : "pop"} className={cx("inline-flex", !reducedMotion && "motion-safe:animate-[sm-pop_var(--sm-duration-slow)_ease-out_1]")}>
                <Icon name="HandsClapping" size={32} color="primaryText" weight="fill" />
              </span>
            )}
            {audio && promptSrc && s.phase === "round" && <IconButton icon="SpeakerHigh" label={t("learn:LRN-18.little_learner_hear_again")} onPress={() => audio.play(promptSrc)} size={48} testID="play-hear-again" />}
          </div>
          {s.phase === "round" && (
            <Text variant="caption" tone="muted" testID="play-help">
              {help}
            </Text>
          )}
          {body}
          {s.phase === "round" && s.feedback && (
            <div role="status" data-testid="play-feedback" data-tone={success ? "success" : "try_again"} className={cx("flex items-center gap-2 rounded-lg p-3", success ? "bg-success-tint" : "bg-surface-sunken")}>
              <Icon name={success ? "CheckCircle" : "ArrowCounterClockwise"} size={24} color={success ? "successText" : "inkMuted"} />
              <Text variant="body">{s.feedback}</Text>
            </div>
          )}
        </>
      )}
    </ActivityShell>
  );
}

/** The trace pad: the glyph in the app font, pale, with the child's strokes over it. */
function TraceArea({
  glyph,
  script,
  mask,
  guide,
  onDone,
}: {
  glyph: string;
  script: "latin" | "devanagari" | "digits";
  mask?: PlayPlayerProps["glyphMask"];
  guide: ReactNode;
  onDone: (coverage: number) => void;
}) {
  const { t } = usePlayT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<TracePoint[][]>([]);
  const drawing = useRef(false);
  const [count, setCount] = useState(0);
  const [canDraw, setCanDraw] = useState(true);

  const redraw = () => {
    const c = canvas.current;
    if (!c) return;
    setCanDraw(drawTrace(c, glyph, script, strokes.current));
  };
  useEffect(redraw, [glyph, script]); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: { clientX: number; clientY: number }): TracePoint => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: r.width ? (e.clientX - r.left) / r.width : 0, y: r.height ? (e.clientY - r.top) / r.height : 0 };
  };

  const finish = () => {
    const m = (mask ?? canvasGlyphMask)(glyph, script);
    // Without a mask the pad cannot measure, so any trace counts (the round still ends on a win).
    const coverage = m ? traceCoverage(m, strokes.current) : strokes.current.length ? 1 : 0;
    onDone(coverage);
  };

  return (
    <div className="flex flex-col items-center gap-3" data-testid="round-trace">
      {guide}
      <div className="relative aspect-square w-full max-w-[320px] rounded-lg bg-surface-sunken">
        {!canDraw && (
          <span aria-hidden className={cx("absolute inset-0 flex items-center justify-center text-display text-ink-disabled", script === "devanagari" ? "font-deva" : "font-sans")}>
            {glyph}
          </span>
        )}
        <canvas
          ref={canvas}
          width={320}
          height={320}
          role="img"
          aria-label={`${t("learn:LRN-18.little_learner_trace_help")}: ${glyph}`}
          data-testid="trace-pad"
          className="absolute inset-0 h-full w-full touch-none"
          onPointerDown={(e) => {
            drawing.current = true;
            strokes.current.push([point(e)]);
            setCount((n) => n + 1);
            redraw();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            strokes.current.at(-1)?.push(point(e));
            redraw();
          }}
          onPointerUp={() => (drawing.current = false)}
          onPointerLeave={() => (drawing.current = false)}
        />
      </div>
      <div className="flex w-full gap-3">
        <Button
          variant="ghost"
          icon="ArrowCounterClockwise"
          label={t("learn:LRN-18.little_learner_start_again")}
          onPress={() => {
            strokes.current = [];
            setCount(0);
            redraw();
          }}
          testID="trace-again"
        />
        <Button icon="Check" label={t("learn:LRN-18.little_learner_all_done")} disabled={count === 0} onPress={finish} testID="trace-done" />
      </div>
    </div>
  );
}
