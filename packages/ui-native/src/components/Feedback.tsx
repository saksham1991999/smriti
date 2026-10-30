import { useEffect } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { meterAmountKey, type BannerContract, type DayDotsContract, type IconName, type MeterContract, type PetLineContract, type ToastContract } from "@smriti/tokens/ui";
import { useTheme, useUI } from "../theme";
import { Icon } from "./Icon";
import { PetAvatar } from "./Illustration";
import { ProgressBar } from "./Progress";
import { hitSlopFor, PressableScale } from "./Pressable";
import { Text, useWeight } from "./Text";

export interface BannerProps extends BannerContract {
  style?: StyleProp<ViewStyle>;
}

/** Full-width strip under the top bar: icon, one line, optional action and close. Never an error fill. */
export function Banner({ tone, text, icon, action, onClose, testID, style }: BannerProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  const look: Record<BannerContract["tone"], { bg: string; fg: string; icon: IconName; iconTint: string }> = {
    info: { bg: c.primaryTint, fg: c.ink, icon: "Info", iconTint: c.primary },
    warning: { bg: c.warningTint, fg: c.warningText, icon: "Warning", iconTint: c.warningText },
    offline: { bg: c.surfaceSunken, fg: c.inkMuted, icon: "WifiSlash", iconTint: c.inkMuted },
  };
  const l = look[tone];
  const bold = useWeight(700, action?.label);
  return (
    <View
      testID={testID}
      accessibilityRole={tone === "warning" ? "alert" : "text"}
      accessibilityLiveRegion={tone === "warning" ? "assertive" : "polite"}
      style={[{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: l.bg }, style]}
    >
      <Icon name={icon ?? l.icon} size={20} tint={l.iconTint} />
      <Text variant="label" style={{ flex: 1, color: l.fg }}>
        {text}
      </Text>
      {action && (
        <PressableScale accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={hitSlopFor(40, 24)}>
          <Text variant="label" style={[{ color: tone === "info" ? c.primaryText : l.fg }, bold]}>
            {action.label}
          </Text>
        </PressableScale>
      )}
      {onClose && (
        <PressableScale accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={onClose} hitSlop={hitSlopFor(32, 32)} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
          <Icon name="X" size={20} tint={l.fg} />
        </PressableScale>
      )}
    </View>
  );
}

export interface ToastProps extends ToastContract {
  style?: StyleProp<ViewStyle>;
}

/** Bottom, above the tab bar, 4 s, one action at most. Errors stay until dismissed. Position it in the screen layout. */
export function Toast({ open, message, tone = "default", icon, action, onDismiss, durationMs = 4000, testID, style }: ToastProps) {
  const theme = useTheme();
  const { t, reducedMotion } = useUI();
  const c = theme.colors;
  useEffect(() => {
    if (!open || tone === "error") return;
    const id = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(id);
  }, [open, tone, durationMs, onDismiss]);
  const bold = useWeight(700, action?.label);
  if (!open) return null;
  return (
    <Animated.View
      testID={testID}
      entering={reducedMotion ? undefined : FadeInDown.duration(theme.motion.duration.base)}
      exiting={reducedMotion ? undefined : FadeOut.duration(theme.motion.duration.fast)}
      accessibilityRole={tone === "error" ? "alert" : "text"}
      accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
      style={[{ flexDirection: "row", alignItems: "center", gap: 10, borderRadius: theme.radius.md, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.ink }, theme.shadow.raised, style]}
    >
      {(icon || tone === "error") && <Icon name={icon ?? "WarningOctagon"} size={20} tint={c.bg} />}
      <Text variant="label" style={{ flex: 1, color: c.bg }}>
        {message}
      </Text>
      {action && (
        <PressableScale accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={hitSlopFor(40, 24)}>
          <Text variant="label" style={[{ color: c.bg }, bold]}>
            {action.label}
          </Text>
        </PressableScale>
      )}
      {tone === "error" && (
        <PressableScale accessibilityRole="button" accessibilityLabel={t("common.dismiss")} onPress={onDismiss} hitSlop={hitSlopFor(32, 32)} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
          <Icon name="X" size={20} tint={c.bg} />
        </PressableScale>
      )}
    </Animated.View>
  );
}

export interface MeterProps extends MeterContract {
  style?: StyleProp<ViewStyle>;
}

/** Labelled bar for pet mood (streak gold) and energy (gem blue). Never error or warning colours. Read as words. */
export function Meter({ kind, label, stateWord, value, testID, style }: MeterProps) {
  const { t } = useUI();
  const words = t("meter.a11y", { label, state: stateWord, amount: t(meterAmountKey(value)) });
  return (
    <View testID={testID} style={[{ gap: 6 }, style]}>
      <Text variant="label" importantForAccessibility="no">
        {label} · {stateWord}
      </Text>
      <ProgressBar value={value / 100} tone={kind === "mood" ? "streak" : "gem"} thickness={10} label={label} valueText={words} />
    </View>
  );
}

export interface DayDotsProps extends DayDotsContract {
  style?: StyleProp<ViewStyle>;
}

/** 3 to 7 circles: done (success fill with a check), today (2 px primary ring), to do (track outline). */
export function DayDots({ days, label, testID, style }: DayDotsProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  return (
    <View testID={testID} accessibilityLabel={label} accessibilityRole="list" style={[{ flexDirection: "row", justifyContent: "space-between", gap: 8 }, style]}>
      {days.map((d, i) => (
        <View key={i} accessible accessibilityLabel={`${d.label}, ${t(`dayDots.${d.state}`)}`} style={{ alignItems: "center", gap: 4 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: d.state === "done" ? c.success : c.surface,
              borderWidth: d.state === "done" ? 0 : 2,
              borderColor: d.state === "today" ? c.primary : c.track,
            }}
          >
            {d.state === "done" && <Icon name="Check" size={20} tint={c.onSuccess} />}
          </View>
          <Text variant="caption" tone={d.state === "today" ? "ink" : "muted"}>
            {d.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export interface PetLineProps extends PetLineContract {
  style?: StyleProp<ViewStyle>;
}

/** The pet's 40 px avatar plus a speech bubble on surface, at most two lines, read by screen readers. */
export function PetLine({ pet, petName, text, avatarSize = 40, live = true, testID, style }: PetLineProps) {
  const theme = useTheme();
  const { t } = useUI();
  return (
    <View testID={testID} style={[{ flexDirection: "row", alignItems: "flex-end", gap: 8 }, style]}>
      <PetAvatar species={pet.species} mood={pet.mood} size={avatarSize} />
      <View
        accessible
        accessibilityLabel={t("pet.says", { pet_name: petName, text })}
        accessibilityLiveRegion={live ? "polite" : "none"}
        style={[
          { flexShrink: 1, maxWidth: 320, borderRadius: 18, borderBottomLeftRadius: 6, backgroundColor: theme.colors.surface, paddingHorizontal: 14, paddingVertical: 10 },
          theme.shadow.card,
        ]}
      >
        <Text variant="label" numberOfLines={2}>
          {text}
        </Text>
      </View>
    </View>
  );
}
