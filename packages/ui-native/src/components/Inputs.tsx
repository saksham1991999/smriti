import { useEffect, useRef } from "react";
import { Pressable, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import type { Confidence, ConfidenceRowContract, IconName, PickerContract, Rating, RatingButtonsContract, SwitchContract } from "@smriti/tokens/ui";
import { useTheme, useUI } from "../theme";
import { Icon } from "./Icon";
import { PressableScale } from "./Pressable";
import { Text, useWeight } from "./Text";

const confidences: Confidence[] = ["sure", "half", "guess"];

export interface ConfidenceRowProps extends ConfidenceRowContract {
  style?: StyleProp<ViewStyle>;
}

/** Sure / 50:50 / Guess (R21). Optional, no default, never blocks [Check]. Tap the selected chip again to clear. */
export function ConfidenceRow({ value, onChange, showLabel = true, disabled, testID, style }: ConfidenceRowProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  const bold = useWeight(700);
  return (
    <View testID={testID} style={[{ gap: 8 }, style]}>
      {showLabel && (
        <Text variant="caption" tone="muted">
          {t("confidence.label")}
        </Text>
      )}
      <View accessibilityRole="radiogroup" accessibilityLabel={t("confidence.label")} style={{ flexDirection: "row", gap: 8 }}>
        {confidences.map((k) => {
          const on = value === k;
          return (
            <PressableScale
              key={k}
              accessibilityRole="radio"
              accessibilityLabel={t(`confidence.${k}`)}
              accessibilityState={{ checked: on, disabled: Boolean(disabled) }}
              disabled={disabled}
              onPress={() => onChange(on ? null : k)}
              style={{
                flex: 1,
                minHeight: 48,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 24,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: on ? c.primaryTint : c.surfaceRaised,
                borderWidth: on ? 2 : 1,
                borderColor: on ? c.primary : c.line,
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <Text variant="label" tone={on ? "primary" : "ink"} style={bold}>
                {t(`confidence.${k}`)}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const ratingIcon: Record<Rating, IconName> = { again: "ArrowCounterClockwise", hard: "Barbell", good: "Check", easy: "Lightning" };

export interface RatingButtonsProps extends RatingButtonsContract {
  style?: StyleProp<ViewStyle>;
}

/** Again / Hard / Good / Easy (R18), each with an icon, a label and the next interval (memory-labs P1). */
export function RatingButtons({ intervals, onRate, layout = "row", disabled, testID, style }: RatingButtonsProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  const look: Record<Rating, { bg: string; fg: string }> = {
    again: { bg: c.errorTint, fg: c.errorText },
    hard: { bg: c.warningTint, fg: c.warningText },
    good: { bg: c.successTint, fg: c.successText },
    easy: { bg: c.primaryTint, fg: c.primaryText },
  };
  const heavy = useWeight(800);
  return (
    <View testID={testID} style={[{ flexDirection: "row", flexWrap: "wrap", gap: 12 }, style]}>
      {(Object.keys(ratingIcon) as Rating[]).map((r) => {
        const label = t(`rating.${r}`);
        return (
          <PressableScale
            key={r}
            accessibilityRole="button"
            accessibilityLabel={t("rating.a11y", { label, interval: intervals[r] })}
            disabled={disabled}
            onPress={() => onRate(r)}
            style={{
              flexBasis: layout === "row" ? "21%" : "45%",
              flexGrow: 1,
              minHeight: 56,
              borderRadius: theme.radius.button,
              paddingVertical: 8,
              paddingHorizontal: 4,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              backgroundColor: look[r].bg,
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <Icon name={ratingIcon[r]} size={20} tint={look[r].fg} />
            <Text variant="label" style={[{ color: look[r].fg }, heavy]}>
              {label}
            </Text>
            <Text variant="caption" numeric style={{ color: look[r].fg }}>
              {intervals[r]}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const ROW = 56;
const VISIBLE = 5;

export interface PickerProps extends PickerContract {
  style?: StyleProp<ViewStyle>;
}

/**
 * Wheel picker (DESIGN.md §5): 56 px rows, five visible, the chosen row on a surfaceSunken band.
 * Screen readers get an adjustable control: swipe up or down to change the value.
 */
export function Picker({ label, options, value, onChange, placeholder, testID, style }: PickerProps) {
  const theme = useTheme();
  const { t } = useUI();
  const ref = useRef<ScrollView>(null);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  useEffect(() => {
    ref.current?.scrollTo({ y: index * ROW, animated: false });
  }, [index]);
  const pick = (i: number) => {
    const o = options[Math.min(options.length - 1, Math.max(0, i))];
    if (o && o.value !== value) onChange(o.value);
  };
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => pick(Math.round(e.nativeEvent.contentOffset.y / ROW));
  const current = options.find((o) => o.value === value);
  return (
    <View testID={testID} style={[{ gap: 6 }, style]}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label ?? placeholder ?? t("picker.placeholder") }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => pick(value === null ? 0 : index + (e.nativeEvent.actionName === "increment" ? 1 : -1))}
        style={{ height: ROW * VISIBLE, borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: theme.colors.surface }}
      >
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: ROW * 2, height: ROW, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken }} />
        <ScrollView
          ref={ref}
          showsVerticalScrollIndicator={false}
          snapToInterval={ROW}
          decelerationRate="fast"
          onMomentumScrollEnd={onEnd}
          contentContainerStyle={{ paddingVertical: ROW * 2 }}
          importantForAccessibility="no-hide-descendants"
        >
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <Pressable key={o.value} onPress={() => pick(i)} style={{ height: ROW, alignItems: "center", justifyContent: "center" }}>
                <Text variant="heading" numeric tone={on ? "ink" : "muted"}>
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

export interface SwitchProps extends SwitchContract {
  style?: StyleProp<ViewStyle>;
  hideLabel?: boolean;
}

/** 46 x 28 track with a check in the thumb when on (never colour alone). */
export function Switch({ checked, onCheckedChange, label, disabled, hideLabel, testID, style }: SwitchProps) {
  const theme = useTheme();
  const { reducedMotion } = useUI();
  const c = theme.colors;
  const fast = theme.motion.duration.fast;
  const thumb = useAnimatedStyle(() => ({ left: reducedMotion ? (checked ? 21 : 2) : withTiming(checked ? 21 : 2, { duration: fast }) }), [checked, reducedMotion, fast]);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => onCheckedChange(!checked)}
      style={[{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, opacity: disabled ? 0.6 : 1 }, style]}
    >
      {!hideLabel && (
        <Text variant="label" style={{ flex: 1 }} importantForAccessibility="no">
          {label}
        </Text>
      )}
      <View style={{ width: 46, height: 28, borderRadius: 14, backgroundColor: checked ? c.primary : c.track, borderWidth: checked ? 0 : 1, borderColor: c.inkDisabled }}>
        <Animated.View style={[{ position: "absolute", top: checked ? 3 : 2, width: 22, height: 22, borderRadius: 11, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }, theme.shadow.card, thumb]}>
          {checked && <Icon name="Check" size={16} color="primary" />}
        </Animated.View>
      </View>
    </Pressable>
  );
}
