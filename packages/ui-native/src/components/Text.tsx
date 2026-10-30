import type { ReactNode } from "react";
import { Text as RNText, type StyleProp, type TextStyle } from "react-native";
import { hasDevanagari, type TextContract, type TextTone } from "@smriti/tokens/ui";
import type { NativeTheme } from "@smriti/tokens/native";
import { useSubject, useTheme, useUI } from "../theme";

export interface TextProps extends TextContract {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  accessibilityLabel?: string;
  accessible?: boolean;
  importantForAccessibility?: "auto" | "yes" | "no" | "no-hide-descendants";
}

function textOf(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

export function toneColor(theme: NativeTheme, tone: TextTone, subject: { text: string; onStrong: string }): string {
  const c = theme.colors;
  switch (tone) {
    case "muted":
      return c.inkMuted;
    case "disabled":
      return c.inkDisabled;
    case "primary":
      return c.primaryText;
    case "subject":
      return subject.text;
    case "onStrong":
      return subject.onStrong;
    case "onPrimary":
      return c.onPrimary;
    case "success":
      return c.successText;
    case "error":
      return c.errorText;
    case "warning":
      return c.warningText;
    case "streak":
      return c.streakText;
    default:
      return c.ink;
  }
}

/**
 * Typography from tokens.type. Strings with Devanagari (or any text in Hindi mode) use Noto Sans
 * Devanagari at 1.15x the line height, because React Native has no per-glyph font fallback.
 */
export function Text({ variant = "body", tone = "ink", numeric, align, subject, heading, children, style, testID, numberOfLines, accessibilityLabel, accessible, importantForAccessibility }: TextProps) {
  const theme = useTheme();
  const { locale } = useUI();
  const s = useSubject(subject);
  const str = textOf(children);
  const script = hasDevanagari(str) || (locale === "hi" && str === "") ? "devanagari" : "latin";
  const base = theme.type[script][variant];
  return (
    <RNText
      testID={testID}
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel}
      accessible={accessible}
      importantForAccessibility={importantForAccessibility}
      accessibilityRole={heading ?? (variant === "display" || variant === "title") ? "header" : undefined}
      style={[
        base,
        { color: toneColor(theme, tone, s), textAlign: align === "center" ? "center" : align === "end" ? "right" : undefined, fontVariant: numeric ? ["tabular-nums"] : undefined },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

/** Font family for a weight in the right script, for Text that needs a weight other than its variant's. */
export function useWeight(weight: 500 | 600 | 700 | 800, text?: string): TextStyle {
  const theme = useTheme();
  const { locale } = useUI();
  const script = text !== undefined ? (hasDevanagari(text) ? "devanagari" : "latin") : locale === "hi" ? "devanagari" : "latin";
  return { fontFamily: theme.fonts[script][weight], fontWeight: String(weight) as TextStyle["fontWeight"] };
}
