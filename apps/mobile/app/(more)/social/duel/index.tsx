import { Banner, Button, ChoiceChips, FriendRow, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { findRandom, leaveRandom, loadFriends, personName, randomState, startDuel, type QueueState } from '../../../../src/features/social/services';
import { avatarOf, useGate } from '../../../../src/features/social/ui';
import { useApp, useT } from '../../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../../src/ui/Screen';

/**
 * SOC-15 (who to play) and SOC-16 for a random match (finding, then Keep looking, Practise solo
 * or Challenge a friend). The queue is polled every second; there are never bots (R31).
 */
export default function DuelSetup() {
  const app = useApp();
  const t = useT();
  const gate = useGate();
  const params = useLocalSearchParams<{ friend?: string }>();
  const canRandom = gate.data?.features?.includes('random_duel') ?? false;
  const canFriend = gate.data?.features?.includes('friend_duel') ?? false;
  const [who, setWho] = useState<'friend' | 'random'>('friend');
  const [friend, setFriend] = useState<string | null>(params.friend ?? null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [error, setError] = useState(false);
  const started = useRef(0);
  const friends = useQuery({ queryKey: ['social', 'friends'], queryFn: () => loadFriends(app), enabled: canFriend });
  const count = Number(app.flags.get('duel.question_count') ?? 10);
  const seconds = Number(app.flags.get('duel.question_seconds') ?? 20);
  const online = app.deps.network.isOnline();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/friends' as Href));

  const open = (id: string) => router.replace(`/social/duel/${id}` as Href);

  useEffect(() => {
    if (queue?.state !== 'waiting' || queue.timed_out) return;
    const timer = setInterval(() => {
      void randomState(app).then((q) => {
        if (q.state === 'matched' && q.duel) {
          app.track('duel_match_wait', { result: 'found', wait_ms: app.deps.clock() - started.current });
          open(q.duel.id);
        } else setQueue(q);
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, queue?.state, queue?.timed_out]);

  const start = async () => {
    setError(false);
    app.track('duel_setup', { relation: who });
    try {
      if (who === 'random') {
        started.current = app.deps.clock();
        const q = await findRandom(app);
        if (q.state === 'matched' && q.duel) return open(q.duel.id);
        setQueue(q);
        return;
      }
      if (!friend) return;
      open((await startDuel(app, { opponentId: friend })).id);
    } catch {
      setError(true);
    }
  };

  const solo = async () => {
    await leaveRandom(app);
    app.track('duel_match_wait', { result: 'solo', wait_ms: app.deps.clock() - started.current });
    try {
      open((await startDuel(app, { solo: true })).id);
    } catch {
      setError(true);
    }
  };

  const cancel = async () => {
    await leaveRandom(app);
    app.track('duel_match_wait', { result: 'cancelled', wait_ms: app.deps.clock() - started.current });
    setQueue(null);
  };

  if (queue?.state === 'waiting') {
    return (
      <Screen testID="SOC-16">
        <BackHeader title={t('tutor_social:SOC-15.title')} backLabel={t('ui:common.back')} onBack={() => void cancel()} />
        {queue.timed_out ? (
          <Stack gap={12}>
            <Text variant="title" heading testID="soc16-timeout">
              {t('tutor_social:SOC-16.random_timeout')}
            </Text>
            <Button
              label={t('tutor_social:SOC-16.keep_looking')}
              onPress={async () => {
                await leaveRandom(app);
                started.current = app.deps.clock();
                setQueue(await findRandom(app));
              }}
              testID="soc16-keep"
            />
            <Button variant="secondary" label={t('tutor_social:SOC-16.practise_solo')} onPress={() => void solo()} testID="soc16-solo" />
            <Text variant="caption" tone="muted">
              {t('tutor_social:SOC-16.practise_solo_note')}
            </Text>
            {canFriend ? (
              <Button
                variant="ghost"
                label={t('tutor_social:SOC-16.challenge_a_friend_instead')}
                onPress={async () => {
                  await cancel();
                  setWho('friend');
                }}
              />
            ) : null}
          </Stack>
        ) : (
          <Stack gap={16}>
            <Spinner label={t('tutor_social:SOC-16.finding')} />
            <Text variant="title" heading align="center" testID="soc16-finding">
              {t('tutor_social:SOC-16.finding')}
            </Text>
            <Button variant="secondary" label={t('tutor_social:SOC-16.cancel')} onPress={() => void cancel()} testID="soc16-cancel" />
          </Stack>
        )}
      </Screen>
    );
  }

  const options = [...(canFriend ? [{ value: 'friend', label: t('tutor_social:SOC-15.a_friend') }] : []), ...(canRandom ? [{ value: 'random', label: t('tutor_social:SOC-15.random') }] : [])];
  return (
    <Screen testID="SOC-15" footer={<Button icon="Lightning" label={t('tutor_social:SOC-15.start')} disabled={!online || (who === 'friend' && !friend)} onPress={() => void start()} testID="soc15-start" />}>
      <BackHeader title={t('tutor_social:SOC-15.title')} backLabel={t('ui:common.back')} onBack={back} />
      {!online ? <Banner tone="offline" icon="WifiSlash" text={t('tutor_social:SOC-15.offline')} /> : null}
      {error ? <Banner tone="warning" icon="Warning" text={t('tutor_social:SOC-19.expired')} testID="soc15-error" /> : null}
      <Text variant="heading">{t('tutor_social:SOC-15.who')}</Text>
      <ChoiceChips label={t('tutor_social:SOC-15.who')} hideLabel options={options} value={[who]} onChange={(v) => setWho(v[0] === 'random' ? 'random' : 'friend')} testID="soc15-who" />
      {!canRandom && app.store.getState().profile?.age_band === '10_12' ? (
        <Text variant="caption" tone="muted">
          {t('tutor_social:SOC-15.under_13_random')}
        </Text>
      ) : null}
      {who === 'friend' ? (
        <Stack gap={4}>
          {(friends.data ?? []).map((f) => (
            <FriendRow
              key={f.person.user_id ?? ''}
              selectable
              selected={friend === f.person.user_id}
              name={personName(f.person, t)}
              avatar={avatarOf(f.person)}
              studiedToday={f.studied_today}
              onPress={() => setFriend(f.person.user_id)}
              testID={`soc15-friend-${f.person.user_id}`}
            />
          ))}
          {friends.data && friends.data.length === 0 ? (
            <Button variant="secondary" label={t('tutor_social:SOC-01.empty_cta')} onPress={() => router.push('/social/add' as Href)} />
          ) : null}
        </Stack>
      ) : (
        <Text variant="caption" tone="muted">
          {t('tutor_social:SOC-15.random_note')}
        </Text>
      )}
      <Text variant="label" tone="muted" numeric testID="soc15-rules">
        {t('tutor_social:SOC-15.rules', { count, s: seconds })}
      </Text>
      <Stack gap={4}>
        <Text variant="heading">{t('tutor_social:SOC-15.demo_title')}</Text>
        {(['demo_lines.1', 'demo_lines.2', 'demo_lines.3'] as const).map((k) => (
          <Text key={k} variant="body">{`• ${t(`tutor_social:SOC-15.${k}`)}`}</Text>
        ))}
      </Stack>
    </Screen>
  );
}
