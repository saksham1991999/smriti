import { useAppStore } from '@smriti/app-core/react';
import { Card, GoogleButton, PetAvatar, PlantView, SaveStateChip, SettingsGroup, SettingsRow, StatTile, Text, TrustLine } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../src/services/context';
import { BuddyLine } from '../../src/ui/Onboarding';
import { Screen } from '../../src/ui/Screen';

/** ME-01: who you are, what you have done, Pro, and the way to Settings. */
export default function Me() {
  const app = useApp();
  const t = useT();
  const pet = useAppStore((s) => s.pet);
  const plant = useAppStore((s) => s.plant);
  const streak = useAppStore((s) => s.streak);
  const wallet = useAppStore((s) => s.wallet);
  const profile = useAppStore((s) => s.profile);
  const entitlement = useAppStore((s) => s.entitlement);
  const syncing = useAppStore((s) => s.syncStatus === 'flushing');
  const signedIn = useAppStore((s) => s.session.status === 'signed_in');
  const lessons = useUiState((s) => s.lessonsCompleted);
  const pro = entitlement?.plan === 'pro';
  const little = app.isLittleLearner();
  const goSignIn = () => router.push({ pathname: '/sign-in', params: { mode: 'soft', reason: 'save_progress' } });

  return (
    <Screen testID="ME-01" edges="top">
      <View style={styles.header}>
        {pet ? <PetAvatar species={pet.species} size={56} /> : null}
        <View style={styles.grow}>
          <Text variant="title" heading>
            {signedIn ? (profile?.display_name ?? t('me_money:ME-01.title')) : t('me_money:ME-01.guest_name')}
          </Text>
          <SaveStateChip state={!signedIn ? 'guest' : syncing ? 'saving' : 'saved'} {...(!signedIn ? { onPress: goSignIn } : {})} testID="save-state" />
        </View>
      </View>

      {!signedIn && !little ? (
        <Card tone="tint" testID="guest-card">
          <View style={styles.gap}>
            <Text variant="heading">{t('me_money:ME-01.guest_card_title')}</Text>
            <Text variant="body" tone="muted">
              {t('me_money:ME-01.guest_card_body', { pet: pet?.name ?? '' })}
            </Text>
            <GoogleButton onPress={goSignIn} platform={Platform.OS === 'web' ? 'web' : Platform.OS === 'ios' ? 'ios' : 'android'} testID="me-google" />
            <TrustLine />
          </View>
        </Card>
      ) : null}

      <View style={styles.tiles}>
        <StatTile style={styles.tile} icon="Plant" value={String(streak?.current ?? 0)} label={t('me_money:ME-01.stat_streak')} testID="me-streak" />
        <StatTile style={styles.tile} icon="Lightning" value={String(wallet?.xp_total ?? 0)} label={t('me_money:ME-01.stat_xp')} testID="me-xp" />
        <StatTile style={styles.tile} icon="BookBookmark" value={String(lessons)} label={t('me_money:ME-01.stat_lessons')} testID="me-lessons" />
      </View>

      <Card outlined testID="plant-card">
        <View style={styles.row}>
          <PlantView stage={plant?.stage ?? 'seed'} health={plant?.health ?? 'thriving'} size={64} decorative />
          <Text variant="heading" style={styles.grow}>
            {t('me_money:ME-01.plant_card')}
          </Text>
        </View>
      </Card>

      {!little ? (
        <Card tone={pro ? 'surface' : 'tint'} outlined onPress={() => router.push({ pathname: '/paywall', params: { from: 'me_card' } })} accessibilityLabel={pro ? t('me_money:ME-01.pro_card_pro.1') : t('me_money:ME-01.pro_card_eligible')} testID="pro-card">
          <Text variant="heading">{pro ? t('me_money:ME-01.pro_card_pro.1') : t('me_money:ME-01.pro_card_eligible')}</Text>
        </Card>
      ) : null}

      <SettingsGroup title={t('me_money:ME-01.learning_group')}>
        <SettingsRow title={t('me_money:ME-01.my_memory')} icon="Brain" onPress={() => router.push('/memory' as Href)} testID="me-memory" />
        <SettingsRow title={little ? t('me_money:ME-01.for_grown_ups_little_learner') : t('me_money:SET-01.title')} icon="Gear" onPress={() => router.push('/settings' as Href)} testID="me-settings" />
      </SettingsGroup>

      {!signedIn && pet ? <BuddyLine text={t('me_money:ME-01.pet_line_guest')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, gap: 6, alignItems: 'flex-start' },
  gap: { gap: 10 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
