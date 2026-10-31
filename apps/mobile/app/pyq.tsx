import { Banner, Button, Card, Chip, ChoiceChips, EmptyState, Icon, IconButton, ProgressBar, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../src/services/context';
import { drillKeys, listPyqPapers, listPyqs, pyqMockId, sourceHost, type PyqFilters } from '../src/services/drill';
import { examName } from '../src/services/exams';
import { listAttempts } from '../src/services/mocks';
import { activeFilterCount, applyPyqFilters, PyqFilterSheet } from '../src/ui/PyqFilters';
import { BackHeader, Screen } from '../src/ui/Screen';

const VIEW_KEY = 'pyq-view';

/**
 * PRC-07, the PYQ bank: by topic (chapters with their PYQ count, years and solved count) or by
 * paper (grouped by year, each with its official source). Everything comes from `/v1/pyq` and
 * `/v1/pyq/papers`; an exam with no ingested papers shows the plain empty state.
 */
export default function PyqBank() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const exam = app.examProfileId();
  const examShort = examName(app, exam) ?? app.appName();
  const [view, setView] = useState<'topic' | 'paper'>('topic');
  const [filters, setFilters] = useState<PyqFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [subject, setSubject] = useState<string | null>(null);
  const pyqs = useQuery({ queryKey: drillKeys.pyqs(scope, exam, null), queryFn: () => listPyqs(app) });
  const papers = useQuery({ queryKey: drillKeys.papers(scope, exam), queryFn: () => listPyqPapers(app), enabled: view === 'paper' });
  const attempts = useQuery({ queryKey: ['smriti', 'attempts', scope], queryFn: () => listAttempts(app), enabled: view === 'paper' });

  useEffect(() => {
    void app.deps.stores.kv
      .get(VIEW_KEY)
      .then((v) => (v === 'paper' || v === 'topic') && setView(v))
      .catch(() => undefined);
  }, [app]);
  const pickView = (v: 'topic' | 'paper') => {
    setView(v);
    app.track('pyq_bank_viewed', { view: v });
    void app.deps.stores.kv.set(VIEW_KEY, v).catch(() => undefined);
  };

  const subjects = useMemo(() => app.deps.content.subjects(locale, exam), [app, locale, exam]);
  const chapterName = (id: string) => subjects.flatMap((s) => s.chapters).find((c) => c.id === id)?.name ?? id;
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? id;
  const all = pyqs.data ?? [];
  const filtered = applyPyqFilters(all, { ...filters, subject: subject ?? filters.subject ?? null });
  const subjectIds = [...new Set(all.map((q) => q.subject_id).filter((x): x is string => Boolean(x)))];

  const chapters = useMemo(() => {
    const by = new Map<string, { id: string; count: number; solved: number; years: number[] }>();
    for (const q of filtered) {
      const id = q.chapter_id ?? '';
      if (!id) continue;
      const row = by.get(id) ?? { id, count: 0, solved: 0, years: [] };
      row.count++;
      if (q.status === 'correct') row.solved++;
      row.years.push(q.year);
      by.set(id, row);
    }
    return [...by.values()];
  }, [filtered]);

  const byYear = useMemo(() => {
    const groups = new Map<number, NonNullable<typeof papers.data>>();
    for (const p of papers.data ?? []) groups.set(p.year, [...(groups.get(p.year) ?? []), p]);
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [papers.data]);

  const paperStatus = (paperId: string) => {
    const a = (attempts.data ?? []).filter((x) => x.mock_id === pyqMockId(paperId));
    if (a.some((x) => x.status === 'in_progress')) return t('practice:PRC-07.in_progress');
    const done = a.find((x) => x.score !== null);
    return done ? `${done.score}/${done.max_score ?? ''}` : t('practice:PRC-07.not_started');
  };

  const nFilters = activeFilterCount(filters);
  const loading = view === 'topic' ? pyqs.isPending : papers.isPending;
  const failed = view === 'topic' ? pyqs.isError : papers.isError;
  const empty = view === 'topic' ? pyqs.data && all.length === 0 : papers.data && papers.data.length === 0;

  return (
    <Screen testID="PRC-07">
      <BackHeader
        title={t('practice:PRC-07.title')}
        backLabel={t('ui:common.back')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/practice' as Href))}
        trailing={<IconButton icon="Sliders" label={`${t('practice:PRC-08.title')}${nFilters ? ` (${nFilters})` : ''}`} onPress={() => setFilterOpen(true)} testID="pyq-filters" />}
      />
      <ChoiceChips
        label={t('practice:PRC-07.title')}
        hideLabel
        options={[
          { value: 'topic', label: t('practice:PRC-07.by_topic') },
          { value: 'paper', label: t('practice:PRC-07.by_paper') },
        ]}
        value={[view]}
        onChange={(v) => pickView((v[0] as 'topic' | 'paper') ?? 'topic')}
        testID="pyq-view"
      />
      {nFilters ? (
        <View style={styles.chips}>
          <Chip kind="filter" label={`${t('practice:PRC-08.title')} · ${nFilters}`} selected onPress={() => setFilters({})} accessibilityLabel={t('practice:PRC-07.clear_filters')} />
        </View>
      ) : null}
      {loading ? <Spinner label={t('practice:PRC-07.title')} /> : null}
      {failed ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void (view === 'topic' ? pyqs.refetch() : papers.refetch()) }} /> : null}
      {empty ? <EmptyState illustration="ui-all-caught-up" alt="" text={t('practice:PRC-07.empty_no_pyqs_yet', { exam_short: examShort })} testID="pyq-empty" /> : null}

      {view === 'topic' && all.length > 0 ? (
        <>
          {subjectIds.length > 1 ? (
            <ChoiceChips label={t('practice:PRC-08.subject')} hideLabel options={subjectIds.map((s) => ({ value: s, label: subjectName(s) }))} value={subject ? [subject] : []} onChange={(v) => setSubject(v[0] ?? null)} />
          ) : null}
          {chapters.length === 0 ? (
            <View style={styles.center}>
              <Text variant="body" tone="muted">
                {t('practice:PRC-07.filter_empty')}
              </Text>
              <Button variant="ghost" label={t('practice:PRC-07.clear_filters')} onPress={() => (setFilters({}), setSubject(null))} />
            </View>
          ) : null}
          {chapters.map((c) => (
            <Card
              key={c.id}
              outlined
              onPress={() => router.push({ pathname: '/pyq-chapter/[id]', params: { id: c.id } })}
              accessibilityLabel={`${chapterName(c.id)}. ${t('practice:PRC-07.chapter_caption', { pyq_count: c.count, first_year: Math.min(...c.years), last_year: Math.max(...c.years) })}. ${t('practice:PRC-07.solved', { solved: c.solved })}`}
              testID={`pyq-chapter-${c.id}`}
            >
              <View style={styles.row}>
                <View style={[styles.grow, styles.gap]}>
                  <Text variant="label">{chapterName(c.id)}</Text>
                  <Text variant="caption" tone="muted" numeric>
                    {t('practice:PRC-07.chapter_caption', { pyq_count: c.count, first_year: Math.min(...c.years), last_year: Math.max(...c.years) })}
                  </Text>
                  <ProgressBar value={c.count ? c.solved / c.count : 0} tone="primary" label={t('practice:PRC-07.solved', { solved: c.solved })} valueText={t('practice:PRC-07.solved', { solved: c.solved })} />
                  <Text variant="caption" tone="muted" numeric>
                    {t('practice:PRC-07.solved', { solved: c.solved })}
                  </Text>
                </View>
                <Icon name="CaretRight" color="inkMuted" />
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {view === 'paper'
        ? byYear.map(([year, list]) => (
            <View key={year} style={styles.gap}>
              <Text variant="heading" numeric>
                {String(year)}
              </Text>
              {list.map((p) => {
                const host = sourceHost(p.source_url);
                return (
                  <Card
                    key={p.id}
                    outlined
                    onPress={() => {
                      app.track('pyq_paper_opened', { paper_id: p.id, action: 'open' });
                      router.push({ pathname: '/pyq-paper/[id]', params: { id: p.id } });
                    }}
                    accessibilityLabel={`${examShort} ${p.year}, ${p.session_label ?? ''}. ${t('practice:PRC-07.paper_caption', { question_count: p.question_count, held_on: p.held_on ?? '' })}. ${host ? t('practice:PRC-07.source', { source_host: host }) : ''}. ${paperStatus(p.id)}`}
                    testID={`pyq-paper-${p.id}`}
                  >
                    <View style={styles.row}>
                      <View style={[styles.grow, styles.gap]}>
                        <Text variant="label">{t('practice:PRC-07.paper_row', { exam_short: examShort, year: p.year, session_label: p.session_label ?? '' })}</Text>
                        <Text variant="caption" tone="muted" numeric>
                          {p.held_on ? t('practice:PRC-07.paper_caption', { question_count: p.question_count, held_on: p.held_on }) : t('practice:PRC-07.paper_caption.1', { question_count: p.question_count })}
                        </Text>
                        {host ? (
                          <View style={styles.row}>
                            <Icon name="ShieldCheck" size={16} color="success" label={t('practice:PRC-18.source')} />
                            <Text variant="caption" tone="muted">
                              {t('practice:PRC-07.source', { source_host: host })}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text variant="caption" tone="muted" numeric>
                        {paperStatus(p.id)}
                      </Text>
                      <Icon name="CaretRight" color="inkMuted" />
                    </View>
                  </Card>
                );
              })}
            </View>
          ))
        : null}

      <Text variant="caption" tone="muted" align="center">
        {t('practice:PRC-07.footer')}
      </Text>
      <PyqFilterSheet key={filterOpen ? "open" : "closed"} open={filterOpen} onOpenChange={setFilterOpen} items={all} value={filters} onApply={setFilters} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  gap: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 16 },
});
