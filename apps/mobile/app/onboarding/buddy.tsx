import { Button, Card, Chip, Icon, PetView, Text, useTheme } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useApp, useT, useUiState } from '../../src/services/context';
import { questionSteps, STEP_ROUTE } from '../../src/services/onboarding';
import { OnboardingFrame } from '../../src/ui/Onboarding';

const MAX = 12;

/** ONB-10: pick and name the study buddy (R42). The name is prefilled, so one tap on Continue keeps it. */
export default function Buddy() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const ob = useUiState((s) => s.onboarding);
  const suggestions = [1, 2, 3, 4].map((n) => t(`onboarding:ONB-10.suggestions.${n as 1 | 2 | 3 | 4}`));
  const [species, setSpecies] = useState<'cat' | 'dog'>(ob.pet?.species ?? 'cat');
  const [name, setName] = useState(ob.pet?.name ?? suggestions[0] ?? '');
  const trimmed = name.trim();
  const error = trimmed.length === 0 ? t('onboarding:ONB-10.error_empty') : [...trimmed].length > MAX ? t('onboarding:ONB-10.error_too_long') : null;
  const steps = questionSteps(ob, app.deps.variant.examProfileIds.length !== 1);
  const go = async () => {
    if (error) return;
    const s = await app.nameBuddy(species, trimmed);
    router.push(STEP_ROUTE[s.step] as Href);
  };
  return (
    <OnboardingFrame
      testID="ONB-10"
      step={steps.indexOf('buddy')}
      total={steps.length + 1}
      headline={t('onboarding:ONB-10.headline')}
      petLine={species === 'cat' ? t('onboarding:ONB-10.cat_line') : t('onboarding:ONB-10.dog_line')}
      footer={<Button label={t('onboarding:ONB-10.primary')} disabled={Boolean(error)} onPress={() => void go()} fullWidth testID="buddy-continue" />}
    >
      <View style={styles.row} accessibilityRole="radiogroup">
        {(['cat', 'dog'] as const).map((s) => (
          <View key={s} style={styles.grow}>
            <Card tone={species === s ? 'tint' : 'surface'} outlined onPress={() => setSpecies(s)} accessibilityLabel={s === 'cat' ? t('onboarding:ONB-10.cat_card') : t('onboarding:ONB-10.dog_card')} testID={`buddy-${s}`}>
              <View style={[styles.pick, species !== s && styles.dim]} accessibilityState={{ selected: species === s }}>
                {species === s ? (
                  <View style={styles.badge}>
                    <Icon name="CheckCircle" weight="fill" color="primary" />
                  </View>
                ) : null}
                <PetView species={s} mood={species === s ? 'curious' : 'happy'} size={128} decorative />
                <Text variant="heading" align="center">
                  {s === 'cat' ? t('onboarding:ONB-10.cat_card') : t('onboarding:ONB-10.dog_card')}
                </Text>
              </View>
            </Card>
          </View>
        ))}
      </View>
      <View style={styles.field}>
        <Text variant="label" tone="muted">
          {t('onboarding:ONB-10.name_label')}
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={24}
          placeholder={t('onboarding:ONB-10.placeholder')}
          placeholderTextColor={theme.colors.inkMuted}
          accessibilityLabel={t('onboarding:ONB-10.name_label')}
          style={[styles.input, { backgroundColor: theme.colors.surfaceSunken, color: theme.colors.ink, borderRadius: theme.radius.md, fontFamily: theme.fonts.latin[600] }]}
          testID="buddy-name"
        />
        <Text variant="caption" tone={error ? 'error' : 'muted'}>
          {error ?? t('onboarding:ONB-10.helper')}
        </Text>
        <View style={styles.chips}>
          {suggestions.map((s) => (
            <Chip key={s} kind="filter" label={s} selected={trimmed === s} onPress={() => setName(s)} />
          ))}
        </View>
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
  pick: { alignItems: 'center', gap: 4 },
  dim: { opacity: 0.6 },
  badge: { position: 'absolute', top: 0, right: 0, zIndex: 1 },
  field: { gap: 8 },
  input: { minHeight: 52, paddingHorizontal: 16, fontSize: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
