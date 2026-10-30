import { useAppStore } from '@smriti/app-core/react';
import { Button, Chip, PlantView, StatTile, Text } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../src/services/context';
import { STEP_ROUTE } from '../../src/services/onboarding';
import { OnboardingFrame } from '../../src/ui/Onboarding';

/** ONB-14: the seed sprouted. Day 1, and what the first lesson earned. */
export default function FirstWin() {
  const app = useApp();
  const t = useT();
  const result = useUiState((s) => s.onboarding.firstLesson);
  const plant = useAppStore((s) => s.plant);
  const synced = useAppStore((s) => s.updatedAt !== null);
  const little = app.isLittleLearner();
  const go = async () => {
    const s = await app.leaveFirstWin();
    router.replace(STEP_ROUTE[s.step] as Href);
  };
  return (
    <OnboardingFrame
      testID="ONB-14"
      back={false}
      petLine={little ? t('onboarding:ONB-14.little_learner_pet_line') : t('onboarding:ONB-14.pet_line')}
      footer={<Button label={t('onboarding:ONB-14.primary')} onPress={() => void go()} fullWidth testID="first-win-continue" />}
    >
      <View style={styles.center}>
        <PlantView stage={plant?.stage === 'seed' || !plant ? 'sprout' : plant.stage} health="thriving" size={200} alt={t('onboarding:ONB-14.headline')} />
        <Text variant="display" heading align="center">
          {little ? t('onboarding:ONB-14.little_learner_headline') : t('onboarding:ONB-14.headline')}
        </Text>
        <Chip kind="status" tone="streak" icon="Plant" label={t('onboarding:ONB-14.streak_pill')} accessibilityLabel={t('onboarding:ONB-14.streak_pill_a11y')} testID="first-win-day" />
      </View>
      {result ? (
        <View style={styles.tiles}>
          <StatTile style={styles.tile} icon="Lightning" value={t('onboarding:ONB-14.xp_tile', { xp: result.xp })} label={t('learn:LES-08.stat_labels.1')} tint testID="first-win-xp" />
          {result.accuracy !== null ? (
            <StatTile style={styles.tile} icon="CheckCircle" value={t('onboarding:ONB-14.accuracy_tile.1', { accuracy: Math.round(result.accuracy * 100) })} label={t('onboarding:ONB-14.accuracy_tile.2')} />
          ) : null}
          <StatTile style={styles.tile} icon="Timer" value={t('onboarding:ONB-14.time_tile.1', { minutes: result.minutes })} label={t('onboarding:ONB-14.time_tile.2')} />
        </View>
      ) : null}
      {!synced ? (
        <Text variant="caption" tone="muted" align="center">
          {t('onboarding:ONB-14.defer_sync_chip')}
        </Text>
      ) : null}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 12, paddingTop: 8 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1 },
});
