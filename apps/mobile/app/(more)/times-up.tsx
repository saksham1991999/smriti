import { useAppStore, useStoreSelector } from '@smriti/app-core/react';
import { Button, Icon, PetView, Text, Toast } from '@smriti/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { deviceLimits } from '../../src/features/parent/limits';
import { useApp, useT } from '../../src/services/context';
import { Screen, Stack } from '../../src/ui/Screen';

type Ask = 'idle' | 'asked' | 'approved' | 'declined' | 'offline' | 'limit';

/** SET-19, Time's up: ends the session kindly. No timers, no countdowns, no auto-dismiss. */
export default function TimesUp() {
  const app = useApp();
  const t = useT();
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const pet = useAppStore((s) => s.pet);
  const limits = deviceLimits(app);
  const from = useStoreSelector(limits.store, (s) => s.limits?.allowed_from ?? null);
  const open = useStoreSelector(limits.store, (s) => s.request);
  const [ask, setAsk] = useState<Ask>(open?.status === 'pending' ? 'asked' : 'idle');
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState(false);

  // A pending ask: look for the parent's answer when the screen is open.
  useEffect(() => {
    if (ask !== 'asked') return;
    const timer = setInterval(() => {
      void limits.checkRequest().then((r) => {
        if (r?.status === 'allowed') {
          setAsk('approved');
          setToast(true);
          setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/learn')), 1200);
        } else if (r?.status === 'declined') setAsk('declined');
      });
    }, 15_000);
    return () => clearInterval(timer);
  }, [ask, limits]);

  const askMore = async () => {
    const r = await limits.ask();
    if (r.kind === 'sent') setAsk(r.request.status === 'allowed' ? 'approved' : 'asked');
    else if (r.kind === 'declined_today') setAsk('declined');
    else if (r.kind === 'limit_reached') setAsk('limit');
    else setAsk('offline');
  };

  const petName = pet?.name ?? app.appName();
  const body = reason === 'outside_hours' ? t('me_money:SET-19.body_hours', { time: from?.slice(0, 5) ?? '' }) : t('me_money:SET-19.body_limit');
  const status: Partial<Record<Ask, string>> = {
    asked: t('me_money:SET-19.asked'),
    approved: t('me_money:SET-19.approved'),
    declined: t('me_money:SET-19.declined'),
    offline: t('me_money:SET-19.offline'),
    limit: t('me_money:SET-19.declined'),
  };

  return (
    <Screen testID="SET-19" contentStyle={styles.content}>
      <View style={styles.art} accessibilityLiveRegion="assertive">
        {pet ? <PetView species={pet.species} mood="sleepy" under10 size={200} alt={t('me_money:SET-19.title', { pet: petName })} /> : null}
      </View>
      <Text variant="display" heading align="center" testID="set19-title">
        {t('me_money:SET-19.title', { pet: petName })}
      </Text>
      <Text variant="body" align="center" testID="set19-body">
        {body}
      </Text>
      <Stack row gap={8} style={styles.saved}>
        <Icon name="Check" color="success" size={20} />
        <Text variant="body" tone="muted">
          {t('me_money:SET-19.saved')}
        </Text>
      </Stack>
      {status[ask] ? (
        <View accessibilityLiveRegion="polite" style={styles.status}>
          {ask === 'asked' ? <ActivityIndicator /> : null}
          <Text variant="label" align="center" testID="set19-status">
            {status[ask]}
          </Text>
        </View>
      ) : null}
      <Stack gap={12}>
        {!done ? <Button label={t('me_money:SET-19.ok')} onPress={() => setDone(true)} fullWidth testID="set19-ok" /> : null}
        {!done && (ask === 'idle' || ask === 'offline') ? <Button variant="secondary" label={t('me_money:SET-19.ask')} onPress={() => void askMore()} fullWidth testID="set19-ask" /> : null}
        <Button variant="ghost" label={t('me_money:SET-19.parent_unlock')} onPress={() => router.push('/grown-ups')} fullWidth testID="set19-unlock" />
      </Stack>
      <Toast open={toast} message={t('me_money:SET-19.approved')} icon="CheckCircle" onDismiss={() => setToast(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center', justifyContent: 'center', flexGrow: 1 },
  art: { alignItems: 'center' },
  saved: { justifyContent: 'center' },
  status: { alignItems: 'center', gap: 8 },
});
