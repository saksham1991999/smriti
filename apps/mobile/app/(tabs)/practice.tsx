import { Banner, Button, Card, Chip, Icon, LimitMeter, Spinner, Text, useTheme } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { examName } from '../../src/services/exams';
import { useApp, useT, useUiState, useQueryScope } from '../../src/services/context';
import { fetchPracticeHub, hubPetLine, practiceKeys, type PracticeHub } from '../../src/services/practice';
import { BuddyLine } from '../../src/ui/Onboarding';
import { Screen } from '../../src/ui/Screen';

const REASON_TONE = { low_accuracy: 'warning', fading: 'primary', missed_in_mock: 'error', overconfident: 'warning' } as const;

/**
 * PRC-01, the practice hub, from `/v1/practice/hub` in one call: today's challenge, weak spots,
 * the four entry tiles, the free meter and recent sessions. Offline it keeps the last hub.
 */
export default function Practice() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const locale = useUiState((s) => s.locale);
  const online = app.deps.network.isOnline();
  const scope = useQueryScope();
  const exam = app.examProfileId();
  const examShort = examName(app, exam) ?? app.appName();
  const little = app.isLittleLearner();
  const hub = useQuery({ queryKey: practiceKeys.hub(scope, exam), queryFn: () => fetchPracticeHub(app) });
  const data: PracticeHub | undefined = hub.data;
  const goPro = () => router.push({ pathname: '/paywall', params: { from: 'practice_meter' } });

  const petLine = data
    ? {
        cap_reached: t('practice:PRC-01.pet_line_cap_reached'),
        challenge_not_played: t('practice:PRC-01.pet_line_challenge_not_played'),
        weak_spots_found: t('practice:PRC-01.pet_line_weak_spots_found', { concept_name: data.weak_spots[0]?.concept_name[locale] ?? '' }),
        new_student: t('practice:PRC-01.pet_line_new_student'),
      }[hubPetLine(data)]
    : t('practice:PRC-01.pet_line_new_student');

  return (
    <Screen testID="PRC-01" edges="top">
      <View style={styles.titleRow}>
        <Text variant="display" heading>
          {t('practice:PRC-01.title')}
        </Text>
        <Chip kind="filter" label={examShort} testID="prc-exam-chip" />
      </View>
      {!online ? <Banner tone="offline" icon="WifiSlash" text={t('practice:PRC-01.offline_banner')} testID="prc-offline" /> : null}
      <BuddyLine text={petLine} testID="prc-pet-line" />

      {hub.isPending ? (
        <View style={styles.center}>
          <Spinner label={t('ui:saveState.saving')} />
        </View>
      ) : null}
      {hub.isError && !data ? (
        <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void hub.refetch() }} testID="prc-error" />
      ) : null}

      {data?.mock_in_progress ? (
        <Card tone="tint" testID="prc-resume">
          <View style={styles.row}>
            <Icon name="Timer" color="primary" />
            <Text variant="body" style={styles.grow}>
              {t('practice:MOCK-01.in_progress')}
            </Text>
            <Button size="sm" label={t('practice:PRC-01.resume_button')} onPress={() => router.push('/mocks' as Href)} testID="prc-resume-btn" />
          </View>
        </Card>
      ) : null}

      {data ? <ChallengeCard hub={data} examShort={examShort} /> : null}

      {data && data.weak_spots.length > 0 ? (
        <Card outlined testID="prc-weak-spots">
          <View style={styles.gap}>
            <View style={styles.row}>
              <Text variant="heading" style={styles.grow}>
                {t('practice:PRC-01.weak_spots_heading')}
              </Text>
              <Button size="sm" variant="ghost" label={t('practice:PRC-01.see_all', { n: data.weak_spots.length })} onPress={() => router.push('/weak-spots' as Href)} testID="prc-weak-all" />
            </View>
            {data.weak_spots.map((w) => (
              <Pressable
                key={w.concept_id}
                accessibilityRole="button"
                accessibilityLabel={`${w.concept_name[locale] ?? w.concept_name.en ?? ''}. ${w.reasons[0] ? t(`practice:PRC-02.reason_${w.reasons[0]}`) : ''}`}
                onPress={() => router.push({ pathname: '/drill', params: { concepts: w.concept_id, source: 'weak_spot' } })}
                style={[styles.row, styles.spot, { borderTopColor: theme.colors.line }]}
                testID={`weak-${w.concept_id}`}
              >
                <View style={styles.grow}>
                  <Text variant="caption" tone="muted">
                    {w.topic_name[locale] ?? w.topic_name.en ?? ''}
                  </Text>
                  <Text variant="body">{w.concept_name[locale] ?? w.concept_name.en ?? ''}</Text>
                </View>
                {w.reasons[0] ? <Chip label={t(`practice:PRC-02.reason_${w.reasons[0]}`)} tone={REASON_TONE[w.reasons[0]]} /> : null}
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      <View style={styles.grid}>
        <Tile icon="Barbell" title={t('practice:PRC-01.tile_concept_drill')} caption={t('practice:PRC-01.tile_caption')} onPress={() => router.push({ pathname: '/drill', params: { source: 'hub' } })} testID="prc-tile-drill" />
        <Tile icon="FileText" title={t('practice:PRC-01.tile_pyq_bank')} onPress={() => router.push('/pyq' as Href)} testID="prc-tile-pyq" />
        <Tile icon="Exam" title={t('practice:PRC-01.tile_mock_tests')} onPress={() => router.push('/mocks' as Href)} testID="prc-tile-mocks" />
        <Tile icon="Sparkle" title={t('tutor_social:AI-02.history')} caption={t('tutor_social:AI-02.input_placeholder_no_context')} onPress={() => router.push('/tutor' as Href)} testID="prc-tile-tutor" />
        <Tile icon="TrendUp" title={t('practice:PRC-01.tile_analytics')} onPress={() => router.push('/progress' as Href)} testID="prc-tile-analytics" />
      </View>

      {app.ageBand() !== '10_12' && app.ageBand() !== 'u10' ? (
        <Card outlined onPress={() => router.push('/photo-doubt' as Href)} accessibilityLabel={t('practice:PRC-01.snap_a_doubt')} testID="prc-snap">
          <View style={styles.row}>
            <Icon name="Sparkle" color="primary" />
            <View style={styles.grow}>
              <Text variant="label">{t('practice:PRC-01.snap_a_doubt')}</Text>
              <Text variant="caption" tone="muted">
                {t('practice:PRC-01.snap_caption')}
              </Text>
            </View>
            <Icon name="CaretRight" color="inkMuted" />
          </View>
        </Card>
      ) : null}

      {data ? (
        <LimitMeter
          label={t('practice:PRC-01.title')}
          used={data.limits.practice_questions.used}
          limit={data.limits.practice_questions.limit ?? 0}
          hidden={data.limits.practice_questions.unlimited}
          proAction={little ? 'ask_grown_up' : 'pro_link'}
          onProPress={goPro}
          testID="prc-meter"
        />
      ) : null}

      {data && data.recent_sessions.length > 0 ? (
        <View style={styles.gap} testID="prc-recent">
          <View style={styles.row}>
            <Text variant="heading" style={styles.grow}>
              {t('practice:PRC-01.recent')}
            </Text>
            <Button size="sm" variant="ghost" label={t('practice:PRC-16.title')} onPress={() => router.push('/practice-history' as Href)} testID="prc-history" />
          </View>
          {data.recent_sessions.map((r) => (
            <Card key={r.id} outlined onPress={() => router.push({ pathname: r.ended_at ? '/session-summary/[id]' : '/session/[id]', params: { id: r.id } })} accessibilityLabel={t('practice:PRC-01.resume_card.2', { answered: r.correct, total: r.answered })}>
              <Text variant="body" numeric>
                {t('practice:PRC-01.resume_card.2', { answered: r.correct, total: r.answered })}
              </Text>
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function ChallengeCard({ hub, examShort }: { hub: PracticeHub; examShort: string }) {
  const t = useT();
  const c = hub.daily_challenge;
  const open = () => router.push('/challenge' as Href);
  return (
    <Card tone="tint" testID="prc-challenge">
      <View style={styles.gap}>
        <Text variant="title" heading>
          {t('practice:PRC-01.challenge_title')}
        </Text>
        <Text variant="body" tone="muted">
          {t('practice:PRC-01.challenge_sub_line', { exam_short: examShort })}
        </Text>
        <View style={styles.actions}>
          {c.state === 'not_played' || c.state === 'started' ? (
            <Button size="sm" label={c.state === 'started' ? t('practice:PRC-01.resume_button') : t('practice:PRC-01.play')} icon="Play" iconPosition="end" onPress={open} testID="prc-play" />
          ) : c.state === 'played' ? (
            <Button size="sm" variant="secondary" label={t('practice:PRC-01.see_result')} onPress={open} testID="prc-see-result" />
          ) : (
            <Text variant="caption" tone="muted" testID="prc-challenge-unavailable">
              {t('practice:PRC-11.not_published')}
            </Text>
          )}
        </View>
      </View>
    </Card>
  );
}

function Tile({ icon, title, caption, onPress, testID }: { icon: 'Barbell' | 'FileText' | 'Exam' | 'Sparkle' | 'TrendUp'; title: string; caption?: string; onPress?: () => void; testID: string }) {
  const body = (
    <Card outlined {...(onPress ? { onPress, accessibilityLabel: title } : {})} testID={testID}>
      <View style={styles.tileBody}>
        <Icon name={icon} color="primary" />
        <Text variant="heading">{title}</Text>
        {caption ? (
          <Text variant="caption" tone="muted">
            {caption}
          </Text>
        ) : null}
      </View>
    </Card>
  );
  return <View style={styles.tile}>{body}</View>;
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  center: { alignItems: 'center', paddingVertical: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  spot: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  grow: { flex: 1 },
  gap: { gap: 10 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47.5%' },
  tileBody: { gap: 8, minHeight: 110 },
});
