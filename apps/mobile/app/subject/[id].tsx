import { Card, Chip, ChoiceChips, EmptyState, IconButton, Illustration, ProChip, ProgressBar, ProgressRing, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { bundledIllustrations } from '../../src/seed/illustrations';
import { useApp, useQueryScope, useT, useUiState } from '../../src/services/context';
import { drillKeys, fetchWeakSpots } from '../../src/services/drill';
import { filterChapters, subjectProgress, unitSections, weakChapters, type ChapterFilter } from '../../src/services/learn';
import { loadTopicStates, type TopicState } from '../../src/services/progress';
import { Screen } from '../../src/ui/Screen';

const FILTERS: ChapterFilter[] = ['all', 'in_progress', 'not_started', 'weak'];

/**
 * LRN-01, the subject map: every chapter of the subject for this exam with its progress, from the
 * manifest and `topic_status` on the device. Free students see Free or Pro on each chapter (the
 * manifest's free chapters); Pro students see neither. "Weak" appears once the server's weak spots
 * cover `learn.weak_filter_min_attempts` answers in the subject (`weakChapters`). Unit headers show
 * only when the manifest names its units.
 */
export default function Subject() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const { id } = useLocalSearchParams<{ id: string }>();
  const subject = app.deps.content.subjects(locale, app.examProfileId()).find((s) => s.id === id);
  const [states, setStates] = useState<Map<string, TopicState>>(new Map());
  const [filter, setFilter] = useState<ChapterFilter>('all');
  const pro = app.isPro();
  const scope = useQueryScope();
  const exam = app.examProfileId();
  const minAttempts = app.flags.get('learn.weak_filter_min_attempts') ?? null;
  // Only asked when the owner has set the threshold; offline or signed out it simply stays hidden.
  const weakQuery = useQuery({ queryKey: drillKeys.weakSpots(scope, exam), queryFn: () => fetchWeakSpots(app), enabled: minAttempts !== null, retry: 1 });
  useFocusEffect(
    useCallback(() => {
      void loadTopicStates(app).then(setStates);
    }, [app]),
  );
  useEffect(() => {
    if (subject) app.track('subject_map_viewed', {});
  }, [app, subject]);
  const progress = useMemo(() => (subject ? subjectProgress(subject, states) : null), [subject, states]);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));
  if (!subject || !progress) {
    return (
      <Screen testID="LRN-01">
        <IconButton icon="CaretLeft" label={t('ui:common.back')} onPress={back} />
      </Screen>
    );
  }
  const art = bundledIllustrations[`subject-${subject.colorFamily}`] ? `subject-${subject.colorFamily}` : null;
  const weak = weakChapters(subject, weakQuery.data, minAttempts);
  const active: ChapterFilter = filter === 'weak' && !weak.offered ? 'all' : filter;
  const shown = filterChapters(subject, progress, active, weak);
  const sections = unitSections(subject, shown);
  const filterLabels: Record<ChapterFilter, string> = { all: t('learn:LRN-01.filters.1'), in_progress: t('learn:LRN-01.filters.2'), not_started: t('learn:LRN-01.filters.3'), weak: t('learn:LRN-01.filters.4') };
  const emptyText = active === 'weak' ? t('learn:LRN-01.weak_filter_empty') : t('learn:LRN-01.empty_filter');

  return (
    <Screen testID="LRN-01">
      <Card tone="tint" subject={subject.colorFamily} size="lg" testID="subject-header">
        <View style={styles.header}>
          <View style={styles.headerText}>
            <IconButton icon="CaretLeft" label={t('ui:common.back')} onPress={back} variant="filled" />
            <Text variant="display" heading tone="subject" subject={subject.colorFamily}>
              {subject.name}
            </Text>
            <Text variant="label" tone="muted" numeric testID="subject-progress">
              {t('learn:LRN-01.progress', { done: progress.done, total: progress.total, percent: progress.percent })}
            </Text>
          </View>
          {art ? <Illustration name={art} decorative width={110} height={110} /> : null}
        </View>
        <ProgressBar value={progress.percent / 100} tone="subject" subject={subject.colorFamily} label={t('learn:LRN-01.ring_a11y', { percent: progress.percent })} />
      </Card>
      <ChoiceChips
        label={t('learn:LRN-01.filters.1')}
        hideLabel
        options={FILTERS.filter((f) => f !== 'weak' || weak.offered).map((f) => ({ value: f, label: filterLabels[f] }))}
        value={[active]}
        onChange={(v) => {
          const next = (v[0] as ChapterFilter | undefined) ?? 'all';
          setFilter(next);
          app.track('subject_filter_changed', {});
        }}
        testID="subject-filters"
      />
      {shown.length === 0 ? <EmptyState illustration="ui-search-empty" alt={emptyText} text={emptyText} testID="subject-empty" /> : null}
      {sections.map((sec) => (
        <View key={sec.unitId || 'all'} style={styles.section}>
          {sec.name ? (
            <View style={styles.unitHead} testID={`unit-${sec.unitId}`}>
              <Text variant="heading" heading>
                {sec.name}
              </Text>
              <Text variant="caption" tone="muted" numeric>
                {t('learn:LRN-01.unit_meta', { n: sec.chapters.length })}
              </Text>
            </View>
          ) : null}
          {sec.chapters.map((c) => {
            const n = subject.chapters.indexOf(c) + 1;
            const cp = progress.chapters.get(c.id)!;
            const chip = pro ? null : c.free ? t('practice:MOCK-01.free_chip') : null;
            return (
              <Card
                key={c.id}
                onPress={() => router.push({ pathname: '/chapter/[id]', params: { id: c.id } })}
                accessibilityLabel={`${t('learn:LRN-01.chapter_kicker', { n })}, ${c.name}, ${t('learn:LRN-01.ring_a11y', { percent: cp.percent })}`}
                testID={`chapter-${c.id}`}
              >
                <View style={styles.row}>
                  <View style={styles.grow}>
                    <Text variant="caption" tone="subject" subject={subject.colorFamily}>
                      {t('learn:LRN-01.chapter_kicker', { n })}
                    </Text>
                    <Text variant="heading" numberOfLines={3}>
                      {c.name}
                    </Text>
                    <View style={styles.chips}>
                      {chip ? <Chip kind="status" tone="success" label={chip} /> : null}
                      {!pro && !c.free ? <ProChip /> : null}
                    </View>
                  </View>
                  <ProgressRing value={cp.percent / 100} size={44} stroke={6} tone="subject" subject={subject.colorFamily} label={t('learn:LRN-01.ring_a11y', { percent: cp.percent })} centerText={`${cp.percent}`} />
                </View>
              </Card>
            );
          })}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 12 },
  headerText: { flex: 1, gap: 6, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 },
  grow: { flex: 1, gap: 4 },
  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  section: { gap: 12 },
  unitHead: { gap: 2, marginTop: 8 },
});
