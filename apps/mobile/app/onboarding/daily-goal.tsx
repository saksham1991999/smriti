import { Button, OptionCard, Text } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useApp, useT, useUiState } from '../../src/services/context';
import { OnboardingFrame } from '../../src/ui/Onboarding';

const STOPS = [5, 10, 20, 30] as const;

/** ONB-08: minutes a day, after the first lesson. 10 is preselected. */
export default function DailyGoal() {
  const app = useApp();
  const t = useT();
  const ob = useUiState((s) => s.onboarding);
  const [minutes, setMinutes] = useState<number>(ob.dailyGoalMinutes ?? 10);
  const go = async () => {
    await app.setDailyGoal(minutes, true);
    router.replace('/onboarding/reminder' as Href);
  };
  return (
    <OnboardingFrame
      testID="ONB-08"
      back={false}
      headline={t('onboarding:ONB-08.headline')}
      helper={ob.firstLesson ? t('onboarding:ONB-08.helper', { minutes: ob.firstLesson.minutes }) : t('onboarding:ONB-08.helper_deferred')}
      petLine={t('onboarding:ONB-08.pet_line')}
      footer={
        <>
          <Button label={t('onboarding:ONB-08.primary')} onPress={() => void go()} fullWidth testID="goal-set" />
          <Text variant="caption" tone="muted" align="center">
            {t('onboarding:ONB-08.change_note')}
          </Text>
        </>
      }
    >
      <View style={{ gap: 12 }} accessibilityRole="radiogroup">
        {STOPS.map((m) => (
          <OptionCard
            key={m}
            kind="choice"
            label={t(`onboarding:ONB-08.stop_${m}.1`)}
            description={t(`onboarding:ONB-08.stop_${m}.2`)}
            state={minutes === m ? 'selected' : 'idle'}
            onPress={() => setMinutes(m)}
            testID={`daily-${m}`}
          />
        ))}
      </View>
      <Text variant="body" tone="muted">
        {t('onboarding:ONB-08.streak_note')}
      </Text>
    </OnboardingFrame>
  );
}
