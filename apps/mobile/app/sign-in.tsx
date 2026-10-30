import { useAppStore } from '@smriti/app-core/react';
import { AppleButton, Button, Chip, GoogleButton, Illustration, Sheet, Text, TrustLine, useTheme } from '@smriti/ui-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import type { LinkOutcome } from '../src/services/app';
import { useApp, useT, useUiState } from '../src/services/context';
import { BuddyLine } from '../src/ui/Onboarding';
import { Screen } from '../src/ui/Screen';

type Reason = 'lesson_3' | 'streak_day_2' | 'save_progress' | 'start_trial' | 'restore';

/**
 * AUTH-01 (soft prompt, guest), AUTH-02 (hard gate: Pro, restore), AUTH-04 (signing in) and
 * AUTH-06 (saved). Google links the guest in place, so nothing moves (TRD §6). Locally the Google
 * provider is the dev one: a test email stands in for a Google account (WEB-01 dev strings).
 */
export default function SignIn() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const params = useLocalSearchParams<{ mode?: string; reason?: string; then?: string }>();
  const reason: Reason = (['lesson_3', 'streak_day_2', 'save_progress', 'start_trial', 'restore'] as const).find((r) => r === params.reason) ?? (params.mode === 'hard' ? 'restore' : 'save_progress');
  const soft = params.mode !== 'hard';
  const pet = useAppStore((s) => s.pet);
  const streak = useAppStore((s) => s.streak);
  const lessons = useUiState((s) => s.lessonsCompleted);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LinkOutcome | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [apple, setApple] = useState(false);
  const dev = app.deps.google.kind === 'dev';
  const petName = pet?.name ?? '';

  useEffect(() => {
    if (Platform.OS === 'ios') void app.deps.apple.isAvailable().then(setApple).catch(() => setApple(false));
  }, [app]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));
  const done = () => {
    if (params.then === 'paywall') router.replace({ pathname: '/paywall', params: { from: 'sign_in' } });
    else close();
  };
  const run = async (fn: () => Promise<LinkOutcome>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setOutcome(r);
  };
  const google = () => {
    if (dev) setDevOpen(true);
    else void run(() => app.continueWithGoogle());
  };
  const submitDev = () => {
    if (!email.includes('@')) return;
    setDevOpen(false);
    void run(() => app.continueWithGoogle({ email: email.trim(), name: name.trim() || email.split('@')[0]! }));
  };
  const later = async () => {
    if (soft) await app.softLater();
    close();
  };

  if (outcome?.status === 'linked' || outcome?.status === 'restored') {
    const restored = outcome.status === 'restored';
    const days = streak?.current ?? 0;
    return (
      <Screen testID="AUTH-06" footer={<Button label={t('auth:AUTH-06.continue')} onPress={done} fullWidth testID="auth-done" />}>
        <View style={styles.center}>
          <Illustration name="ui-signin-saved" decorative width={200} height={160} />
          <Text variant="display" heading align="center">
            {restored ? t('auth:AUTH-06.title_restore_no_name') : days > 1 ? t('auth:AUTH-06.toast_line_1_link', { pet_name: petName, n: days }) : t('auth:AUTH-06.toast_line_1_link_first_day', { pet_name: petName })}
          </Text>
          {restored ? (
            <Text variant="body" tone="muted" align="center">
              {days ? t('auth:AUTH-06.line_restore', { n: days }) : t('auth:AUTH-06.line_restore_no_streak')}
            </Text>
          ) : email ? (
            <Text variant="body" tone="muted" align="center">
              {t('auth:AUTH-06.toast_line_2', { email })}
            </Text>
          ) : null}
        </View>
        <BuddyLine text={t('auth:AUTH-06.pet_line_restore_card')} />
      </Screen>
    );
  }

  if (outcome?.status === 'merge_needed') {
    return (
      <Screen testID="AUTH-08" footer={<Button label={t('auth:AUTH-08.great')} onPress={done} fullWidth />}>
        <Text variant="display" heading>
          {t('auth:AUTH-08.pending_title')}
        </Text>
        <Text variant="body" tone="muted">
          {t('auth:AUTH-08.pending_line')}
        </Text>
      </Screen>
    );
  }

  const title = soft ? t(`auth:AUTH-01.title_${reason === 'lesson_3' || reason === 'streak_day_2' ? reason : 'save_progress'}`, { pet_name: petName }) : t(`auth:AUTH-02.title_${reason === 'start_trial' ? 'start_trial' : 'restore'}`);
  const line = soft ? t(`auth:AUTH-01.reason_${reason === 'lesson_3' || reason === 'streak_day_2' ? reason : 'save_progress'}`, { pet_name: petName }) : t(`auth:AUTH-02.reason_${reason === 'start_trial' ? 'start_trial' : 'restore'}`);

  return (
    <Screen
      testID={soft ? 'AUTH-01' : 'AUTH-02'}
      footer={
        <>
          <GoogleButton loading={busy} disabled={busy} onPress={google} platform={Platform.OS === 'web' ? 'web' : Platform.OS === 'ios' ? 'ios' : 'android'} testID="google-button" />
          {apple ? <AppleButton loading={busy} disabled={busy} onPress={() => void run(() => app.continueWithApple())} testID="apple-button" /> : null}
          <Button variant="ghost" label={soft ? t('auth:AUTH-01.later') : t('auth:AUTH-02.back')} onPress={() => void later()} fullWidth testID="auth-later" />
          <TrustLine />
          <Text variant="caption" tone="muted" align="center">
            {t('auth:AUTH-01.legal_footer')}
          </Text>
        </>
      }
    >
      <View style={styles.center}>
        <Illustration name="cat-shield-key" decorative width={180} height={150} />
        <Text variant="display" heading align="center">
          {title}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {line}
        </Text>
      </View>
      {soft && (streak?.current || lessons) ? (
        <View style={styles.tiles}>
          <Chip kind="status" tone="streak" icon="Plant" label={t('auth:AUTH-01.stat_tiles.1', { n: streak?.current ?? 0 })} />
          <Chip kind="status" tone="primary" icon="BookBookmark" label={t('auth:AUTH-01.stat_tiles.2', { n: lessons })} />
        </View>
      ) : null}
      {busy ? (
        <Text variant="caption" tone="muted" align="center" testID="auth-busy">
          {t('auth:AUTH-04.signing_in')}
        </Text>
      ) : null}
      {outcome?.status === 'cancelled' ? (
        <Text variant="caption" tone="muted" align="center">
          {t('auth:AUTH-01.cancelled_line')}
        </Text>
      ) : null}
      {outcome?.status === 'error' ? (
        <Text variant="caption" tone="error" align="center" testID="auth-error">
          {app.deps.network.isOnline() ? t('learn:LES-11.error') : t('auth:AUTH-01.offline_line')}
        </Text>
      ) : null}

      <Sheet open={devOpen} onOpenChange={setDevOpen} title={app.tPending('learn:WEB-01.dev_sign_in_title')} description={app.tPending('learn:WEB-01.dev_sign_in_body')} testID="dev-google">
        <View style={styles.form}>
          <Text variant="label" tone="muted">
            {app.tPending('learn:WEB-01.dev_email')}
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            accessibilityLabel={app.tPending('learn:WEB-01.dev_email')}
            style={[styles.input, { backgroundColor: theme.colors.surfaceSunken, color: theme.colors.ink, borderRadius: theme.radius.md }]}
            testID="dev-email"
          />
          {email && !email.includes('@') ? (
            <Text variant="caption" tone="error">
              {app.tPending('learn:WEB-01.dev_email_error')}
            </Text>
          ) : null}
          <Text variant="label" tone="muted">
            {app.tPending('learn:WEB-01.dev_name')}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            accessibilityLabel={app.tPending('learn:WEB-01.dev_name')}
            style={[styles.input, { backgroundColor: theme.colors.surfaceSunken, color: theme.colors.ink, borderRadius: theme.radius.md }]}
            testID="dev-name"
          />
          <Button label={app.tPending('learn:WEB-01.dev_submit')} disabled={!email.includes('@')} onPress={submitDev} fullWidth testID="dev-submit" />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 10 },
  tiles: { flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  form: { gap: 8 },
  input: { minHeight: 52, paddingHorizontal: 16, fontSize: 18 },
});
