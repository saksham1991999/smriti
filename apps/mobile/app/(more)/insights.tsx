import type { components } from '@smriti/api-client';
import type { MessageKey } from '@smriti/i18n';
import { Card, Icon, PetLine, ProgressBar, Spinner, StatTile, Text, useTheme } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../src/services/context';
import { BackHeader, Screen, Stack } from '../../src/ui/Screen';

type S = components['schemas'];

const LEVEL_KEY: Record<string, MessageKey> = { sure: 'memory_labs:MEM-03.sure', fifty: 'memory_labs:MEM-03.fifty', guess: 'memory_labs:MEM-03.guess' };

/**
 * Insights from the learner's own answers and schedule (MEM-25 calibration, the fading topics
 * from `/v1/insights/weak-areas`, and tonight's sleep review). Every number is the API's: the
 * calibration chart appears only once the owner-set number of tagged answers exists, and before
 * that the screen says how many more are needed.
 */
export default function Insights() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const get = async <T,>(p: '/v1/insights/calibration' | '/v1/insights/weak-areas' | '/v1/insights/sleep-review'): Promise<T | null> => {
    await app.ensureSession();
    const r = await app.api.GET(p).catch(() => null);
    return (r?.data as T | undefined) ?? null;
  };
  const cal = useQuery({ queryKey: ['insights', 'calibration'], queryFn: () => get<S['CalibrationOut']>('/v1/insights/calibration') });
  const weak = useQuery({ queryKey: ['insights', 'weak'], queryFn: () => get<S['WeakAreasOut']>('/v1/insights/weak-areas') });
  const sleep = useQuery({ queryKey: ['insights', 'sleep'], queryFn: () => get<S['SleepReviewOut']>('/v1/insights/sleep-review') });
  const pet = app.store.getState().pet;
  const exam = app.examProfileId();
  const tracked = useRef(false);
  useEffect(() => {
    if (!cal.data || tracked.current) return;
    tracked.current = true;
    app.track('metacog_viewed', { range: 'all', has_enough_data: cal.data.shown });
  }, [app, cal.data]);
  const topicName = (id: string) => app.deps.content.topic(locale, id, exam)?.name ?? null;

  return (
    <Screen testID="MEM-25">
      <BackHeader title={t('memory_labs:MEM-25.title')} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/learn' as Href))} />
      {cal.isPending ? <Spinner label={t('memory_labs:MEM-25.title')} /> : null}
      {cal.data ? <Calibration c={cal.data} petName={pet?.name ?? ''} species={pet?.species === 'dog' ? 'dog' : 'cat'} /> : null}

      {weak.data?.topics.length ? (
        <Stack gap={8}>
          <Text variant="heading" heading>
            {t('practice:PRC-02.reason_fading')}
          </Text>
          {weak.data.topics.map((w) => {
            const name = topicName(w.topic_id);
            if (!name) return null; // a topic this exam's content doesn't carry
            return (
              <FadingRow
                key={w.topic_id}
                label={t('learn:HOME-01.secondary_fading_phase_2', { topic_title: name, n: w.cards })}
                onPress={() => router.push({ pathname: '/review', params: { topic: w.topic_id } } as unknown as Href)}
                testID={`fading-${w.topic_id}`}
              />
            );
          })}
        </Stack>
      ) : null}

      {sleep.data && (sleep.data.eligible || sleep.data.reason === 'not_confident') ? (
        <Card testID="sleep-review">
          <Stack gap={4}>
            <Stack row gap={8}>
              <Icon name="Moon" size={20} color="primary" />
              <Text variant="heading">{t('memory_labs:MEM-06.sleep')}</Text>
            </Stack>
            <Text variant="body" tone="muted">
              {t('memory_labs:MEM-06.sleep_sub')}
            </Text>
            <Text variant="label" numeric testID="sleep-bedtime">
              {sleep.data.eligible && sleep.data.bedtime ? t('memory_labs:MEM-06.bedtime', { time: clock(app, sleep.data.bedtime) }) : t('memory_labs:MEM-06.bedtime_none')}
            </Text>
          </Stack>
        </Card>
      ) : null}
    </Screen>
  );
}

function Calibration({ c, petName, species }: { c: S['CalibrationOut']; petName: string; species: 'cat' | 'dog' }) {
  const t = useT();
  if (!c.shown) {
    const k = c.needed !== null && c.needed !== undefined ? Math.max(0, c.needed - c.tagged) : null;
    return (
      <Stack gap={12}>
        <PetLine pet={{ species, mood: 'curious' }} petName={petName} text={t('memory_labs:MEM-25.pet_empty')} />
        {k !== null ? (
          <Text variant="body" tone="muted" testID="mem25-empty">
            {t('memory_labs:MEM-25.empty', { k })}
          </Text>
        ) : null}
      </Stack>
    );
  }
  const levels = c.levels ?? [];
  const sure = levels.find((l) => l.confidence === 'sure');
  const guess = levels.find((l) => l.confidence === 'guess');
  const sureWrong = sure ? sure.answers - sure.correct : 0;
  return (
    <Stack gap={12}>
      <View style={styles.tiles}>
        <StatTile style={styles.tile} icon="Warning" value={String(sureWrong)} label={t('memory_labs:MEM-25.sure_wrong')} testID="mem25-sure-wrong" />
        <StatTile style={styles.tile} icon="Question" value={String(guess?.correct ?? 0)} label={t('memory_labs:MEM-25.lucky')} testID="mem25-lucky" />
      </View>
      <Card>
        <Stack gap={14}>
          {levels.map((l) => {
            const pct = l.accuracy === null ? 0 : Math.round(l.accuracy * 100);
            const text = t('memory_labs:MEM-25.bar_label', { pct, count: l.answers });
            return (
              <Stack key={l.confidence} gap={6}>
                <View style={styles.barHead}>
                  <Text variant="label">{t(LEVEL_KEY[l.confidence] ?? 'memory_labs:MEM-03.sure')}</Text>
                  <Text variant="caption" tone="muted" numeric>
                    {text}
                  </Text>
                </View>
                <ProgressBar value={l.accuracy ?? 0} tone="primary" label={t(LEVEL_KEY[l.confidence] ?? 'memory_labs:MEM-03.sure')} valueText={text} testID={`mem25-bar-${l.confidence}`} />
              </Stack>
            );
          })}
          <Text variant="caption" tone="muted">
            {t('memory_labs:MEM-25.chart_note')}
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}

function FadingRow({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} style={[styles.row, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md }]}>
      <Icon name="ArrowCounterClockwise" size={24} color="primary" />
      <Text variant="label" style={styles.grow}>
        {label}
      </Text>
      <Icon name="CaretRight" size={20} color="inkMuted" />
    </Pressable>
  );
}

/** "22:30:00" from the API as a local clock time in the app's language. */
function clock(app: ReturnType<typeof useApp>, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h ?? 0, m ?? 0));
  return new Intl.DateTimeFormat(app.ui.getState().locale === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16 },
  grow: { flex: 1 },
});
