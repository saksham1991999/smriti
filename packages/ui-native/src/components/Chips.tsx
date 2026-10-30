import { View, type StyleProp, type ViewStyle } from "react-native";
import type { NativeTheme } from "@smriti/tokens/native";
import type { SubjectColors } from "@smriti/tokens";
import {
  truncateEmailMiddle,
  type ChipContract,
  type ChipTone,
  type ChoiceChipsContract,
  type CitationChipContract,
  type IconName,
  type ProChipContract,
  type SaveState,
  type SaveStateChipContract,
  type StreakPillContract,
} from "@smriti/tokens/ui";
import { useSubject, useTheme, useUI } from "../theme";
import { Icon } from "./Icon";
import { hitSlopFor, PressableScale } from "./Pressable";
import { Text, useWeight } from "./Text";

export function chipLook(theme: NativeTheme, tone: ChipTone, s: SubjectColors): { bg: string; fg: string; border?: string } {
  const c = theme.colors;
  switch (tone) {
    case "neutral":
      return { bg: c.surfaceRaised, fg: c.ink, border: c.line };
    case "subject":
      return { bg: s.tint, fg: s.text };
    case "primary":
      return { bg: c.primaryTint, fg: c.primaryText };
    case "success":
      return { bg: c.successTint, fg: c.successText };
    case "warning":
      return { bg: c.warningTint, fg: c.warningText };
    case "error":
      return { bg: c.errorTint, fg: c.errorText };
    case "streak":
      return { bg: c.streakTint, fg: c.streakText };
    default:
      return { bg: c.surfaceSunken, fg: c.inkMuted };
  }
}

export interface ChipProps extends ChipContract {
  style?: StyleProp<ViewStyle>;
  /** For chips inside a radio/checkbox group (ChoiceChips). */
  role?: "radio" | "checkbox" | "button";
  /** Text colour override (CitationChip uses ink on sunken). */
  textColor?: string;
  /** Extra ring for selected choice chips. */
  ringColor?: string;
}

/** 32 tall, fully round (DESIGN.md §5). Filter chips select; status chips are a tint with its *Text colour. */
export function Chip({ label, kind = "status", tone, icon, selected, subject, onPress, accessibilityLabel, testID, style, role, textColor, ringColor }: ChipProps) {
  const theme = useTheme();
  const s = useSubject(subject);
  const resolvedTone: ChipTone = tone ?? (kind === "filter" ? "neutral" : "sunken");
  const look = kind === "filter" && selected ? { bg: theme.colors.primary, fg: theme.colors.onPrimary, border: undefined } : chipLook(theme, resolvedTone, s);
  const fg = textColor ?? look.fg;
  const border = ringColor ?? look.border;
  const content = (
    <>
      {kind === "filter" && selected && !icon ? <Icon name="Check" size={16} tint={fg} /> : icon ? <Icon name={icon} size={16} weight={icon === "Plant" ? "fill" : "bold"} tint={fg} /> : null}
      <Text variant="label" numberOfLines={1} style={{ color: fg, flexShrink: 1 }}>
        {label}
      </Text>
    </>
  );
  const box: ViewStyle = {
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    maxWidth: "100%",
    backgroundColor: look.bg,
    borderWidth: border ? (ringColor ? 2 : 1) : 0,
    borderColor: border,
  };
  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={accessibilityLabel ?? label} style={[box, style]}>
        {content}
      </View>
    );
  }
  const isToggle = kind === "filter" || role === "radio" || role === "checkbox";
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      accessibilityRole={role === "radio" ? "radio" : role === "checkbox" ? "checkbox" : isToggle ? "togglebutton" : "button"}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={isToggle ? { checked: Boolean(selected), selected: Boolean(selected) } : undefined}
      hitSlop={hitSlopFor(48, 32)}
      style={[box, style]}
    >
      {content}
    </PressableScale>
  );
}

export interface ChoiceChipsProps extends ChoiceChipsContract {
  style?: StyleProp<ViewStyle>;
}

/** A radio or checkbox group of chips for short answers. Selected: primaryTint, primary text, check icon. */
export function ChoiceChips({ label, hideLabel, options, value, multiple, onChange, testID, style }: ChoiceChipsProps) {
  const theme = useTheme();
  const toggle = (v: string) => {
    if (multiple) onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    else onChange([v]);
  };
  return (
    <View testID={testID} style={[{ gap: 8 }, style]}>
      {!hideLabel && (
        <Text variant="label" tone="muted">
          {label}
        </Text>
      )}
      <View accessibilityRole={multiple ? undefined : "radiogroup"} accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <Chip
              key={o.value}
              label={o.label}
              role={multiple ? "checkbox" : "radio"}
              tone={on ? "primary" : "neutral"}
              icon={on ? "Check" : undefined}
              selected={on}
              onPress={() => toggle(o.value)}
              ringColor={on ? theme.colors.primary : undefined}
            />
          );
        })}
      </View>
    </View>
  );
}

export interface ProChipProps extends ProChipContract {
  style?: StyleProp<ViewStyle>;
}

/** "Pro" on primaryTint with LockSimple. Never gold (R11). Under-13s get "Ask a grown-up" instead (R14). */
export function ProChip({ askGrownUp, onPress, testID, style }: ProChipProps) {
  const { t } = useUI();
  return (
    <Chip
      testID={testID}
      tone="primary"
      icon="LockSimple"
      label={askGrownUp ? t("pro.askGrownUp") : t("pro.label")}
      accessibilityLabel={askGrownUp ? undefined : t("pro.a11y")}
      onPress={onPress}
      style={style}
    />
  );
}

export interface CitationChipProps extends CitationChipContract {
  style?: StyleProp<ViewStyle>;
}

/** "{exam_short} {year} · {session_label}" on every PYQ; dropped or changed keys add a warning state. */
export function CitationChip({ examShort, year, sessionLabel, keyStatus = "final", onPress, testID, style }: CitationChipProps) {
  const { t } = useUI();
  const theme = useTheme();
  const flagged = keyStatus === "dropped" || keyStatus === "changed";
  const base = `${examShort} ${year} · ${sessionLabel}`;
  const extra = keyStatus === "dropped" ? t("citation.dropped") : keyStatus === "changed" ? t("citation.changed") : keyStatus === "provisional" ? t("citation.provisional") : null;
  return (
    <Chip
      testID={testID}
      tone={flagged ? "warning" : "sunken"}
      icon={flagged ? "Warning" : "FileText"}
      label={extra ? `${base} · ${extra}` : base}
      accessibilityLabel={`${t("citation.a11y", { exam: examShort, year, session: sessionLabel })}${extra ? ` ${extra}.` : ""}`}
      onPress={onPress}
      textColor={flagged ? undefined : theme.colors.ink}
      style={style}
    />
  );
}

const saveStateLook: Record<SaveState, { tone: ChipTone; icon: IconName }> = {
  guest: { tone: "warning", icon: "CloudSlash" },
  saving: { tone: "sunken", icon: "CloudArrowUp" },
  saved: { tone: "success", icon: "CloudCheck" },
  saved_offline: { tone: "success", icon: "CloudCheck" },
};

export interface SaveStateChipProps extends SaveStateChipContract {
  style?: StyleProp<ViewStyle>;
  maxChars?: number;
}

/** AUTH-33: whether progress is only on this phone, saving, saved, or saved but offline. Icon plus text. */
export function SaveStateChip({ state, email, provider = "google", managed, layout = "chip", onPress, maxChars = 22, testID, style }: SaveStateChipProps) {
  const { t } = useUI();
  const full =
    state === "guest"
      ? t("saveState.guest")
      : state === "saving"
        ? t("saveState.saving")
        : state === "saved_offline"
          ? t("saveState.savedOffline")
          : managed
            ? t("saveState.savedManaged")
            : provider === "apple" || !email
              ? t("saveState.savedApple")
              : t("saveState.saved", { email });
  const shown = state === "saved" && email && !managed && provider !== "apple" ? t("saveState.saved", { email: truncateEmailMiddle(email, maxChars) }) : full;
  const look = saveStateLook[state];
  if (layout === "row") {
    return (
      <View testID={testID} accessible accessibilityLabel={full} accessibilityLiveRegion="polite" style={[{ flexDirection: "row", alignItems: "center", gap: 8 }, style]}>
        <Icon name={look.icon} size={20} color={state === "guest" ? "warningText" : state === "saving" ? "inkMuted" : "successText"} />
        <Text variant="body" style={{ flexShrink: 1 }}>
          {shown}
        </Text>
      </View>
    );
  }
  return (
    <View accessibilityLiveRegion="polite" style={{ alignSelf: "flex-start" }}>
      <Chip
        testID={testID}
        tone={look.tone}
        icon={look.icon}
        label={shown}
        accessibilityLabel={state === "guest" ? t("saveState.guestHint") : full}
        onPress={onPress}
        style={style}
      />
    </View>
  );
}

export interface StreakPillProps extends StreakPillContract {
  style?: StyleProp<ViewStyle>;
}

/** The streak count with Phosphor Plant (fill) in streak gold, never a flame (R28). */
export function StreakPill({ days, onPress, testID, style }: StreakPillProps) {
  const theme = useTheme();
  const { t } = useUI();
  const w = useWeight(800, String(days));
  const box: ViewStyle = { height: 32, borderRadius: 16, paddingLeft: 8, paddingRight: 12, flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: theme.colors.streakTint };
  const inner = (
    <>
      <Icon name="Plant" size={20} weight="fill" color="streak" />
      <Text variant="label" numeric importantForAccessibility="no" style={w}>
        {days}
      </Text>
    </>
  );
  const label = t("streak.pill", { n: days });
  return onPress ? (
    <PressableScale testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={hitSlopFor(48, 32)} style={[box, style]}>
      {inner}
    </PressableScale>
  ) : (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={label} style={[box, style]}>
      {inner}
    </View>
  );
}
