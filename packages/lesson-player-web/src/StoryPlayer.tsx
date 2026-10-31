/**
 * LRN-11 Storybook reader for a `storybook@1` in a story bundle, on lesson-core's story reducer:
 * page by page, "Read to me" (on by default for little learners), the 2 s auto-turn after the
 * narration, "The end!" with [Read again] and [Done].
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { initialStory, PET_REACTION_MS, petReaction, planStory, reduceStory, type PetReactionEvent, type StoryAction, type StoryState } from "@smriti/lesson-core";
import { Button, PetView, Text, cx, useUI } from "@smriti/ui-web";
import { ActivityShell, mediaUrl, PetSays, useClocked, useCompletion, type ActivityPlayerProps } from "./activity";
import { Media } from "./Media";

export interface StoryPlayerProps extends ActivityPlayerProps {
  /** Little learner rules: narration on by default, bigger text (default true). */
  little?: boolean;
  /** Each page shown (for `storybook_page_viewed`), 0-based. */
  onPageViewed?: (page: number) => void;
}

export function StoryPlayer(props: StoryPlayerProps) {
  const { bundle, activityId, bundleVersion, t, audio, contentBaseUrl } = props;
  const little = props.little ?? true;
  const plan = useMemo(() => planStory(bundle, activityId, { bundleVersion, little }), [bundle, activityId, bundleVersion, little]);
  const [s, dispatch] = useClocked<StoryState, StoryAction>(reduceStory, () => reduceStory(initialStory(), { type: "start", plan, now: (props.clock ?? Date.now)() }), props.clock);
  const { reducedMotion } = useUI();
  useCompletion(s.completion, props.onComplete);

  const page = plan.pages[s.page]!;
  const narrationSrc = mediaUrl(bundle, page.narration, contentBaseUrl);
  const canNarrate = !!audio && plan.pages.some((p) => mediaUrl(bundle, p.narration, contentBaseUrl));

  useEffect(() => {
    props.onPageViewed?.(s.page);
  }, [s.page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play this page's narration when it is on; tell the reducer when it ends.
  useEffect(() => {
    if (!audio) return;
    const off = audio.subscribe((e) => {
      if (e.type === "ended") dispatch({ type: "narration_ended" });
    });
    return off;
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
  const reaction = usePageReaction(s.page, end);
  const pet = petReaction(reaction.event, reducedMotion);
  const readKey = little ? "learn:LRN-11.read_to_me_little_learner" : "learn:LRN-11.read_to_me";

  return (
    <ActivityShell
      props={props}
      testID="story-player"
      header={
        <>
          {little && props.pet && (
            // LRN-11 little learner: the pet in the corner reacts at each page turn. Decorative: the
            // page and its words are announced already.
            <span
              key={reaction.n}
              aria-hidden
              data-testid="story-pet"
              data-mood={pet.mood}
              data-hop={pet.hop || undefined}
              className={cx("inline-grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-primary-tint", pet.hop && "motion-safe:animate-[sm-hop_var(--sm-duration-slow)_ease-out_1]")}
            >
              <PetView species={props.pet.species} mood={pet.mood} under10 decorative size={64} className="mt-[12%]" />
            </span>
          )}
          <Text variant="label" tone="muted" testID="story-page-count">
            {t("learn:LRN-11.page", { n: s.page + 1, total })}
          </Text>
          {canNarrate && (
            <Button
              size="sm"
              variant={s.narration ? "secondary" : "ghost"}
              icon="SpeakerHigh"
              label={t(readKey)}
              buttonProps={{ "aria-pressed": s.narration }}
              onPress={() => dispatch({ type: "narration", on: !s.narration })}
              testID="story-read-to-me"
            />
          )}
        </>
      }
      footer={
        end ? (
          <div className="flex gap-3">
            <Button variant="secondary" icon="ArrowCounterClockwise" label={t("learn:LRN-11.again")} onPress={() => dispatch({ type: "read_again" })} testID="story-again" />
            <Button
              label={t("learn:LRN-11.done")}
              icon="Check"
              onPress={() => {
                dispatch({ type: "done" });
                props.onExit("done");
              }}
              testID="story-done"
            />
          </div>
        ) : (
          <div className="flex gap-3">
            <Button variant="ghost" icon="CaretLeft" label={t("learn:LRN-11.back")} disabled={s.page === 0} onPress={() => dispatch({ type: "back" })} testID="story-back" />
            <Button icon="CaretRight" iconPosition="end" label={t("learn:LRN-11.next")} onPress={() => dispatch({ type: "next" })} testID="story-next" />
          </div>
        )
      }
    >
      <div onPointerDown={() => dispatch({ type: "touch" })} className="flex flex-col gap-4" aria-live="polite">
        <h1 className="m-0 text-title text-ink">{plan.title}</h1>
        {/* LRN-11: a page turn (by hand or the auto-turn after narration) slides; reduced motion fades. */}
        <div
          key={s.page}
          data-testid="story-page"
          data-motion={reducedMotion ? "fade" : "slide"}
          className={cx(
            "flex flex-col gap-4",
            reducedMotion ? "animate-[sm-fade_var(--sm-duration-slow)_ease-out_1]" : "motion-safe:animate-[sm-slide-in_var(--sm-duration-slow)_ease-out_1] motion-reduce:animate-[sm-fade_var(--sm-duration-slow)_ease-out_1]",
          )}
        >
          <Media refId={page.media} className="aspect-[3/2]" fit="cover" />
          <p className={cx("m-0 text-ink", little ? "text-title font-medium" : "text-heading font-medium")} data-testid="story-text">
            {page.text}
          </p>
        </div>
        {end && props.pet && <PetSays pet={props.pet} text={t("learn:LRN-11.end")} testID="story-end" />}
        {end && !props.pet && (
          <Text variant="title" testID="story-end">
            {t("learn:LRN-11.end")}
          </Text>
        )}
      </div>
    </ActivityShell>
  );
}

/** The pet's reaction to page turns: set at each turn (and at the end), back to rest after a moment. */
function usePageReaction(page: number, end: boolean): { event: PetReactionEvent | null; n: number } {
  const [r, setR] = useState<{ event: PetReactionEvent | null; n: number }>({ event: null, n: 0 });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setR((x) => ({ event: end ? "story_end" : "page_turn", n: x.n + 1 }));
    const id = setTimeout(() => setR((x) => ({ ...x, event: null })), PET_REACTION_MS);
    return () => clearTimeout(id);
  }, [page, end]);
  return r;
}
