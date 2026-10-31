import { useAppStore } from '@smriti/app-core/react';
import { uuidv7, type LessonSession, type LessonState } from '@smriti/lesson-core';
import { LessonPlayer } from '@smriti/lesson-player-native';
import { Button, Chip, Dialog, EmptyState, PetAvatar, Text, useTheme } from '@smriti/ui-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { prepareTestOut, saveTestOut, undoTestOut, type PreparedCheck, type TestOutOutcome } from '../../src/services/checks';
import { useApp, useT, useUiState } from '../../src/services/context';
import { eventSink } from '../../src/services/lessons';
import { useHaptics } from '../../src/ui/hooks';
import { Screen } from '../../src/ui/Screen';

/**
 * LES-12 (Test out) and LES-13 (its result). The player runs lesson-core's check plan: question
 * cards only, one try, no hints, no combos. Passed topics are marked learned on the device; nothing
 * is ever marked failed, and leaving early marks nothing.
 */
export default function CheckScreen() {
  const app = useApp();
  const t = useT();
  const haptics = useHaptics();
  const theme = useTheme();
  const locale = useUiState((s) => s.locale);
  const online = useUiState(() => app.deps.network.isOnline());
  const { chapterId, topic } = useLocalSearchParams<{ chapterId: string; topic?: string }>();
  const prepared = useMemo(() => (chapterId ? prepareTestOut(app, chapterId, topic || undefined) : null), [app, chapterId, topic]);
  const sink = useMemo(() => eventSink(app), [app]);
  const sessionRef = useRef<LessonSession | null>(null);
  const [index, setIndex] = useState(0);
  const [exitAsk, setExitAsk] = useState(false);
  const [outcome, setOutcome] = useState<TestOutOutcome | null>(null);
  const toChapter = () => (chapterId ? router.replace({ pathname: '/chapter/[id]', params: { id: chapterId } }) : router.replace('/learn' as Href));

  if (!prepared) {
    return (
      <Screen testID="LES-12-empty" footer={<Button label={t('ui:common.back')} onPress={() => (router.canGoBack() ? router.back() : toChapter())} fullWidth />}>
        <EmptyState illustration="ui-offline" text={t('learn:LRN-06.no_questions')} />
      </Screen>
    );
  }

  if (outcome) return <CheckResult prepared={prepared} outcome={outcome} onDone={toChapter} />;

  const complete = async (s: LessonState) => {
    await sink.drain();
    const o = await saveTestOut(app, prepared, s);
    if (o.marks.length) haptics.success();
    setOutcome(o);
  };

  const leave = async () => {
    setExitAsk(false);
    const session = sessionRef.current;
    if (session) {
      session.dispatch({ type: 'exit' });
      for (const e of session.emitted) sink.push(e);
    }
    await sink.drain();
    if (router.canGoBack()) router.back();
    else toChapter();
  };

  const count = prepared.plan.cards.length;
  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg }]} testID="LES-12">
      <View style={styles.band}>
        <Chip icon="Rocket" tone="primary" label={t('learn:LES-12.test_out_chip', { n: Math.min(index + 1, count), count })} testID="check-chip" />
        {index === 0 ? (
          <Text variant="caption" tone="muted" testID="check-confidence-note">
            {t('learn:LES-12.confidence_note_first_card')}
          </Text>
        ) : null}
      </View>
      <LessonPlayer
        key={`${prepared.plan.topicId}:${locale}`}
        plan={prepared.plan}
        bundle={prepared.bundle}
        config={prepared.config}
        tz={app.deps.timeZone()}
        t={t}
        subject={prepared.subject}
        online={online}
        resolveMedia={(url) => app.deps.content.asset(locale, url)}
        onEvent={sink.push}
        onProgress={(p) => setIndex(p.lastCardIndex)}
        onComplete={(s) => void complete(s)}
        onPreviewEnd={() => undefined}
        onRequestExit={() => setExitAsk(true)}
        haptics={{ tap: haptics.tap, success: haptics.success, error: haptics.warning }}
        clock={() => app.now()}
        newId={(now) => uuidv7(now)}
        sessionRef={sessionRef}
      />
      <Dialog
        open={exitAsk}
        onOpenChange={(o) => (o ? undefined : setExitAsk(false))}
        title={t('learn:LES-05.check_title')}
        description={t('learn:LES-05.check_line')}
        confirm={{ label: t('learn:LES-05.check_buttons.1'), onPress: () => setExitAsk(false) }}
        cancel={{ label: t('learn:LES-05.check_buttons.2'), onPress: () => void leave() }}
        testID="LES-05"
      />
    </View>
  );
}

/** LES-13, Test out variant: one row per topic, [Continue], [Start {topic}], "Undo this". */
function CheckResult({ prepared, outcome, onDone }: { prepared: PreparedCheck; outcome: TestOutOutcome; onDone: () => void }) {
  const app = useApp();
  const t = useT();
  const pet = useAppStore((s) => s.pet);
  const obPet = useUiState((s) => s.onboarding.pet);
  const [undoAsk, setUndoAsk] = useState(false);
  const [undone, setUndone] = useState(false);
  const passed = new Set(outcome.result.passed);
  const n = outcome.result.passed.length;
  const any = n > 0 && !undone;
  const firstWorth = prepared.topics.find((tp) => prepared.checked.has(tp.id) && !passed.has(tp.id));
  const petName = pet?.name ?? obPet?.name ?? '';
  const species = pet?.species ?? obPet?.species ?? 'cat';
  return (
    <Screen
      testID="LES-13"
      footer={
        <View style={styles.gap}>
          <Button label={t('learn:LES-13.test_out_buttons.1')} onPress={onDone} fullWidth testID="check-continue" />
          {firstWorth ? (
            <Button
              variant="secondary"
              label={t('learn:LES-13.test_out_buttons.2', { topic_title: firstWorth.name })}
              onPress={() => router.replace({ pathname: '/lesson/[topicId]', params: { topicId: firstWorth.id, mode: 'deep_dive' } })}
              fullWidth
              testID="check-start-topic"
            />
          ) : null}
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.result}>
        <PetAvatar species={species} mood={any ? 'proud' : 'curious'} size={96} alt={petName ? t(any ? 'learn:LES-13.pet_proud_alt' : 'learn:LES-13.pet_curious_alt', { pet_name: petName }) : undefined} />
        <Text variant="title" heading testID="check-title">
          {any ? t('learn:LES-13.test_out_title', { n }) : t('learn:LES-13.test_out_title_none')}
        </Text>
        <Text variant="body">{any ? t('learn:LES-13.test_out_line') : t('learn:LES-13.test_out_line_none')}</Text>
        <View style={styles.rows}>
          {prepared.topics.map((tp) => {
            const state = !prepared.checked.has(tp.id) ? 'none' : passed.has(tp.id) && !undone ? 'passed' : 'worth';
            return (
              <View key={tp.id} style={styles.row} testID={`check-row-${tp.id}`}>
                <Text variant="label" style={styles.grow}>
                  {tp.name}
                </Text>
                {state === 'passed' ? (
                  <Chip icon="Check" tone="success" label={t('learn:LES-13.chips.3')} />
                ) : state === 'worth' ? (
                  <Chip icon="BookOpen" tone="sunken" label={t('learn:LES-13.chips.2')} />
                ) : (
                  <Chip icon="Minus" tone="sunken" label={t('learn:LES-13.chips.4')} />
                )}
              </View>
            );
          })}
        </View>
        <View style={styles.stat}>
          {outcome.result.unfinished ? null : <Chip tone="primary" icon="Star" label={t('learn:LES-02.xp', { xp: outcome.xp })} />}
          <Text variant="caption" tone="muted" numeric>
            {t('learn:LES-13.score', { correct: outcome.correct, total: outcome.total })}
          </Text>
        </View>
        {outcome.marks.length && !undone ? (
          <Button variant="ghost" icon="ArrowCounterClockwise" label={t('learn:LES-13.undo')} onPress={() => setUndoAsk(true)} testID="check-undo" />
        ) : null}
      </ScrollView>
      <Dialog
        open={undoAsk}
        onOpenChange={(o) => (o ? undefined : setUndoAsk(false))}
        title={t('learn:LES-13.undo_title')}
        description={t('learn:LES-13.undo_body')}
        confirm={{
          label: t('learn:LES-13.undo'),
          onPress: () => {
            setUndoAsk(false);
            void undoTestOut(app, outcome.marks).then(() => setUndone(true));
          },
        }}
        cancel={{ label: t('learn:LES-13.undo_keep'), onPress: () => setUndoAsk(false) }}
        testID="check-undo-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  band: { paddingHorizontal: 16, paddingTop: 8, gap: 6, alignItems: 'flex-start' },
  gap: { gap: 10 },
  grow: { flex: 1 },
  result: { gap: 16, alignItems: 'flex-start', paddingBottom: 24 },
  rows: { alignSelf: 'stretch', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
