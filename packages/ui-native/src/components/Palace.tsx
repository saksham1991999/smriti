import { View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useState } from "react";
import type { RoomCardContract } from "@smriti/tokens/ui";
import { useTheme, useUI } from "../theme";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Illustration } from "./Illustration";
import { PressableScale } from "./Pressable";
import { Text, useWeight } from "./Text";

export interface RoomCardProps extends RoomCardContract {
  style?: StyleProp<ViewStyle>;
}

/**
 * A memory-palace card (MEM-12): the first room's image as a 3:2 banner, the name in heading, the meta line,
 * a Due marker (warning, Clock and the word), then [Walk] secondary and [Quiz me] primary small.
 * The banner and title open the palace (onPress); the two buttons are separate controls after it.
 */
export function RoomCard({ name, image, imageAlt, meta, due, onWalk, onQuiz, onPress, testID, style }: RoomCardProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  const bold = useWeight(700);
  const { width: screen } = useWindowDimensions();
  const [width, setWidth] = useState(Math.min(screen - 32, 560));
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const bannerH = Math.round((width * 2) / 3);
  const label = [name, meta, due ? t("palace.due") : undefined].filter(Boolean).join(", ");
  const head = (
    <>
      <View style={{ width: "100%", height: bannerH, backgroundColor: c.surfaceSunken }}>
        <Illustration name={image} alt={imageAlt} decorative={!imageAlt} fit="cover" width={width} height={bannerH} />
        {due && (
          <View style={{ position: "absolute", top: 12, right: 12, height: 28, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 14, paddingHorizontal: 10, backgroundColor: c.warning }}>
            <Icon name="Clock" size={16} tint={c.onWarning} />
            <Text variant="label" style={[bold, { color: c.onWarning }]}>
              {t("palace.due")}
            </Text>
          </View>
        )}
      </View>
      <View style={{ gap: 4, paddingHorizontal: 16, paddingTop: 12 }}>
        <Text variant="heading" heading>
          {name}
        </Text>
        {meta && (
          <Text variant="label" tone="muted">
            {meta}
          </Text>
        )}
      </View>
    </>
  );
  return (
    <View testID={testID} onLayout={onLayout} style={[{ overflow: "hidden", borderRadius: theme.radius.cardLarge, backgroundColor: c.surface }, theme.shadow.card, style]}>
      {onPress ? (
        <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID ? `${testID}-open` : undefined}>
          {head}
        </PressableScale>
      ) : (
        <View accessible accessibilityLabel={label}>
          {head}
        </View>
      )}
      {onWalk || onQuiz ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}>
          {onWalk && <Button label={t("palace.walk")} variant="secondary" size="sm" onPress={onWalk} testID={testID ? `${testID}-walk` : undefined} />}
          {onQuiz && <Button label={t("palace.quiz")} variant="primary" size="sm" onPress={onQuiz} testID={testID ? `${testID}-quiz` : undefined} />}
        </View>
      ) : (
        <View style={{ height: 16 }} />
      )}
    </View>
  );
}
