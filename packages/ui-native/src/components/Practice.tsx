import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { mockPalette } from "@smriti/tokens";
import {
  applyKeypadKey,
  formatScore,
  formatShortDuration,
  heatCell,
  keypadLayout,
  limitState,
  paletteShapePoints,
  paletteStateKey,
  timeResultKey,
  timerState,
  timeStripHeights,
  type HeatMapCellContract,
  type IconName,
  type KeypadKey,
  type LeaderboardRowContract,
  type LimitMeterContract,
  type MockPaletteCellContract,
  type NumericKeypadContract,
  type OmrBubbleRowContract,
  type ScoreRingContract,
  type SectionTabsContract,
  type TimerContract,
  type TimerPhase,
  type TimeStripContract,
} from "@smriti/tokens/ui";
import { useSubject, useTheme, useUI } from "../theme";
import { Icon } from "./Icon";
import { PetAvatar } from "./Illustration";
import { ProgressBar, ProgressRing } from "./Progress";
import { hitSlopFor, PressableScale } from "./Pressable";
import { Text, useWeight } from "./Text";

// ---------- Mock palette cell ----------

export interface MockPaletteCellProps extends MockPaletteCellContract {
  style?: StyleProp<ViewStyle>;
}

/** 40 x 40 in a 48 px target, exam-standard colours plus a shape per state (DESIGN.md §2.4). */
export function MockPaletteCell({ number, state, current, onPress, testID, style }: MockPaletteCellProps) {
  const theme = useTheme();
  const { t } = useUI();
  const p = mockPalette[state];
  const pts = paletteShapePoints(p.shape);
  const bold = useWeight(700, String(number));
  const label = `${t("palette.cell", { n: number, state: t(paletteStateKey[state]) })}${current ? `, ${t("palette.current")}` : ""}`;
  const round = p.shape === "circle" || p.shape === "circle-tick";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(current) }}
      onPress={onPress}
      style={[{ width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.xs, borderWidth: current ? 2 : 0, borderColor: theme.colors.ink }, style]}
    >
      <View
        style={{
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pts ? "transparent" : p.fill,
          borderRadius: round ? 20 : 4,
          borderWidth: state === "notVisited" ? 1.5 : state === "answeredMarked" ? 3 : 0,
          borderColor: p.border,
        }}
      >
        {pts && (
          <Svg width={40} height={40} viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: "absolute" }}>
            <Polygon points={pts.map(([x, y]) => `${x},${y}`).join(" ")} fill={p.fill} />
          </Svg>
        )}
        <Text variant="label" numeric importantForAccessibility="no" style={[{ color: p.text }, bold]}>
          {number}
        </Text>
      </View>
      {state === "answeredMarked" && (
        <View style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: mockPalette.answered.fill }}>
          <Icon name="Check" size={16} tint={mockPalette.answered.text} />
        </View>
      )}
    </Pressable>
  );
}

// ---------- Timer ----------

const phaseIcon: Record<TimerPhase, IconName> = { default: "Timer", warning: "Warning", final: "WarningOctagon", paused: "PauseCircle", done: "WarningOctagon" };

function useNow(now: () => number, running: boolean): number {
  const [tick, setTick] = useState(() => now());
  useEffect(() => {
    if (!running) return;
    setTick(now());
    const id = setInterval(() => setTick(now()), 1000);
    return () => clearInterval(id);
  }, [now, running]);
  return tick;
}

export interface TimerProps extends TimerContract {
  style?: StyleProp<ViewStyle>;
}

/** Count-down or count-up in `title` with tabular figures. Warning and final add an icon; count-up never warns. */
export function Timer({ mode, endsAt, startedAt, now = Date.now, warnAtMs, finalAtMs, paused, pausedMs, sectional, announce = "warnings", size = "header", caption, hideCaption, testID, style }: TimerProps) {
  const theme = useTheme();
  const { t } = useUI();
  const current = useNow(now, !paused);
  const s = timerState({ mode, endsAt, startedAt, now: current, warnAtMs, finalAtMs, paused, pausedMs });
  const color = s.phase === "warning" ? theme.colors.warningText : s.phase === "final" || s.phase === "done" ? theme.colors.errorText : theme.colors.ink;
  const lastPhase = useRef<TimerPhase>(s.phase);
  useEffect(() => {
    if (s.phase !== lastPhase.current) {
      lastPhase.current = s.phase;
      if (announce === "warnings" && (s.phase === "warning" || s.phase === "final")) {
        AccessibilityInfo.announceForAccessibility?.(`${t(s.phase === "warning" ? "timer.warning" : "timer.final")}: ${s.text}`);
      }
    }
  }, [s.phase, s.text, announce, t]);
  const capText = caption ?? (s.phase === "paused" ? t("timer.paused") : mode === "countdown" ? t("timer.left") : t("timer.taken"));
  const sect = sectional ? timerState({ mode: "countdown", endsAt: sectional.endsAt, now: current }) : null;
  const bold = useWeight(700);
  return (
    <View testID={testID} style={[{ alignItems: "center" }, style]}>
      <View accessible accessibilityRole="timer" accessibilityLabel={`${capText} ${s.text}`} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={phaseIcon[s.phase]} size={size === "header" ? 24 : 20} weight={s.phase === "paused" ? "fill" : "bold"} tint={color} />
        <Text variant={size === "header" ? "title" : "label"} heading={false} numeric style={[{ color }, size === "compact" ? bold : null]}>
          {s.text}
        </Text>
      </View>
      {!hideCaption && (
        <Text variant="caption" tone="muted">
          {capText}
        </Text>
      )}
      {sect && (
        <Text variant="caption" tone="muted" numeric>
          {sectional?.label} {sect.text}
        </Text>
      )}
    </View>
  );
}

// ---------- Section tabs ----------

export interface SectionTabsProps extends SectionTabsContract {
  style?: StyleProp<ViewStyle>;
}

/** 40 px scrollable tabs with an "{answered}/{total}" badge. Active: 3 px primary underline. Locked: Lock icon. */
export function SectionTabs({ sections, activeCode, onSelect, label, testID, style }: SectionTabsProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  return (
    <ScrollView testID={testID} horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel={label} style={[{ borderBottomWidth: 1, borderBottomColor: c.line, flexGrow: 0 }, style]} contentContainerStyle={{ gap: 4 }}>
      {sections.map((s) => {
        const on = s.code === activeCode;
        const blocked = s.state !== "open";
        const a11y = `${s.title}, ${t("sectionTabs.count", { answered: s.answered, total: s.total })}${s.state === "locked" ? `, ${t("sectionTabs.closed")}` : s.state === "not_open" ? `, ${t("sectionTabs.notOpen")}` : ""}`;
        return (
          <Pressable
            key={s.code}
            accessibilityRole="tab"
            accessibilityLabel={a11y}
            accessibilityState={{ selected: on, disabled: blocked }}
            disabled={blocked}
            onPress={() => onSelect(s.code)}
            hitSlop={{ top: 4, bottom: 4 }}
            style={{ height: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12 }}
          >
            {s.state === "locked" && <Icon name="Lock" size={16} color="inkDisabled" />}
            <Text variant="label" tone={blocked ? "disabled" : on ? "ink" : "muted"}>
              {s.title}
            </Text>
            <View style={{ borderRadius: 999, paddingHorizontal: 6, backgroundColor: c.surfaceSunken }}>
              <Text variant="caption" tone="muted" numeric>
                {s.answered}/{s.total}
              </Text>
            </View>
            {on && <View style={{ position: "absolute", left: 8, right: 8, bottom: 0, height: 3, borderRadius: 2, backgroundColor: c.primary }} />}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------- Numeric keypad ----------

const keyLabelKey = { "-": "keypad.minus", ".": "keypad.decimal", backspace: "keypad.backspace", clear: "keypad.clear" } as const;

export interface NumericKeypadProps extends NumericKeypadContract {
  style?: StyleProp<ViewStyle>;
}

/** 4 x 4 grid of 56 px keys on surfaceSunken under the answer field. The system keyboard is never opened. */
export function NumericKeypad({ value, onChange, allowDecimal = true, allowNegative = true, maxLength = 8, disabled, error, label, onKey, testID, style }: NumericKeypadProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  const opts = { allowDecimal, allowNegative, maxLength };
  const press = (k: KeypadKey) => {
    if (disabled) return;
    onKey?.(k);
    onChange(applyKeypadKey(value, k, opts));
  };
  const fieldLabel = label ?? t("keypad.answer");
  return (
    <View testID={testID} style={[{ gap: 12 }, style]}>
      <View style={{ gap: 4 }}>
        <View
          accessible
          accessibilityLabel={fieldLabel}
          accessibilityValue={{ text: value || "" }}
          accessibilityLiveRegion="polite"
          style={{ height: 56, justifyContent: "center", borderRadius: theme.radius.md, backgroundColor: c.surface, paddingHorizontal: 16, borderWidth: 1.5, borderColor: error ? c.error : c.line }}
        >
          <Text variant="heading" numeric tone={value ? "ink" : "muted"}>
            {value || fieldLabel}
          </Text>
        </View>
        {error && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name="WarningOctagon" size={16} color="errorText" />
            <Text variant="caption" tone="error">
              {error}
            </Text>
          </View>
        )}
      </View>
      <View style={{ gap: 8, borderRadius: theme.radius.card, backgroundColor: c.surfaceSunken, padding: 8 }}>
        {keypadLayout.map((row, r) => (
          <View key={r} style={{ flexDirection: "row", gap: 8 }}>
            {row.map((k, i) =>
              k === null || (k === "." && !allowDecimal) || (k === "-" && !allowNegative) ? (
                <View key={`e${i}`} style={{ flex: 1 }} />
              ) : (
                <PressableScale
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={k in keyLabelKey ? t(keyLabelKey[k as keyof typeof keyLabelKey]) : k}
                  disabled={disabled}
                  onPress={() => press(k)}
                  style={[{ flex: 1, height: 56, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", backgroundColor: c.surface }, theme.shadow.card]}
                >
                  {k === "backspace" ? (
                    <Icon name="Backspace" color={disabled ? "inkDisabled" : "ink"} />
                  ) : (
                    <Text variant={k === "clear" ? "label" : "title"} numeric tone={disabled ? "disabled" : "ink"}>
                      {k === "clear" ? "C" : k === "-" ? "−" : k}
                    </Text>
                  )}
                </PressableScale>
              ),
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------- OMR bubble row ----------

export interface OmrBubbleRowProps extends OmrBubbleRowContract {
  style?: StyleProp<ViewStyle>;
}

/** Question number and 32 px option bubbles in 48 px hit areas, with an optional flag. */
export function OmrBubbleRow({ questionNo, options, selected = null, flagged, onSelect, onClear, readOnly, testID, style }: OmrBubbleRowProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  const bold = useWeight(700);
  return (
    <View testID={testID} style={[{ flexDirection: "row", alignItems: "center", gap: 4 }, style]}>
      <Text variant="label" numeric style={[{ width: 40 }, bold]}>
        {questionNo}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={String(questionNo)} style={{ flexDirection: "row" }}>
        {options.map((o, i) => {
          const on = selected === i;
          return (
            <Pressable
              key={o}
              accessibilityRole="radio"
              accessibilityLabel={t("omr.option", { n: questionNo, x: o, state: t(on ? "omr.filled" : "omr.empty") })}
              accessibilityState={{ checked: on, disabled: Boolean(readOnly) }}
              disabled={readOnly}
              onPress={() => onSelect?.(i)}
              style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: on ? c.ink : c.surface, borderWidth: on ? 0 : 1.5, borderColor: c.line }}>
                <Text variant="label" style={[{ color: on ? c.surface : c.ink }, bold]}>
                  {o}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {flagged && <Icon name="Flag" size={20} weight="fill" color="warningText" label={t("omr.flagged")} />}
      {onClear && selected !== null && !readOnly && (
        <Pressable accessibilityRole="button" onPress={onClear} hitSlop={hitSlopFor(40, 24)} style={{ marginLeft: "auto", paddingHorizontal: 8 }}>
          <Text variant="label" tone="primary">
            {t("omr.clear")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------- Score ring ----------

export interface ScoreRingProps extends ScoreRingContract {
  style?: StyleProp<ViewStyle>;
}

/** The progress ring at stroke 12 with the score in `display`. Negative scores show "−n" with an empty ring. */
export function ScoreRing({ score, max, label, size = "lg", loading, testID, style }: ScoreRingProps) {
  const theme = useTheme();
  const { t } = useUI();
  const px = size === "lg" ? 152 : 112;
  const value = loading || max <= 0 ? 0 : Math.max(0, score) / max;
  const words = t("score.a11y", { score: formatScore(score), max });
  return (
    <ProgressRing testID={testID} value={value} size={px} stroke={12} tone="primary" label={label ?? words} valueText={loading ? t("common.loading") : words} style={style}>
      {loading ? (
        <View style={{ width: 64, height: 36, borderRadius: theme.radius.xs, backgroundColor: theme.colors.surfaceSunken }} />
      ) : (
        <View style={{ alignItems: "center" }}>
          <Text variant={size === "lg" ? "display" : "title"} numeric heading={false}>
            {formatScore(score)}
          </Text>
          <Text variant="caption" tone="muted" numeric>
            {t("score.of", { max })}
          </Text>
        </View>
      )}
    </ProgressRing>
  );
}

// ---------- Heat map cell ----------

export interface HeatMapCellProps extends HeatMapCellContract {
  style?: StyleProp<ViewStyle>;
}

/** 44 x 44 with the percentage printed inside; too few answers are hatched. Never colour alone. */
export function HeatMapCell({ value, count, minCount, label, selected, disabled, onPress, testID, style }: HeatMapCellProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = heatCell(value, count, minCount);
  const step = c.kind === "filled" ? theme.heat[c.step] : undefined;
  const a11y = c.kind === "tooFew" ? `${label}: ${t("heat.notEnough")}` : t("heat.a11y", { label, percent: c.percent });
  const box: ViewStyle = {
    width: 44,
    height: 44,
    borderRadius: theme.radius.xs,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: step?.fill ?? theme.colors.surfaceSunken,
    borderWidth: selected ? 2 : 0,
    borderColor: theme.colors.ink,
    opacity: disabled ? 0.6 : 1,
  };
  const content = (
    <>
      {c.kind === "tooFew" && (
        <View pointerEvents="none" style={{ position: "absolute", top: -22, left: -22, width: 88, height: 88, transform: [{ rotate: "45deg" }] }}>
          {Array.from({ length: 13 }, (_, i) => (
            <View key={i} style={{ position: "absolute", top: 0, bottom: 0, left: i * 7, width: 2, backgroundColor: theme.colors.line }} />
          ))}
        </View>
      )}
      <Text variant="caption" numeric importantForAccessibility="no" style={{ color: step?.text ?? theme.colors.inkMuted }}>
        {c.kind === "filled" ? `${c.percent}%` : "–"}
      </Text>
    </>
  );
  return onPress ? (
    <PressableScale testID={testID} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} hitSlop={hitSlopFor(44, 44)} style={[box, style]}>
      {content}
    </PressableScale>
  ) : (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={a11y} style={[box, style]}>
      {content}
    </View>
  );
}

// ---------- Time strip ----------

const resultIcon = { right: "Check", wrong: "X", skipped: "Minus", not_scored: "Minus" } as const;
const resultColor = { right: "successText", wrong: "errorText", skipped: "inkMuted", not_scored: "inkMuted" } as const;

export interface TimeStripProps extends TimeStripContract {
  style?: StyleProp<ViewStyle>;
  height?: number;
}

/** One bar per question (height = time), a result glyph under each, optional dashed target, and a table view. */
export function TimeStrip({ items, label, subject, selectedIndex, onSelect, showTarget = true, targetCaption, view: viewProp, onViewChange, height = 120, testID, style }: TimeStripProps) {
  const theme = useTheme();
  const { t, locale } = useUI();
  const s = useSubject(subject);
  const c = theme.colors;
  const [own, setOwn] = useState<"chart" | "table">("chart");
  const view = viewProp ?? own;
  const setView = (v: "chart" | "table") => (onViewChange ? onViewChange(v) : setOwn(v));
  const { heights, targets } = timeStripHeights(items, height);
  const hasTarget = showTarget && targets.some((x) => x !== null);
  const bold = useWeight(700);
  const cell = { flex: 1, paddingVertical: 8 } as const;
  return (
    <View testID={testID} accessibilityLabel={label} style={[{ gap: 12 }, style]}>
      <Pressable accessibilityRole="button" onPress={() => setView(view === "chart" ? "table" : "chart")} hitSlop={hitSlopFor(40, 24)} style={{ alignSelf: "flex-end" }}>
        <Text variant="label" tone="primary" style={bold}>
          {view === "chart" ? t("timeStrip.showTable") : t("timeStrip.showChart")}
        </Text>
      </Pressable>
      {view === "chart" ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, alignItems: "flex-end", paddingBottom: 4 }}>
            {items.map((it, i) => {
              const target = targets[i];
              const sel = selectedIndex === i;
              return (
                <Pressable
                  key={`${it.sectionCode ?? ""}${it.questionNo}`}
                  accessibilityRole="button"
                  accessibilityLabel={t("timeStrip.bar", { n: it.questionNo, time: formatShortDuration(it.timeMs, locale), result: t(timeResultKey[it.result]) })}
                  accessibilityState={{ selected: sel }}
                  onPress={() => onSelect?.(i)}
                  style={{ width: 24, alignItems: "center", gap: 4 }}
                >
                  <View style={{ height, width: "100%", alignItems: "center", justifyContent: "flex-end" }}>
                    <View style={{ width: 16, height: heights[i], borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: s.strong, borderWidth: sel ? 2 : 0, borderColor: c.ink }} />
                    {hasTarget && target !== null && target !== undefined && (
                      <View style={{ position: "absolute", left: 0, right: 0, bottom: target, borderTopWidth: 2, borderStyle: "dashed", borderColor: c.ink }} />
                    )}
                  </View>
                  <Icon name={resultIcon[it.result]} size={16} color={resultColor[it.result]} />
                  <Text variant="caption" tone="muted" numeric>
                    {it.questionNo}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 4 }}>
            {(["right", "wrong", "skipped"] as const).map((r) => (
              <View key={r} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Icon name={resultIcon[r]} size={16} color={resultColor[r]} />
                <Text variant="caption" tone="muted">
                  {t(timeResultKey[r])}
                </Text>
              </View>
            ))}
            {hasTarget ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 16, borderTopWidth: 2, borderStyle: "dashed", borderColor: c.ink }} />
                <Text variant="caption" tone="muted">
                  {t("timeStrip.targetLine")}
                </Text>
              </View>
            ) : (
              <Text variant="caption" tone="muted">
                {t("timeStrip.noTarget")}
              </Text>
            )}
          </View>
          {targetCaption && hasTarget && (
            <Text variant="caption" tone="muted">
              {targetCaption}
            </Text>
          )}
        </>
      ) : (
        <View>
          <View style={{ flexDirection: "row" }}>
            {[t("timeStrip.question"), t("timeStrip.time"), ...(hasTarget ? [t("timeStrip.target")] : []), t("timeStrip.result")].map((h) => (
              <Text key={h} variant="caption" tone="muted" style={cell}>
                {h}
              </Text>
            ))}
          </View>
          {items.map((it) => (
            <View key={`${it.sectionCode ?? ""}${it.questionNo}`} style={{ flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: c.line }}>
              <Text variant="label" numeric style={cell}>
                {it.questionNo}
              </Text>
              <Text variant="label" numeric style={cell}>
                {formatShortDuration(it.timeMs, locale)}
              </Text>
              {hasTarget && (
                <Text variant="label" numeric style={cell}>
                  {it.targetMs === undefined ? "–" : formatShortDuration(it.targetMs, locale)}
                </Text>
              )}
              <View style={[cell, { flexDirection: "row", alignItems: "center", gap: 4 }]}>
                <Icon name={resultIcon[it.result]} size={16} color={resultColor[it.result]} />
                <Text variant="label">{t(timeResultKey[it.result])}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------- Leaderboard row ----------

export interface LeaderboardRowProps extends LeaderboardRowContract {
  style?: StyleProp<ViewStyle>;
}

/** Rank, 32 px avatar, name, score. The name is already resolved by privacy rules; self row is primaryTint. */
export function LeaderboardRow({ rank, avatar, name, score, time, percentile, isSelf, pinned, rankPending, onPress, testID, style }: LeaderboardRowProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  const shownName = isSelf ? t("leaderboard.you") : name;
  const top3 = rank !== null && rank <= 3;
  const rankText = rank === null ? (rankPending ? t("leaderboard.rankSoon") : t("leaderboard.notRanked")) : String(rank);
  const a11y = t("leaderboard.a11y", { rank: rankText, name: shownName, score });
  const avatarSize = top3 ? 40 : 32;
  const bold = useWeight(700);
  const heavy = useWeight(800, score);
  const selfW = useWeight(800, shownName);
  const box: StyleProp<ViewStyle> = [
    { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: isSelf ? c.primaryTint : c.surface },
    pinned ? theme.shadow.raised : null,
    style,
  ];
  const content = (
    <>
      <Text variant={top3 ? "title" : rank === null ? "caption" : "label"} tone={rank === null ? "muted" : "ink"} numeric align="center" numberOfLines={1} style={[{ minWidth: 32 }, rank !== null && !top3 ? bold : null]}>
        {rankText}
      </Text>
      {avatar.kind === "pet" ? (
        <PetAvatar species={avatar.species} size={avatarSize} />
      ) : (
        <View style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSunken }}>
          <Text variant="label" tone="muted" style={bold}>
            {avatar.initials}
          </Text>
        </View>
      )}
      <Text variant="label" numberOfLines={1} style={[{ flex: 1 }, isSelf ? selfW : null]}>
        {shownName}
      </Text>
      {(time || percentile) && (
        <Text variant="caption" tone="muted" numeric>
          {[time, percentile].filter(Boolean).join(" · ")}
        </Text>
      )}
      <Text variant="label" numeric style={heavy}>
        {score}
      </Text>
    </>
  );
  return onPress ? (
    <PressableScale noScale testID={testID} accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={box} pressedStyle={{ backgroundColor: c.surfaceSunken }}>
      {content}
    </PressableScale>
  ) : (
    <View testID={testID} accessible accessibilityLabel={a11y} style={box}>
      {content}
    </View>
  );
}

// ---------- Limit meter ----------

export interface LimitMeterProps extends LimitMeterContract {
  style?: StyleProp<ViewStyle>;
}

/** Label, 8 px bar and "{used} of {limit}". Never pulses or shakes. Under-13s get "Ask a grown-up". */
export function LimitMeter({ label, used, limit, lastFewAt, proAction = "pro_link", onProPress, hidden, testID, style }: LimitMeterProps) {
  const { t } = useUI();
  const bold = useWeight(700);
  if (hidden) return null;
  const s = limitState(used, limit, lastFewAt);
  const ofText = t("limit.of", { used: s.used, limit: s.limit });
  return (
    <View testID={testID} style={[{ gap: 6 }, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text variant="label">{label}</Text>
        <Text variant="label" tone="muted" numeric>
          {ofText}
        </Text>
      </View>
      <ProgressBar value={s.fraction} tone="primary" label={label} valueText={ofText} />
      {(s.phase !== "in_range" || proAction !== "none") && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text variant="caption" tone="muted">
            {s.phase === "full" ? t("limit.full") : s.phase === "last_few" ? t("limit.left", { remaining: s.remaining }) : ""}
          </Text>
          {proAction !== "none" && onProPress && (
            <Pressable accessibilityRole="button" onPress={onProPress} hitSlop={hitSlopFor(40, 24)}>
              <Text variant="label" tone="primary" style={bold}>
                {proAction === "ask_grown_up" ? t("pro.askGrownUp") : t("limit.getPro")}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
