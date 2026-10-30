import { TabBar, type NavItem } from '@smriti/ui-native';
import { Tabs } from 'expo-router/js-tabs';

import { useApp, useUiState } from '../../src/services/context';

/**
 * The four tabs (R46): Learn, Labs, Practice, Me. Little learner mode has three (R14: no
 * Practice, which holds mocks and PYQs). The bar is ui-native's TabBar on both platforms.
 */
export default function TabsLayout() {
  const app = useApp();
  useUiState((s) => s.locale);
  const little = useUiState((s) => s.onboarding.schoolClass !== null && s.onboarding.schoolClass <= 5);
  const items: NavItem[] = [
    { key: 'learn', label: app.tPending('learn:WEB-01.tab_learn'), icon: 'House' },
    { key: 'labs', label: app.t('memory_labs:LAB-01.title'), icon: 'Flask' },
    ...(little ? [] : [{ key: 'practice', label: app.t('practice:PRC-01.title'), icon: 'Exam' } as NavItem]),
    { key: 'me', label: app.t('me_money:ME-01.title'), icon: 'UserCircle' },
  ];
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
      <Tabs.Screen name="practice" options={{ href: little ? null : undefined }} />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}
