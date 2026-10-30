import { Button, Chip, Dialog, Illustration, Text } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { useApp, useT } from '../../src/services/context';
import { OnboardingFrame } from '../../src/ui/Onboarding';

/** The four chips, local 24-hour time; the labels come from the catalogue (`chip_times.N`). */
const TIMES = ['07:00', '17:00', '19:00', '21:00'] as const;

/** ONB-15: the reminder soft ask before the OS prompt. Ends onboarding either way. */
export default function Reminder() {
  const app = useApp();
  const t = useT();
  const [time, setTime] = useState<(typeof TIMES)[number]>('19:00');
  const [denied, setDenied] = useState(false);
  const label = (i: number) => t(`onboarding:ONB-15.chip_times.${(i + 1) as 1 | 2 | 3 | 4}`);
  const done = () => router.replace('/learn' as Href);
  const yes = async () => {
    const r = await app.answerReminder(time);
    if (r.granted) done();
    else setDenied(true);
  };
  const notNow = async () => {
    await app.answerReminder(null);
    done();
  };
  return (
    <OnboardingFrame
      testID="ONB-15"
      back={false}
      headline={t('onboarding:ONB-15.headline', { time: label(TIMES.indexOf(time)) })}
      helper={t('onboarding:ONB-15.body')}
      footer={
        <>
          <Button label={t('onboarding:ONB-15.primary')} onPress={() => void yes()} fullWidth testID="reminder-yes" />
          <Button variant="ghost" label={t('onboarding:ONB-15.secondary')} onPress={() => void notNow()} fullWidth testID="reminder-not-now" />
        </>
      }
    >
      <View style={styles.center}>
        <Illustration name="ui-notify-bell" decorative width={160} height={160} />
      </View>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {TIMES.map((tm, i) => (
          <Chip key={tm} kind="filter" label={label(i)} selected={time === tm} onPress={() => setTime(tm)} testID={`reminder-${tm}`} />
        ))}
      </View>
      <Text variant="caption" tone="muted">
        {app.audience() === 'adult' ? t('onboarding:ONB-15.quiet_hours_label') : t('onboarding:ONB-15.school_hours_label')}
      </Text>
      <Dialog
        open={denied}
        onOpenChange={(o) => {
          if (!o) {
            setDenied(false);
            done();
          }
        }}
        title={t('onboarding:ONB-15.denied_title')}
        description={t('onboarding:ONB-15.denied_body')}
        confirm={{ label: t('onboarding:ONB-15.denied_primary'), onPress: done }}
        cancel={{ label: t('onboarding:ONB-15.denied_secondary'), onPress: () => void Linking.openSettings().catch(() => undefined) }}
        testID="ONB-15-denied"
      />
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
