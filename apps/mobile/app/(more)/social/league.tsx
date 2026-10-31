import { Button, LeaderboardRow, LeagueTierBadge, PetLine, Spinner, Text } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { Fragment, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { joinLeague, loadLeague, personName } from '../../../src/features/social/services';
import { crestFor, socialKeys, useLocale } from '../../../src/features/social/ui';
import { useApp, useT } from '../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../src/ui/Screen';

/** SOC-08, this week's league: tier crest, time left, the cohort with promotion and demotion zones. */
export default function League() {
  const app = useApp();
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['social', 'league'], queryFn: () => loadLeague(app) });
  const l = q.data;
  const tracked = useRef(false);
  const me = l?.rows?.find((r) => r.person.is_self);

  useEffect(() => {
    if (!l || tracked.current || l.state !== 'in_cohort') return;
    tracked.current = true;
    const hours = Math.max(0, (Date.parse(l.closes_at) - app.deps.clock()) / 3_600_000);
    app.track('league_viewed', { tier: String(l.tier), zone: me?.zone ?? 'safe', hours_left_bucket: hours < 6 ? 'lt6' : hours < 24 ? 'lt24' : hours < 72 ? 'lt72' : 'gte72' });
  }, [app, l, me]);

  const ends = () => {
    if (!l) return '';
    const ms = Math.max(0, Date.parse(l.closes_at) - app.deps.clock());
    if (ms < 3_600_000) return t('tutor_social:SOC-08.ends_soon', { m: Math.ceil(ms / 60_000) });
    return t('tutor_social:SOC-08.ends_in', { d: Math.floor(ms / 86_400_000), h: Math.floor((ms % 86_400_000) / 3_600_000) });
  };
  const updated = l ? Math.max(0, Math.round((app.deps.clock() - Date.parse(l.updated_at)) / 60_000)) : 0;
  const pet = app.store.getState().pet;
  const petLine = me?.zone === 'promote' ? 'pet_line_promotion' : me?.zone === 'demote' ? 'pet_line_demotion' : 'pet_line_safe';

  return (
    <Screen testID="SOC-08" footer={l?.state === 'in_cohort' || l?.state === 'not_joined' ? <Button label={t('tutor_social:SOC-08.start_a_lesson')} onPress={() => router.replace('/learn')} testID="soc08-lesson" /> : undefined}>
      <BackHeader title={l ? t('tutor_social:SOC-08.title', { tier_name: l.tier_name[locale] }) : ''} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/friends' as Href))} />
      {q.isPending ? <Spinner label={t('tutor_social:SOC-01.leaderboards')} /> : null}
      {l ? (
        <>
          <View style={styles.band}>
            <LeagueTierBadge name={l.tier_name[locale]} crest={crestFor(app, l.tier)} size="lg" />
            <Text variant="label" numeric testID="soc08-ends">
              {ends()}
            </Text>
            <Text variant="caption" tone="muted" numeric>
              {t('tutor_social:SOC-08.updated', { n: updated })}
            </Text>
          </View>
          {l.state === 'join_available' ? (
            <Stack gap={8}>
              <Text variant="body">{t('tutor_social:SOC-08.teen_join.1')}</Text>
              <Button
                label={t('tutor_social:SOC-08.teen_join.2')}
                onPress={async () => {
                  await joinLeague(app);
                  app.track('league_joined', { source: 'teen_card' });
                  await qc.invalidateQueries({ queryKey: socialKeys.all });
                }}
                testID="soc08-join"
              />
            </Stack>
          ) : null}
          {l.state === 'not_joined' ? <Text variant="body">{t('tutor_social:SOC-08.not_joined')}</Text> : null}
          {l.state === 'opted_out' ? <Text variant="body">{t('tutor_social:SOC-08.opted_out')}</Text> : null}
          {me && pet ? <PetLine pet={{ species: pet.species === 'dog' ? 'dog' : 'cat', mood: me.zone === 'demote' ? 'curious' : 'happy' }} petName={pet.name} text={t(`tutor_social:SOC-08.${petLine}`)} /> : null}
          <View testID="soc08-rows">
            {(l.rows ?? []).map((r, i, all) => {
              const prev = all[i - 1];
              const promoteStart = r.zone === 'promote' && i === 0;
              const demoteStart = r.zone === 'demote' && prev?.zone !== 'demote';
              return (
                <Fragment key={`${r.rank}-${r.person.user_id ?? i}`}>
                  {promoteStart ? <Divider text={t('tutor_social:SOC-08.promotion_divider', { n: l.promote_count })} /> : null}
                  {demoteStart ? <Divider text={t('tutor_social:SOC-08.demotion_divider', { n: l.demote_count })} /> : null}
                  <LeaderboardRow rank={r.rank} avatar={{ kind: 'pet', species: r.person.avatar?.species === 'dog' ? 'dog' : 'cat' }} name={personName(r.person, t)} score={`${r.xp} XP`} isSelf={r.person.is_self} testID={`soc08-row-${r.rank}`} />
                  {r.zone === 'promote' && all[i + 1] && all[i + 1]!.zone !== 'promote' ? <Divider text={t('tutor_social:SOC-01.zones.2')} /> : null}
                </Fragment>
              );
            })}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function Divider({ text }: { text: string }) {
  return (
    <View style={styles.divider} accessibilityRole="header">
      <Text variant="caption" tone="muted">
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { alignItems: 'center', gap: 4 },
  divider: { paddingVertical: 8, paddingHorizontal: 4 },
});
