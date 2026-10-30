import { Button, PlantView, Text } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../src/services/context';
import { firstTopicId } from '../../src/services/lessons';
import { useHaptics } from '../../src/ui/hooks';
import { OnboardingFrame } from '../../src/ui/Onboarding';

/** After this long without a tap, the primary button plants and starts in one go (ONB-12). */
const FALLBACK_MS = 12_000;

/** ONB-12: tap the pot to plant the seed, then the first lesson (ONB-13). */
export default function Seed() {
  const app = useApp();
  const t = useT();
  const haptics = useHaptics();
  const planted = useUiState((s) => s.onboarding.seedPlanted);
  const little = app.isLittleLearner();
  const [fallback, setFallback] = useState(false);
  const topicId = firstTopicId(app);
  const topic = topicId ? app.deps.content.topic(app.ui.getState().locale, topicId, app.examProfileId()) : null;

  useEffect(() => {
    if (planted) return;
    const id = setTimeout(() => setFallback(true), FALLBACK_MS);
    return () => clearTimeout(id);
  }, [planted]);

  const plant = async () => {
    if (planted) return;
    haptics.success();
    await app.plantSeed();
  };
  const start = async () => {
    if (!planted) await app.plantSeed();
    if (!topicId) {
      // No lesson on the device (empty seed pack): onboarding goes on and Home offers one later.
      const s = await app.finishFirstLesson(null);
      router.replace((s.step === 'first_win' ? '/onboarding/daily-goal' : '/') as Href);
      return;
    }
    router.push({ pathname: '/lesson/[topicId]', params: { topicId, mode: 'onboarding' } });
  };

  const primary = !planted && fallback ? t('onboarding:ONB-12.fallback_primary_after_12_s') : little ? t('onboarding:ONB-12.little_learner_primary') : t('onboarding:ONB-12.primary_lesson');
  const petLine = planted ? (topic?.minutes ? t('onboarding:ONB-12.pet_line_lesson', { minutes: topic.minutes }) : t('onboarding:ONB-12.pet_line_shared_topic', { topic_title: topic?.name ?? '' })) : undefined;

  return (
    <OnboardingFrame
      testID="ONB-12"
      back={!planted}
      petLine={petLine}
      footer={<Button label={primary} disabled={!planted && !fallback} onPress={() => void start()} fullWidth testID="seed-start" />}
    >
      <View style={styles.center}>
        <Text variant="display" heading align="center">
          {planted ? t('onboarding:ONB-12.headline_after') : little ? t('onboarding:ONB-12.little_learner_instruction') : t('onboarding:ONB-12.instruction')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onboarding:ONB-12.instruction')}
          accessibilityState={{ disabled: planted }}
          onPress={() => void plant()}
          testID="seed-pot"
          style={styles.pot}
        >
          <PlantView stage="seed" health="thriving" size={220} decorative />
        </Pressable>
        {planted ? (
          <Text variant="body" tone="muted" align="center" testID="seed-rule">
            {little ? t('onboarding:ONB-12.little_learner_rule') : t('onboarding:ONB-12.rule')}
          </Text>
        ) : null}
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 16, paddingTop: 24 },
  pot: { alignItems: 'center', justifyContent: 'center', minHeight: 240 },
});
