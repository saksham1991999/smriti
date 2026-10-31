/**
 * LRN-11 Storybook reader for a `storybook@1` in a story bundle, on lesson-core's story reducer:
 * page by page, "Read to me" (on by default for little learners), the 2 s auto-turn after the
 * narration, "The end!" with [Read again] and [Done]. Props follow @smriti/lesson-player-web.
 */
import { initialStory, planStory, reduceStory, type StoryAction, type StoryState } from "@smriti/lesson-core";
import { Button, Chip, Text, useTheme, useUI } from "@smriti/ui-native";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, { FadeIn, SlideInRight } from "react-native-reanimated";

import { ActivityShell, audioSource, PetSays, Row, useClocked, useCompletion, type ActivityPlayerProps } from "./activity";
import { Media } from "./Media";

export interface StoryPlayerProps extends ActivityPlayerProps {
  /** Little learner rules: narration on by default, bigger text (default true). */
  little?: boolean;
  /** Each page shown (for `storybook_page_viewed`), 0-based. */
  onPageViewed?: (page: number) => void;
}

export function StoryPlayer(props: StoryPlayerProps) {
  const { bundle, activityId, bundleVersion, t, audio } = props;
  const theme = useTheme();
  const { reducedMotion } = useUI();
  const little = props.little ?? true;
  const plan = useMemo(() => planStory(bundle, activityId, { bundleVersion, little }), [bundle, activityId, bundleVersion, little]);
  const [s, dispatch] = useClocked<StoryState, StoryAction>(reduceStory, () => reduceStory(initialStory(), { type: "start", plan, now: (props.clock ?? Date.now)() }), props.clock);
  useCompletion(s.completion, props.onComplete);

  const page = plan.pages[s.page]!;
  const narrationSrc = audioSource(props, page.narration);
  const canNarrate = !!audio && plan.pages.some((p) => audioSource(props, p.narration));

  useEffect(() => {
    props.onPageViewed?.(s.page);
  }, [s.page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play this page's narration when it is on; tell the reducer when it ends.
  useEffect(() => {
    if (!audio) return;
    return audio.subscribe((e) => {
      if (e.type === "ended") dispatch({ type: "narration_ended" });
    });
  }, [audio, dispatch]);
  useEffect(() => {
    if (!audio) return;
    if (s.phase === "page" && s.narration && narrationSrc) audio.play(narrationSrc);
    else audio.stop();
  }, [audio, s.phase, s.page, s.narration, narrationSrc]);
  useEffect(() => () => audio?.stop(), [audio]);

  // The auto-turn clock runs only while a turn is pending.
  useEffect(() => {
    if (s.autoAdvanceAt === null) return;
    const id = setInterval(() => dispatch({ type: "tick" }), 250);
    return () => clearInterval(id);
  }, [s.autoAdvanceAt, dispatch]);

  const end = s.phase === "end" || s.phase === "complete";
  const total = plan.pages.length;
  const readKey = little ? "learn:LRN-11.read_to_me_little_learner" : "learn:LRN-11.read_to_me";

  return (
    <ActivityShell
      props={props}
      testID="story-player"
      header={
        <>
          <Text variant="label" tone="muted" testID="story-page-count">
            {t("learn:LRN-11.page", { n: s.page + 1, total })}
          </Text>
          {canNarrate && (
            <Chip
              kind="filter"
              icon="SpeakerHigh"
              selected={s.narration}
              label={t(readKey)}
              onPress={() => dispatch({ type: "narration", on: !s.narration })}
              testID="story-read-to-me"
            />
          )}
        </>
      }
      footer={
        end ? (
          <Row>
            <Button variant="secondary" icon="ArrowCounterClockwise" label={t("learn:LRN-11.again")} onPress={() => dispatch({ type: "read_again" })} style={{ flex: 1 }} testID="story-again" />
            <Button
              label={t("learn:LRN-11.done")}
              icon="Check"
              onPress={() => {
                dispatch({ type: "done" });
                props.onExit("done");
              }}
              style={{ flex: 1 }}
              testID="story-done"
            />
          </Row>
        ) : (
          <Row>
            <Button variant="ghost" icon="CaretLeft" label={t("learn:LRN-11.back")} disabled={s.page === 0} onPress={() => dispatch({ type: "back" })} style={{ flex: 1 }} testID="story-back" />
            <Button icon="CaretRight" iconPosition="end" label={t("learn:LRN-11.next")} onPress={() => dispatch({ type: "next" })} style={{ flex: 1 }} testID="story-next" />
          </Row>
        )
      }
    >
      <View onTouchStart={() => dispatch({ type: "touch" })} style={{ gap: theme.space[4] }} accessibilityLiveRegion="polite">
        <Text variant="title">{plan.title}</Text>
        {/* LRN-11: a page turn (by hand or the auto-turn after narration) slides; reduced motion fades. */}
        <Animated.View
          key={s.page}
          entering={reducedMotion ? FadeIn.duration(theme.motion.duration.slow) : SlideInRight.duration(theme.motion.duration.slow)}
          style={{ gap: theme.space[4] }}
          testID="story-page"
        >
          <Media mediaRef={page.media} maxHeight={260} />
          <Text variant={little ? "title" : "heading"} testID="story-text">
            {page.text}
          </Text>
        </Animated.View>
        {end && props.pet && <PetSays pet={props.pet} text={t("learn:LRN-11.end")} testID="story-end" />}
        {end && !props.pet && (
          <Text variant="title" testID="story-end">
            {t("learn:LRN-11.end")}
          </Text>
        )}
      </View>
    </ActivityShell>
  );
}
