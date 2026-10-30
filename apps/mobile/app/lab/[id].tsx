import { Button, IconButton, Illustration, Text } from '@smriti/ui-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { LABS, labIllustration } from '../../src/content/labs';
import { useApp, useT, useUiState } from '../../src/services/context';
import { BuddyLine } from '../../src/ui/Onboarding';
import { Screen } from '../../src/ui/Screen';

/**
 * LAB-03 shell with the LAB-05 fallback. The sim runtime (sim-bridge's WebView host, sims served
 * from the content CDN or a downloaded folder) needs built sim bundles on the CDN, which do not
 * exist yet, so every lab shows LAB-05 "here's the idea" for now (see the report).
 */
export default function Lab() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const { id } = useLocalSearchParams<{ id: string }>();
  const lab = LABS.find((l) => l.id === id);
  const online = app.deps.network.isOnline();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/labs' as Href));
  return (
    <Screen testID="LAB-05" footer={<Button variant="secondary" label={t('ui:common.back')} onPress={back} fullWidth />}>
      <View style={styles.top}>
        <IconButton icon="X" label={t('ui:common.close')} onPress={back} />
        <Text variant="title" heading style={styles.grow}>
          {lab?.title[locale] ?? ''}
        </Text>
      </View>
      <View style={styles.center}>
        <Illustration name={lab ? labIllustration(lab) : 'ui-offline'} decorative width={240} height={180} />
        <Text variant="label" tone="muted">
          {online ? t('memory_labs:LAB-05.reason_failed') : t('memory_labs:LAB-05.reason_offline')}
        </Text>
      </View>
      <BuddyLine text={online ? t('memory_labs:LAB-05.pet_failed') : t('memory_labs:LAB-05.pet_offline')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  center: { alignItems: 'center', gap: 12 },
});
