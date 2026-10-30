import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { SubjectColors } from "@smriti/tokens";
import type { NativeTheme } from "@smriti/tokens/native";
import {
  clamp01,
  ringGeometry,
  toPercent,
  type ProgressBarContract,
  type ProgressRingContract,
  type ProgressTone,
  type SegmentedProgressContract,
} from "@smriti/tokens/ui";
import { useSubject, useTheme, useUI } from "../theme";
import { Text } from "./Text";

export function progressToneColor(theme: NativeTheme, tone: ProgressTone, s: SubjectColors): string {
  const c = theme.colors;
  switch (tone) {
    case "primary":
      return c.primary;
    case "streak":
      return c.streak;
    case "success":
      return c.success;
    case "gem":
      return c.gem;
    case "onStrong":
      return s.onStrong;
    default:
      return s.strong;
  }
}

/** The track on a strong fill: onStrong at 28%. */
const withAlpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

export interface ProgressBarProps extends ProgressBarContract {
  style?: StyleProp<ViewStyle>;
}

/** 8 px bar, radius 4, `track` behind (DESIGN.md §5). On a strong fill use tone="onStrong". */
export function ProgressBar({ value, tone = "subject", subject, label, valueText, thickness = 8, style, testID }: ProgressBarProps) {
  const theme = useTheme();
  const { t } = useUI();
  const s = useSubject(subject);
  const pct = toPercent(value);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct, text: valueText ?? t("progress.percent", { percent: pct }) }}
      style={[{ height: thickness, borderRadius: thickness / 2, overflow: "hidden", alignSelf: "stretch", backgroundColor: tone === "onStrong" ? withAlpha(s.onStrong, 0.28) : theme.colors.track }, style]}
    >
      <View style={{ height: "100%", width: `${clamp01(value) * 100}%`, borderRadius: thickness / 2, backgroundColor: progressToneColor(theme, tone, s) }} />
    </View>
  );
}

export interface ProgressRingProps extends ProgressRingContract {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/** Ring with stroke 10-12 (DESIGN.md §5), drawn with react-native-svg. */
export function ProgressRing({ value, size = 56, stroke = 10, tone = "subject", subject, label, valueText, centerText, children, style, testID }: ProgressRingProps) {
  const theme = useTheme();
  const { t } = useUI();
  const s = useSubject(subject);
  const g = ringGeometry(size, stroke, value);
  const pct = toPercent(value);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct, text: valueText ?? t("progress.percent", { percent: pct }) }}
      style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={g.cx} cy={g.cy} r={g.r} fill="none" strokeWidth={stroke} stroke={theme.colors.track} />
        {value > 0 && (
          <Circle
            cx={g.cx}
            cy={g.cy}
            r={g.r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            stroke={progressToneColor(theme, tone, s)}
            strokeDasharray={`${g.circumference}`}
            strokeDashoffset={g.dashOffset}
          />
        )}
      </Svg>
      {children ?? (centerText ? (
        <Text variant="label" numeric style={{ fontFamily: theme.fonts.latin[800], fontWeight: "800" }}>
          {centerText}
        </Text>
      ) : null)}
    </View>
  );
}

export interface SegmentedProgressProps extends SegmentedProgressContract {
  style?: StyleProp<ViewStyle>;
}

/** Lesson progress: one segment per card (or per onboarding question). */
export function SegmentedProgress({ total, done, current, tone = "primary", subject, label, style, testID }: SegmentedProgressProps) {
  const theme = useTheme();
  const { t } = useUI();
  const s = useSubject(subject);
  const fill = progressToneColor(theme, tone, s);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: total, now: done, text: t("progress.segments", { done, total }) }}
      style={[{ flexDirection: "row", gap: 4, alignSelf: "stretch" }, style]}
    >
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: theme.colors.track }}>
          <View style={{ height: "100%", borderRadius: 4, backgroundColor: fill, width: i < done ? "100%" : i === current ? "50%" : "0%" }} />
        </View>
      ))}
    </View>
  );
}
