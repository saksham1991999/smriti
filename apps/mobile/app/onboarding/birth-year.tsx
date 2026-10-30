import { Button, Picker, Text } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { useState } from 'react';

import { useApp, useT, useUiState } from '../../src/services/context';
import { questionSteps, STEP_ROUTE } from '../../src/services/onboarding';
import { OnboardingFrame } from '../../src/ui/Onboarding';

/** ONB-04: birth year (DPDP age gate). "Prefer not to say" uses the under-18 settings. */
export default function BirthYear() {
  const app = useApp();
  const t = useT();
  const ob = useUiState((s) => s.onboarding);
  const thisYear = new Date(app.now()).getFullYear();
  const [year, setYear] = useState<string | null>(typeof ob.birthYear === 'number' ? String(ob.birthYear) : null);
  const years = Array.from({ length: 70 }, (_, i) => String(thisYear - 4 - i));
  const steps = questionSteps(ob, app.deps.variant.examProfileIds.length !== 1);
  const go = async (v: number | 'declined') => {
    const s = await app.answerBirthYear(v);
    router.push(STEP_ROUTE[s.step] as Href);
  };
  return (
    <OnboardingFrame
      testID="ONB-04"
      step={steps.indexOf('birth_year')}
      total={steps.length + 1}
      headline={t('onboarding:ONB-04.headline')}
      helper={t('onboarding:ONB-04.helper')}
      petLine={year ? t('onboarding:ONB-04.pet_reaction') : undefined}
      footer={
        <>
          <Button label={t('onboarding:ONB-04.primary')} disabled={!year} onPress={() => year && void go(Number(year))} fullWidth testID="birth-continue" />
          <Button variant="ghost" label={t('onboarding:ONB-04.decline')} onPress={() => void go('declined')} fullWidth testID="birth-decline" />
          <Text variant="caption" tone="muted" align="center">
            {t('onboarding:ONB-04.decline_note')}
          </Text>
        </>
      }
    >
      <Picker label={t('onboarding:ONB-04.headline')} options={years.map((y) => ({ value: y, label: y }))} value={year} onChange={setYear} testID="birth-year" />
    </OnboardingFrame>
  );
}
