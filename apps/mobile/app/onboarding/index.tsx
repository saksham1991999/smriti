import { Button, Illustration, Text } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { getLocales } from 'expo-localization';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { useApp, useT } from '../../src/services/context';
import { examName } from '../../src/services/exams';
import { STEP_ROUTE } from '../../src/services/onboarding';
import { Screen } from '../../src/ui/Screen';

/** ONB-01: welcome and language. The device-locale button is primary; each button shows its own script. */
export default function Welcome() {
  const app = useApp();
  const t = useT();
  const deviceHindi = (() => {
    try {
      return getLocales()[0]?.languageCode === 'hi';
    } catch {
      return false;
    }
  })();
  const perExam = app.deps.variant.id !== 'all';
  const { width } = useWindowDimensions();
  const heroW = Math.min(width, 640);
  const start = async (locale: 'en' | 'hi') => {
    await app.chooseLocale(locale);
    const skipped = await app.skipGoalIfSingleProfile();
    const step = app.ui.getState().onboarding.step;
    router.push((skipped ? STEP_ROUTE[step] : '/onboarding/goal') as Href);
  };
  const english = <Button key="en" label={t('onboarding:ONB-01.english_button')} variant={deviceHindi ? 'secondary' : 'primary'} fullWidth onPress={() => void start('en')} testID="start-en" />;
  const hindi = <Button key="hi" label={t('onboarding:ONB-01.hindi_button')} variant={deviceHindi ? 'primary' : 'secondary'} fullWidth onPress={() => void start('hi')} testID="start-hi" />;
  return (
    <Screen
      testID="ONB-01"
      contentStyle={styles.content}
    >
      <Illustration name="scene-welcome" alt="" decorative width={heroW} height={Math.round(heroW * 0.8)} fit="cover" style={styles.hero} />
      <View style={styles.headline}>
        <Text variant="display" align="center" heading>
          {perExam ? t('onboarding:ONB-01.headline_per_exam', { exam_short: examName(app, app.deps.variant.examProfileIds[0] ?? null) ?? app.appName() }) : t('onboarding:ONB-01.headline_all_exams')}
        </Text>
      </View>
        <View style={styles.footer}>
          {deviceHindi ? [hindi, english] : [english, hindi]}
          <Button variant="ghost" label={perExam ? t('onboarding:ONB-01.existing_account_per_exam') : t('onboarding:ONB-01.existing_account')} onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'hard', from: 'ONB-01' } })} testID="existing-account" />
          <Text variant="caption" tone="muted" align="center">
            {t('onboarding:ONB-01.legal')}
          </Text>
        </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 0, paddingTop: 0, alignItems: 'center' },
  hero: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  footer: { gap: 12, alignSelf: 'stretch', paddingHorizontal: 16 },
  headline: { paddingHorizontal: 24 },
});
