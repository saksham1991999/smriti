/**
 * The little learner's pet in a corner (LRN-11 page turns, LES-01 "pet avatar stays at the
 * top-right of every card and reacts"). Art comes from PetView (the app's pet assets; nothing
 * drawn here). Decorative and hidden from screen readers: the page or feedback it reacts to is
 * announced already. Reduced motion never hops; the mood still changes (lesson-core petReaction).
 */
import { petReaction, type PetReactionEvent } from "@smriti/lesson-core";
import { PetView, useTheme, useUI } from "@smriti/ui-native";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

export interface CornerPetProps {
  species: "cat" | "dog";
  event: PetReactionEvent | null;
  /** Changes on every new reaction, so the same event can hop again. */
  n: number | string;
  /** The wrapper's testID; the inner view is `${testID}-${mood}`. */
  testID: string;
  /** Circle diameter. */
  size?: number;
}

export function CornerPet({ species, event, n, testID, size = 56 }: CornerPetProps) {
  const theme = useTheme();
  const { reducedMotion } = useUI();
  const r = petReaction(event, reducedMotion);
  const y = useSharedValue(0);
  useEffect(() => {
    if (r.hop) y.value = withSequence(withTiming(-8, { duration: theme.motion.duration.base }), withTiming(0, { duration: theme.motion.duration.base }));
  }, [n, r.hop, y, theme.motion.duration.base]);
  const hop = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View
      testID={testID}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", alignItems: "center", backgroundColor: theme.colors.primaryTint }, hop]}
    >
      <View testID={`${testID}-${r.mood}`}>
        <PetView species={species} mood={r.mood} under10 decorative size={Math.round(size * 1.15)} style={{ marginTop: Math.round(size / 8) }} />
      </View>
    </Animated.View>
  );
}
