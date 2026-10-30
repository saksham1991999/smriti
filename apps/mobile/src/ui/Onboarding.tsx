import { useAppStore } from '@smriti/app-core/react';
import { IconButton, PetLine, SegmentedProgress, Text } from '@smriti/ui-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useT, useUiState } from '../services/context';
import { Screen } from './Screen';

/**
 * The onboarding question frame (onboarding §5.2): back, a segmented bar over the question steps,
 * the headline, the body, the buddy's line and one primary action at the bottom.
 */
export function OnboardingFrame({
  step,
  total = 5,
  headline,
  helper,
  children,
  petLine,
  footer,
  back = true,
  testID,
}: {
  step?: number;
  total?: number;
  headline?: string;
  helper?: string;
  children?: ReactNode;
  petLine?: string;
  footer: ReactNode;
  back?: boolean;
  testID?: string;
}) {
  const t = useT();
  return (
    <Screen testID={testID} footer={footer}>
      {back || step !== undefined ? (
        <View style={styles.top}>
          {back ? <IconButton icon="CaretLeft" label={t('ui:common.back')} onPress={() => (router.canGoBack() ? router.back() : undefined)} testID="onb-back" /> : <View style={styles.spacer} />}
          {step !== undefined ? (
            <View style={styles.grow}>
              <SegmentedProgress total={total} done={step} current={step} label={t('ui:progress.segments', { done: step, total })} />
            </View>
          ) : null}
        </View>
      ) : null}
      {headline ? (
        <Text variant="display" heading>
          {headline}
        </Text>
      ) : null}
      {helper ? (
        <Text variant="body" tone="muted">
          {helper}
        </Text>
      ) : null}
      {children}
      {petLine ? <BuddyLine text={petLine} /> : null}
    </Screen>
  );
}

/** The buddy says a line; before a buddy is picked both pets say it together. */
export function BuddyLine({ text, testID }: { text: string; testID?: string }) {
  const pet = useAppStore((s) => s.pet);
  const ob = useUiState((s) => s.onboarding.pet);
  const species = pet?.species ?? ob?.species ?? 'cat';
  const name = pet?.name ?? ob?.name ?? '';
  return <PetLine pet={{ species, mood: 'happy' }} petName={name} text={text} testID={testID ?? 'pet-line'} />;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 },
  spacer: { width: 44, height: 44 },
});
