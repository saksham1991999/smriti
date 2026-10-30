import { useEffect, useRef } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import type {
  CheerButtonContract,
  DuelAnswer,
  DuelScoreBarContract,
  DuelSide,
  FriendRowContract,
  LeagueTierBadgeContract,
  SquadCardContract,
} from "@smriti/tokens/ui";
import { useTheme, useUI } from "../theme";
import { Icon } from "./Icon";
import { Illustration, PetAvatar } from "./Illustration";
import { ProgressBar } from "./Progress";
import { hitSlopFor, PressableScale } from "./Pressable";
import { Text, useWeight } from "./Text";

// ---------- FriendRow ----------

export interface FriendRowProps extends FriendRowContract {
  style?: StyleProp<ViewStyle>;
}

/**
 * One friend in a list (SOC-01 friends, SOC-15 pick a friend): pet avatar 40, name, today's status as an
 * icon and a word, the streak with the Plant icon. Selectable rows are radios. Status is never colour alone.
 */
export function FriendRow({ name, avatar, studiedToday, streakDays, studyingNow, selectable, selected, disabled, note, onPress, testID, style }: FriendRowProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  const bold = useWeight(700, name);
  const numBold = useWeight(700);
  const statusText = studyingNow ? t("friend.studyingNow") : studiedToday === undefined ? undefined : studiedToday ? t("friend.studied") : t("friend.notYet");
  const streakText = streakDays !== undefined && streakDays > 0 ? t("streak.pill", { n: streakDays }) : undefined;
  const label = [name, statusText, streakText, note].filter(Boolean).join(", ");
  const body = (
    <>
      <PetAvatar species={avatar.species} mood={avatar.mood} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={bold}>
          {name}
        </Text>
        {(statusText || note) && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12 }}>
            {statusText && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {studyingNow ? (
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.success }} />
                ) : (
                  <Icon name={studiedToday ? "CheckCircle" : "Circle"} size={16} weight={studiedToday ? "fill" : "bold"} color={studiedToday ? "successText" : "inkMuted"} />
                )}
                <Text variant="caption" tone={studyingNow || studiedToday ? "success" : "muted"}>
                  {statusText}
                </Text>
              </View>
            )}
            {note && (
              <Text variant="caption" tone="muted">
                {note}
              </Text>
            )}
          </View>
        )}
      </View>
      {streakText && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, backgroundColor: c.streakTint, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Icon name="Plant" size={16} weight="fill" color="streakText" />
          <Text variant="label" tone="streak" numeric style={numBold}>
            {streakDays}
          </Text>
        </View>
      )}
      {selectable && (
        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: selected ? c.primary : c.line, alignItems: "center", justifyContent: "center" }}>
          {selected && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.primary }} />}
        </View>
      )}
    </>
  );
  const box: StyleProp<ViewStyle> = [
    { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderRadius: theme.radius.card, paddingHorizontal: 12, paddingVertical: 8, opacity: disabled ? 0.6 : 1 },
    selected ? { backgroundColor: c.primaryTint } : null,
    style,
  ];
  if (!onPress && !selectable) {
    return (
      <View testID={testID} accessible accessibilityLabel={label} style={box}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      testID={testID}
      accessibilityRole={selectable ? "radio" : "button"}
      accessibilityLabel={label}
      accessibilityState={{ checked: selectable ? Boolean(selected) : undefined, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={box}
      pressedStyle={{ backgroundColor: c.surfaceSunken }}
    >
      {body}
    </PressableScale>
  );
}

// ---------- LeagueTierBadge ----------

const crestSize = { sm: 40, md: 56, lg: 96, xl: 120 } as const;

export interface LeagueTierBadgeProps extends LeagueTierBadgeContract {
  style?: StyleProp<ViewStyle>;
}

/**
 * A plant-tier league crest (SOC-08). The tier name and crest come from config, never hard-coded.
 * past: full colour; current: one step larger, primary ring, bold name; future: dimmed with an inkDisabled outline.
 */
export function LeagueTierBadge({ name, crest, state = "current", size = "md", showName = true, testID, style }: LeagueTierBadgeProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  const bold = useWeight(700, name);
  const base = crestSize[size];
  const px = state === "current" && (size === "sm" || size === "md") ? base + 16 : base;
  const img = Math.round(px * 0.86);
  const stateWord = state === "current" ? t("league.current") : state === "past" ? t("league.reached") : t("league.notReached");
  return (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={`${t("league.crest", { tier_name: name })}, ${stateWord}`} style={[{ alignItems: "center", gap: 4, maxWidth: Math.max(px, 96) }, style]}>
      <View
        style={[
          { width: px, height: px, borderRadius: px / 2, alignItems: "center", justifyContent: "center" },
          state === "current" ? { backgroundColor: c.primaryTint, borderWidth: 3, borderColor: c.primary } : null,
          state === "future" ? { borderWidth: 2, borderStyle: "dashed", borderColor: c.inkDisabled } : null,
        ]}
      >
        <View style={{ opacity: state === "future" ? 0.4 : 1 }}>
          <Illustration name={crest} decorative width={img} height={img} />
        </View>
      </View>
      {showName && (
        <Text variant="caption" tone={state === "future" ? "muted" : "ink"} align="center" numberOfLines={2} style={state === "current" ? bold : undefined}>
          {name}
        </Text>
      )}
    </View>
  );
}

// ---------- DuelScoreBar ----------

function DuelDot({ answer }: { answer: DuelAnswer }) {
  const c = useTheme().colors;
  const look =
    answer === "right"
      ? { backgroundColor: c.success }
      : answer === "wrong"
        ? { backgroundColor: c.error }
        : answer === "answered"
          ? { backgroundColor: c.inkMuted }
          : { borderWidth: 2, borderColor: c.line };
  return (
    <View style={[{ width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" }, look]}>
      {answer === "right" && <Icon name="Check" size={16} tint={c.onSuccess} />}
      {answer === "wrong" && <Icon name="X" size={16} tint={c.onError} />}
    </View>
  );
}

function DuelRow({ side, count }: { side: DuelSide; count: number }) {
  const { t } = useUI();
  const bold = useWeight(700, side.name);
  const scoreWeight = useWeight(700);
  const answered = side.answers.filter((a) => a !== "open").length;
  const dots = Array.from({ length: count }, (_, i) => side.answers[i] ?? "open");
  const label = `${t("duel.a11y", { name: side.name, score: side.score, answered, count })}${side.dropped ? `, ${t("duel.dropped")}` : ""}`;
  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", gap: 12, opacity: side.dropped ? 0.6 : 1 }}>
      <PetAvatar species={side.avatar.species} mood={side.avatar.mood} size={32} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text variant="label" numberOfLines={1} style={bold}>
          {side.name}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {dots.map((a, i) => (
            <DuelDot key={i} answer={a} />
          ))}
        </View>
        {side.dropped && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name="WifiSlash" size={16} color="inkMuted" />
            <Text variant="caption" tone="muted">
              {t("duel.dropped")}
            </Text>
          </View>
        )}
      </View>
      <Text variant="title" numeric heading={false} style={scoreWeight}>
        {side.score}
      </Text>
    </View>
  );
}

export interface DuelScoreBarProps extends DuelScoreBarContract {
  style?: StyleProp<ViewStyle>;
}

/** The live duel score strip (SOC-18): one row per player with a dot per question and a tabular score. Solo shows one row. */
export function DuelScoreBar({ count, you, opponent, testID, style }: DuelScoreBarProps) {
  const theme = useTheme();
  const { t } = useUI();
  return (
    <View testID={testID} style={[{ gap: 10, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, padding: 12 }, theme.shadow.card, style]}>
      <DuelRow side={you} count={count} />
      {opponent ? (
        <>
          <View style={{ height: 1, backgroundColor: theme.colors.line }} />
          <DuelRow side={opponent} count={count} />
        </>
      ) : (
        <Text variant="caption" tone="muted">
          {t("duel.solo")}
        </Text>
      )}
    </View>
  );
}

// ---------- SquadCard ----------

export interface SquadCardProps extends SquadCardContract {
  style?: StyleProp<ViewStyle>;
}

/** A squad row (SOC-01): crest 40, name, the shared quest as "{done} of {target}" with a streak bar, days left. */
export function SquadCard({ name, crest, done, target, daysLeft, onPress, testID, style }: SquadCardProps) {
  const theme = useTheme();
  const { t } = useUI();
  const bold = useWeight(700, name);
  const progress = t("squad.progress", { done, target });
  const box: StyleProp<ViewStyle> = [
    { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, padding: 16 },
    theme.shadow.card,
    style,
  ];
  const body = (
    <>
      <Illustration name={crest} decorative width={40} height={40} />
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <Text numberOfLines={1} style={[bold, { flexShrink: 1 }]}>
            {name}
          </Text>
          <Text variant="label" tone="muted" numeric>
            {progress}
          </Text>
        </View>
        <ProgressBar value={target > 0 ? Math.min(1, done / target) : 0} tone="streak" label={progress} />
        {daysLeft !== undefined && (
          <Text variant="caption" tone="muted">
            {t("squad.daysLeft", { n: daysLeft })}
          </Text>
        )}
      </View>
      {onPress && <Icon name="CaretRight" size={20} color="inkMuted" />}
    </>
  );
  const label = t("squad.a11y", { name, done, target }) + (daysLeft !== undefined ? `, ${t("squad.daysLeft", { n: daysLeft })}` : "");
  return onPress ? (
    <PressableScale testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={box}>
      {body}
    </PressableScale>
  ) : (
    <View testID={testID} accessible accessibilityLabel={label} style={box}>
      {body}
    </View>
  );
}

// ---------- CheerButton ----------

export interface CheerButtonProps extends CheerButtonContract {
  style?: StyleProp<ViewStyle>;
}

/**
 * reaction: 40 tall, icon + word + count; the icon pops once when sent and a second tap does nothing (SOC-01).
 * message: a 48-tall surfaceRaised preset chip with an icon (SOC-22 grid); shows "Sent!" once sent.
 */
export function CheerButton({ label, icon, kind = "reaction", count, sent, disabled, onPress, testID, style }: CheerButtonProps) {
  const theme = useTheme();
  const { t, reducedMotion } = useUI();
  const c = theme.colors;
  const bold = useWeight(700);
  const scale = useSharedValue(1);
  const prev = useRef(sent);
  useEffect(() => {
    if (sent && !prev.current && !reducedMotion) {
      scale.value = withSequence(withTiming(1.25, { duration: 140 }), withTiming(1, { duration: 180 }));
    }
    prev.current = sent;
  }, [sent, reducedMotion, scale]);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const inactive = Boolean(disabled || sent);

  if (kind === "message") {
    const bg = sent ? c.successTint : disabled ? c.surfaceSunken : c.surfaceRaised;
    const fg = sent ? c.successText : disabled ? c.inkMuted : c.ink;
    return (
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={sent ? `${label}, ${t("cheer.sent")}` : label}
        accessibilityState={{ disabled: inactive }}
        disabled={inactive}
        onPress={onPress}
        style={[{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: bg }, !sent && !disabled ? theme.shadow.card : null, style]}
      >
        <Animated.View style={pop}>
          <Icon name={sent ? "Check" : icon} size={20} tint={fg} />
        </Animated.View>
        <Text variant="label" style={{ flex: 1, color: fg }}>
          {label}
        </Text>
        {sent && (
          <Text variant="caption" style={[bold, { color: fg }]}>
            {t("cheer.sent")}
          </Text>
        )}
      </PressableScale>
    );
  }
  const fg = sent ? c.primaryText : c.ink;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={count !== undefined ? t("cheer.count", { label, n: count }) : label}
      accessibilityState={{ selected: Boolean(sent), disabled: Boolean(disabled) }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={hitSlopFor(64, 40)}
      style={[
        { height: 40, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingHorizontal: 12, backgroundColor: sent ? c.primaryTint : c.surfaceRaised, opacity: disabled ? 0.6 : 1 },
        sent ? null : { borderWidth: 1, borderColor: c.line },
        style,
      ]}
    >
      <Animated.View style={pop}>
        <Icon name={icon} size={20} weight={sent ? "fill" : "bold"} tint={fg} />
      </Animated.View>
      <Text variant="label" style={{ color: fg }}>
        {label}
      </Text>
      {count !== undefined && (
        <Text variant="label" numeric style={[bold, { color: fg }]}>
          {count}
        </Text>
      )}
    </PressableScale>
  );
}
