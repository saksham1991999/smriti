import type { components } from '@smriti/api-client';
import { Banner, Button, Card, Chip, Icon, Spinner, Text } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../../src/ui/Screen';

type Room = components['schemas']['LiveRoom'];

/**
 * MOCK-03 Live mock room: the window, a countdown on the server's clock (its offset from this
 * device is kept, so the countdown runs on offline), how it works, and one action that moves
 * from [Register] to [Registered] to [Start now] (into MOCK-04 for this mock) when the window
 * opens. After the window: taken or closed, and the leaderboard once ranks are out.
 */
export default function LiveRoom() {
  const app = useApp();
  const t = useT();
  const qc = useQueryClient();
  const locale = useUiState((s) => s.locale);
  const online = useUiState(() => app.deps.network.isOnline());
  const { id } = useLocalSearchParams<{ id: string }>();
  const offset = useRef(0);
  const q = useQuery({
    queryKey: ['live', id],
    queryFn: async (): Promise<Room | null> => {
      await app.ensureSession();
      const r = await app.api.GET('/v1/live/mocks/{mock_id}', { params: { path: { mock_id: id } } }).catch(() => null);
      if (r?.data) offset.current = Date.parse(r.data.server_time) - app.deps.clock();
      return r?.data ?? null;
    },
    refetchInterval: 30_000,
  });
  const [now, setNow] = useState(() => app.deps.clock());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const h = setInterval(() => setNow(app.deps.clock()), 1000);
    return () => clearInterval(h);
  }, [app]);
  const room = q.data;
  const serverNow = now + offset.current;

  // The status flips on the server's clock: refetch when a boundary passes.
  useEffect(() => {
    if (!room) return;
    const edges = [room.room_opens_at, room.window_start, room.window_end].map(Date.parse);
    if (edges.some((e) => e <= serverNow && e > serverNow - 1000)) void q.refetch();
  }, [room, serverNow, q]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/mocks' as Href));
  if (!room) {
    return (
      <Screen testID="MOCK-03">
        <BackHeader title="" backLabel={t('ui:common.back')} onBack={back} />
        {q.isPending ? <Spinner label={t('practice:MOCK-03.live_chip')} /> : <Banner tone="offline" icon="WifiSlash" text={t('practice:MOCK-03.needs_internet')} />}
      </Screen>
    );
  }

  const title = room.title[locale] ?? room.title.en ?? '';
  const fmtTime = (iso: string) => new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit', timeZone: app.deps.timeZone() }).format(new Date(iso));
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: app.deps.timeZone() }).format(new Date(iso));
  const until = (iso: string) => hms(Math.max(0, Date.parse(iso) - serverNow));
  const live = room.status === 'live';
  const before = room.status === 'scheduled' || room.status === 'room_open';
  const taken = room.attempt_id !== null;
  const pro = app.isPro();
  const lateMin = live && room.duration_s !== null && room.deadline_if_started_now ? Math.floor((Date.parse(room.deadline_if_started_now) - serverNow) / 60_000) : null;
  const isLate = lateMin !== null && room.duration_s !== null && lateMin < Math.floor(room.duration_s / 60);

  const register = async () => {
    if (!pro) return router.push({ pathname: '/paywall', params: { from: 'live_mock' } } as unknown as Href);
    setBusy(true);
    setError(false);
    const r = await app.api.POST('/v1/live/mocks/{mock_id}/registration', { params: { path: { mock_id: room.mock_id } } }).catch(() => null);
    setBusy(false);
    if (!r?.data) return setError(true);
    app.track('live_mock_registered', { mock_id: room.mock_id });
    void qc.invalidateQueries({ queryKey: ['live', id] });
  };

  let footer: React.ReactNode = null;
  if (before) {
    footer = room.registered ? (
      <Button label={t('practice:MOCK-03.registered')} icon="CheckCircle" disabled onPress={() => undefined} testID="mock03-registered" />
    ) : (
      <Button label={pro ? t('practice:MOCK-03.register') : t('practice:MOCK-02.unlock')} icon={pro ? undefined : 'Lock'} disabled={busy} onPress={() => void register()} testID="mock03-register" />
    );
  } else if (live && !taken) {
    footer = <Button label={t('practice:MOCK-03.start_now')} icon="Play" disabled={!online || !room.can_start} onPress={() => router.push(`/mock/${room.mock_id}` as Href)} testID="mock03-start" />;
  } else if (room.status === 'results') {
    footer = <Button label={t('practice:MOCK-24.title', { mock_title: title })} onPress={() => router.push(`/live/${room.mock_id}/leaderboard` as Href)} testID="mock03-leaderboard" />;
  }

  return (
    <Screen testID="MOCK-03" footer={footer}>
      <BackHeader title={title} backLabel={t('ui:common.back')} onBack={back} />
      <Chip label={t('practice:MOCK-03.live_chip')} tone="error" icon="Lightning" />
      <Card testID="mock03-window">
        <Stack gap={6}>
          <Text variant="heading">{t('practice:MOCK-03.window', { date: fmtDate(room.window_start), start_time: fmtTime(room.window_start), end_time: fmtTime(room.window_end) })}</Text>
          {before ? (
            <Text variant="title" numeric testID="mock03-countdown">
              {t('practice:MOCK-03.starts_in', { time: until(room.window_start) })}
            </Text>
          ) : live ? (
            <Text variant="title" numeric testID="mock03-countdown">
              {t('practice:MOCK-03.closes_in', { time: until(room.window_end) })}
            </Text>
          ) : null}
        </Stack>
      </Card>

      {live && isLate && !taken ? <Banner tone="warning" icon="Timer" text={t('practice:MOCK-03.late_start', { remaining: lateMin ?? 0, end_time: fmtTime(room.window_end) })} testID="mock03-late" /> : null}
      {live && !online && !taken ? <Banner tone="offline" icon="WifiSlash" text={t('practice:MOCK-03.needs_internet')} /> : null}
      {taken && room.results_at && room.status !== 'results' ? <Banner tone="info" icon="CheckCircle" text={t('practice:MOCK-03.taken', { results_at: `${fmtDate(room.results_at)} ${fmtTime(room.results_at)}` })} testID="mock03-taken" /> : null}
      {room.status === 'closed' && !taken && room.results_at ? <Banner tone="info" icon="Info" text={t('practice:MOCK-03.closed', { results_at: `${fmtDate(room.results_at)} ${fmtTime(room.results_at)}` })} testID="mock03-closed" /> : null}
      {error ? <Banner tone="warning" icon="Warning" text={t('practice:MOCK-03.needs_internet')} /> : null}

      {before || live ? (
        <Stack gap={10}>
          <How text={t('practice:MOCK-03.how_it_works_1')} />
          {room.full_duration_until && room.duration_s ? <How text={t('practice:MOCK-03.how_it_works_2', { latest_full_start: fmtTime(room.full_duration_until), duration_min: Math.round(room.duration_s / 60) })} /> : null}
          {room.results_at ? <How text={t('practice:MOCK-03.how_it_works_3', { results_at: `${fmtDate(room.results_at)} ${fmtTime(room.results_at)}` })} /> : null}
        </Stack>
      ) : null}
    </Screen>
  );
}

function How({ text }: { text: string }) {
  return (
    <View style={styles.how}>
      <Icon name="CheckCircle" size={20} color="primary" />
      <Text variant="body" style={styles.grow}>
        {text}
      </Text>
    </View>
  );
}

/** hh:mm:ss, tabular. */
function hms(ms: number): string {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

const styles = StyleSheet.create({
  how: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  grow: { flex: 1 },
});
