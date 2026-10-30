import { Card, Chip, ChoiceChips, EmptyState, IconButton, Illustration, ProChip, ProgressBar, ProgressRing, Text } from '@smriti/ui-native';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { bundledIllustrations } from '../../src/seed/illustrations';
import { useApp, useT, useUiState } from '../../src/services/context';
import { filterChapters, subjectProgress, type ChapterFilter } from '../../src/services/learn';
import { loadTopicStates, type TopicState } from '../../src/services/progress';
import { Screen } from '../../src/ui/Screen';

const FILTERS: ChapterFilter[] = ['all', 'in_progress', 'not_started'];

/**
 * LRN-01, the subject map: every chapter of the subject for this exam with its progress, from the
 * manifest and `topic_status` on the device. Free students see Free or Pro on each chapter (the
 * manifest's free chapters); Pro students see neither. The "Weak" filter waits for real attempt
 * data (`learn.weak_filter_min_attempts`), so it is not offered yet.
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
  const shown = filterChapters(subject, progress, filter);
  const filterLabels: Record<ChapterFilter, string> = { all: t('learn:LRN-01.filters.1'), in_progress: t('learn:LRN-01.filters.2'), not_started: t('learn:LRN-01.filters.3') };

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
        options={FILTERS.map((f) => ({ value: f, label: filterLabels[f] }))}
        value={[filter]}
        onChange={(v) => {
          const next = (v[0] as ChapterFilter | undefined) ?? 'all';
          setFilter(next);
          app.track('subject_filter_changed', {});
        }}
        testID="subject-filters"
      />
      {shown.length === 0 ? <EmptyState illustration="ui-search-empty" alt={t('learn:LRN-01.empty_filter')} text={t('learn:LRN-01.empty_filter')} /> : null}
      {shown.map((c) => {
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 12 },
  headerText: { flex: 1, gap: 6, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 },
  grow: { flex: 1, gap: 4 },
  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
});
