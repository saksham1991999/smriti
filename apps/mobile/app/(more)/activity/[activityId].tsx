import type { ActivityCompletion } from '@smriti/lesson-core';
import { PlayPlayer, SongPlayer, StoryPlayer } from '@smriti/lesson-player-native';
import { Button, EmptyState, useTheme } from '@smriti/ui-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { completeActivity } from '../../../src/features/little/activities';
import { glyphMaskFor, webAudioPort } from '../../../src/features/little/media';
import { useApp, useT, useUiState } from '../../../src/services/context';
import { Screen } from '../../../src/ui/Screen';

type Kind = 'story' | 'song' | 'play';
const KINDS: readonly Kind[] = ['story', 'song', 'play'];

/**
 * LRN-11 (storybook), LRN-17 (song) and LRN-18 (play) for little learners, on the players from
 * lesson-player-native. The app supplies the bundle from the device, pictures from the seed pack
 * or CDN, audio where the platform has it, and records the completion (app-core
 * `recordActivityCompleted`), which marks the path node done.
 */
export default function ActivityScreen() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const params = useLocalSearchParams<{ activityId: string; topic?: string; kind?: string }>();
  const kind = KINDS.includes(params.kind as Kind) ? (params.kind as Kind) : null;
  const locale = useUiState((s) => s.locale);
  const online = useUiState(() => app.deps.network.isOnline());
  const exam = app.examProfileId();
  const loaded = useMemo(() => (kind && params.topic ? app.deps.content.loadActivities(locale, params.topic, kind, exam) : null), [app, kind, params.topic, locale, exam]);
  const audio = useMemo(() => webAudioPort(), []);
  const glyphMask = useMemo(() => glyphMaskFor({ latin: theme.fonts.latin[700], devanagari: theme.fonts.devanagari[700] }), [theme]);
  const pet = app.store.getState().pet;
  const subject = params.topic ? app.deps.content.subjectOf(locale, params.topic, exam)?.id : undefined;

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));

  if (!kind || !loaded || !loaded.bundle.activities[params.activityId]) {
    return (
      <Screen testID="LES-11" footer={<Button label={t('learn:LES-11.back')} onPress={leave} fullWidth />}>
        <EmptyState illustration="ui-offline" text={t('learn:LES-11.error')} />
      </Screen>
    );
  }

  const onComplete = (c: ActivityCompletion) => {
    void completeActivity(app, c);
    const props = { activity_id: c.activityId, topic_id: c.topicId, stars: c.stars, duration_s: Math.round(c.msTotal / 1000) };
    if (c.kind === 'story') app.track('storybook_completed', {});
    else if (c.kind === 'song') app.track('song_completed', props);
    else app.track('play_completed', props);
  };

  const common = {
    bundle: loaded.bundle,
    activityId: params.activityId,
    bundleVersion: loaded.hash,
    t,
    resolveMedia: (url: string) => app.deps.content.asset(locale, url),
    // Tracks play from the CDN; a bundle-relative track isn't in the seed pack, so it stays silent.
    resolveAudio: (url: string) => (/^https:\/\//.test(url) ? url : undefined),
    ...(audio ? { audio } : {}),
    online,
    ...(pet ? { pet: { species: pet.species === 'dog' ? ('dog' as const) : ('cat' as const), name: pet.name } } : {}),
    ...(subject ? { subject } : {}),
    clock: app.deps.clock,
    onComplete,
    // The story's completion lands in an effect after [Done]: leave on the next tick so it is
    // recorded before this screen unmounts.
    onExit: (reason: 'close' | 'done') => (reason === 'done' ? setTimeout(leave, 0) : leave()),
  };

  return (
    <Screen testID={kind === 'story' ? 'LRN-11' : kind === 'song' ? 'LRN-17' : 'LRN-18'} scroll={false} contentStyle={styles.bare}>
      {kind === 'story' ? (
        <StoryPlayer {...common} little={app.isLittleLearner()} onPageViewed={() => app.track('storybook_page_viewed', {})} />
      ) : kind === 'song' ? (
        <SongPlayer {...common} />
      ) : (
        <PlayPlayer
          {...common}
          {...(glyphMask ? { glyphMask } : {})}
          onRoundComplete={(r) => app.track('play_round_completed', { activity_id: params.activityId, round_index: r.roundIndex, round_kind: r.kind, attempts: r.attempts, was_guided: r.guided })}
        />
      )}
    </Screen>
  );
}

// The player shell brings its own gutter and footer spacing.
const styles = StyleSheet.create({ bare: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 } });
