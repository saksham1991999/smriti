import type { components } from '@smriti/api-client';
import { Chip, LeaderboardRow, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../../src/ui/Screen';

type S = components['schemas'];

/**
 * MOCK-24 Live mock leaderboard: frozen ranks from `/v1/live/mocks/{id}/leaderboard`, top rows
 * and the learner's own row pinned. Names arrive resolved by the API (R31): adults by display
 * name, under-18s as a nickname with their pet; this build shows a minor's row as "Nickname"
 * with the pet until the nickname word list ships to the app.
 */
export default function LiveLeaderboard() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const { id } = useLocalSearchParams<{ id: string }>();
  const room = useQuery({
    queryKey: ['live', id],
    queryFn: async () => (await app.api.GET('/v1/live/mocks/{mock_id}', { params: { path: { mock_id: id } } }).catch(() => null))?.data ?? null,
  });
  const q = useQuery({
    queryKey: ['live', id, 'board'],
    queryFn: async (): Promise<S['LiveLeaderboard'] | null> => {
      await app.ensureSession();
      return (await app.api.GET('/v1/live/mocks/{mock_id}/leaderboard', { params: { path: { mock_id: id } } }).catch(() => null))?.data ?? null;
    },
  });
  const tracked = useRef(false);
  useEffect(() => {
    if (!q.data || tracked.current) return;
    tracked.current = true;
    app.track('mock_leaderboard_viewed', { mock_id: id, scope: 'all_india' });
  }, [app, id, q.data]);

  const title = room.data ? (room.data.title[locale] ?? room.data.title.en ?? '') : '';
  const resultsAt = room.data?.results_at ? new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: app.deps.timeZone() }).format(new Date(room.data.results_at)) : '';
  const b = q.data;
  const pet = app.store.getState().pet;
  const name = (r: S['LiveLeaderboardRow']) => (r.is_you ? t('practice:MOCK-24.own_row.1') : r.name ?? t('tutor_social:SOC-03.nickname_row_minor', { public_nickname: '' }).trim());
  const avatar = (r: S['LiveLeaderboardRow']) => {
    if (r.is_you) return { kind: 'pet' as const, species: pet?.species === 'dog' ? ('dog' as const) : ('cat' as const) };
    if (r.avatar?.startsWith('pet:')) return { kind: 'pet' as const, species: r.avatar === 'pet:dog' ? ('dog' as const) : ('cat' as const) };
    const n = (r.name ?? '?').trim();
    return { kind: 'initials' as const, initials: n.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() };
  };
  // "75 percentile", or "75.25 percentile": whole numbers lose their decimals.
  const pctNum = (p: number | null) => (p === null ? '' : String(Number(p.toFixed(2))));
  const pct = (p: number | null) => (p === null ? undefined : t('practice:MOCK-24.own_row.4', { percentile: pctNum(p) }));
  const me = b?.you ?? null;

  return (
    <Screen
      testID="MOCK-24"
      footer={
        me ? (
          <View accessibilityLabel={t('practice:MOCK-24.own_row', { rank: me.rank, score: me.score, percentile: pctNum(me.percentile) })}>
            <LeaderboardRow rank={me.rank} avatar={avatar(me)} name={t('practice:MOCK-24.own_row.1')} score={String(me.score)} percentile={pct(me.percentile)} isSelf pinned testID="mock24-you" />
          </View>
        ) : undefined
      }
    >
      <BackHeader title={t('practice:MOCK-24.title', { mock_title: title })} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace(`/live/${id}` as Href))} />
      {q.isPending ? <Spinner label={t('practice:MOCK-24.all_india')} /> : null}
      {b && b.published ? (
        <>
          <Text variant="caption" tone="muted" testID="mock24-meta">
            {t('practice:MOCK-24.meta', { ranked_count: b.ranked, results_at: resultsAt })}
          </Text>
          <View style={styles.tabs}>
            <Chip kind="filter" selected label={t('practice:MOCK-24.all_india')} />
          </View>
          <Stack gap={8}>
            {b.rows.map((r) => (
              <LeaderboardRow key={`${r.rank}-${r.is_you}-${r.name}`} rank={r.rank} avatar={avatar(r)} name={name(r)} score={String(r.score)} percentile={pct(r.percentile)} isSelf={r.is_you} testID={`mock24-row-${r.rank}`} />
            ))}
          </Stack>
          <Text variant="caption" tone="muted">
            {t('practice:MOCK-24.footer')}
          </Text>
        </>
      ) : b ? (
        <Text variant="body" tone="muted" testID="mock24-pending">
          {t('practice:MOCK-24.pending', { results_at: resultsAt })}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8 },
});
