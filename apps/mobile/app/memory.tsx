import { Button, IconButton, Illustration, SettingsGroup, SettingsRow, Text } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useT } from '../src/services/context';
import { Screen } from '../src/ui/Screen';

/**
 * MEM-01. Review cards come from the server's SRS state (`srs` in /v1/sync/state); the review
 * session (MEM-03) is not built yet, so a student with no due cards sees "All caught up".
 */
export default function Memory() {
  const t = useT();
  // app-core's store has no SRS section yet; the count comes with MEM-03.
  const due = 0;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));
  return (
    <Screen testID="MEM-01">
      <View style={styles.top}>
        <IconButton icon="CaretLeft" label={t('ui:common.back')} onPress={back} />
        <Text variant="title" heading>
          {t('memory_labs:MEM-01.title')}
        </Text>
      </View>
      <View style={styles.center}>
        <Illustration name="ui-all-caught-up" decorative width={200} height={150} />
        <Text variant="heading" align="center">
          {due > 0 ? t('memory_labs:MEM-01.today_due.1', { n: due }) : t('memory_labs:MEM-01.today_none')}
        </Text>
        {due > 0 ? <Button label={t('memory_labs:MEM-01.start')} disabled fullWidth /> : null}
      </View>
      <SettingsGroup>
        <SettingsRow title={t('memory_labs:MEM-01.tool_decks')} icon="Cards" trailing="none" />
        <SettingsRow title={t('memory_labs:MEM-01.tool_techniques')} icon="Lightbulb" trailing="none" />
        <SettingsRow title={t('memory_labs:MEM-01.tool_focus')} icon="Timer" trailing="none" />
      </SettingsGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { alignItems: 'center', gap: 12 },
});
