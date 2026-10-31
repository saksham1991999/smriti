import { Banner, Button, Card, ChoiceChips, Spinner, Switch, Text } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../../src/services/context';
import { fetchMockDetail, startAttempt, type MockDetail } from '../../src/services/mocks';
import { BackHeader, Screen } from '../../src/ui/Screen';

const TYPE_KEY: Record<string, string> = { mcq_single: 'single_correct', mcq_multi: 'multiple_correct', numerical: 'numerical', integer: 'numerical' };

/**
 * MOCK-02 (what the paper is), with MOCK-04's exam-day switch and MOCK-06's language choice and
 * declaration folded in before the start: one screen, then the paper. Everything shown comes from
 * the blueprint the server returns (its source and verification date included).
 */
export default function MockDetailScreen() {
  const app = useApp();
  const t = useT();
  const queries = useQueryClient();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useQuery({ queryKey: ['smriti', 'mock', scope, id], queryFn: () => fetchMockDetail(app, String(id)) });
  const [language, setLanguage] = useState<'en' | 'hi'>(locale);
  const [examDay, setExamDay] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/mocks' as Href));
  const d = detail.data;

  const start = async (m: MockDetail) => {
    if (m.in_progress_attempt_id) return router.replace({ pathname: '/attempt/[id]', params: { id: m.in_progress_attempt_id } });
    setBusy(true);
    setFailed(false);
    try {
      const lang = m.languages.includes(language) ? language : ((m.languages[0] as 'en' | 'hi' | undefined) ?? 'en');
      const a = await startAttempt(app, m.id, lang, examDay ? 'strict' : 'practice');
      void queries.invalidateQueries({ queryKey: ['smriti', 'mocks'] });
      router.replace({ pathname: '/attempt/[id]', params: { id: a.id } });
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  const footer = d ? (
    !d.access.allowed ? (
      <Button label={t('practice:MOCK-02.unlock')} icon="Lock" onPress={() => router.push({ pathname: '/paywall', params: { from: d.access.paywall_source ?? 'mock_lock' } })} testID="mock-unlock" />
    ) : d.in_progress_attempt_id ? (
      <Button label={t('practice:MOCK-02.resume')} onPress={() => void start(d)} testID="mock-resume" />
    ) : (
      <View style={styles.gap}>
        {!agreed ? (
          <Text variant="caption" tone="muted" align="center">
            {t('practice:MOCK-06.tick_first')}
          </Text>
        ) : null}
        <Button label={t('practice:MOCK-06.begin')} loading={busy} disabled={!agreed} onPress={() => void start(d)} testID="mock-begin" />
      </View>
    )
  ) : null;

  return (
    <Screen testID="MOCK-02" footer={footer}>
      <BackHeader title={d ? (d.title[locale] ?? d.title.en ?? d.paper_code) : t('practice:MOCK-01.title')} backLabel={t('ui:common.back')} onBack={back} />
      {detail.isPending ? <Spinner label={t('practice:MOCK-01.title')} /> : null}
      {detail.isError ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void detail.refetch() }} /> : null}
      {failed ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} testID="mock-start-failed" /> : null}
      {d ? (
        <>
          <Text variant="body" tone="muted" numeric>
            {`${t('practice:MOCK-01.duration_fact', { duration_min: d.duration_min })} · ${t('practice:MOCK-01.questions_fact', { question_count: d.question_count })}`}
          </Text>
          {d.attempts > 0 ? <Banner tone="info" icon="Info" text={t('practice:MOCK-02.re_attempt_note')} /> : null}

          <Card outlined testID="mock-sections">
            <View style={styles.gap}>
              <Text variant="heading">{t('practice:MOCK-02.sections')}</Text>
              {d.sections.map((s) => (
                <View key={s.code} style={styles.gapSm}>
                  <Text variant="body">{t('practice:MOCK-06.sections_line', { section_title: s.title[locale] ?? s.title.en ?? s.code, question_count: s.question_count })}</Text>
                  <Text variant="caption" tone="muted">
                    {s.timer_min ? t('practice:MOCK-02.section_timer_locked', { section_timer_min: s.timer_min }) : t('practice:MOCK-02.shared_time')}
                    {s.attempt_any ? ` · ${t('practice:MOCK-02.attempt_any', { attempt_any: s.attempt_any })}` : ''}
                  </Text>
                  {Object.entries(s.marking).map(([type, m]) => (
                    <Text key={type} variant="caption" tone="muted" numeric>
                      {t('practice:MOCK-06.marking_line', { type: TYPE_KEY[type] ? t(`practice:MOCK-07.${TYPE_KEY[type]}` as never) : type, correct: m.correct, wrong: m.wrong, unattempted: m.unattempted })}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </Card>

          <Card outlined testID="mock-rules">
            <View style={styles.gapSm}>
              <Text variant="heading">{t('practice:MOCK-02.rules')}</Text>
              <Text variant="body">{d.section_navigation === 'free' ? t('practice:MOCK-02.free_navigation') : t('practice:MOCK-02.locked_navigation')}</Text>
              <Text variant="body">{d.calculator === 'none' ? t('practice:MOCK-02.no_calculator') : d.calculator === 'scientific' ? t('practice:MOCK-02.calculator_scientific') : t('practice:MOCK-02.calculator_basic')}</Text>
              <Text variant="body">{d.marked_answer_evaluated ? t('practice:MOCK-02.marked_evaluated') : t('practice:MOCK-02.marked_not_evaluated')}</Text>
              <Text variant="caption" tone="muted">
                {t('practice:MOCK-02.source', { source_title: d.source.title, source_published: d.source.published ?? '', verified_at: d.verified_at.slice(0, 10) })}
              </Text>
            </View>
          </Card>

          {d.access.allowed && !d.in_progress_attempt_id ? (
            <Card tone="tint" testID="mock-ready">
              <View style={styles.gap}>
                {d.languages.length > 1 && d.language_switch !== 'fixed' ? (
                  <ChoiceChips
                    label={t('practice:MOCK-06.language_label')}
                    options={d.languages.map((l) => ({ value: l, label: l === 'hi' ? 'हिन्दी' : 'English' }))}
                    value={[language]}
                    onChange={(v) => setLanguage(((Array.isArray(v) ? v[0] : v) as 'en' | 'hi') ?? 'en')}
                    testID="mock-language"
                  />
                ) : null}
                <Switch checked={examDay} onCheckedChange={setExamDay} label={t('practice:MOCK-04.exam_day_mode')} testID="mock-exam-day" />
                <Text variant="caption" tone="muted">
                  {t('practice:MOCK-04.exam_day_caption')}
                </Text>
                <Switch checked={agreed} onCheckedChange={setAgreed} label={t('practice:MOCK-06.declaration')} testID="mock-declaration" />
              </View>
            </Card>
          ) : null}

          {d.past_attempts.length > 0 ? (
            <View style={styles.gapSm} testID="mock-past">
              <Text variant="heading">{t('practice:MOCK-02.your_attempts')}</Text>
              {d.past_attempts.map((a) => (
                <Card key={a.id} outlined onPress={() => router.push({ pathname: '/report/[id]', params: { id: a.id } })} accessibilityLabel={t('practice:MOCK-19.attempt_line', { n: a.attempt_no, date: a.started_at.slice(0, 10) })}>
                  <Text variant="body" numeric>
                    {`${t('practice:MOCK-19.attempt_line', { n: a.attempt_no, date: a.started_at.slice(0, 10) })}${a.score !== null ? ` · ${t('practice:MOCK-19.score', { score: a.score, max_score: a.max_score ?? 0 })}` : ''}`}
                  </Text>
                </Card>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  gapSm: { gap: 6 },
});
