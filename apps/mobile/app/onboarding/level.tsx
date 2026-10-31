import { Button, OptionCard } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useApp, useT, useUiState } from '../../src/services/context';
import { examName } from '../../src/services/exams';
import { questionSteps, STEP_ROUTE, type SelfLevel } from '../../src/services/onboarding';
import { OnboardingFrame } from '../../src/ui/Onboarding';

const LEVELS: SelfLevel[] = ['starting', 'basics', 'revising'];

/** ONB-07: where the student is; "basics" and "revising" start the first lesson further in. */
export default function Level() {
  const app = useApp();
  const t = useT();
  const ob = useUiState((s) => s.onboarding);
  const [level, setLevel] = useState<SelfLevel | null>(ob.level);
  const school = ob.schoolClass !== null;
  const steps = questionSteps(ob, app.deps.variant.examProfileIds.length !== 1);
  const exam = examName(app, app.examProfileId()) ?? app.appName();
  const go = async () => {
    if (!level) return;
    const s = await app.answerLevel(level);
    router.push(STEP_ROUTE[s.step] as Href);
  };
  return (
    <OnboardingFrame
      testID="ONB-07"
      step={steps.indexOf('level')}
      total={steps.length + 1}
      headline={school ? t('onboarding:ONB-07.headline_school', { n: ob.schoolClass ?? '' }) : t('onboarding:ONB-07.headline', { exam_short: exam })}
      petLine={level ? t(`onboarding:ONB-07.reaction_${level}`) : undefined}
      footer={<Button label={t('onboarding:ONB-07.primary')} disabled={!level} onPress={() => void go()} fullWidth testID="level-continue" />}
    >
      <View style={{ gap: 12 }} accessibilityRole="radiogroup">
        {LEVELS.map((l, i) => (
          <OptionCard
            key={l}
            kind="choice"
            label={school ? t(`onboarding:ONB-07.school_card_${(i + 1) as 1 | 2 | 3}`) : t(`onboarding:ONB-07.card_${(i + 1) as 1 | 2 | 3}`)}
            description={school ? undefined : t(`onboarding:ONB-07.card_${(i + 1) as 1 | 2 | 3}_caption`)}
            state={level === l ? 'selected' : 'idle'}
            onPress={() => setLevel(l)}
            testID={`level-${l}`}
          />
        ))}
      </View>
    </OnboardingFrame>
  );
}
