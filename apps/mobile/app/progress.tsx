import { useAttempts, usePracticeSessions } from '@smriti/api-client/react';
import { Button, Card, ChoiceChips, Illustration, ProgressBar, Spinner, Text } from '@smriti/ui-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../src/services/context';
import { mockTrend, periodStart, practiceStats, type Period } from '../src/services/history';
import { loadTopicStates, type TopicState } from '../src/services/progress';
import { BuddyLine } from '../src/ui/Onboarding';
import { BackHeader, Screen } from '../src/ui/Screen';

const PERIODS: Period[] = ['7d', '30d', 'all'];
const MIN_MOCKS_FOR_TREND = 2;

/**
 * PRC-14, "Your progress", from real data only: practice answered and accuracy for the period
 * (`/v1/practice/sessions`), the mock score trend (`/v1/attempts`) and how much of the syllabus
 * has been touched (`topic_status`). Readiness, accuracy vs speed, confidence and mistake types
 * need an analytics endpoint the API does not have yet, so those cards are not shown.
 */
export default function Progress() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const [period, setPeriod] = useState<Period>('30d');
  const sessions = usePracticeSessions(100);
  const attempts = useAttempts(100);
  const [states, setStates] = useState<Map<string, TopicState>>(new Map());
  useFocusEffect(
    useCallback(() => {
      void loadTopicStates(app).then(setStates);
    }, [app]),
  );
  const since = periodStart(period, app.now());
  const stats = useMemo(() => practiceStats(sessions.data ?? [], since), [sessions.data, since]);
  const trend = useMemo(() => mockTrend(attempts.data ?? [], locale, since), [attempts.data, locale, since]);
  const all = [...states.values()];
  const covered = all.length ? Math.round((all.filter((s) => s.status !== 'not_started').length / all.length) * 100) : 0;
  const empty = !sessions.isPending && !attempts.isPending && (sessions.data?.length ?? 0) === 0 && trend.length === 0 && covered === 0;
  const withData = [stats.answered > 0, trend.length >= MIN_MOCKS_FOR_TREND, covered > 0].filter(Boolean).length;
  useEffect(() => {
    if (!sessions.isPending) app.track('analytics_viewed', { period, cards_with_data: withData });
  }, [app, period, sessions.isPending, withData]);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/practice' as Href));
  const periodLabel: Record<Period, string> = { '7d': t('practice:PRC-14.7_days'), '30d': t('practice:PRC-14.30_days'), all: t('practice:PRC-14.all_time') };

  return (
    <Screen testID="PRC-14">
      <BackHeader title={t('practice:PRC-14.title')} backLabel={t('ui:common.back')} onBack={back} />
      <ChoiceChips label={t('practice:PRC-14.title')} hideLabel options={PERIODS.map((p) => ({ value: p, label: periodLabel[p] }))} value={[period]} onChange={(v) => setPeriod((v[0] as Period | undefined) ?? '30d')} testID="progress-period" />
      {sessions.isPending ? <Spinner label={t('practice:PRC-14.title')} /> : null}

      {empty ? (
        <View style={styles.center} testID="progress-empty">
          <Illustration name="ui-search-empty" decorative width={220} height={165} />
          <BuddyLine text={t('practice:PRC-14.pet_line_empty_dashboard')} />
          <Button label={t('practice:PRC-01.tile_concept_drill')} icon="Barbell" onPress={() => router.push({ pathname: '/drill', params: { source: 'analytics' } })} />
        </View>
      ) : (
        <>
          <Card testID="progress-practice">
            <View style={styles.gap}>
              <Text variant="heading">{t('practice:PRC-14.weekly_accuracy')}</Text>
              <Text variant="title" numeric testID="progress-practice-line">
                {stats.accuracy !== null ? t('practice:PRC-16.row_meta', { answered: stats.answered, accuracy: stats.accuracy }) : t('practice:PRC-16.row_meta.1', { answered: stats.answered })}
              </Text>
              {stats.accuracy !== null ? <ProgressBar value={stats.accuracy / 100} tone="success" label={t('practice:PRC-15.chapter_meta.1', { accuracy: stats.accuracy })} /> : null}
              <Button variant="secondary" size="sm" label={t('practice:PRC-14.practise_weak_spots')} onPress={() => router.push('/weak-spots' as Href)} testID="progress-weak" />
            </View>
          </Card>

          <Card testID="progress-trend">
            <View style={styles.gap}>
              <Text variant="heading">{t('practice:PRC-14.trend')}</Text>
              <Text variant="caption" tone="muted">
                {t('practice:PRC-14.mock_scores')}
              </Text>
              {trend.length >= MIN_MOCKS_FOR_TREND ? (
                trend.map((p) => (
                  <View key={p.id} style={styles.gapSm}>
                    <View style={styles.row}>
                      <Text variant="label" numberOfLines={1} style={styles.grow}>
                        {p.title}
                      </Text>
                      <Text variant="label" numeric>{`${p.pct}%`}</Text>
                    </View>
                    <ProgressBar value={p.pct / 100} tone="primary" label={`${p.title} ${p.pct}%`} />
                  </View>
                ))
              ) : (
                <View style={styles.gapSm}>
                  <Text variant="body">{t('practice:PRC-14.card_empty_mocks', { n: MIN_MOCKS_FOR_TREND - trend.length })}</Text>
                  <Button size="sm" variant="ghost" label={t('practice:PRC-01.tile_mock_tests')} onPress={() => router.push('/mocks' as Href)} />
                </View>
              )}
            </View>
          </Card>

          <Card testID="progress-covered">
            <View style={styles.gap}>
              <Text variant="heading" numeric>
                {t('practice:PRC-14.covered', { covered })}
              </Text>
              <ProgressBar value={covered / 100} tone="primary" label={t('practice:PRC-14.covered', { covered })} />
            </View>
          </Card>

          <Button variant="ghost" icon="Brain" label={t('practice:PRC-14.memory_link')} onPress={() => router.push('/memory' as Href)} />
          <Button variant="ghost" icon="Clock" label={t('practice:PRC-16.title')} onPress={() => router.push('/practice-history' as Href)} testID="progress-history" />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 10 },
  gapSm: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  center: { alignItems: 'center', gap: 12 },
});
