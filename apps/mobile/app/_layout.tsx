import { AppStoreProvider } from '@smriti/app-core/react';
import type { ExamKey } from '@smriti/tokens';
import { UIProvider } from '@smriti/ui-native';
import { smritiFonts } from '@smriti/ui-native/fonts';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { bundledIllustrations } from '../src/seed/illustrations';
import type { SmritiApp } from '../src/services/app';
import { AppProvider, useUiState } from '../src/services/context';
import { getDeviceApp } from '../src/services/device';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const resolveAsset = (name: string) => bundledIllustrations[name];

export default function RootLayout() {
  const [fontsLoaded] = useFonts(smritiFonts);
  const [app, setApp] = useState<SmritiApp | null>(null);
  useEffect(() => {
    let alive = true;
    void getDeviceApp().then(async (a) => {
      if (!a.ui.getState().ready) await a.boot();
      if (alive) setApp(a);
    });
    return () => {
      alive = false;
    };
  }, []);
  const ready = Boolean(app) && fontsLoaded;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  if (!app || !fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider app={app}>
          <AppStoreProvider store={app.store}>
            <Themed variant={app.deps.variant.id as ExamKey} />
          </AppStoreProvider>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Themed({ variant }: { variant: ExamKey }) {
  const pref = useUiState((s) => s.themePref);
  const locale = useUiState((s) => s.locale);
  const system = useColorScheme();
  const mode = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  return (
    <UIProvider mode={mode} exam={variant} locale={locale} resolveAsset={resolveAsset}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="lesson/[topicId]" options={{ gestureEnabled: false, animation: 'slide_from_bottom' }} />
        <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
      </Stack>
    </UIProvider>
  );
}
