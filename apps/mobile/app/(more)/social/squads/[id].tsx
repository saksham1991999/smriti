import { Banner, Button, Card, FriendRow, ProgressBar, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';

import { cheerSquad, inviteLink, loadSquad, personName } from '../../../../src/features/social/services';
import { avatarOf, shareOrCopy, SocialToast } from '../../../../src/features/social/ui';
import { useApp, useT } from '../../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../../src/ui/Screen';

/** SOC-14, a squad's home: who studied today, this week's XP, the quest (when configured) and a cheer. */
export default function SquadHome() {
  const app = useApp();
  const t = useT();
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const q = useQuery({ queryKey: ['social', 'squad', id], queryFn: () => loadSquad(app, id) });
  const [toast, setToast] = useState<string | null>(null);
  const [cheered, setCheered] = useState(false);
  const s = q.data;

  const share = async () => {
    if (!s?.invite_code) return;
    const link = inviteLink(app, `/squad/${s.invite_code}`);
    const out = await shareOrCopy(t('tutor_social:SOC-04.share_message', { app_name: app.appName(), link }), link);
    if (out === 'copied') setToast(t('tutor_social:SOC-04.copied'));
  };

  const cheer = async () => {
    if (!s) return;
    await cheerSquad(app, s.id);
    setCheered(true);
    setToast(t('tutor_social:SOC-22.sent'));
  };

  return (
    <Screen testID="SOC-14" footer={s ? <Button icon="HandsClapping" label={t('tutor_social:SOC-14.cheer_the_squad')} disabled={cheered || s.member_count < 2} onPress={() => void cheer()} testID="soc14-cheer" /> : undefined}>
      <BackHeader title={s?.name ?? ''} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/friends' as Href))} />
      {q.isPending ? <Spinner label={t('tutor_social:SOC-01.squads')} /> : null}
      {s ? (
        <>
          {created === '1' ? <Banner tone="info" icon="CheckCircle" text={t('tutor_social:SOC-13.created', { squad_name: s.name })} testID="soc14-created" /> : null}
          <Card>
            <Stack gap={8}>
              <Text variant="label" tone="muted" numeric>
                {t('tutor_social:SOC-14.members', { n: s.member_count })}
              </Text>
              {s.invite_code ? (
                <Stack row gap={12}>
                  <Text variant="title" numeric style={{ flex: 1 }} testID="soc14-code">
                    {s.invite_code}
                  </Text>
                  <Button size="sm" variant="secondary" icon="PaperPlaneRight" label={t('tutor_social:SOC-14.invite')} onPress={() => void share()} testID="soc14-invite" />
                </Stack>
              ) : null}
            </Stack>
          </Card>
          {s.quest ? (
            <Card tone="tint" testID="soc14-quest">
              <Stack gap={8}>
                <Text variant="heading">{t('tutor_social:SOC-14.quest_header')}</Text>
                <ProgressBar value={s.quest.target ? Math.min(1, s.quest.progress / s.quest.target) : 0} tone="streak" label={t('tutor_social:SOC-14.quest_progress', { done: s.quest.progress, target: s.quest.target })} />
                <Text variant="label" numeric>
                  {s.quest.completed ? t('tutor_social:SOC-14.quest_done') : t('tutor_social:SOC-14.quest_progress', { done: s.quest.progress, target: s.quest.target })}
                </Text>
              </Stack>
            </Card>
          ) : null}
          <Text variant="heading">{t('tutor_social:SOC-14.today')}</Text>
          <Stack gap={4}>
            {(s.members ?? []).map((m) => (
              <FriendRow key={m.person.user_id ?? personName(m.person, t)} name={m.person.is_self ? t('tutor_social:SOC-08.you') : personName(m.person, t)} avatar={avatarOf(m.person)} studiedToday={m.studied_today} note={`${t('tutor_social:SOC-14.this_week')}: ${m.week_xp} XP`} testID={`soc14-member-${m.person.user_id}`} />
            ))}
          </Stack>
        </>
      ) : null}
      <SocialToast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}
