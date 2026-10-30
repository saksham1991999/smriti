import type { ReactNode } from "react";
import { Pressable, type AccessibilityRole, type AccessibilityState, type StyleProp, type ViewStyle, type Insets } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { motion } from "@smriti/tokens";
import { useUI } from "../theme";

const [x1, y1, x2, y2] = motion.easing.standard;
const standard = Easing.bezier(x1, y1, x2, y2);

/** Extra touch area so small controls reach 48 x 48 (DESIGN.md §4). */
export function hitSlopFor(width: number, height: number, min = 48): Insets {
  const h = Math.max(0, (min - width) / 2);
  const v = Math.max(0, (min - height) / 2);
  return { left: h, right: h, top: v, bottom: v };
}

export interface PressableScaleProps {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** No press scale (Google and Apple buttons follow their own pressed state). */
  noScale?: boolean;
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  accessibilityValue?: { min?: number; max?: number; now?: number; text?: string };
  hitSlop?: Insets;
  testID?: string;
  children: ReactNode;
}

/** Pressable that scales to 0.97 over `fast` (120 ms) with the standard easing. Off in reduced motion. */
export function PressableScale({ onPress, onLongPress, disabled, noScale, style, pressedStyle, children, ...a11y }: PressableScaleProps) {
  const { reducedMotion } = useUI();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const animate = !noScale && !reducedMotion && !disabled;
  return (
    <Pressable
      {...a11y}
      onPress={disabled ? undefined : onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityState={{ disabled: Boolean(disabled), ...a11y.accessibilityState }}
      onPressIn={() => {
        if (animate) scale.value = withTiming(motion.pressScale, { duration: motion.duration.fast, easing: standard });
      }}
      onPressOut={() => {
        if (animate) scale.value = withTiming(1, { duration: motion.duration.fast, easing: standard });
      }}
    >
      {({ pressed }) => <Animated.View style={[style, animated, pressed && pressedStyle]}>{children}</Animated.View>}
    </Pressable>
  );
}
