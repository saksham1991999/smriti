import { Children, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import type { PriceBlockContract, SettingsGroupContract, SettingsRowContract, TrialTimelineContract } from "@smriti/tokens/ui";
import { useTheme, useUI } from "../theme";
import { Icon } from "./Icon";
import { Switch } from "./Inputs";
import { PressableScale } from "./Pressable";
import { Text, useWeight } from "./Text";

export interface SettingsRowProps extends SettingsRowContract {
  style?: StyleProp<ViewStyle>;
}

/** 56 px row: leading icon in inkMuted, title in `label`, optional value, then a caret or a switch. */
export function SettingsRow({ title, icon, value, trailing = "caret", checked = false, onCheckedChange, onPress, destructive, disabled, testID, style }: SettingsRowProps) {
  const theme = useTheme();
  const box: ViewStyle = { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, opacity: disabled ? 0.6 : 1 };
  if (trailing === "switch") {
    return (
      <View testID={testID} style={[box, style]}>
        {icon && <Icon name={icon} color="inkMuted" />}
        <Switch label={title} checked={checked} onCheckedChange={(v) => onCheckedChange?.(v)} disabled={disabled} style={{ flex: 1 }} />
      </View>
    );
  }
  const content = (
    <>
      {icon && <Icon name={icon} color={destructive ? "errorText" : "inkMuted"} />}
      <Text variant="label" tone={destructive ? "error" : "ink"} style={{ flex: 1 }}>
        {title}
      </Text>
      {value && (
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ maxWidth: "50%" }}>
          {value}
        </Text>
      )}
      {trailing === "caret" && <Icon name="CaretRight" size={20} color="inkMuted" />}
    </>
  );
  return onPress ? (
    <PressableScale
      noScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}, ${value}` : title}
      disabled={disabled}
      onPress={onPress}
      style={[box, style]}
      pressedStyle={{ backgroundColor: theme.colors.surfaceSunken }}
    >
      {content}
    </PressableScale>
  ) : (
    <View testID={testID} accessible accessibilityLabel={value ? `${title}, ${value}` : title} style={[box, style]}>
      {content}
    </View>
  );
}

export interface SettingsGroupProps extends SettingsGroupContract {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/** Rows grouped in a surface card, radius 20, with line dividers, under an optional caption heading. */
export function SettingsGroup({ title, children, testID, style }: SettingsGroupProps) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View testID={testID} style={[{ gap: 8 }, style]}>
      {title && (
        <Text variant="caption" tone="muted" heading style={{ paddingHorizontal: 4, letterSpacing: 0.6, textTransform: "uppercase" }}>
          {title}
        </Text>
      )}
      <View style={[{ overflow: "hidden", borderRadius: theme.radius.card, backgroundColor: theme.colors.surface }, theme.shadow.card]}>
        {rows.map((r, i) => (
          <View key={i} style={i > 0 ? { borderTopWidth: 1, borderTopColor: theme.colors.line } : undefined}>
            {r}
          </View>
        ))}
      </View>
    </View>
  );
}

export interface PriceBlockProps extends PriceBlockContract {
  style?: StyleProp<ViewStyle>;
}

/** The price as live text in `display`, the "then" line in `body`, fine print in `caption`. Tax-inclusive. */
export function PriceBlock({ price, thenLine, finePrint, testID, style }: PriceBlockProps) {
  return (
    <View testID={testID} style={[{ gap: 4 }, style]}>
      <Text variant="display" numeric heading={false}>
        {price}
      </Text>
      {thenLine && <Text variant="body">{thenLine}</Text>}
      {finePrint && (
        <Text variant="caption" tone="muted">
          {finePrint}
        </Text>
      )}
    </View>
  );
}

export interface TrialTimelineProps extends TrialTimelineContract {
  style?: StyleProp<ViewStyle>;
}

/** R33: today ₹1, the reminder date, the renewal date and price, on real dates. No countdown, no anchors. */
export function TrialTimeline({ eligible, todayLabel, reminderDate, renewDate, trialPrice, renewPrice, testID, style }: TrialTimelineProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  const bold = useWeight(700);
  if (!eligible) {
    return (
      <View testID={testID} style={[{ flexDirection: "row", alignItems: "flex-start", gap: 12 }, style]}>
        <Icon name="CalendarCheck" color="primaryText" />
        <Text variant="label" style={{ flex: 1 }}>
          {t("trial.notEligible", { date: renewDate, price: renewPrice })}
        </Text>
      </View>
    );
  }
  const rows = [
    { icon: "CheckCircle" as const, text: t("trial.today", { price: trialPrice }), sub: todayLabel, done: true },
    { icon: "Bell" as const, text: t("trial.reminder", { date: reminderDate }), sub: undefined, done: false },
    { icon: "CalendarCheck" as const, text: t("trial.renew", { date: renewDate, price: renewPrice }), sub: undefined, done: false },
  ];
  return (
    <View testID={testID} style={[{ gap: 12 }, style]}>
      <View accessibilityRole="list" style={{ gap: 16 }}>
        <View style={{ position: "absolute", top: 16, bottom: 16, left: 15, width: 2, backgroundColor: c.line }} />
        {rows.map((r, i) => (
          <View key={i} accessible accessibilityLabel={r.sub ? `${r.text}, ${r.sub}` : r.text} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: r.done ? c.primary : c.surfaceSunken }}>
              <Icon name={r.icon} size={20} weight={r.done ? "fill" : "bold"} color={r.done ? "onPrimary" : "inkMuted"} />
            </View>
            <View style={{ flex: 1, paddingTop: 4 }}>
              <Text variant="label" style={bold}>
                {r.text}
              </Text>
              {r.sub && (
                <Text variant="caption" tone="muted">
                  {r.sub}
                </Text>
              )}
            </View>
          </View>
        ))}
      </View>
      <Text variant="caption" tone="primary">
        {t("trial.cancel")}
      </Text>
    </View>
  );
}
