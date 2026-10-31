import { useAppStore } from '@smriti/app-core/react';
import { Button, ChoiceChips, Dialog, IconButton, SettingsGroup, SettingsRow, Text } from '@smriti/ui-native';
import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../src/services/context';
import { Screen } from '../src/ui/Screen';

/** SET-01 with SET-06 (language), SET-07 (appearance), SET-08 (haptics) inline, and AUTH-12 (sign out). */
export default function Settings() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const theme = useUiState((s) => s.themePref);
  const haptics = useUiState((s) => s.haptics);
  const signedIn = useAppStore((s) => s.session.status === 'signed_in');
  const pet = useAppStore((s) => s.pet);
  const [askOut, setAskOut] = useState(false);
  const version = Constants.expoConfig?.version ?? '0.0.0';

  const signOut = async () => {
    setAskOut(false);
    await app.signOut();
    router.replace('/' as Href);
  };

  return (
    <Screen testID="SET-01">
      <View style={styles.top}>
        <IconButton icon="CaretLeft" label={t('ui:common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/me' as Href))} testID="settings-back" />
        <Text variant="title" heading>
          {t('me_money:SET-01.title')}
        </Text>
      </View>

      <SettingsGroup title={t('me_money:SET-06.title')}>
        <View style={styles.pad}>
          <ChoiceChips
            label={t('me_money:SET-06.app_language')}
            options={[
              { value: 'en', label: app.languageName('en') },
              { value: 'hi', label: app.languageName('hi') },
            ]}
            value={[locale]}
            onChange={(v) => {
              const next = v[0];
              if (next === 'en' || next === 'hi') void app.setLocale(next);
            }}
            testID="set-language"
          />
          <Text variant="caption" tone="muted">
            {t('me_money:SET-06.app_caption', { pet: pet?.name ?? '' })}
          </Text>
        </View>
      </SettingsGroup>

      <SettingsGroup title={t('me_money:SET-07.title')}>
        <View style={styles.pad}>
          <ChoiceChips
            label={t('me_money:SET-07.title')}
            hideLabel
            options={[
              { value: 'system', label: t('me_money:SET-07.system') },
              { value: 'light', label: t('me_money:SET-07.light') },
              { value: 'dark', label: t('me_money:SET-07.dark') },
            ]}
            value={[theme]}
            onChange={(v) => {
              const next = v[0];
              if (next === 'system' || next === 'light' || next === 'dark') void app.savePrefs({ themePref: next });
            }}
            testID="set-theme"
          />
        </View>
      </SettingsGroup>

      <SettingsGroup title={t('me_money:SET-08.title')}>
        <SettingsRow title={t('me_money:SET-08.haptics')} icon="Sparkle" trailing="switch" checked={haptics} onCheckedChange={(v) => void app.savePrefs({ haptics: v })} testID="set-haptics" />
      </SettingsGroup>

      {signedIn ? (
        <SettingsGroup>
          <SettingsRow title={t('auth:AUTH-12.sign_out')} icon="SignOut" trailing="none" destructive onPress={() => setAskOut(true)} testID="set-sign-out" />
        </SettingsGroup>
      ) : (
        <Button variant="secondary" label={t('me_money:SET-01.guest_button')} onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'soft', reason: 'save_progress' } })} fullWidth />
      )}

      <Text variant="caption" tone="muted" align="center">
        {t('me_money:SET-01.footer.1', { app: app.appName(), version, build: app.deps.variant.id })}
      </Text>

      <Dialog
        open={askOut}
        onOpenChange={setAskOut}
        title={t('auth:AUTH-12.title', { app_name: app.appName() })}
        description={t('auth:AUTH-12.body')}
        confirm={{ label: t('auth:AUTH-12.sign_out'), onPress: () => void signOut(), destructive: true }}
        cancel={{ label: t('ui:common.back'), onPress: () => setAskOut(false) }}
        testID="AUTH-12"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pad: { padding: 12, gap: 8 },
});
