import { useEffect, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import {
  pluralCategory,
  type CardContract,
  type ContinueCardContract,
  type EmptyStateContract,
  type OptionCardContract,
  type StatTileContract,
  type StreakCardContract,
  type SubjectTileContract,
} from "@smriti/tokens/ui";
import { useSubject, useTheme, useUI } from "../theme";
import { Button } from "./Button";
import { Chip } from "./Chips";
import { Icon } from "./Icon";
import { Illustration, PetView, PlantView } from "./Illustration";
import { ProgressBar } from "./Progress";
import { PressableScale } from "./Pressable";
import { Text, useWeight } from "./Text";

export interface CardProps extends CardContract {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/** Card surface: radius 20 (24 for large hero cards), one soft shadow, none in dark mode. */
export function Card({ tone = "surface", subject, size = "md", outlined, onPress, accessibilityLabel, testID, style, children }: CardProps) {
  const theme = useTheme();
  const s = useSubject(subject);
  const bg = tone === "tint" ? s.tint : tone === "strong" ? s.strong : tone === "sunken" ? theme.colors.surfaceSunken : theme.colors.surface;
  const box: StyleProp<ViewStyle> = [
    { borderRadius: size === "lg" ? theme.radius.cardLarge : theme.radius.card, padding: size === "lg" ? 18 : 16, backgroundColor: bg },
    tone === "surface" && !outlined ? theme.shadow.card : null,
    outlined ? { borderWidth: 1.5, borderColor: theme.colors.line } : null,
    style,
  ];
  return onPress ? (
    <PressableScale testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={box}>
      {children}
    </PressableScale>
  ) : (
    <View testID={testID} accessibilityLabel={accessibilityLabel} style={box}>
      {children}
    </View>
  );
}

export interface SubjectTileProps extends SubjectTileContract {
  style?: StyleProp<ViewStyle>;
}

/** Tint background, radius 20, illustration top-right (may overlap), name, progress in strong, caption. */
export function SubjectTile({ subject, name, progress, caption, next, illustration, chip, offline, onPress, testID, style }: SubjectTileProps) {
  const theme = useTheme();
  const { t } = useUI();
  const s = useSubject(subject);
  const body = (
    <>
      {illustration && <Illustration name={illustration} subject={subject} decorative width={74} height={74} dimmed={offline} style={{ position: "absolute", top: -10, right: -6 }} />}
      {chip && <Chip label={chip.label} icon={chip.icon} tone={chip.tone ?? "neutral"} style={{ marginBottom: "auto" }} />}
      <Text variant="heading" style={{ paddingRight: 48 }}>
        {name}
      </Text>
      {next && (
        <Text variant="label" tone="muted">
          {next}
        </Text>
      )}
      {progress !== undefined && <ProgressBar value={progress} tone="subject" subject={subject} label={name} valueText={t("progress.percent", { percent: Math.round(progress * 100) })} />}
      {caption && (
        <Text variant="caption" tone="muted">
          {caption}
        </Text>
      )}
    </>
  );
  const box: ViewStyle = { minHeight: 128, borderRadius: theme.radius.card, backgroundColor: s.tint, padding: 14, gap: 6, justifyContent: "flex-end" };
  return onPress ? (
    <PressableScale testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={[name, next, caption].filter(Boolean).join(", ")} style={[box, style]}>
      {body}
    </PressableScale>
  ) : (
    <View testID={testID} style={[box, style]}>
      {body}
    </View>
  );
}

export interface ContinueCardProps extends ContinueCardContract {
  style?: StyleProp<ViewStyle>;
}

/** Subject strong fill, onStrong text, big illustration overlapping the right edge, progress, [Resume]. One per screen. */
export function ContinueCard({ subject, eyebrow, eyebrowIcon, title, meta, progress, progressLabel, illustration, actionLabel, onPress, testID, style }: ContinueCardProps) {
  const theme = useTheme();
  const { t } = useUI();
  const s = useSubject(subject);
  const action = actionLabel ?? t("continue.resume");
  const bold = useWeight(700, action);
  return (
    <View
      testID={testID}
      accessibilityLabel={eyebrow ? `${eyebrow}: ${title}` : title}
      style={[{ borderRadius: theme.radius.cardLarge, backgroundColor: s.strong, padding: 18, gap: 10 }, style]}
    >
      {illustration && <Illustration name={illustration} subject={subject} decorative width={118} height={118} style={{ position: "absolute", top: -18, right: -10 }} />}
      {eyebrow && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {eyebrowIcon && <Icon name={eyebrowIcon} size={16} color="subjectOnStrong" subject={subject} />}
          <Text variant="label" tone="onStrong" subject={subject}>
            {eyebrow}
          </Text>
        </View>
      )}
      <Text variant="title" tone="onStrong" subject={subject} heading style={{ maxWidth: "70%" }}>
        {title}
      </Text>
      {meta && (
        <Text variant="label" tone="onStrong" subject={subject}>
          {meta}
        </Text>
      )}
      {progress !== undefined && <ProgressBar value={progress} tone="onStrong" subject={subject} label={title} style={{ maxWidth: "90%" }} />}
      <View style={{ marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <PressableScale
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${action}: ${title}`}
          style={{ height: 48, borderRadius: theme.radius.md, backgroundColor: s.onStrong, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <Text variant="body" style={[{ color: s.strong }, bold]}>
            {action}
          </Text>
          <Icon name="ArrowRight" size={20} tint={s.strong} />
        </PressableScale>
        {progressLabel && (
          <Text variant="label" tone="onStrong" subject={subject}>
            {progressLabel}
          </Text>
        )}
      </View>
    </View>
  );
}

export interface StreakCardProps extends StreakCardContract {
  style?: StyleProp<ViewStyle>;
}

/** streakTint (warningTint at risk), plant on the right, one line of state copy, daily goal and freeze slots. */
export function StreakCard({ message, goal, freezes, atRisk, plant, onPress, testID, style }: StreakCardProps) {
  const theme = useTheme();
  const { t, locale } = useUI();
  const c = theme.colors;
  const freezeLabel =
    freezes?.label ??
    (freezes
      ? freezes.ready === 0
        ? t("streak.freezesReady.zero")
        : t(pluralCategory(freezes.ready, locale) === "one" ? "streak.freezesReady.one" : "streak.freezesReady.other", { n: freezes.ready })
      : "");
  const goalText = goal ? (goal.label ?? t("streak.goal", { done: goal.done, target: goal.target })) : "";
  const body = (
    <>
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
          {atRisk && <Icon name="Warning" size={20} color="warningText" label={t("streak.atRisk")} />}
          <Text variant="heading" style={{ flexShrink: 1 }}>
            {message}
          </Text>
        </View>
        {goal && (
          <>
            <ProgressBar value={goal.target ? goal.done / goal.target : 0} tone="primary" label={goalText} />
            <Text variant="caption" tone="muted" numeric importantForAccessibility="no">
              {goalText}
            </Text>
          </>
        )}
        {freezes && (
          <View accessible accessibilityLabel={freezeLabel} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {Array.from({ length: freezes.slots }, (_, i) =>
                i < freezes.ready ? (
                  <View key={i} style={[{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }, theme.shadow.card]}>
                    <Icon name="Snowflake" size={16} color="primary" />
                  </View>
                ) : (
                  <View key={i} style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderStyle: "dashed", borderColor: c.inkMuted, opacity: 0.6 }} />
                ),
              )}
            </View>
            <Text variant="caption" tone="muted">
              {freezeLabel}
            </Text>
          </View>
        )}
      </View>
      <PlantView stage={plant.stage} health={plant.health} alt={plant.alt} decorative={!plant.alt} size={86} style={{ marginVertical: -14, marginRight: -4 }} />
    </>
  );
  const box: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: theme.radius.cardLarge, padding: 16, backgroundColor: atRisk ? c.warningTint : c.streakTint };
  return onPress ? (
    <PressableScale testID={testID} onPress={onPress} accessibilityRole="button" style={[box, style]}>
      {body}
    </PressableScale>
  ) : (
    <View testID={testID} style={[box, style]}>
      {body}
    </View>
  );
}

export interface OptionCardProps extends OptionCardContract {
  style?: StyleProp<ViewStyle>;
}

/** Question option or choice card. Selected: 2 px primary border; correct/wrong add tint and an icon, never colour alone. */
export function OptionCard({ label, keyLabel, state = "idle", kind = "question", multiple, description, illustration, disabled, onPress, testID, style }: OptionCardProps) {
  const theme = useTheme();
  const { t, reducedMotion } = useUI();
  const c = theme.colors;
  const selected = state === "selected";
  const stateText = state === "correct" ? t("option.correct") : state === "wrong" ? t("option.wrong") : undefined;
  const shake = useSharedValue(0);
  useEffect(() => {
    if (state === "wrong" && !reducedMotion) {
      shake.value = withSequence(withTiming(-6, { duration: 50 }), withTiming(6, { duration: 75 }), withTiming(-4, { duration: 75 }), withTiming(0, { duration: 100 }));
    }
  }, [state, reducedMotion, shake]);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const look =
    state === "correct"
      ? { bg: c.successTint, border: c.success, bw: 2, keyBg: c.success, keyFg: c.onSuccess }
      : state === "wrong"
        ? { bg: c.errorTint, border: c.error, bw: 2, keyBg: c.error, keyFg: c.onError }
        : selected
          ? { bg: kind === "choice" ? c.primaryTint : c.surface, border: c.primary, bw: 2, keyBg: c.primary, keyFg: c.onPrimary }
          : { bg: c.surface, border: c.line, bw: 1.5, keyBg: c.surfaceSunken, keyFg: c.inkMuted };
  const keyW = useWeight(800, keyLabel ?? "");
  const labelW = useWeight(600, label);
  return (
    <Animated.View style={shakeStyle}>
      <PressableScale
        testID={testID}
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        accessibilityRole={multiple ? "checkbox" : "radio"}
        accessibilityLabel={[keyLabel, label, description, stateText].filter(Boolean).join(", ")}
        accessibilityState={{ checked: state !== "idle", disabled: Boolean(disabled) }}
        style={[
          {
            minHeight: 56,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            borderRadius: kind === "choice" ? theme.radius.card : theme.radius.md,
            paddingHorizontal: kind === "choice" ? 14 : 16,
            paddingVertical: 14,
            backgroundColor: look.bg,
            borderWidth: look.bw,
            borderColor: look.border,
            opacity: disabled && state === "idle" ? 0.6 : 1,
          },
          style,
        ]}
      >
        {kind === "question" && keyLabel && (
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: look.keyBg, alignItems: "center", justifyContent: "center" }}>
            <Text variant="label" style={[{ color: look.keyFg }, keyW]}>
              {keyLabel}
            </Text>
          </View>
        )}
        {illustration && <Illustration name={illustration} decorative width={56} height={56} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body" style={labelW}>
            {label}
          </Text>
          {description && (
            <Text variant="label" tone="muted">
              {description}
            </Text>
          )}
        </View>
        {state === "correct" && <Icon name="CheckCircle" weight="fill" color="successText" />}
        {state === "wrong" && <Icon name="XCircle" weight="fill" color="errorText" />}
        {kind === "choice" && selected && (
          <View style={{ position: "absolute", top: -8, right: -8, borderRadius: 12, backgroundColor: c.surface }}>
            <Icon name="CheckCircle" weight="fill" color="primary" />
          </View>
        )}
      </PressableScale>
    </Animated.View>
  );
}

export interface StatTileProps extends StatTileContract {
  style?: StyleProp<ViewStyle>;
}

/** Number in `title` with tabular figures, label in `caption`, optional tint. */
export function StatTile({ value, label, tint, subject, icon, testID, style }: StatTileProps) {
  const theme = useTheme();
  const s = useSubject(subject);
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${value} ${label}`}
      style={[{ gap: 2, borderRadius: theme.radius.md, padding: 12, backgroundColor: tint ? s.tint : theme.colors.surface }, tint ? null : theme.shadow.card, style]}
    >
      {icon && <Icon name={icon} size={20} color="subjectText" subject={subject} />}
      <Text variant="title" numeric heading={false}>
        {value}
      </Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

export interface EmptyStateProps extends EmptyStateContract {
  style?: StyleProp<ViewStyle>;
}

/** Illustration (pet or plant), one line of copy, one action (DESIGN.md §5). */
export function EmptyState({ illustration, pet, plant, alt, text, action, testID, style }: EmptyStateProps) {
  return (
    <View testID={testID} style={[{ alignItems: "center", gap: 16, paddingHorizontal: 24, paddingVertical: 32 }, style]}>
      {pet ? (
        <PetView species={pet.species} mood={pet.mood ?? "curious"} size={160} alt={alt} decorative={!alt} />
      ) : plant ? (
        <PlantView stage={plant.stage} health={plant.health} size={160} alt={alt} decorative={!alt} />
      ) : illustration ? (
        <Illustration name={illustration} alt={alt} decorative={!alt} width={200} height={150} />
      ) : null}
      <Text variant="body" align="center" style={{ maxWidth: 320 }}>
        {text}
      </Text>
      {action && <Button label={action.label} onPress={action.onPress} variant="secondary" size="sm" />}
    </View>
  );
}
