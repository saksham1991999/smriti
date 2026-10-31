import { Button, Card, EmptyState, FriendRow, Icon, PetAvatar, PetLine, Spinner, Text } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { acceptDuo, inviteDuos, loadDuos, loadFriends, nudgeDuo, personName, type Duo } from '../../../src/features/social/services';
import { avatarOf, CheerSheet, SocialToast, socialKeys } from '../../../src/features/social/ui';
import { useApp, useT } from '../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../src/ui/Screen';

/** SOC-12 (my Duos, with a preset nudge) and SOC-11 (pick friends to start one, `?start=1`). */
export default function Duos() {
  const app = useApp();
  const t = useT();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ start?: string }>();
  const [picking, setPicking] = useState(params.start === '1');
  const [picked, setPicked] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [nudge, setNudge] = useState<Duo | null>(null);
  const duos = useQuery({ queryKey: ['social', 'duos'], queryFn: () => loadDuos(app) });
  const friends = useQuery({ queryKey: ['social', 'friends'], queryFn: () => loadFriends(app), enabled: picking });
  const max = Number(app.flags.get('social.duo_max_partners') ?? 5);
  const list = duos.data ?? [];
  const active = list.filter((d) => d.status === 'active');
  const doneToday = active.filter((d) => d.me_today && d.partner_today).length;
  const pet = app.store.getState().pet;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/friends' as Href));
  const inDuo = new Set(list.map((d) => d.partner.user_id));

  const send = async () => {
    const r = await inviteDuos(app, picked);
    app.track('duo_invited', { partners_count: r.invited.length });
    setPicked([]);
    setPicking(false);
    setToast(t('tutor_social:SOC-11.sent_toast'));
    await qc.invalidateQueries({ queryKey: socialKeys.all });
  };

  if (picking) {
    const free = Math.max(0, max - list.length);
    return (
      <Screen
        testID="SOC-11"
        footer={
          <>
            <Button label={t('tutor_social:SOC-11.send', { n: picked.length })} disabled={!picked.length} onPress={() => void send()} testID="soc11-send" />
            <Button variant="ghost" label={t('tutor_social:SOC-11.not_now')} onPress={() => setPicking(false)} />
          </>
        }
      >
        <BackHeader title={t('tutor_social:SOC-11.sender_title')} backLabel={t('ui:common.back')} onBack={() => setPicking(false)} />
        <Text variant="body">{t('tutor_social:SOC-11.body')}</Text>
        <Text variant="label" tone="muted" numeric>
          {t('tutor_social:SOC-11.slots', { used: list.length, max })}
        </Text>
        <Stack gap={4}>
          {(['rule_1', 'rule_2', 'rule_3'] as const).map((k) => (
            <Text key={k} variant="caption" tone="muted">{`• ${t(`tutor_social:SOC-11.${k}`)}`}</Text>
          ))}
        </Stack>
        <Text variant="heading">{t('tutor_social:SOC-11.picker_header')}</Text>
        {free === 0 ? <Text variant="body">{t('tutor_social:SOC-11.all_slots_used', { max })}</Text> : null}
        {(friends.data ?? [])
          .filter((f) => f.person.user_id && !inDuo.has(f.person.user_id))
          .map((f) => {
            const id = f.person.user_id!;
            const on = picked.includes(id);
            return (
              <FriendRow
                key={id}
                selectable
                selected={on}
                disabled={!on && picked.length >= free}
                name={personName(f.person, t)}
                avatar={avatarOf(f.person)}
                studiedToday={f.studied_today}
                onPress={() => setPicked((p) => (on ? p.filter((x) => x !== id) : [...p, id]))}
                testID={`soc11-pick-${id}`}
              />
            );
          })}
      </Screen>
    );
  }

  return (
    <Screen testID="SOC-12" footer={<Button icon="Plus" label={t('tutor_social:SOC-12.start_a_duo')} disabled={list.length >= max} onPress={() => setPicking(true)} testID="soc12-start" />}>
      <BackHeader title={t('tutor_social:SOC-12.title')} backLabel={t('ui:common.back')} onBack={back} trailing={<Text variant="label" tone="muted" numeric>{t('tutor_social:SOC-12.slots', { used: list.length, max })}</Text>} />
      {duos.isPending ? <Spinner label={t('tutor_social:SOC-12.title')} /> : null}
      {duos.data && list.length === 0 ? <EmptyState pet={{ species: pet?.species === 'dog' ? 'dog' : 'cat', mood: 'curious' }} text={`${t('tutor_social:SOC-12.empty_title')}. ${t('tutor_social:SOC-12.empty_body')}`} testID="soc12-empty" /> : null}
      {active.length && pet ? (
        <PetLine
          pet={{ species: pet.species === 'dog' ? 'dog' : 'cat', mood: 'happy' }}
          petName={pet.name}
          text={doneToday === active.length ? t('tutor_social:SOC-12.pet_line_all_done') : doneToday === 0 ? t('tutor_social:SOC-12.pet_line_none_yet') : t('tutor_social:SOC-12.pet_line_mixed', { done: doneToday, total: active.length })}
        />
      ) : null}
      {list.map((d) => {
        const name = personName(d.partner, t);
        return (
          <Card key={d.id} testID={`soc12-duo-${d.id}`}>
            <Stack gap={12}>
              <Stack row gap={12}>
                <PetAvatar species={avatarOf(d.partner).species} size={48} />
                <View style={styles.grow}>
                  <Text variant="heading">{name}</Text>
                  <Stack row gap={4}>
                    <Icon name="Plant" size={16} color="streakText" />
                    <Text variant="label" tone="streak" numeric>
                      {t('tutor_social:SOC-12.card_streak', { n: d.shared_streak })}
                    </Text>
                  </Stack>
                </View>
              </Stack>
              {d.status === 'active' ? (
                <View style={styles.today}>
                  <Today who={t('tutor_social:SOC-12.you')} done={d.me_today} />
                  <Today who={name} done={d.partner_today} />
                </View>
              ) : null}
              {d.status === 'invited' && !d.invited_by_me ? (
                <Button
                  size="sm"
                  label={t('tutor_social:SOC-11.accept')}
                  onPress={async () => {
                    await acceptDuo(app, d.id);
                    await qc.invalidateQueries({ queryKey: socialKeys.all });
                  }}
                  testID={`soc12-accept-${d.id}`}
                />
              ) : null}
              {d.status === 'invited' && d.invited_by_me ? (
                <Text variant="caption" tone="muted">
                  {t('tutor_social:SOC-16.waiting_for_friend', { name })}
                </Text>
              ) : null}
              {d.status === 'active' && !d.partner_today ? <Button size="sm" variant="secondary" icon="Bell" label={t('tutor_social:SOC-25.nudge', { name })} onPress={() => setNudge(d)} testID={`soc12-nudge-${d.id}`} /> : null}
            </Stack>
          </Card>
        );
      })}
      <Text variant="caption" tone="muted" align="center">
        {t('tutor_social:SOC-12.footer')}
      </Text>
      {nudge ? <CheerSheet open kind="nudge" onClose={() => setNudge(null)} to={nudge.partner.user_id ?? ''} name={personName(nudge.partner, t)} send={(preset) => nudgeDuo(app, nudge.id, preset).then(() => 'sent' as const)} /> : null}
      <SocialToast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

function Today({ who, done }: { who: string; done: boolean }) {
  const t = useT();
  return (
    <View style={styles.side} accessible accessibilityLabel={`${who}, ${done ? t('tutor_social:SOC-12.done') : t('tutor_social:SOC-12.not_yet')}`}>
      <Icon name={done ? 'CheckCircle' : 'Circle'} size={20} weight={done ? 'fill' : 'bold'} color={done ? 'successText' : 'inkMuted'} />
      <Text variant="label" numberOfLines={1} style={styles.grow}>
        {who}
      </Text>
      <Text variant="caption" tone={done ? 'success' : 'muted'}>
        {done ? t('tutor_social:SOC-12.done') : t('tutor_social:SOC-12.not_yet')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  today: { gap: 8 },
  side: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
