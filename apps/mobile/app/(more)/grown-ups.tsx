import { PARENT_PIN_RE } from '@smriti/app-core';
import { useAppStore, useStoreSelector } from '@smriti/app-core/react';
import { Banner, Button, GoogleButton, Illustration, Text, TrustLine, useTheme } from '@smriti/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { parentSession, type PinResult } from '../../src/features/parent/session';
import { Field } from '../../src/features/shared/Field';
import { useApp, useT } from '../../src/services/context';
import { Screen, Stack } from '../../src/ui/Screen';

type View_ = 'gate' | 'dev' | 'pin' | 'set_pin';

/**
 * SET-13, the parent mode gate: the parent's own Google sign-in the first time on this device
 * (AUTH-24), then [Continue as {parent}] or the optional parent PIN, which works offline.
 */
export default function GrownUps() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const session = parentSession(app);
  const state = useStoreSelector(session.store, (s) => s);
  const pet = useAppStore((s) => s.pet);
  const params = useLocalSearchParams<{ set?: string }>();
  // SET-14 "Parent PIN" comes back here to set or change the PIN while parent mode is open.
  const [view, setView] = useState<View_>(params.set === 'pin' && session.store.getState().unlocked ? 'set_pin' : 'gate');
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const online = app.deps.network.isOnline();
  const separate = session.mode() === 'separate';

  useEffect(() => {
    void session.reload();
  }, [session]);

  const toDashboard = () => router.replace('/parent');
  const back = () => (router.canGoBack() ? router.back() : router.replace('/learn'));

  const google = async (dev?: { email: string; name: string }) => {
    if (app.deps.google.kind === 'dev' && !dev) return setView('dev');
    setBusy(true);
    setError(null);
    const r = await session.signIn(dev);
    setBusy(false);
    if (r === 'ok') return state.pinSet ? toDashboard() : setView('set_pin');
    if (r === 'offline') setError(t('me_money:SET-13.needs_internet'));
  };

  const confirm = async () => {
    setBusy(true);
    const r = await session.confirm();
    setBusy(false);
    if (r === 'ok') toDashboard();
    else if (r === 'offline') setError(t('me_money:SET-13.needs_internet'));
  };

  const unlock = async () => {
    setBusy(true);
    const r: PinResult = await session.checkPin(pin);
    setBusy(false);
    setPin('');
    if (r.kind === 'ok') return toDashboard();
    setError(r.kind === 'locked' ? t('me_money:SET-13.pin_locked', { n: r.minutes }) : t('me_money:SET-13.pin_wrong'));
  };

  const savePin = async () => {
    await session.setPin(pin);
    setPin('');
    toDashboard();
  };

  const header = (
    <Stack gap={12}>
      {separate ? (
        <Text variant="label" tone="primary" align="center" testID="set13-hand-over">
          {t('me_money:SET-13.hand_over_child_view')}
        </Text>
      ) : null}
      <View style={[styles.art, { borderRadius: theme.radius.cardLarge }]}>
        <Illustration name="scene-parent-child" fallback={['scene-student-laptop']} alt={t('me_money:SET-13.title')} width={300} height={200} />
      </View>
      <Text variant="display" heading align="center">
        {t('me_money:SET-13.title')}
      </Text>
      <Text variant="body" tone="muted" align="center">
        {t('me_money:SET-13.body')}
      </Text>
    </Stack>
  );

  let actions;
  if (view === 'dev') {
    actions = (
      <Stack gap={12} style={{}}>
        <Text variant="heading">{app.tPending('learn:WEB-01.dev_sign_in_title')}</Text>
        <Text variant="caption" tone="muted">
          {app.tPending('learn:WEB-01.dev_sign_in_body')}
        </Text>
        <Field label={app.tPending('learn:WEB-01.dev_email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" testID="set13-dev-email" />
        <Field label={app.tPending('learn:WEB-01.dev_name')} value={name} onChangeText={setName} testID="set13-dev-name" />
        <Button label={app.tPending('learn:WEB-01.dev_submit')} disabled={!email.includes('@') || busy} loading={busy} onPress={() => void google({ email, name })} fullWidth testID="set13-dev-submit" />
        <Button variant="ghost" label={t('ui:common.back')} onPress={() => setView('gate')} fullWidth />
      </Stack>
    );
  } else if (view === 'pin' || view === 'set_pin') {
    const setting = view === 'set_pin';
    actions = (
      <Stack gap={12}>
        {setting ? (
          <>
            <Text variant="heading">{t('me_money:SET-13.set_pin_title')}</Text>
            <Text variant="caption" tone="muted">
              {t('me_money:SET-13.set_pin_body')}
            </Text>
          </>
        ) : null}
        <Field
          label={t('me_money:SET-13.pin_label')}
          value={pin}
          onChangeText={(v) => {
            setError(null);
            setPin(v.replace(/\D/g, '').slice(0, 4));
          }}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          autoFocus
          error={error}
          testID="set13-pin"
        />
        <Button label={setting ? t('me_money:SET-16.save') : t('me_money:SET-13.unlock')} disabled={!PARENT_PIN_RE.test(pin) || busy} loading={busy} onPress={() => void (setting ? savePin() : unlock())} fullWidth testID="set13-pin-submit" />
        <Button variant="ghost" label={setting ? t('me_money:SET-13.skip_pin') : t('ui:common.back')} onPress={() => (setting ? toDashboard() : setView('gate'))} fullWidth testID="set13-pin-cancel" />
      </Stack>
    );
  } else if (!state.linked) {
    actions = (
      <Stack gap={12}>
        {!online ? <Banner tone="offline" icon="WifiSlash" text={t('me_money:SET-13.needs_internet')} testID="set13-offline" /> : null}
        <GoogleButton loading={busy} disabled={busy || !online} onPress={() => void google()} platform={Platform.OS === 'web' ? 'web' : Platform.OS === 'ios' ? 'ios' : 'android'} testID="set13-google" />
        <TrustLine />
      </Stack>
    );
  } else {
    actions = (
      <Stack gap={12}>
        {!online && !state.pinSet ? <Banner tone="offline" icon="WifiSlash" text={t('me_money:SET-13.needs_internet')} /> : null}
        <Button
          label={state.name ? t('me_money:SET-13.continue_as', { parent: state.name }) : t('me_money:SET-13.continue_google')}
          disabled={busy || !online}
          loading={busy}
          onPress={() => void confirm()}
          fullWidth
          testID="set13-continue"
        />
        {state.pinSet ? <Button variant="secondary" label={t('me_money:SET-13.pin')} onPress={() => setView('pin')} fullWidth testID="set13-use-pin" /> : null}
        {error ? (
          <Text variant="caption" tone="error" align="center">
            {error}
          </Text>
        ) : null}
      </Stack>
    );
  }

  return (
    <Screen testID="SET-13" contentStyle={styles.content}>
      {header}
      {actions}
      {view === 'gate' ? <Button variant="ghost" label={t('me_money:SET-13.back', { pet: pet?.name ?? app.appName() })} onPress={back} fullWidth testID="set13-back" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 24, maxWidth: 560, width: '100%', alignSelf: 'center' },
  art: { alignSelf: 'center', overflow: 'hidden' },
});
