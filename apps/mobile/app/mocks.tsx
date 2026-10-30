import { useAppStore } from '@smriti/app-core/react';
import { Banner, Button, Card, ChoiceChips, Chip, EmptyState, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState, useQueryScope } from '../src/services/context';
import { examName } from '../src/services/exams';
import { fetchMocks, fetchPracticeHub, practiceKeys, type MockCard } from '../src/services/practice';
import { BuddyLine } from '../src/ui/Onboarding';
import { BackHeader, Screen } from '../src/ui/Screen';

type Filter = 'all' | 'full' | 'sectional' | 'chapter' | 'pyq_paper';

/**
 * MOCK-01, the mock list, from `/v1/mocks` (cards carry their own `access`, so a locked mock opens
 * the paywall with the server's `paywall_source`). The free sectional meter comes from the hub.
 * Taking a mock (MOCK-03 onwards) is not built in the app yet.
 */
export default function Mocks() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const signedIn = useAppStore((s) => s.session.status === 'signed_in');
  const exam = app.examProfileId();
  const examShort = examName(app, exam) ?? app.appName();
  const [filter, setFilter] = useState<Filter>('all');
  const mocks = useQuery({ queryKey: practiceKeys.mocks(scope, exam), queryFn: () => fetchMocks(app) });
  const hub = useQuery({ queryKey: practiceKeys.hub(scope, exam), queryFn: () => fetchPracticeHub(app) });
  const back = () => (router.canGoBack() ? router.back() : router.replace('/practice' as Href));
  const shown = (mocks.data ?? []).filter((m) => filter === 'all' || m.kind === filter);
  const sectional = hub.data?.limits.sectional_mocks;

  const open = (m: MockCard) => {
    if (!m.access.allowed) {
      router.push({ pathname: '/paywall', params: { from: m.access.paywall_source ?? 'mock_lock' } });
    }
  };

  return (
    <Screen testID="MOCK-01">
      <BackHeader title={t('practice:MOCK-01.title')} backLabel={t('ui:common.back')} onBack={back} />
      <BuddyLine text={t('practice:MOCK-01.pet_line')} />
      <ChoiceChips
        label={t('practice:MOCK-01.title')}
        hideLabel
        options={[
          { value: 'all', label: t('practice:MOCK-01.for_you') },
          { value: 'full', label: t('practice:MOCK-01.full') },
          { value: 'sectional', label: t('practice:MOCK-01.sectional') },
          { value: 'chapter', label: t('practice:MOCK-01.chapter') },
          { value: 'pyq_paper', label: t('practice:MOCK-01.pyq_papers') },
        ]}
        value={[filter]}
        onChange={(v) => setFilter((Array.isArray(v) ? v[0] : v) as Filter)}
        testID="mock-filter"
      />
      {sectional && !sectional.unlimited && sectional.limit !== null ? (
        // A weekly quota: ui-native's LimitMeter words its states per day, so the catalogue line stands alone.
        <Text variant="label" tone="muted" numeric testID="mock-meter">
          {t('practice:MOCK-01.free_usage', { used: sectional.used, limit: sectional.limit })}
        </Text>
      ) : null}

      {mocks.isPending ? <Spinner label={t('ui:saveState.saving')} /> : null}
      {mocks.isError ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void mocks.refetch() }} testID="mock-error" /> : null}
      {mocks.data && shown.length === 0 ? <EmptyState illustration="ui-all-caught-up" alt="" text={t('practice:MOCK-01.empty', { exam_short: examShort })} testID="mock-empty" /> : null}

      {shown.map((m) => (
        <Card key={m.id} outlined testID={`mock-${m.id}`}>
          <View style={styles.gap}>
            <View style={styles.row}>
              <Text variant="heading" style={styles.grow}>
                {m.title[locale] ?? m.title.en ?? m.paper_code}
              </Text>
              {m.is_free ? <Chip label={t('practice:MOCK-01.free_chip')} tone="success" /> : null}
            </View>
            <Text variant="caption" tone="muted" numeric>
              {`${t('practice:MOCK-01.duration_fact', { duration_min: m.duration_min })} · ${t('practice:MOCK-01.questions_fact', { question_count: m.question_count })}`}
            </Text>
            <View style={styles.actions}>
              {m.in_progress_attempt_id ? (
                <Chip label={t('practice:MOCK-01.in_progress')} tone="primary" />
              ) : m.attempts > 0 ? (
                <Chip label={t('practice:MOCK-01.attempted.1')} tone="neutral" />
              ) : null}
              <Button
                size="sm"
                variant={m.access.allowed ? 'primary' : 'secondary'}
                icon={m.access.allowed ? undefined : 'Lock'}
                label={m.attempts > 0 && !m.in_progress_attempt_id ? t('practice:MOCK-01.view') : t('practice:MOCK-01.start')}
                onPress={() => open(m)}
                disabled={m.access.allowed}
                testID={`mock-start-${m.id}`}
              />
            </View>
          </View>
        </Card>
      ))}

      <Text variant="caption" tone="muted" align="center">
        {signedIn ? t('practice:MOCK-01.sync_line') : t('practice:MOCK-01.guest_sync_line')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
});
