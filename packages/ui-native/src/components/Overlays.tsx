import { useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DialogContract, SheetContract, TooltipContract } from "@smriti/tokens/ui";
import { useTheme, useUI } from "../theme";
import { Button, IconButton } from "./Button";
import { Text } from "./Text";

export interface SheetProps extends SheetContract {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  footer?: ReactNode;
}

/**
 * Bottom sheet on a transparent Modal: radius 28 at the top, grabber, scrim. Heights 40%, 60%, full;
 * grows with content. Slides up, or fades in reduced motion. Android back and scrim tap close it when dismissible.
 */
export function Sheet({ open, onOpenChange, title, hideTitle, description, height = "60", tone = "default", dismissible = true, children, footer, style, testID }: SheetProps) {
  const theme = useTheme();
  const { t, reducedMotion } = useUI();
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  const min = height === "full" ? winH - 24 : (winH * Number(height)) / 100;
  const close = () => dismissible && onOpenChange(false);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={close} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: c.scrim }} disabled={!dismissible} />
        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          entering={reducedMotion ? FadeIn.duration(theme.motion.duration.base) : SlideInDown.duration(theme.motion.duration.slow)}
          style={[
            {
              minHeight: min,
              maxHeight: winH - 24,
              height: height === "full" ? winH - 24 : undefined,
              borderTopLeftRadius: theme.radius.sheet,
              borderTopRightRadius: theme.radius.sheet,
              paddingHorizontal: 20,
              paddingTop: 10,
              paddingBottom: Math.max(26, insets.bottom),
              backgroundColor: tone === "success" ? c.successTint : tone === "error" ? c.errorTint : c.surfaceRaised,
            },
            theme.shadow.raised,
            style,
          ]}
        >
          <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: c.line, marginBottom: 8 }} />
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            {hideTitle ? (
              <View accessible accessibilityRole="header" accessibilityLabel={title} style={{ flex: 1 }} />
            ) : (
              <Text variant="title" heading style={{ flex: 1 }}>
                {title}
              </Text>
            )}
            {dismissible && <IconButton icon="X" label={t("common.close")} onPress={() => onOpenChange(false)} size={48} style={{ marginTop: -4, marginRight: -8 }} />}
          </View>
          {description && (
            <Text variant="body" tone="muted" style={{ marginTop: 4 }}>
              {description}
            </Text>
          )}
          <ScrollView style={{ marginTop: 12, flexGrow: 0 }} contentContainerStyle={{ flexGrow: 1 }}>
            {children}
          </ScrollView>
          {footer && <View style={{ marginTop: 12, gap: 10 }}>{footer}</View>}
        </Animated.View>
      </View>
    </Modal>
  );
}

export interface DialogProps extends DialogContract {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/** Centred confirm dialog (sign out, leave a duel). One main action, Cancel beside it. */
export function Dialog({ open, onOpenChange, title, description, confirm, cancel, children, style, testID }: DialogProps) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)} statusBarTranslucent>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.scrim, padding: 16 }}>
        <View testID={testID} accessibilityViewIsModal style={[{ width: "100%", maxWidth: 420, gap: 12, borderRadius: theme.radius.cardLarge, backgroundColor: c.surfaceRaised, padding: 24 }, theme.shadow.raised, style]}>
          <Text variant="title" heading>
            {title}
          </Text>
          {description && (
            <Text variant="body" tone="muted">
              {description}
            </Text>
          )}
          {children}
          <View style={{ marginTop: 8, gap: 10 }}>
            {confirm && <Button label={confirm.label} variant={confirm.destructive ? "destructive" : "primary"} onPress={confirm.onPress} />}
            {cancel && <Button label={cancel.label} variant="ghost" onPress={cancel.onPress} />}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Parity with ui-web (Radix needs a provider there); a pass-through on native. */
export function TooltipProvider({ children }: { children: ReactNode; delayDuration?: number }) {
  return <>{children}</>;
}

export interface TooltipProps extends TooltipContract {
  children: ReactNode;
}

/**
 * Touch has no hover, so on native the hint shows on long press, above the child, until released.
 * The child must carry its own accessibility label (IconButton does).
 */
export function Tooltip({ label, children, testID }: TooltipProps) {
  const theme = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <View testID={testID} style={{ alignSelf: "flex-start" }}>
      <Pressable onLongPress={() => setShown(true)} onPressOut={() => setShown(false)} accessibilityHint={label}>
        {children}
      </Pressable>
      {shown && (
        <View pointerEvents="none" style={[{ position: "absolute", bottom: "100%", marginBottom: 6, alignSelf: "center", borderRadius: theme.radius.xs, backgroundColor: theme.colors.ink, paddingHorizontal: 10, paddingVertical: 6 }, theme.shadow.raised]}>
          <Text variant="caption" style={{ color: theme.colors.bg }} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </View>
  );
}
