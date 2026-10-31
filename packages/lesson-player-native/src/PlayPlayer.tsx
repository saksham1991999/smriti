/**
 * LRN-18 Play activity for a `play@1` in a play bundle, on lesson-core's play reducer: tap, match,
 * sort, drag and trace rounds with no score, timer or fail state. A wrong move bounces back, the
 * second shows the hint, then the right move glows ("Look here!") so every round ends on a win.
 *
 * On iOS and Android every "drag" is tap-then-tap (pick the item, then the place), so nothing
 * needs a gesture library or a fine drag; the trace pad uses the responder system and has
 * [All done]. Props follow @smriti/lesson-player-web.
 */
import {
  initialPlay,
  nextMove,
  planPlay,
  reducePlay,
  TRACE_BRUSH,
  traceCoverage,
  type GlyphMask,
  type PlayAction,
  type PlayMove,
  type PlayState,
  type TracePoint,
} from "@smriti/lesson-core";
import { Button, Icon, IconButton, PressableScale, Text, useTheme, useUI } from "@smriti/ui-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text as RNText, View, type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";
import Svg, { Polyline } from "react-native-svg";

import { ActivityShell, audioSource, Dots, PetSays, Row, useClocked, useCompletion, type ActivityPlayerProps } from "./activity";
import { usePlayer } from "./context";
import { Media } from "./Media";

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
  /**
   * Rasterises a trace glyph from the app font (for example with Skia). Without one the pad
   * cannot measure, so any trace counts and the round still ends on a win.
   */
  glyphMask?: (glyph: string, script: "latin" | "devanagari" | "digits") => GlyphMask | null;
  /** Renders a trace round's stroke-order guide (a Rive animation ref) while the move is shown. */
  renderGuide?: (animationRef: string) => ReactNode;
}

type Tile = { id: string; label: string; media: string };
type TileState = "idle" | "picked" | "done";

function TileButton({ tile, state, glow, onPress, testID }: { tile: Tile; state: TileState; glow: boolean; onPress: () => void; testID: string }) {
  const { t } = usePlayer();
  const theme = useTheme();
  const c = theme.colors;
  const label =
    state === "picked"
      ? t("learn:LRN-18.little_learner_picked_a11y", { label: tile.label })
      : state === "done"
        ? t("learn:LRN-18.little_learner_placed_a11y", { label: tile.label })
        : tile.label;
  const ring = state === "picked" || glow;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      // The shown move is announced, not only drawn as a ring (never colour alone).
      accessibilityHint={glow ? t("learn:LRN-18.little_learner_show_me") : undefined}
      accessibilityState={{ selected: state === "picked", disabled: state === "done" }}
      disabled={state === "done"}
      onPress={onPress}
      style={[
        styles.tile,
        { backgroundColor: state === "done" ? c.successTint : c.surface, borderRadius: theme.radius.card, borderColor: ring ? c.primary : "transparent" },
        theme.shadow.card,
      ]}
    >
      <View style={styles.tileMedia} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Media mediaRef={tile.media} maxHeight={80} />
      </View>
      <Text variant="label" align="center" importantForAccessibility="no">
        {tile.label}
      </Text>
      {state === "done" && (
        <View style={styles.badge}>
          <Icon name="CheckCircle" size={24} color="successText" />
        </View>
      )}
    </PressableScale>
  );
}

/** A place a picked item can go (a sort bucket or a drag target). */
function PlaceButton({
  label,
  filled,
  glow,
  enabled,
  onPress,
  testID,
  children,
  style,
}: {
  label: string;
  filled: boolean;
  glow: boolean;
  enabled: boolean;
  onPress: () => void;
  testID: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = usePlayer();
  const theme = useTheme();
  const c = theme.colors;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={filled ? t("learn:LRN-18.little_learner_placed_a11y", { label }) : t("learn:LRN-18.little_learner_place_a11y", { label })}
      accessibilityHint={glow ? t("learn:LRN-18.little_learner_show_me") : undefined}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={[
        { borderWidth: glow ? 4 : 3, borderStyle: glow || filled ? "solid" : "dashed", borderColor: filled ? c.success : c.primary, backgroundColor: filled ? c.successTint : c.primaryTint, alignItems: "center", justifyContent: "center" },
        style,
      ]}
    >
      {children}
    </PressableScale>
  );
}

const same = (a: PlayMove | null, b: PlayMove): boolean => !!a && JSON.stringify(a) === JSON.stringify(b);

export function PlayPlayer(props: PlayPlayerProps) {
  const { bundle, activityId, bundleVersion, t, audio } = props;
  const theme = useTheme();
  const { reducedMotion } = useUI();
  const c = theme.colors;
  const plan = useMemo(() => planPlay(bundle, activityId, { bundleVersion }), [bundle, activityId, bundleVersion]);
  const [s, dispatch] = useClocked<PlayState, PlayAction>(reducePlay, () => reducePlay(initialPlay(), { type: "start", plan, now: (props.clock ?? Date.now)() }), props.clock);
  const [picked, setPicked] = useState<{ side: "left" | "right" | "item"; id: string } | null>(null);
  const [scene, setScene] = useState<{ width: number; height: number } | null>(null);
  useCompletion(s.completion, props.onComplete);

  const round = plan.rounds[s.round]!;
  const hint = s.phase === "round" ? nextMove(s) : null;
  const glowMove = s.guided ? hint : null;
  const promptSrc = audioSource(props, round.audio);

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
          <View style={styles.grid} testID="round-tap">
            {round.items.map((it) => (
              <TileButton key={it.id} tile={it} state={done(it.id) ? "done" : "idle"} glow={same(glowMove, { type: "tap", item: it.id })} onPress={() => move({ type: "tap", item: it.id })} testID={`tile-${it.id}`} />
            ))}
          </View>
        );
        break;
      case "match": {
        help = t("learn:LRN-18.little_learner_match_help");
        const rightDone = (id: string) => round.pairs.some((p) => p.right.id === id && done(p.left.id));
        const glowL = glowMove?.type === "match" ? glowMove.left : null;
        const glowR = glowMove?.type === "match" ? glowMove.right : null;
        body = (
          <View style={[styles.columns, { gap: theme.space[6] }]} testID="round-match">
            <View style={styles.column}>
              {round.pairs.map(({ left }) => (
                <TileButton key={left.id} tile={left} state={tileState("left", left.id, done(left.id))} glow={glowL === left.id} testID={`left-${left.id}`} onPress={() => pick("left", left.id, (o) => ({ type: "match", left: left.id, right: o.id }))} />
              ))}
            </View>
            <View style={styles.column}>
              {round.pairs.map(({ right }) => (
                <TileButton key={right.id} tile={right} state={tileState("right", right.id, rightDone(right.id))} glow={glowR === right.id} testID={`right-${right.id}`} onPress={() => pick("right", right.id, (o) => ({ type: "match", left: o.id, right: right.id }))} />
              ))}
            </View>
          </View>
        );
        break;
      }
      case "sort": {
        help = t("learn:LRN-18.little_learner_move_help");
        const glowItem = glowMove?.type === "place" ? glowMove.item : null;
        const glowTarget = glowMove?.type === "place" ? glowMove.target : null;
        body = (
          <View style={{ gap: theme.space[4] }} testID="round-sort">
            <View style={styles.grid}>
              {round.items.map((it) => (
                <TileButton key={it.id} tile={it} state={tileState("item", it.id, done(it.id))} glow={glowItem === it.id} testID={`item-${it.id}`} onPress={() => setPicked({ side: "item", id: it.id })} />
              ))}
            </View>
            <View style={styles.grid}>
              {round.buckets.map((b) => (
                <PlaceButton
                  key={b.id}
                  label={b.label}
                  filled={false}
                  glow={glowTarget === b.id}
                  enabled={!!picked}
                  onPress={() => picked && move({ type: "place", item: picked.id, target: b.id })}
                  testID={`bucket-${b.id}`}
                  style={[styles.bucket, { borderRadius: theme.radius.card, padding: theme.space[3] }]}
                >
                  {b.media ? (
                    <View style={styles.tileMedia}>
                      <Media mediaRef={b.media} maxHeight={64} />
                    </View>
                  ) : null}
                  <Text variant="heading" importantForAccessibility="no">
                    {b.label}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {round.items
                      .filter((i) => i.bucket === b.id && done(i.id))
                      .map((i) => i.label)
                      .join(", ")}
                  </Text>
                </PlaceButton>
              ))}
            </View>
          </View>
        );
        break;
      }
      case "drag": {
        help = t("learn:LRN-18.little_learner_move_help");
        const filled = (targetId: string) => done(round.targets.find((x) => x.id === targetId)!.accepts);
        const glowItem = glowMove?.type === "place" ? glowMove.item : null;
        const glowTarget = glowMove?.type === "place" ? glowMove.target : null;
        body = (
          <View style={{ gap: theme.space[4] }} testID="round-drag">
            <View testID="drag-scene" style={styles.scene} onLayout={(e: LayoutChangeEvent) => setScene({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
              <Media mediaRef={round.scene} maxHeight={260} />
              {scene &&
                round.targets.map((tg) => {
                  const d = tg.radius * 2 * scene.width;
                  return (
                    <PlaceButton
                      key={tg.id}
                      label={tg.label}
                      filled={filled(tg.id)}
                      glow={glowTarget === tg.id}
                      enabled={!!picked && !filled(tg.id)}
                      onPress={() => picked && move({ type: "place", item: picked.id, target: tg.id })}
                      testID={`target-${tg.id}`}
                      style={{ position: "absolute", left: tg.x * scene.width - d / 2, top: tg.y * scene.height - d / 2, width: Math.max(d, 48), height: Math.max(d, 48), borderRadius: Math.max(d, 48) / 2 }}
                    >
                      {filled(tg.id) ? <Icon name="CheckCircle" size={24} color="successText" /> : null}
                    </PlaceButton>
                  );
                })}
            </View>
            <View style={styles.grid}>
              {round.items.map((it) => (
                <TileButton key={it.id} tile={it} state={tileState("item", it.id, done(it.id))} glow={glowItem === it.id} testID={`item-${it.id}`} onPress={() => setPicked({ side: "item", id: it.id })} />
              ))}
            </View>
          </View>
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
        <View style={[styles.stars, { gap: theme.space[3], paddingVertical: theme.space[8] }]} testID="play-stars" accessibilityLiveRegion="polite">
          <Icon name="Star" size={32} color="primaryText" weight="fill" />
          <Text variant="title" align="center">
            {t("learn:LRN-18.little_learner_stars", { n: s.stars })}
          </Text>
        </View>
      ) : (
        <>
          <View style={[styles.petRow, { gap: theme.space[2] }]}>
            <View style={styles.grow}>
              <PetSays pet={props.pet} text={petText} testID="play-pet-line" />
            </View>
            {s.phase === "cheer" ? (
              // The cheer: a clap that pops in, or just appears with reduced motion. The pet line carries the words.
              <Animated.View entering={reducedMotion ? undefined : ZoomIn.duration(theme.motion.duration.slow)} testID="play-cheer">
                <Icon name="HandsClapping" size={32} color="primaryText" weight="fill" />
              </Animated.View>
            ) : null}
            {audio && promptSrc && s.phase === "round" ? (
              <IconButton icon="SpeakerHigh" label={t("learn:LRN-18.little_learner_hear_again")} onPress={() => audio.play(promptSrc)} size={48} testID="play-hear-again" />
            ) : null}
          </View>
          {s.phase === "round" && (
            <Text variant="caption" tone="muted" testID="play-help">
              {help}
            </Text>
          )}
          {body}
          {s.phase === "round" && s.feedback ? (
            <View
              accessible
              accessibilityLiveRegion="polite"
              testID="play-feedback"
              style={[styles.feedback, { gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.card, backgroundColor: success ? c.successTint : c.surfaceSunken }]}
            >
              <Icon name={success ? "CheckCircle" : "ArrowCounterClockwise"} size={24} color={success ? "successText" : "inkMuted"} />
              <Text variant="body" style={styles.grow}>
                {s.feedback}
              </Text>
            </View>
          ) : null}
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
  const { t } = usePlayer();
  const theme = useTheme();
  const c = theme.colors;
  const [size, setSize] = useState(0);
  const [strokes, setStrokes] = useState<TracePoint[][]>([]);
  const live = useRef<TracePoint[][]>([]);
  const fontFamily = theme.fonts[script === "devanagari" ? "devanagari" : "latin"][700];

  const point = (e: GestureResponderEvent): TracePoint => ({
    x: size ? Math.min(1, Math.max(0, e.nativeEvent.locationX / size)) : 0,
    y: size ? Math.min(1, Math.max(0, e.nativeEvent.locationY / size)) : 0,
  });
  const update = (next: TracePoint[][]) => {
    live.current = next;
    setStrokes(next);
  };

  const finish = () => {
    const m = mask ? mask(glyph, script) : null;
    // Without a mask the pad cannot measure, so any trace counts (the round still ends on a win).
    const coverage = m ? traceCoverage(m, live.current) : live.current.length ? 1 : 0;
    onDone(coverage);
  };

  return (
    <View style={{ alignItems: "center", gap: theme.space[3] }} testID="round-trace">
      {guide}
      <View
        testID="trace-pad"
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${t("learn:LRN-18.little_learner_trace_help")}: ${glyph}`}
        onLayout={(e: LayoutChangeEvent) => setSize(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => update([...live.current, [point(e)]])}
        onResponderMove={(e) => {
          const all = live.current.slice();
          const last = all.at(-1);
          if (!last) return;
          all[all.length - 1] = [...last, point(e)];
          update(all);
        }}
        style={[styles.pad, { backgroundColor: c.surfaceSunken, borderRadius: theme.radius.card }]}
      >
        <RNText
          importantForAccessibility="no"
          accessibilityElementsHidden
          allowFontScaling={false}
          style={{ fontFamily, fontWeight: "700", fontSize: size ? size * 0.8 : 1, lineHeight: size || undefined, color: c.inkDisabled, textAlign: "center", width: size || undefined }}
        >
          {glyph}
        </RNText>
        {size > 0 && (
          <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
            {strokes.map((stroke, i) => (
              <Polyline
                key={i}
                points={(stroke.length === 1 ? [stroke[0]!, { x: stroke[0]!.x + 0.001, y: stroke[0]!.y }] : stroke).map((p) => `${p.x * size},${p.y * size}`).join(" ")}
                fill="none"
                stroke={c.primary}
                strokeWidth={size * TRACE_BRUSH * 2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </Svg>
        )}
      </View>
      <Row>
        <Button variant="ghost" icon="ArrowCounterClockwise" label={t("learn:LRN-18.little_learner_start_again")} onPress={() => update([])} style={{ flex: 1 }} testID="trace-again" />
        <Button icon="Check" label={t("learn:LRN-18.little_learner_all_done")} disabled={strokes.length === 0} onPress={finish} style={{ flex: 1 }} testID="trace-done" />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 },
  columns: { flexDirection: "row" },
  column: { flex: 1, gap: 12 },
  tile: { minWidth: 96, minHeight: 96, padding: 8, gap: 4, alignItems: "center", borderWidth: 4 },
  tileMedia: { width: 80 },
  badge: { position: "absolute", right: 4, top: 4 },
  bucket: { minWidth: 120, minHeight: 96, gap: 8 },
  // Room for the targets even while the scene picture is not on the device yet.
  scene: { minHeight: 200 },
  stars: { alignItems: "center" },
  petRow: { flexDirection: "row", alignItems: "flex-end" },
  feedback: { flexDirection: "row", alignItems: "center" },
  pad: { width: "100%", maxWidth: 320, aspectRatio: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
