import { TabBar, type NavItem } from '@smriti/ui-native';
import { Redirect, type Href } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { tabsFor, useExperience } from '../../src/features/little/experience';
import { useApp, useUiState } from '../../src/services/context';
import { STEP_ROUTE } from '../../src/services/onboarding';

/**
 * The tabs from app-core's `learnerExperience`: Learn, Labs, Practice, Me (R46), Friends when
 * `feature.friends` is on (Phase 2), and three for little learners (R14: no Practice, which holds
 * mocks and PYQs). The bar is ui-native's TabBar on both platforms.
 */
export default function TabsLayout() {
  const app = useApp();
  useUiState((s) => s.locale);
  const tabs = tabsFor(app, useExperience());
  const step = useUiState((s) => (s.onboarding.completedAt ? null : s.onboarding.step));
  // A deep link into the tabs before onboarding is done goes back to the step it stopped at.
  if (step && step !== 'done') return <Redirect href={STEP_ROUTE[step] as Href} />;
  const all: Record<string, NavItem> = {
    learn: { key: 'learn', label: app.tPending('learn:WEB-01.tab_learn'), icon: 'House' },
    labs: { key: 'labs', label: app.t('memory_labs:LAB-01.title'), icon: 'Flask' },
    practice: { key: 'practice', label: app.t('practice:PRC-01.title'), icon: 'Exam' },
    friends: { key: 'friends', label: app.t('tutor_social:SOC-01.title'), icon: 'UsersThree' },
    me: { key: 'me', label: app.t('me_money:ME-01.title'), icon: 'UserCircle' },
  };
  const items = tabs.map((k) => all[k]!);
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => (
        <TabBar
          testID="tab-bar"
          items={items}
          activeKey={state.routes[state.index]?.name ?? 'learn'}
          onSelect={(key) => navigation.navigate(key)}
        />
      )}
    >
      <Tabs.Screen name="learn" />
      <Tabs.Screen name="labs" />
      <Tabs.Screen name="practice" options={{ href: tabs.includes('practice') ? undefined : null }} />
      <Tabs.Screen name="friends" options={{ href: tabs.includes('friends') ? undefined : null }} />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}
