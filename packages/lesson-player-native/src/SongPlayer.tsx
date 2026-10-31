/**
 * LRN-17 Song player for a `song@1` in a song bundle, on lesson-core's song reducer: the lyrics
 * with the line being sung lit, the line's action (Phosphor icon and spoken cue), and the sung
 * track through the injected audio port. Props follow @smriti/lesson-player-web.
 */
import { initialSong, planSong, reduceSong, type SongAction, type SongState } from "@smriti/lesson-core";
import { Button, Icon, Text, useTheme } from "@smriti/ui-native";
import { useEffect, useMemo } from "react";
import { AccessibilityInfo, View } from "react-native";

import { ActivityShell, appIcon, audioSource, PetSays, Row, useClocked, useCompletion, useTint, type ActivityPlayerProps } from "./activity";
import { Media } from "./Media";

export type SongPlayerProps = ActivityPlayerProps;

export function SongPlayer(props: SongPlayerProps) {
  const { bundle, activityId, bundleVersion, t, audio } = props;
  const theme = useTheme();
  const tint = useTint(props.subject);
  const plan = useMemo(() => planSong(bundle, activityId, { bundleVersion }), [bundle, activityId, bundleVersion]);
  const [s, dispatch] = useClocked<SongState, SongAction>(reduceSong, () => reduceSong(initialSong(), { type: "start", plan, now: (props.clock ?? Date.now)() }), props.clock);
  useCompletion(s.completion, props.onComplete);

  const src = audioSource(props, plan.audio);
  const ready = !!audio && !!src;
  const actions = new Map(plan.actions.map((a) => [a.id, a]));
  const current = s.line === null ? null : plan.lines[s.line]!;
  const action = s.action ? actions.get(s.action) : undefined;

  useEffect(() => {
    if (!audio) return;
    return audio.subscribe((e) => {
      if (e.type === "position") dispatch({ type: "tick", positionMs: e.ms });
      else if (e.type === "ended") dispatch({ type: "ended" });
      // A track that fails to play pauses quietly; [Sing along] tries again.
      else dispatch({ type: "pause" });
    });
  }, [audio, dispatch]);
  useEffect(() => () => audio?.stop(), [audio]);

  // Screen readers hear which line is being sung (no-op without one).
  const nowSinging = current ? t("learn:LRN-17.little_learner_now_singing_a11y", { line: current.text }) : "";
  useEffect(() => {
    if (nowSinging) AccessibilityInfo.announceForAccessibility?.(nowSinging);
  }, [nowSinging]);

  const sing = () => {
    if (!audio || !src) return;
    if (s.phase === "paused") audio.resume();
    else audio.play(src);
    dispatch({ type: "play" });
  };
  const pause = () => {
    audio?.pause();
    dispatch({ type: "pause" });
  };
  const ended = s.phase === "complete";

  return (
    <ActivityShell
      props={props}
      testID="song-player"
      footer={
        ended ? (
          <>
            <PetSays pet={props.pet} text={t("learn:LRN-17.little_learner_song_done")} testID="song-done-line" />
            <Row>
              <Button variant="secondary" icon="ArrowCounterClockwise" label={t("learn:LRN-17.little_learner_sing_again")} onPress={sing} style={{ flex: 1 }} testID="song-again" />
              <Button icon="Check" label={t("learn:LRN-17.little_learner_done")} onPress={() => props.onExit("done")} style={{ flex: 1 }} testID="song-done" />
            </Row>
          </>
        ) : s.phase === "playing" ? (
          <Button icon="PauseCircle" label={t("learn:LRN-17.little_learner_pause")} onPress={pause} testID="song-pause" />
        ) : (
          <Button icon="Play" label={t("learn:LRN-17.little_learner_sing_along")} disabled={!ready} onPress={sing} testID="song-play" />
        )
      }
    >
      {plan.cover ? (
        <View style={{ alignSelf: "center", width: "60%" }}>
          <Media mediaRef={plan.cover} maxHeight={220} />
        </View>
      ) : null}
      <Text variant="title" align="center">
        {plan.title}
      </Text>
      {!ready && (
        <Text variant="body" tone="muted" align="center" testID="song-not-ready">
          {t("learn:LRN-17.little_learner_not_ready")}
        </Text>
      )}
      <View accessibilityLabel={t("learn:LRN-17.little_learner_lyrics_a11y")} accessibilityRole="list" style={{ gap: theme.space[2] }} testID="song-lyrics">
        {plan.lines.map((line, i) => {
          const on = s.line === i;
          const lineAction = line.action ? actions.get(line.action) : undefined;
          const lit = plan.timed && on;
          return (
            <View
              key={i}
              accessible
              accessibilityLabel={lineAction ? `${line.text}. ${lineAction.cue}` : line.text}
              accessibilityState={{ selected: on }}
              testID={`song-line-${i}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.space[2],
                paddingHorizontal: theme.space[3],
                paddingVertical: theme.space[2],
                borderRadius: theme.radius.md,
                backgroundColor: lit ? tint.tint : "transparent",
              }}
            >
              <Text variant="heading" tone={!plan.timed ? "ink" : on ? "subject" : "muted"} subject={props.subject} style={{ flex: 1 }}>
                {line.text}
              </Text>
              {lineAction && <Icon name={appIcon(lineAction.icon)} size={24} color={on ? "subjectText" : "inkMuted"} subject={props.subject} />}
            </View>
          );
        })}
      </View>
      {action && (
        <View
          accessible
          accessibilityLiveRegion="polite"
          testID="song-action"
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.card, backgroundColor: theme.colors.primaryTint }}
        >
          <Icon name={appIcon(action.icon)} size={32} color="primary" />
          <Text variant="heading">{t("learn:LRN-17.little_learner_do_this", { cue: action.cue })}</Text>
        </View>
      )}
    </ActivityShell>
  );
}
