import { uuidv7, type LessonSession, type LessonState } from '@smriti/lesson-core';
import { LessonPlayer } from '@smriti/lesson-player-native';
import { Button, Dialog, EmptyState, Text } from '@smriti/ui-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../src/services/context';
import { eventSink, finishLesson, prepareLesson, type LessonRunMode } from '../../src/services/lessons';
import { useHaptics, minutesOf } from '../../src/ui/hooks';
import { Screen } from '../../src/ui/Screen';

const MODES: LessonRunMode[] = ['deep_dive', 'quick_revision', 'onboarding'];

/**
 * LES-01 to LES-07 (the player from lesson-player-native) with LES-05 (leave?) and LES-11 (not on
 * this device). Onboarding mode is ONB-13: the exit dialog has the seed copy and the end is ONB-14.
 */
export default function LessonScreen() {
  const app = useApp();
  const t = useT();
  const haptics = useHaptics();
  const params = useLocalSearchParams<{ topicId: string; mode?: string; bite?: string }>();
  const mode = MODES.includes(params.mode as LessonRunMode) ? (params.mode as LessonRunMode) : 'deep_dive';
  const locale = useUiState((s) => s.locale);
  const online = useUiState(() => app.deps.network.isOnline());
  const prepared = useMemo(
    () => (params.topicId ? prepareLesson(app, { topicId: params.topicId, mode, ...(params.bite ? { biteId: params.bite } : {}) }) : null),
    [app, params.topicId, params.bite, mode],
  );
  const sink = useMemo(() => eventSink(app), [app]);
  const sessionRef = useRef<LessonSession | null>(null);
  const [exitAsk, setExitAsk] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const onboarding = mode === 'onboarding';
  const little = app.isLittleLearner();

  if (!prepared) {
    return (
      <Screen testID="LES-11" footer={<Button label={t('learn:LES-11.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as Href))} fullWidth />}>
        <EmptyState illustration="ui-offline" text={t('learn:LES-11.error')} />
      </Screen>
    );
  }

  const complete = async (s: LessonState) => {
    if (!s.summary || busy) return;
    setBusy(true);
    const end = await finishLesson(app, prepared, s.summary, sink);
    if (onboarding) {
      await app.finishFirstLesson({ topicId: end.topicId, xp: end.summary.xp, accuracy: end.summary.accuracy, minutes: minutesOf(end.summary.msTotal) });
      router.replace('/onboarding/first-win' as Href);
    } else {
      router.replace('/lesson-end' as Href);
    }
  };

  const leave = async () => {
    setExitAsk(null);
    const session = sessionRef.current;
    if (session) {
      session.dispatch({ type: 'exit' });
      for (const e of session.emitted) sink.push(e);
    }
    await sink.drain();
    if (onboarding) {
      // "Finish later": the seed waits on Home; the rest of onboarding still runs.
      await app.finishFirstLesson(null);
      await app.leaveFirstWin();
      router.replace('/onboarding/daily-goal' as Href);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/learn' as Href);
  };

  const title = onboarding ? t('learn:LES-05.onboarding_title') : t('learn:LES-05.title');
  const body = onboarding ? t('learn:LES-05.onboarding_body', { cards_left: exitAsk ?? 0 }) : (exitAsk ?? 0) <= 3 ? t('learn:LES-05.pet_line_few_left', { n: exitAsk ?? 0 }) : t('learn:LES-05.line');
  const stay = onboarding ? t('learn:LES-05.onboarding_buttons.1') : little ? t('learn:LES-05.little_learner.1') : t('learn:LES-05.keep_going');
  const go = onboarding ? t('learn:LES-05.onboarding_buttons.2') : little ? t('learn:LES-05.little_learner.2') : t('learn:LES-05.exit');

  return (
    <View style={styles.root} testID={onboarding ? 'ONB-13' : 'LES-01'}>
      <LessonPlayer
        key={`${prepared.plan.topicId}:${prepared.plan.biteId ?? ''}:${locale}`}
        plan={prepared.plan}
        bundle={prepared.bundle}
        config={prepared.config}
        tz={app.deps.timeZone()}
        t={t}
        subject={prepared.subject}
        online={online}
        resolveMedia={(url) => app.deps.content.asset(locale, url)}
        onEvent={sink.push}
        onComplete={(s) => void complete(s)}
        onPreviewEnd={() => router.replace({ pathname: '/paywall', params: { from: 'preview' } })}
        onRequestExit={(left) => setExitAsk(left)}
        haptics={{ tap: haptics.tap, success: haptics.success, error: haptics.warning }}
        clock={() => app.now()}
        newId={(now) => uuidv7(now)}
        sessionRef={sessionRef}
      />
      <Dialog
        open={exitAsk !== null}
        onOpenChange={(o) => (o ? undefined : setExitAsk(null))}
        title={title}
        description={body}
        confirm={{ label: stay, onPress: () => setExitAsk(null) }}
        cancel={{ label: go, onPress: () => void leave() }}
        testID="LES-05"
      />
      {busy ? (
        <View style={styles.busy} pointerEvents="none">
          <Text variant="caption" tone="muted">
            {t('ui:saveState.saving')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  busy: { position: 'absolute', bottom: 24, left: 0, right: 0, alignItems: 'center' },
});
