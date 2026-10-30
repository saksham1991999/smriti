import type { ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SidebarNavContract, TabBarContract, TopBarContract } from "@smriti/tokens/ui";
import { useTheme, useUI } from "../theme";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import { Text, useWeight } from "./Text";

export interface TabBarProps extends TabBarContract {
  style?: StyleProp<ViewStyle>;
}

/**
 * 82 tall with the safe area. Filled icon and primary for the active tab, bold outline and inkMuted otherwise.
 * Phase 1 ships four tabs, little learners three (R14, R46): pass the items for the student.
 */
export function TabBar({ items, activeKey, onSelect, testID, style }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  const bold = useWeight(700);
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={[{ flexDirection: "row", borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface, paddingHorizontal: 4, paddingTop: 8, paddingBottom: Math.max(22, insets.bottom) }, style]}
    >
      {items.map((it) => {
        const on = it.key === activeKey;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityLabel={it.badge ? `${it.label}, ${it.badge}` : it.label}
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(it.key)}
            style={{ flex: 1, minHeight: 48, alignItems: "center", gap: 3 }}
          >
            <View style={{ width: 44, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: on ? c.primaryTint : "transparent" }}>
              <Icon name={it.icon} weight={on ? "fill" : "bold"} color={on ? "primary" : "inkMuted"} />
            </View>
            <Text variant="caption" numberOfLines={1} tone={on ? "primary" : "muted"} style={[bold, { fontSize: 11, lineHeight: 14 }]}>
              {it.label}
            </Text>
            {it.badge && (
              <View style={{ position: "absolute", top: 0, right: "22%", minWidth: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: c.error }}>
                <Text variant="caption" style={{ color: c.onError, fontSize: 11, lineHeight: 16, textAlign: "center" }}>
                  {it.badge}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export interface SidebarNavProps extends SidebarNavContract {
  style?: StyleProp<ViewStyle>;
  header?: ReactNode;
  footer?: ReactNode;
}

/** The tablet sidebar (600 px and wider), same items as the tab bar. */
export function SidebarNav({ items, activeKey, onSelect, header, footer, testID, style }: SidebarNavProps) {
  const theme = useTheme();
  const c = theme.colors;
  const bold = useWeight(700);
  return (
    <View testID={testID} style={[{ width: 248, gap: 6, borderRightWidth: 1, borderRightColor: c.line, backgroundColor: c.surface, paddingHorizontal: 14, paddingVertical: 18 }, style]}>
      {header}
      {items.map((it) => {
        const on = it.key === activeKey;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityLabel={it.badge ? `${it.label}, ${it.badge}` : it.label}
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(it.key)}
            style={{ height: 48, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, paddingHorizontal: 12, backgroundColor: on ? c.primaryTint : "transparent" }}
          >
            <Icon name={it.icon} weight={on ? "fill" : "bold"} color={on ? "primaryText" : "inkMuted"} />
            <Text variant="label" tone={on ? "primary" : "muted"} style={[bold, { flex: 1 }]}>
              {it.label}
            </Text>
            {it.badge && (
              <View style={{ borderRadius: 999, paddingHorizontal: 6, backgroundColor: c.error }}>
                <Text variant="caption" style={{ color: c.onError }}>
                  {it.badge}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
      {footer && <View style={{ marginTop: "auto" }}>{footer}</View>}
    </View>
  );
}

export interface TopBarProps extends TopBarContract {
  style?: StyleProp<ViewStyle>;
  leading?: ReactNode;
  trailing?: ReactNode;
}

/** 56 tall top bar: back (CaretLeft, labelled "Back") or close, title in `title`, up to a couple of actions. */
export function TopBar({ title, onBack, backIcon = "CaretLeft", actions, leading, trailing, testID, style }: TopBarProps) {
  const { t } = useUI();
  return (
    <View testID={testID} style={[{ height: 56, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }, style]}>
      {leading ?? (onBack ? <IconButton icon={backIcon} label={backIcon === "X" ? t("common.close") : t("common.back")} onPress={onBack} size={48} /> : null)}
      {title ? (
        <Text variant="title" heading numberOfLines={1} style={{ flex: 1 }}>
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {actions?.map((a) => <IconButton key={a.label} icon={a.icon} label={a.label} onPress={a.onPress} size={48} />)}
      {trailing}
    </View>
  );
}
