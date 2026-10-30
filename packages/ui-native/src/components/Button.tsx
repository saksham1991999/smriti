import { ActivityIndicator, View, type StyleProp, type ViewStyle } from "react-native";
import type { ButtonContract, ButtonVariant, IconButtonContract } from "@smriti/tokens/ui";
import type { NativeTheme } from "@smriti/tokens/native";
import { useTheme, useUI } from "../theme";
import { Icon } from "./Icon";
import { hitSlopFor, PressableScale } from "./Pressable";
import { Text, useWeight } from "./Text";

export function Spinner({ color, label, size = 20 }: { color?: string; label?: string; size?: number }) {
  const theme = useTheme();
  return (
    <ActivityIndicator
      size={size > 24 ? "large" : "small"}
      color={color ?? theme.colors.ink}
      accessibilityLabel={label}
      accessible={Boolean(label)}
      accessibilityRole={label ? "progressbar" : undefined}
    />
  );
}

function variantLook(theme: NativeTheme, variant: ButtonVariant) {
  const c = theme.colors;
  switch (variant) {
    case "secondary":
      return { bg: c.surface, fg: c.ink, pressed: c.surfaceSunken, border: c.line };
    case "ghost":
      return { bg: "transparent", fg: c.primaryText, pressed: c.primaryTint };
    case "destructive":
      return { bg: c.error, fg: c.onError, pressed: c.error };
    default:
      return { bg: c.primary, fg: c.onPrimary, pressed: c.primaryPressed };
  }
}

export interface ButtonProps extends ButtonContract {
  style?: StyleProp<ViewStyle>;
}

/** DESIGN.md §5 Button: primary (filled, glow), secondary, ghost, destructive; 56 or 40 tall. */
export function Button({ label, variant = "primary", size = "lg", icon, iconPosition = "start", loading, disabled, fullWidth, onPress, accessibilityLabel, testID, style }: ButtonProps) {
  const theme = useTheme();
  const { t } = useUI();
  const full = fullWidth ?? size === "lg";
  const inactive = disabled || loading;
  const look = disabled ? { bg: theme.colors.surfaceSunken, fg: theme.colors.inkMuted, pressed: theme.colors.surfaceSunken } : variantLook(theme, variant);
  const h = size === "lg" ? theme.size.buttonHeight : theme.size.buttonHeightSmall;
  const bold = useWeight(700, label);
  const iconEl = icon ? <Icon name={icon} size={size === "lg" ? 24 : 20} tint={look.fg} /> : null;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      hitSlop={hitSlopFor(full ? 48 : 0, h)}
      style={[
        {
          height: h,
          borderRadius: size === "lg" ? theme.radius.button : theme.radius.md,
          paddingHorizontal: size === "lg" ? 20 : 14,
          backgroundColor: look.bg,
          alignSelf: full ? "stretch" : "flex-start",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: "border" in look && look.border ? 1.5 : 0,
          borderColor: "border" in look ? look.border : undefined,
        },
        variant === "primary" && !disabled ? theme.shadow.cta : null,
        style,
      ]}
      pressedStyle={{ backgroundColor: look.pressed, opacity: variant === "destructive" ? 0.9 : 1 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, opacity: loading ? 0 : 1 }}>
        {iconPosition === "start" && iconEl}
        <Text variant={size === "lg" ? "body" : "label"} style={[{ color: look.fg }, bold]} importantForAccessibility="no">
          {label}
        </Text>
        {iconPosition === "end" && iconEl}
      </View>
      {loading && (
        <View style={{ position: "absolute" }}>
          <Spinner color={look.fg} label={t("common.loading")} />
        </View>
      )}
    </PressableScale>
  );
}

export interface IconButtonProps extends IconButtonContract {
  style?: StyleProp<ViewStyle>;
  size?: 40 | 44 | 48 | 56;
}

/** Icon-only button with a required label and a 48 px hit area. */
export function IconButton({ icon, label, variant = "plain", weight = "bold", disabled, onPress, testID, style, size = 44 }: IconButtonProps) {
  const theme = useTheme();
  const c = theme.colors;
  const bg = variant === "filled" ? c.surface : variant === "primary" ? c.primary : "transparent";
  const fg = disabled ? c.inkDisabled : variant === "primary" ? c.onPrimary : c.ink;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={hitSlopFor(size, size)}
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" },
        variant === "filled" ? theme.shadow.card : variant === "primary" ? theme.shadow.raised : null,
        style,
      ]}
      pressedStyle={variant === "plain" ? { backgroundColor: c.surfaceSunken } : undefined}
    >
      <Icon name={icon} size={24} weight={weight} tint={fg} />
    </PressableScale>
  );
}
