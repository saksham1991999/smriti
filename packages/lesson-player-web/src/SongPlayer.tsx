/**
 * LRN-17 Song player for a `song@1` in a song bundle, on lesson-core's song reducer: the lyrics
 * with the line being sung lit, the line's action (Phosphor icon and spoken cue), and the sung
 * track through the injected audio port.
 */
import { useEffect, useMemo } from "react";
import { initialSong, planSong, reduceSong, type SongAction, type SongState } from "@smriti/lesson-core";
import { Button, Icon, Text, cx, useUI } from "@smriti/ui-web";
import { ActivityShell, appIcon, mediaUrl, PetSays, useClocked, useCompletion, type ActivityPlayerProps } from "./activity";
import { Media } from "./Media";

export type SongPlayerProps = ActivityPlayerProps;

export function SongPlayer(props: SongPlayerProps) {
  const { bundle, activityId, bundleVersion, t, audio, contentBaseUrl } = props;
  const plan = useMemo(() => planSong(bundle, activityId, { bundleVersion }), [bundle, activityId, bundleVersion]);
  const [s, dispatch] = useClocked<SongState, SongAction>(reduceSong, () => reduceSong(initialSong(), { type: "start", plan, now: (props.clock ?? Date.now)() }), props.clock);
  const { reducedMotion } = useUI();
  useCompletion(s.completion, props.onComplete);

  const src = mediaUrl(bundle, plan.audio, contentBaseUrl);
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
            <div className="flex gap-3">
              <Button variant="secondary" icon="ArrowCounterClockwise" label={t("learn:LRN-17.little_learner_sing_again")} onPress={sing} testID="song-again" />
              <Button icon="Check" label={t("learn:LRN-17.little_learner_done")} onPress={() => props.onExit("done")} testID="song-done" />
            </div>
          </>
        ) : s.phase === "playing" ? (
          <Button icon="PauseCircle" label={t("learn:LRN-17.little_learner_pause")} onPress={pause} testID="song-pause" />
        ) : (
          <Button icon="Play" label={t("learn:LRN-17.little_learner_sing_along")} disabled={!ready} onPress={sing} testID="song-play" />
        )
      }
    >
      {plan.cover && <Media refId={plan.cover} className="mx-auto aspect-square w-1/2" fit="cover" />}
      <h1 className="m-0 text-center text-title text-ink">{plan.title}</h1>
      {!ready && (
        <Text variant="body" tone="muted" align="center" testID="song-not-ready">
          {t("learn:LRN-17.little_learner_not_ready")}
        </Text>
      )}
      <ol aria-label={t("learn:LRN-17.little_learner_lyrics_a11y")} className="m-0 flex list-none flex-col gap-2 p-0" data-testid="song-lyrics">
        {plan.lines.map((line, i) => {
          const on = s.line === i;
          const lineAction = line.action ? actions.get(line.action) : undefined;
          return (
            <li
              key={i}
              aria-current={on ? "true" : undefined}
              data-testid={`song-line-${i}`}
              className={cx(
                "flex items-center gap-2 rounded-md px-3 py-2 text-heading",
                !plan.timed ? "text-ink" : on ? "bg-subject-tint text-subject-text" : "text-ink-muted",
                !reducedMotion && "transition-colors duration-base",
              )}
            >
              <span className="flex-1">{line.text}</span>
              {lineAction && <Icon name={appIcon(lineAction.icon)} size={24} color={on ? "subjectText" : "inkMuted"} label={lineAction.cue} />}
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="sr-only" data-testid="song-now">
        {current ? t("learn:LRN-17.little_learner_now_singing_a11y", { line: current.text }) : ""}
      </p>
      {action && (
        <div className="flex items-center justify-center gap-3 rounded-lg bg-primary-tint p-3" data-testid="song-action">
          <Icon name={appIcon(action.icon)} size={32} color="primaryText" />
          <Text variant="heading">{t("learn:LRN-17.little_learner_do_this", { cue: action.cue })}</Text>
        </div>
      )}
    </ActivityShell>
  );
}
