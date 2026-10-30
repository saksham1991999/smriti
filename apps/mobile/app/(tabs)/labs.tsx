import { Card, Chip, Illustration, Text } from '@smriti/ui-native';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { LABS, labIllustration } from '../../src/content/labs';
import { useT, useUiState } from '../../src/services/context';
import { BuddyLine } from '../../src/ui/Onboarding';
import { Screen } from '../../src/ui/Screen';

/** LAB-01: every sim in the repo (sims/*), from their manifests. Free in Labs (R46). */
export default function Labs() {
  const t = useT();
  const locale = useUiState((s) => s.locale);
  return (
    <Screen testID="LAB-01" edges="top">
      <Text variant="display" heading>
        {t('memory_labs:LAB-01.title')}
      </Text>
      <BuddyLine text={t('memory_labs:LAB-01.pet')} />
      <Text variant="heading">{t('memory_labs:LAB-01.featured')}</Text>
      <View style={styles.grid}>
        {LABS.map((lab) => (
          <View key={lab.id} style={styles.tile}>
            <Card outlined onPress={() => router.push({ pathname: '/lab/[id]', params: { id: lab.id } })} accessibilityLabel={lab.title[locale]} testID={`lab-${lab.id}`}>
              <View style={styles.body}>
                <Illustration name={labIllustration(lab)} decorative width={88} height={72} />
                <Text variant="heading" numberOfLines={2}>
                  {lab.title[locale]}
                </Text>
                <Chip kind="status" tone="sunken" icon="CheckCircle" label={t('memory_labs:LAB-01.tasks_progress', { done: 0, total: lab.tasks })} />
              </View>
            </Card>
          </View>
        ))}
      </View>
      <Text variant="caption" tone="muted" align="center">
        {t('memory_labs:LAB-01.coming')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47.5%' },
  body: { gap: 8, minHeight: 150 },
});
