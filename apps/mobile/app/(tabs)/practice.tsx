import { Card, Icon, Text } from '@smriti/ui-native';
import { StyleSheet, View } from 'react-native';

import { useT } from '../../src/services/context';
import { BuddyLine } from '../../src/ui/Onboarding';
import { Screen } from '../../src/ui/Screen';

const TILES = [
  { key: 'tile_concept_drill', caption: 'tile_caption', icon: 'Barbell' },
  { key: 'tile_pyq_bank', caption: null, icon: 'FileText' },
  { key: 'tile_mock_tests', caption: null, icon: 'Exam' },
  { key: 'tile_analytics', caption: 'analytics_caption_no_data', icon: 'TrendUp' },
] as const;

/**
 * PRC-01 shell. Drills, the PYQ bank and mocks need the practice API and published question
 * banks (the practice agent's backend); the tiles are here so navigation matches the mocks.
 */
export default function Practice() {
  const t = useT();
  return (
    <Screen testID="PRC-01" edges="top">
      <Text variant="display" heading>
        {t('practice:PRC-01.title')}
      </Text>
      <BuddyLine text={t('practice:PRC-01.pet_line_new_student')} />
      <View style={styles.grid}>
        {TILES.map((tile) => (
          <View key={tile.key} style={styles.tile}>
            <Card outlined testID={`prc-${tile.key}`}>
              <View style={styles.body}>
                <Icon name={tile.icon} color="primary" />
                <Text variant="heading">{t(`practice:PRC-01.${tile.key}`)}</Text>
                {tile.caption ? (
                  <Text variant="caption" tone="muted">
                    {t(`practice:PRC-01.${tile.caption}`)}
                  </Text>
                ) : null}
              </View>
            </Card>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47.5%' },
  body: { gap: 8, minHeight: 110 },
});
