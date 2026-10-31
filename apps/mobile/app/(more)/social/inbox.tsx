import type { MessageKey } from '@smriti/i18n';
import { Button, Card, EmptyState, PetAvatar, Spinner, Text } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { acceptDuel, acceptDuo, acceptRequest, declineDuel, declineRequest, loadInbox, markInboxSeen, personName, type InboxItem } from '../../../src/features/social/services';
import { avatarOf, CheerSheet, socialKeys } from '../../../src/features/social/ui';
import { useApp, useT } from '../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../src/ui/Screen';

/** SOC-06, the inbox: friend requests, duel challenges, Duo invites and preset cheers. */
export default function Inbox() {
  const app = useApp();
  const t = useT();
  const qc = useQueryClient();
  const inbox = useQuery({ queryKey: ['social', 'inbox'], queryFn: () => loadInbox(app) });
  const [cheerBack, setCheerBack] = useState<InboxItem | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  useEffect(() => {
    void markInboxSeen(app).then(() => qc.invalidateQueries({ queryKey: socialKeys.overview }));
  }, [app, qc]);

  const act = async (item: InboxItem, label: string, fn: () => Promise<unknown>) => {
    await fn();
    setDone((d) => ({ ...d, [item.id]: label }));
    await qc.invalidateQueries({ queryKey: socialKeys.all });
  };

  const items = inbox.data?.items ?? [];
  const groups: { title: MessageKey | null; kinds: InboxItem['kind'][] }[] = [
    { title: 'tutor_social:SOC-06.requests_header', kinds: ['friend_request', 'duo_invite'] },
    { title: 'tutor_social:SOC-06.challenges', kinds: ['duel_challenge'] },
    { title: null, kinds: ['cheer', 'nudge'] },
  ];

  const line = (i: InboxItem) => {
    const name = personName(i.sender, t);
    switch (i.kind) {
      case 'friend_request':
        return t('tutor_social:SOC-06.request_line', { name });
      case 'duo_invite':
        return t('tutor_social:SOC-06.duo_line', { name });
      case 'duel_challenge':
        return t('tutor_social:SOC-06.challenge_line', { name });
      default:
        return t('tutor_social:SOC-06.cheer_line', { name, preset_message: i.preset_id ? t(`tutor_social:SOC-22.${i.preset_id}` as MessageKey) : '' });
    }
  };

  const actions = (i: InboxItem) => {
    if (done[i.id]) {
      return (
        <Text variant="label" tone="success">
          {done[i.id]}
        </Text>
      );
    }
    const from = i.sender.user_id ?? '';
    switch (i.kind) {
      case 'friend_request':
        return (
          <>
            <Button size="sm" label={t('tutor_social:SOC-06.accept')} onPress={() => void act(i, t('tutor_social:SOC-04.already_friends'), () => acceptRequest(app, from))} testID={`soc06-accept-${i.id}`} />
            <Button size="sm" variant="secondary" label={t('tutor_social:SOC-06.decline')} onPress={() => void act(i, t('tutor_social:SOC-06.decline'), () => declineRequest(app, from))} />
          </>
        );
      case 'duo_invite':
        return <Button size="sm" label={t('tutor_social:SOC-06.accept')} onPress={() => void act(i, t('tutor_social:SOC-12.done'), () => acceptDuo(app, i.id))} testID={`soc06-duo-${i.id}`} />;
      case 'duel_challenge':
        return (
          <>
            <Button
              size="sm"
              icon="Play"
              label={t('tutor_social:SOC-06.play')}
              onPress={async () => {
                await acceptDuel(app, i.id);
                router.push(`/social/duel/${i.id}` as Href);
              }}
              testID={`soc06-play-${i.id}`}
            />
            <Button size="sm" variant="secondary" label={t('tutor_social:SOC-20.not_now')} onPress={() => void act(i, t('tutor_social:SOC-20.not_now'), () => declineDuel(app, i.id))} />
          </>
        );
      default:
        return i.sender.user_id ? <Button size="sm" variant="secondary" icon="HandsClapping" label={t('tutor_social:SOC-06.cheer_back')} onPress={() => setCheerBack(i)} testID={`soc06-cheer-back-${i.id}`} /> : null;
    }
  };

  return (
    <Screen testID="SOC-06">
      <BackHeader title={t('tutor_social:SOC-06.title')} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/friends'))} />
      {inbox.isPending ? <Spinner label={t('tutor_social:SOC-06.title')} /> : null}
      {inbox.data && items.length === 0 ? <EmptyState illustration="ui-all-caught-up" text={t('tutor_social:SOC-06.empty')} testID="soc06-empty" /> : null}
      {groups.map((g) => {
        const list = items.filter((i) => g.kinds.includes(i.kind));
        if (!list.length) return null;
        return (
          <Stack key={g.kinds[0]} gap={8}>
            {g.title ? <Text variant="heading">{t(g.title)}</Text> : null}
            {list.map((i) => (
              <Card key={i.id} testID={`soc06-item-${i.id}`}>
                <Stack row gap={12}>
                  <PetAvatar species={avatarOf(i.sender).species} size={40} />
                  <Text variant="body" style={styles.grow}>
                    {line(i)}
                  </Text>
                </Stack>
                <View style={styles.actions}>{actions(i)}</View>
              </Card>
            ))}
          </Stack>
        );
      })}
      {cheerBack?.sender.user_id ? <CheerSheet open onClose={() => setCheerBack(null)} to={cheerBack.sender.user_id} name={personName(cheerBack.sender, t)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: 'flex-end' },
});
