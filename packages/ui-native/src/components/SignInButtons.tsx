// Third-party sign-in buttons: the documented brand exception (DESIGN.md §5, docs/ux/auth.md §0.2).
// Colours come only from tokens.thirdParty. No glow and no press scale, so they match Google's and
// Apple's own buttons. On iOS, expo-apple-authentication's system button should be used for Apple; on
// Android the Google sign-in library's button is preferred. These are the fallback and the previews.
import { Image, Platform, View, type StyleProp, type ViewStyle } from "react-native";
import { AppleLogoIcon } from "phosphor-react-native";
import { thirdParty } from "@smriti/tokens";
import type { AppleButtonContract, GoogleButtonContract, TrustLineContract } from "@smriti/tokens/ui";
import { useTheme, useUI } from "../theme";
import { Spinner } from "./Button";
import { Icon } from "./Icon";
import { PressableScale } from "./Pressable";
import { Text, useWeight } from "./Text";

// Official Google G from Google's sign-in asset kit (see src/assets/google-g.meta.json). Not redrawn.
const googleG = {
  light: require("../assets/google-g-light.png") as number,
  dark: require("../assets/google-g-dark.png") as number,
  neutral: require("../assets/google-g-neutral.png") as number,
};

export interface GoogleButtonProps extends GoogleButtonContract {
  style?: StyleProp<ViewStyle>;
}

export function GoogleButton({ theme = "auto", text = "continue", platform, loading, disabled, onPress, testID, style }: GoogleButtonProps) {
  const app = useTheme();
  const { t, locale } = useUI();
  const resolved = theme === "auto" ? app.mode : theme;
  const look =
    resolved === "neutral"
      ? { fill: thirdParty.google.neutral.fill, text: thirdParty.google.neutral.text, stroke: undefined as string | undefined }
      : thirdParty.google[resolved];
  const plat = platform ?? (Platform.OS === "ios" ? "ios" : "android");
  const pad = thirdParty.google.padding[plat];
  const label = t(text === "signIn" ? "google.signIn" : "google.continue");
  const deva = useWeight(600, label);
  return (
    <PressableScale
      noScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        {
          height: app.size.buttonHeight,
          borderRadius: app.radius.pill,
          backgroundColor: look.fill,
          borderWidth: look.stroke ? thirdParty.google.strokeWidth : 0,
          borderColor: look.stroke,
          paddingLeft: pad.beforeLogo,
          paddingRight: pad.afterText,
          alignSelf: "stretch",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}
      pressedStyle={{ opacity: 0.88 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: pad.afterLogo, opacity: loading ? 0 : 1 }}>
        <Image source={googleG[resolved]} style={{ width: 20, height: 20 }} accessibilityIgnoresInvertColors importantForAccessibility="no" />
        <Text
          importantForAccessibility="no"
          numberOfLines={1}
          style={[
            { color: look.text, fontSize: thirdParty.google.font.size, lineHeight: thirdParty.google.font.lineHeight, letterSpacing: 0 },
            // Google asks for Roboto Medium on Android and the system font on iOS; Hindi uses Noto Sans Devanagari.
            locale === "hi" ? deva : { fontFamily: Platform.OS === "android" ? "sans-serif-medium" : undefined, fontWeight: "500" },
          ]}
        >
          {label}
        </Text>
      </View>
      {loading && (
        <View style={{ position: "absolute" }}>
          <Spinner color={look.text} label={t("common.loading")} />
        </View>
      )}
    </PressableScale>
  );
}

export interface AppleButtonProps extends AppleButtonContract {
  style?: StyleProp<ViewStyle>;
}

/** Fallback for non-iOS previews. On iOS render AppleAuthenticationButton from expo-apple-authentication. */
export function AppleButton({ appearance = "auto", loading, disabled, onPress, testID, style }: AppleButtonProps) {
  const app = useTheme();
  const { t } = useUI();
  const a = thirdParty.apple;
  const look = appearance === "auto" ? app.apple : a[appearance];
  const stroke = "stroke" in look ? (look.stroke as string | undefined) : undefined;
  const label = t("apple.continue");
  const w = useWeight(600, label);
  return (
    <PressableScale
      noScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        {
          height: app.size.buttonHeight,
          borderRadius: app.radius.sheet,
          backgroundColor: look.fill,
          borderWidth: stroke ? 1 : 0,
          borderColor: stroke,
          alignSelf: "stretch",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}
      pressedStyle={{ opacity: 0.88 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: loading ? 0 : 1 }}>
        <AppleLogoIcon size={20} weight="fill" color={look.text} />
        <Text variant="body" importantForAccessibility="no" style={[{ color: look.text }, w]}>
          {label}
        </Text>
      </View>
      {loading && (
        <View style={{ position: "absolute" }}>
          <Spinner color={look.text} label={t("common.loading")} />
        </View>
      )}
    </PressableScale>
  );
}

/** "We never call you or share your email." under the provider buttons on every sign-in surface (R40). */
export function TrustLine({ testID }: TrustLineContract) {
  const { t } = useUI();
  return (
    <View testID={testID} accessible accessibilityLabel={t("auth.trust")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
      <Icon name="ShieldCheck" size={16} weight="fill" color="success" />
      <Text variant="caption" tone="muted" align="center">
        {t("auth.trust")}
      </Text>
    </View>
  );
}
