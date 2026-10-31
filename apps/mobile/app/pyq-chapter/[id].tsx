import { ApiError } from '@smriti/api-client';
import { Banner, Button, Card, Chip, CitationChip, EmptyState, Icon, IconButton, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../../src/services/context';
import { createSession, deviceQuestion, DrillRunner, drillKeys, keepRunner, listPyqs, type PyqFilters, type PyqQuestion } from '../../src/services/drill';
import { examName } from '../../src/services/exams';
import { fetchPracticeHub, practiceKeys } from '../../src/services/practice';
import { FreeLimitSheet } from '../../src/ui/FreeLimitSheet';
import { activeFilterCount, applyPyqFilters, PyqFilterSheet } from '../../src/ui/PyqFilters';
import { PyqSourceSheet } from '../../src/ui/PyqSourceSheet';
import { BackHeader, Screen } from '../../src/ui/Screen';

const STATUS_ICON = { correct: 'CheckCircle', wrong: 'XCircle', not_tried: null } as const;

/** First words of a stem, for the card preview (2 lines). */
function preview(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\$[^$]*\$/g, '…').slice(0, 140) : '';
}

/**
 * PRC-09, every PYQ for one chapter, newest first, each with its paper. Tapping a card starts a
 * session at that question with the rest queued after it; sessions are sized to the free count.
 */
export default function ChapterPyqs() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const exam = app.examProfileId();
  const examShort = examName(app, exam) ?? app.appName();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chapterId = String(id);
  const list = useQuery({ queryKey: drillKeys.pyqs(scope, exam, chapterId), queryFn: () => listPyqs(app, { chapter: chapterId }) });
  const hub = useQuery({ queryKey: practiceKeys.hub(scope, exam), queryFn: () => fetchPracticeHub(app) });
  const [filters, setFilters] = useState<PyqFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [source, setSource] = useState<PyqQuestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [problem, setProblem] = useState(false);
  const chapter = useMemo(() => app.deps.content.subjects(locale, exam).flatMap((s) => s.chapters).find((c) => c.id === chapterId), [app, chapterId, exam, locale]);
  const all = useMemo(() => [...(list.data ?? [])].sort((a, b) => b.year - a.year || a.number - b.number), [list.data]);
  const shown = applyPyqFilters(all, filters);
  const papers = new Set(all.map((q) => q.paper_id)).size;
  const wrong = all.filter((q) => q.status === 'wrong');
  const quota = hub.data?.limits.practice_questions;
  const remaining = quota && !quota.unlimited ? (quota.remaining ?? 0) : null;

  const practise = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    setProblem(false);
    try {
      const s = await createSession(app, { mode: 'drill', question_ids: ids.slice(0, 50), count: Math.min(ids.length, 50), difficulty: 'adaptive', source: 'pyq' });
      keepRunner(new DrillRunner(app, s, { feedback: 'after_each', timed: false, concepts: [], topicId: null, chapterTest: false }));
      router.push({ pathname: '/session/[id]', params: { id: s.id } });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'free_limit_reached') setLimitOpen(true);
      else setProblem(true);
    }
    setBusy(false);
  };
  const from = (q: PyqQuestion) => {
    const i = shown.findIndex((x) => x.question_id === q.question_id);
    return [...shown.slice(i), ...shown.slice(0, i)].map((x) => x.question_id);
  };

  const n = shown.length;
  const footer =
    n > 0 ? (
      <View style={styles.gap}>
        <Button
          label={remaining !== null && remaining < n ? t('practice:PRC-09.practise_remaining', { remaining }) : t('practice:PRC-09.practise_all', { n })}
          loading={busy}
          disabled={remaining === 0}
          onPress={() => void practise(shown.map((q) => q.question_id))}
          testID="pyq-practise-all"
        />
        {wrong.length > 0 ? <Button variant="secondary" label={t('practice:PRC-09.only_wrong')} onPress={() => void practise(wrong.map((q) => q.question_id))} testID="pyq-only-wrong" /> : null}
      </View>
    ) : undefined;

  return (
    <Screen testID="PRC-09" footer={footer}>
      <BackHeader
        title={chapter?.name ?? chapterId}
        backLabel={t('ui:common.back')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/pyq' as Href))}
        trailing={<IconButton icon="Sliders" label={`${t('practice:PRC-08.title')}${activeFilterCount(filters) ? ` (${activeFilterCount(filters)})` : ''}`} onPress={() => setFilterOpen(true)} />}
      />
      {list.data ? (
        <Text variant="caption" tone="muted" numeric>
          {t('practice:PRC-09.subtitle', { n: all.length, paper_count: papers })}
        </Text>
      ) : null}
      {remaining !== null ? (
        <Text variant="caption" tone="muted">
          {t('practice:PRC-09.free_note')}
        </Text>
      ) : null}
      <View style={styles.chips}>
        <Chip kind="filter" label={t('practice:PRC-09.newest_first')} selected />
      </View>
      {list.isPending ? <Spinner label={t('practice:PRC-07.title')} /> : null}
      {list.isError ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void list.refetch() }} /> : null}
      {problem ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} /> : null}
      {list.data && all.length === 0 ? <EmptyState illustration="ui-all-caught-up" alt="" text={t('practice:PRC-09.empty')} /> : null}
      {shown.map((q) => {
        const body = deviceQuestion(app, q.topic_id, q.question_id);
        const stem = preview((body as { stem?: unknown } | null)?.stem);
        const status = q.status === 'correct' ? t('practice:PRC-08.correct') : q.status === 'wrong' ? t('practice:PRC-08.wrong') : t('practice:PRC-08.not_tried');
        const icon = STATUS_ICON[q.status];
        return (
          <Card key={q.question_id} outlined onPress={() => void practise(from(q))} accessibilityLabel={`${examShort} ${q.year}, ${q.session_label ?? ''}. ${q.difficulty ? t(`practice:PRC-03.${q.difficulty}` as 'practice:PRC-03.easy') : ''}. ${status}. ${stem}`} testID={`pyq-q-${q.question_id}`}>
            <View style={styles.gap}>
              <View style={styles.row}>
                <CitationChip examShort={examShort} year={q.year} sessionLabel={q.session_label ?? ''} onPress={() => setSource(q)} />
                <View style={styles.grow} />
                {icon ? <Icon name={icon} color={q.status === 'correct' ? 'success' : 'error'} label={status} /> : null}
              </View>
              {stem ? (
                <Text variant="body" numberOfLines={2}>
                  {stem}
                </Text>
              ) : null}
              <View style={styles.chips}>{q.difficulty ? <Chip label={t(`practice:PRC-03.${q.difficulty}` as 'practice:PRC-03.easy')} tone="neutral" /> : null}</View>
            </View>
          </Card>
        );
      })}
      <PyqFilterSheet key={filterOpen ? 'open' : 'closed'} open={filterOpen} onOpenChange={setFilterOpen} items={all} value={filters} onApply={setFilters} />
      <PyqSourceSheet paperId={source?.paper_id ?? null} number={source?.number ?? null} onClose={() => setSource(null)} />
      <FreeLimitSheet open={limitOpen} onOpenChange={setLimitOpen} kind="daily_cap" limit={quota?.limit ?? null} trigger="practice_limit" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  gap: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
