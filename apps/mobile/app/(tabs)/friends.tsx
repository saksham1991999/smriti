import { Banner, Button, Card, Chip, EmptyState, FriendRow, IconButton, LeagueTierBadge, PetLine, Sheet, Spinner, SquadCard, Text, TopBar, useTheme } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { joinLeague, loadOverview, personName, type FriendRow as Friend } from '../../src/features/social/services';
import { avatarOf, CheerSheet, crestFor, GatePanel, socialKeys, useGate, useLocale } from '../../src/features/social/ui';
import { useApp, useT } from '../../src/services/context';
import { Screen, Stack } from '../../src/ui/Screen';

/**
 * SOC-01, the Friends tab (R46: Phase 2, behind `feature.friends`). The server's gate decides
 * whether it opens; a locked state is SOC-02. Names arrive already resolved for the viewer (R31).
 */
export default function Friends() {
  const t = useT();
  const gate = useGate();
  const qc = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: socialKeys.all });
    }, [qc]),
  );
  const ok = gate.data?.state === 'ok';
  return (
    <Screen testID="SOC-01" edges="top">
      <TopBar
        title={t('tutor_social:SOC-01.title')}
        trailing={
          ok ? (
            <View style={styles.row}>
              <InboxButton />
              <IconButton icon="Plus" label={t('tutor_social:SOC-04.title')} onPress={() => router.push('/social/add' as Href)} testID="soc01-add" />
            </View>
          ) : undefined
        }
      />
      {gate.isPending ? <Spinner label={t('tutor_social:SOC-01.title')} /> : null}
      {gate.isError ? <Banner tone="offline" icon="WifiSlash" text={t('tutor_social:SOC-15.offline')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void gate.refetch() }} /> : null}
      {gate.data && !ok ? <GatePanel gate={gate.data} /> : null}
      {ok ? <Hub /> : null}
    </Screen>
  );
}

function InboxButton() {
  const app = useApp();
  const t = useT();
  const o = useQuery({ queryKey: socialKeys.overview, queryFn: () => loadOverview(app) });
  const theme = useTheme();
  const n = o.data?.inbox_unread ?? 0;
  return (
    <View>
      <IconButton icon="Bell" label={n ? `${t('tutor_social:SOC-06.title')}, ${n}` : t('tutor_social:SOC-06.title')} onPress={() => router.push('/social/inbox' as Href)} testID="soc01-inbox" />
      {n ? (
        <View pointerEvents="none" style={[styles.dot, { backgroundColor: theme.colors.primary, borderColor: theme.colors.bg }]}>
          <Text variant="caption" numeric style={{ color: theme.colors.onPrimary }}>
            {n > 9 ? '9+' : String(n)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Hub() {
  const app = useApp();
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const o = useQuery({ queryKey: socialKeys.overview, queryFn: () => loadOverview(app) });
  const [person, setPerson] = useState<Friend | null>(null);
  const [cheer, setCheer] = useState<Friend | null>(null);
  if (o.isPending) return <Spinner label={t('tutor_social:SOC-01.title')} />;
  if (o.isError || !o.data) return <Banner tone="warning" icon="Warning" text={t('tutor_social:SOC-15.offline')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void o.refetch() }} />;
  const { league, friends_today: friends = [], duos = [], squads = [], gate } = o.data;
  const has = (f: NonNullable<typeof gate.features>[number]) => gate.features?.includes(f) ?? false;
  const maxDuos = Number(app.flags.get('social.duo_max_partners') ?? 5);
  const allStudied = friends.length > 0 && friends.every((f) => f.studied_today);
  const pet = app.store.getState().pet;

  const join = async () => {
    await joinLeague(app);
    app.track('league_joined', { source: 'teen_card' });
    await qc.invalidateQueries({ queryKey: socialKeys.all });
  };

  return (
    <Stack gap={16}>
      {league && has('league') ? (
        <Card onPress={() => router.push('/social/league' as Href)} accessibilityLabel={t('tutor_social:SOC-01.league_card', { tier_name: league.tier_name[locale] })} testID="soc01-league">
          <Stack row gap={12}>
            <LeagueTierBadge name={league.tier_name[locale]} crest={crestFor(app, league.tier)} size="sm" showName={false} />
            <View style={styles.grow}>
              <Text variant="heading">{t('tutor_social:SOC-01.league_card', { tier_name: league.tier_name[locale] })}</Text>
              {league.state === 'in_cohort' && league.my_rank ? (
                <Text variant="body" numeric testID="soc01-rank">
                  {t('tutor_social:SOC-01.rank_line', { rank: league.my_rank, xp: league.my_xp })}
                </Text>
              ) : league.state === 'join_available' ? (
                <Text variant="body">{t('tutor_social:SOC-01.teen_join_card')}</Text>
              ) : league.state === 'opted_out' ? (
                <Text variant="body">{t('tutor_social:SOC-01.opted_out')}</Text>
              ) : (
                <Text variant="body" tone="muted">
                  {t('tutor_social:SOC-01.not_in_league_yet')}
                </Text>
              )}
            </View>
            {league.state === 'join_available' ? <Button size="sm" label={t('tutor_social:SOC-01.teen_join_button')} onPress={() => void join()} testID="soc01-join" /> : null}
          </Stack>
        </Card>
      ) : null}

      {friends.length === 0 ? (
        <EmptyState
          pet={{ species: pet?.species === 'dog' ? 'dog' : 'cat', mood: 'curious' }}
          text={`${t('tutor_social:SOC-01.empty_no_friends_title')} ${t('tutor_social:SOC-01.empty_body')}`}
          action={{ label: t('tutor_social:SOC-01.empty_cta'), onPress: () => router.push('/social/add' as Href) }}
          testID="soc01-empty"
        />
      ) : (
        <Stack gap={4}>
          <Text variant="heading">{t('tutor_social:SOC-01.friends_today')}</Text>
          {friends.map((f) => (
            <FriendRow key={f.person.user_id ?? ''} name={personName(f.person, t)} avatar={avatarOf(f.person)} studiedToday={f.studied_today} streakDays={f.streak} onPress={() => setPerson(f)} testID={`soc01-friend-${f.person.user_id}`} />
          ))}
          {allStudied && pet ? <PetLine pet={{ species: pet.species === 'dog' ? 'dog' : 'cat', mood: 'happy' }} petName={pet.name} text={t('tutor_social:SOC-01.pet_line_all_friends_studied')} /> : null}
        </Stack>
      )}

      {has('duo') ? (
        <Stack gap={8}>
          <Stack row gap={8}>
            <Text variant="heading" style={styles.grow}>
              {t('tutor_social:SOC-01.duos_header', { used: duos.length, max: maxDuos })}
            </Text>
            <Button size="sm" variant="ghost" label={t('tutor_social:SOC-01.see_all')} onPress={() => router.push('/social/duos' as Href)} testID="soc01-duos" />
          </Stack>
          {duos.length ? (
            <View style={styles.wrap}>
              {duos.map((d) => (
                <Chip key={d.id} icon="Plant" label={`${personName(d.partner, t)} · ${t('tutor_social:SOC-01.duo_chip', { n: d.shared_streak })}`} onPress={() => router.push('/social/duos' as Href)} />
              ))}
            </View>
          ) : (
            <Card tone="tint" onPress={() => router.push({ pathname: '/social/duos', params: { start: '1' } } as unknown as Href)} accessibilityLabel={t('tutor_social:SOC-01.start_a_duo')} testID="soc01-start-duo">
              <Text variant="label">{t('tutor_social:SOC-01.start_a_duo')}</Text>
              <Text variant="caption" tone="muted">
                {t('tutor_social:SOC-01.start_a_duo_explainer')}
              </Text>
            </Card>
          )}
        </Stack>
      ) : null}

      {has('friend_duel') || has('random_duel') ? (
        <Card testID="soc01-challenge">
          <Stack row gap={12}>
            <Text variant="heading" style={styles.grow}>
              {t('tutor_social:SOC-01.challenge')}
            </Text>
            <Button size="sm" icon="Lightning" label={t('tutor_social:SOC-01.duel_button')} onPress={() => router.push('/social/duel' as Href)} testID="soc01-duel" />
          </Stack>
        </Card>
      ) : null}

      {has('squad') ? (
        <Stack gap={8}>
          <Stack row gap={8}>
            <Text variant="heading" style={styles.grow}>
              {t('tutor_social:SOC-01.squads')}
            </Text>
            <Button size="sm" variant="ghost" label={t('tutor_social:SOC-01.create')} onPress={() => router.push({ pathname: '/social/squads', params: { tab: 'create' } } as unknown as Href)} testID="soc01-squad-create" />
            <Button size="sm" variant="ghost" label={t('tutor_social:SOC-01.join')} onPress={() => router.push({ pathname: '/social/squads', params: { tab: 'join' } } as unknown as Href)} testID="soc01-squad-join" />
          </Stack>
          {squads.map((s) =>
            s.quest ? (
              <SquadCard key={s.id} name={s.name} crest={s.crest_id ?? 'squad-crest-tulsi'} done={s.quest.progress} target={s.quest.target} onPress={() => router.push(`/social/squads/${s.id}` as Href)} testID={`soc01-squad-${s.id}`} />
            ) : (
              <Card key={s.id} onPress={() => router.push(`/social/squads/${s.id}` as Href)} accessibilityLabel={s.name} testID={`soc01-squad-${s.id}`}>
                <Text variant="label">{s.name}</Text>
                <Text variant="caption" tone="muted">
                  {t('tutor_social:SOC-14.members', { n: s.member_count })}
                </Text>
              </Card>
            ),
          )}
        </Stack>
      ) : null}

      {has('share_deck') ? <Button variant="secondary" icon="Cards" label={t('tutor_social:SOC-01.shared_decks')} onPress={() => router.push('/social/decks' as Href)} testID="soc01-decks" /> : null}

      <PersonSheet
        friend={person}
        onClose={() => setPerson(null)}
        canDuel={has('friend_duel')}
        canCheer={has('cheer')}
        onCheer={(f) => {
          setPerson(null);
          setCheer(f);
        }}
      />
      {cheer?.person.user_id ? <CheerSheet open onClose={() => setCheer(null)} to={cheer.person.user_id} name={personName(cheer.person, t)} /> : null}
    </Stack>
  );
}

/** SOC-07 in brief: the friend's day and streak, with Challenge and Cheer. */
function PersonSheet({ friend, onClose, canDuel, canCheer, onCheer }: { friend: Friend | null; onClose: () => void; canDuel: boolean; canCheer: boolean; onCheer: (f: Friend) => void }) {
  const t = useT();
  if (!friend) return null;
  const name = personName(friend.person, t);
  return (
    <Sheet open onOpenChange={(o) => (o ? undefined : onClose())} title={name} testID="SOC-07">
      <Stack gap={12}>
        <FriendRow name={name} avatar={avatarOf(friend.person)} studiedToday={friend.studied_today} streakDays={friend.streak} />
        <Text variant="body" numeric>
          {t('tutor_social:SOC-07.streak_tile', { n: friend.streak })}
        </Text>
        <View style={styles.wrap}>
          {canDuel ? (
            <Button
              size="sm"
              icon="Lightning"
              label={t('tutor_social:SOC-07.challenge')}
              onPress={() => {
                onClose();
                router.push({ pathname: '/social/duel', params: { friend: friend.person.user_id ?? '' } } as unknown as Href);
              }}
              testID="soc07-challenge"
            />
          ) : null}
          {canCheer ? <Button size="sm" variant="secondary" icon="HandsClapping" label={t('tutor_social:SOC-07.cheer')} onPress={() => onCheer(friend)} testID="soc07-cheer" /> : null}
        </View>
      </Stack>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  dot: { position: 'absolute', top: 4, right: 2, minWidth: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
