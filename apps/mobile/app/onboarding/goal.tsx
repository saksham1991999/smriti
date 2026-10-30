import { Button, Card, Chip, Icon, Illustration, Sheet, Text } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { goalsFor } from '../../src/content/catalogue';
import { useApp, useT, useUiState } from '../../src/services/context';
import { categoryIllustration } from '../../src/services/exams';
import { questionSteps, STEP_ROUTE } from '../../src/services/onboarding';
import { OnboardingFrame } from '../../src/ui/Onboarding';

const CLASS_GROUPS: { key: 'group_little_learners' | 'group_middle' | 'group_senior'; classes: number[] }[] = [
  { key: 'group_little_learners', classes: [1, 2, 3, 4, 5] },
  { key: 'group_middle', classes: [6, 7, 8] },
  { key: 'group_senior', classes: [9, 10, 11, 12] },
];

/** ONB-02 goal (multi-select from the live catalogue, R7) with the ONB-03 class sheet for School. */
export default function Goal() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const exams = useUiState((s) => s.config.exams);
  const saved = useUiState((s) => s.onboarding);
  const [goals, setGoals] = useState<string[]>(saved.goals);
  const [schoolClass, setSchoolClass] = useState<number | null>(saved.schoolClass);
  const [sheet, setSheet] = useState(false);
  const { exams: options, school, curious } = goalsFor({ id: app.deps.variant.id, examIds: app.deps.variant.examIds }, exams);
  const steps = questionSteps({ goals, schoolClass }, true);

  const toggle = (id: string) => setGoals((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g.filter((x) => !(schoolClass !== null && schoolClass <= 5 && x === 'school')), id]));
  const pickClass = (n: number) => {
    setSchoolClass(n);
    // Little learner mode is only for the child: other picks are cleared (ONB-02 toast).
    setGoals((g) => (n <= 5 ? ['school'] : g.includes('school') ? g : [...g, 'school']));
    setSheet(false);
  };

  const reaction = (() => {
    if (goals.length > 1) return t('onboarding:ONB-02.reaction_several_goals', { count: goals.length });
    const g = goals[0];
    if (!g) return t('onboarding:ONB-02.pet_line_before_a_tap', { n: steps.length });
    if (g === 'school') return t('onboarding:ONB-02.reaction_school', { n: schoolClass ?? '' });
    if (g === 'curious') return t('onboarding:ONB-02.reaction_curious');
    const cat = exams.find((e) => e.exam_profile_id === g)?.category;
    if (cat === 'engineering') return t('onboarding:ONB-02.reaction_engineering');
    if (cat === 'medical') return t('onboarding:ONB-02.reaction_medical');
    if (cat === 'civil_services') return t('onboarding:ONB-02.reaction_civil_services');
    return t('onboarding:ONB-02.reaction_government_jobs');
  })();

  const next = async () => {
    const s = await app.answerGoal(goals, goals.includes('school') ? schoolClass : null);
    router.push(STEP_ROUTE[s.step] as Href);
  };

  return (
    <OnboardingFrame
      testID="ONB-02"
      step={0}
      total={steps.length + 1}
      headline={t('onboarding:ONB-02.headline')}
      helper={t('onboarding:ONB-02.helper')}
      petLine={reaction}
      footer={<Button label={t('onboarding:ONB-02.primary')} disabled={goals.length === 0} onPress={() => void next()} fullWidth testID="goal-continue" />}
    >
      <View style={styles.grid}>
        {options.map((e) => (
          <GoalTile key={e.exam_profile_id} title={e.name[locale]} illustration={categoryIllustration(e.category)} selected={goals.includes(e.exam_profile_id)} onPress={() => toggle(e.exam_profile_id)} testID={`goal-${e.exam_profile_id}`} />
        ))}
        {school ? (
          <GoalTile
            title={goals.includes('school') && schoolClass ? t('onboarding:ONB-02.school_card_picked', { n: schoolClass }) : t('onboarding:ONB-02.school_card')}
            caption={t('onboarding:ONB-02.school_caption', { range: '1–12' })}
            illustration="scene-student-laptop"
            selected={goals.includes('school')}
            onPress={() => setSheet(true)}
            testID="goal-school"
          />
        ) : null}
        {curious ? (
          <GoalTile title={t('onboarding:ONB-02.curious_card')} caption={t('onboarding:ONB-02.curious_caption')} illustration="ui-search-empty" selected={goals.includes('curious')} onPress={() => toggle('curious')} testID="goal-curious" />
        ) : null}
      </View>
      <Sheet open={sheet} onOpenChange={setSheet} title={t('onboarding:ONB-03.title')} testID="ONB-03">
        <View style={styles.sheet}>
          {CLASS_GROUPS.map((g) => (
            <View key={g.key} style={styles.group}>
              <Text variant="label" tone="muted">
                {t(`onboarding:ONB-03.${g.key}`)}
              </Text>
              <View style={styles.chips}>
                {g.classes.map((n) => (
                  <Chip key={n} kind="filter" label={String(n)} accessibilityLabel={t('onboarding:ONB-03.chip_label_a11y', { n })} selected={schoolClass === n} onPress={() => pickClass(n)} testID={`class-${n}`} />
                ))}
              </View>
            </View>
          ))}
        </View>
      </Sheet>
    </OnboardingFrame>
  );
}

function GoalTile({ title, caption, illustration, selected, onPress, testID }: { title: string; caption?: string; illustration: string; selected: boolean; onPress: () => void; testID: string }) {
  return (
    <View style={styles.tile}>
      <Card outlined={!selected} tone={selected ? 'tint' : 'surface'} onPress={onPress} accessibilityLabel={title} testID={testID}>
        <View style={styles.tileBody} accessibilityState={{ selected }}>
          <View style={styles.tileTop}>
            <Illustration name={illustration} decorative width={44} height={44} />
            {selected ? <Icon name="CheckCircle" weight="fill" color="primary" /> : null}
          </View>
          <Text variant="heading">{title}</Text>
          {caption ? (
            <Text variant="caption" tone="muted">
              {caption}
            </Text>
          ) : null}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47.5%' },
  tileBody: { gap: 6, minHeight: 104 },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between' },
  sheet: { gap: 16 },
  group: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
