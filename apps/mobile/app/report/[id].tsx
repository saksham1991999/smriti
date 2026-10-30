import { Banner, Button, Card, ScoreRing, Spinner, StatTile, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../../src/services/context';
import { fetchReport } from '../../src/services/mocks';
import { BuddyLine } from '../../src/ui/Onboarding';
import { BackHeader, Screen } from '../../src/ui/Screen';

const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000));

/**
 * MOCK-17/18/19: time's up, scoring and the report from `/v1/attempts/{id}/report`. Rank and
 * percentile show only when the server's `standing.shown` says so; parts the free plan does not
 * include arrive in `locked` and show the Pro card instead.
 */
export default function ReportScreen() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const { id, expired } = useLocalSearchParams<{ id: string; expired?: string }>();
  const report = useQuery({
    queryKey: ['smriti', 'report', scope, id],
    queryFn: () => fetchReport(app, String(id)),
    // MOCK-18: scoring can take a moment; poll until the report has a score.
    refetchInterval: (q) => (q.state.data && q.state.data.score == null && q.state.data.status !== 'abandoned' ? 2_000 : false),
  });
  const r = report.data;
  const back = () => router.replace('/mocks' as Href);
  const rows = r?.questions ?? [];
  const correct = rows.filter((x) => x.status === 'correct').length;
  const wrong = rows.filter((x) => x.status === 'wrong').length;
  const skipped = rows.filter((x) => x.status === 'skipped').length;
  const notScored = rows.filter((x) => x.status === 'not_scored').length;

  return (
    <Screen testID="MOCK-19" footer={r ? <Button label={t('practice:MOCK-19.review_solutions')} onPress={() => router.push({ pathname: '/solutions/[id]', params: { id: r.attempt_id } })} testID="report-solutions" /> : null}>
      <BackHeader title={r ? (r.title[locale] ?? r.title.en ?? '') : t('practice:MOCK-18.title')} backLabel={t('ui:common.back')} onBack={back} />
      {expired ? (
        <Card tone="tint" testID="MOCK-17">
          <Text variant="heading">{t('practice:MOCK-17.title')}</Text>
          <Text variant="body">{t('practice:MOCK-17.line')}</Text>
        </Card>
      ) : null}
      {report.isPending || (r && r.score == null) ? <Spinner label={t('practice:MOCK-18.scoring')} /> : null}
      {report.isError ? <Banner tone="warning" icon="Warning" text={t('practice:MOCK-18.offline')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void report.refetch() }} /> : null}
      {r && r.score != null ? (
        <>
          <Text variant="caption" tone="muted" numeric>
            {t('practice:MOCK-19.attempt_line', { n: r.attempt_no, date: (r.submitted_at ?? r.generated_at).slice(0, 10) })}
          </Text>
          <View style={styles.center}>
            <ScoreRing score={r.score} max={r.max_score ?? 0} label={t('practice:MOCK-19.score_tile')} testID="report-score" />
            <Text variant="body" numeric>
              {t('practice:MOCK-19.counts_line', { correct, wrong, skipped })}
            </Text>
          </View>
          <View style={styles.tiles}>
            {r.accuracy != null ? <StatTile style={styles.tile} icon="CheckCircle" value={`${r.accuracy}%`} label={t('practice:MOCK-19.accuracy_tile')} /> : null}
            {r.time_lost_wrong_ms != null ? <StatTile style={styles.tile} icon="Timer" value={t('practice:MOCK-19.time_lost_value', { m: minutes(r.time_lost_wrong_ms) })} label={t('practice:MOCK-19.time_lost_tile')} /> : null}
          </View>
          {r.standing?.shown && r.standing.percentile != null ? (
            <Text variant="heading" numeric>
              {t('practice:MOCK-19.percentile', { percentile: r.standing.percentile })}
              {r.standing.rank != null ? ` · ${t('practice:MOCK-19.rank', { rank: r.standing.rank, ranked_count: r.standing.of ?? 0 })}` : ''}
            </Text>
          ) : r.standing?.reason === 'below_threshold' ? (
            <Text variant="caption" tone="muted" numeric>
              {t('practice:MOCK-19.threshold', { min: r.standing.needed ?? 0, count: r.standing.counted ?? 0 })}
            </Text>
          ) : r.standing?.reason === 'not_first_attempt' ? (
            <Text variant="caption" tone="muted">{t('practice:MOCK-19.first_attempt_line')}</Text>
          ) : null}
          {notScored > 0 ? <Banner tone="info" icon="Info" text={t('practice:MOCK-19.not_scored_note', { n: notScored })} /> : null}

          {r.sections && r.sections.length > 0 ? (
            <Card outlined testID="report-sections">
              <View style={styles.gap}>
                <Text variant="heading">{t('practice:MOCK-19.sections_and_subjects')}</Text>
                {r.sections.map((s) => (
                  <View key={s.code} style={styles.row}>
                    <Text variant="body" style={styles.flex}>
                      {s.title[locale] ?? s.code}
                    </Text>
                    <Text variant="label" numeric>
                      {t('practice:MOCK-19.section_meta', { marks: s.marks, max: s.max_marks, accuracy: s.accuracy ?? 0 })}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          {r.time_buckets ? (
            <Card outlined testID="report-time">
              <View style={styles.gap}>
                <Text variant="heading">{t('practice:MOCK-20.title')}</Text>
                <Text variant="body" numeric>{`${t('practice:MOCK-19.right_but_slow')}: ${r.time_buckets.right_but_slow}`}</Text>
                <Text variant="body" numeric>{`${t('practice:MOCK-19.fast_and_wrong')}: ${r.time_buckets.fast_and_wrong}`}</Text>
                <Text variant="body" numeric>{`${t('practice:MOCK-19.lucky_guesses')}: ${r.time_buckets.lucky_guesses}`}</Text>
                <Text variant="caption" tone="muted">
                  {r.time_buckets.ideal_time_source === 'authors' ? t('practice:MOCK-19.target_source_authors') : t('practice:MOCK-19.target_source_cohort', { n: '' })}
                </Text>
              </View>
            </Card>
          ) : null}

          {r.confidence && r.confidence.some((c) => c.confidence !== 'none' && c.correct + c.wrong > 0) ? (
            <Card outlined testID="report-confidence">
              <View style={styles.gap}>
                <Text variant="heading">{t('practice:MOCK-19.confidence_title')}</Text>
                {r.confidence
                  .filter((c) => c.confidence !== 'none')
                  .map((c) => (
                    <Text key={c.confidence} variant="body" numeric>
                      {t('practice:MOCK-19.confidence_row', { label: c.confidence === 'sure' ? t('ui:confidence.sure') : c.confidence === 'guess' ? t('ui:confidence.guess') : t('ui:confidence.half'), correct: c.correct, n: c.correct + c.wrong })}
                    </Text>
                  ))}
              </View>
            </Card>
          ) : null}

          {r.fix_next && r.fix_next.length > 0 ? (
            <Card tone="tint" testID="report-fix-next">
              <View style={styles.gap}>
                <Text variant="heading">{t('practice:MOCK-19.fix_next_title')}</Text>
                {r.fix_next.map((f) => (
                  <Text key={f.concept_id} variant="body">
                    {t('practice:MOCK-19.fix_row', { concept_name: app.conceptName(f.concept_id), marks: f.marks_lost })}
                  </Text>
                ))}
                <Button size="sm" label={t('practice:MOCK-19.fix_button', { n: 10 })} onPress={() => router.push({ pathname: '/drill', params: { concepts: r.fix_next!.map((f) => f.concept_id).join(',') } })} testID="report-fix" />
              </View>
            </Card>
          ) : null}

          {r.locked.length > 0 ? (
            <Card tone="tint" onPress={() => router.push({ pathname: '/paywall', params: { from: 'mock_report' } })} accessibilityLabel={t('practice:MOCK-19.pro_lock_title')} testID="report-pro-lock">
              <Text variant="heading">{t('practice:MOCK-19.pro_lock_title')}</Text>
              <Text variant="body" tone="muted">
                {t('practice:MOCK-19.pro_lock_line')}
              </Text>
            </Card>
          ) : null}

          <BuddyLine text={(r.accuracy ?? 0) >= 60 && r.fix_next?.[0] ? t('practice:MOCK-19.pet_line_good', { concept_name: app.conceptName(r.fix_next[0].concept_id) }) : t('practice:MOCK-19.pet_line_tough')} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 8 },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1 },
  gap: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});
