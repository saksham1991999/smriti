import { checkAnswer, type Answer, type AnyQuestion, type CheckResult } from '@smriti/lesson-core';
import { QuestionView, RichText } from '@smriti/lesson-player-native';
import { Banner, Button, Card, ChoiceChips, Chip, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../../src/services/context';
import { fetchSolutions, fromServerAnswer, localQuestion } from '../../src/services/mocks';
import { QuestionHost } from '../../src/ui/QuestionHost';
import { BackHeader, Screen } from '../../src/ui/Screen';

type Filter = 'all' | 'wrong' | 'skipped';
type Item = { question_id: string; position: number; status: string; marks: number; your_answer: Record<string, unknown> | null; question: Record<string, unknown>; solution: Record<string, unknown> };

const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');

/** MOCK-22: every question with your answer, the key, marks and the worked solution. */
export default function SolutionsScreen() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sols = useQuery({ queryKey: ['smriti', 'solutions', scope, id, locale], queryFn: () => fetchSolutions(app, String(id)) });
  const [filter, setFilter] = useState<Filter>('all');
  const items = ((sols.data?.items ?? []) as Item[]).filter((i) => filter === 'all' || i.status === filter);

  return (
    <Screen testID="MOCK-22">
      <BackHeader title={t('practice:MOCK-22.title')} backLabel={t('ui:common.back')} onBack={() => router.back()} />
      <ChoiceChips
        label={t('practice:MOCK-22.title')}
        hideLabel
        options={[
          { value: 'all', label: t('practice:MOCK-22.all') },
          { value: 'wrong', label: t('practice:MOCK-22.wrong') },
          { value: 'skipped', label: t('practice:MOCK-22.skipped') },
        ]}
        value={[filter]}
        onChange={(v) => setFilter(((Array.isArray(v) ? v[0] : v) as Filter) ?? 'all')}
        testID="sol-filter"
      />
      {sols.isPending ? <Spinner label={t('practice:MOCK-22.title')} /> : null}
      {sols.isError ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void sols.refetch() }} /> : null}
      {sols.data && items.length === 0 ? <Text variant="body" tone="muted">{t('practice:MOCK-22.filter_empty')}</Text> : null}
      <QuestionHost>
        {items.map((i) => (
          <SolutionCard key={i.question_id} item={i} locale={locale} />
        ))}
      </QuestionHost>
    </Screen>
  );
}

function SolutionCard({ item, locale }: { item: Item; locale: 'en' | 'hi' }) {
  const t = useT();
  const q = localQuestion({ ...item.question, answer: item.solution.answer }, locale) as AnyQuestion & { answer?: unknown };
  const yours = fromServerAnswer(item.your_answer);
  let result: CheckResult | null = null;
  try {
    result = yours && q.answer ? checkAnswer(q, yours) : null;
  } catch {
    result = null;
  }
  const sol = (localQuestion(item.solution, locale) as unknown as { solution?: { feynman?: unknown; steps?: unknown[]; shortcut?: unknown } }).solution;
  const marks = item.marks > 0 ? t('practice:MOCK-22.marks_plus', { n: item.marks }) : item.marks < 0 ? t('practice:MOCK-22.marks_minus', { n: Math.abs(item.marks) }) : t('practice:MOCK-22.marks_zero');
  return (
    <Card outlined testID={`sol-${item.position}`}>
      <View style={styles.gap}>
        <View style={styles.row}>
          <Text variant="heading" numeric style={styles.flex}>
            {t('practice:MOCK-07.question_n', { n: item.position })}
          </Text>
          <Chip label={marks} tone={item.marks > 0 ? 'success' : item.marks < 0 ? 'error' : 'neutral'} />
        </View>
        {item.status === 'not_scored' ? <Text variant="caption" tone="muted">{t('practice:MOCK-22.not_scored')}</Text> : null}
        <QuestionView question={q} passage={null} draft={(yours ?? { kind: 'options', optionIds: [] }) as Answer} onChange={() => undefined} result={result} struck={[]} disabled />
        {sol ? (
          <View style={styles.gapSm}>
            {textOf(sol.feynman) ? <RichText text={textOf(sol.feynman)} /> : null}
            {(sol.steps ?? []).map((s, n) => (textOf(s) ? <RichText key={n} text={`${n + 1}. ${textOf(s)}`} /> : null))}
            {textOf(sol.shortcut) ? <RichText text={textOf(sol.shortcut)} tone="muted" /> : null}
          </View>
        ) : null}
        <View style={styles.row}>
          <Button size="sm" variant="ghost" icon="Sparkle" label={t('practice:MOCK-22.ask_tutor')} onPress={() => router.push({ pathname: '/tutor', params: { context: `question:${item.question_id}` } })} />
          <Button size="sm" variant="ghost" icon="Flag" label={t('practice:MOCK-22.report')} onPress={() => router.push({ pathname: '/report-content', params: { ref: `question:${item.question_id}` } })} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 10 },
  gapSm: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  flex: { flex: 1 },
});
