import { useEffect, useRef, type ReactNode } from "react";
import { AccessibilityInfo, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { hasDevanagari, type ChatBubbleContract, type ChatInputContract } from "@smriti/tokens/ui";
import { useTheme, useUI } from "../theme";
import { Icon } from "./Icon";
import { PetAvatar } from "./Illustration";
import { PressableScale } from "./Pressable";
import { Text, useWeight } from "./Text";

function Dot({ index }: { index: number }) {
  const theme = useTheme();
  const { reducedMotion } = useUI();
  const opacity = useSharedValue(reducedMotion ? 0.6 : 0.3);
  useEffect(() => {
    if (reducedMotion) return;
    opacity.value = withDelay(index * 160, withRepeat(withSequence(withTiming(1, { duration: 480 }), withTiming(0.3, { duration: 720 })), -1));
    return () => cancelAnimation(opacity);
  }, [reducedMotion, index, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.inkMuted }, animated]} />;
}

export interface ChatBubbleProps extends ChatBubbleContract {
  style?: StyleProp<ViewStyle>;
  /** Rich body (KaTeX, Formula box, generated image). Used instead of `text`. */
  children?: ReactNode;
  /** Citations slot, under the body (sources, PYQ citation chips). */
  citations?: ReactNode;
  /** Action row slot under a finished answer (thumbs, save as flashcard, read aloud). */
  actions?: ReactNode;
}

/**
 * One message in the tutor chat (AI-02). Student: right, primaryTint, 6 px corner bottom right.
 * Tutor: left, nearly full width, surfaceRaised, the pet avatar and an "AI" label above, the AI line under
 * a finished answer. System: a centred caption. A streamed answer is announced once, when it completes.
 */
export function ChatBubble({ role, text, authorName, avatar, streaming, stopped, showAiLabel, live = true, children, citations, actions, testID, style }: ChatBubbleProps) {
  const theme = useTheme();
  const { t } = useUI();
  const c = theme.colors;
  const bold = useWeight(700);
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming && live && text) {
      AccessibilityInfo.announceForAccessibility?.(t("chat.fromTutor", { name: authorName ?? "", text }));
    }
    wasStreaming.current = streaming;
  }, [streaming, live, text, authorName, t]);
  const hasBody = Boolean(text) || Boolean(children);
  const body = text ? <Text>{text}</Text> : children;

  if (role === "system") {
    return (
      <View testID={testID} style={[{ alignSelf: "center", paddingHorizontal: 16 }, style]}>
        <Text variant="caption" tone="muted" align="center">
          {text ?? children}
        </Text>
      </View>
    );
  }

  if (role === "student") {
    return (
      <View testID={testID} style={[{ flexDirection: "row", justifyContent: "flex-end" }, style]}>
        <View
          accessible={Boolean(text)}
          accessibilityLabel={text ? t("chat.fromStudent", { text }) : undefined}
          style={{ maxWidth: "85%", backgroundColor: c.primaryTint, borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 16, paddingVertical: 10 }}
        >
          {body}
        </View>
      </View>
    );
  }

  const aiLine = (showAiLabel ?? true) && !streaming && hasBody;
  return (
    <View testID={testID} style={[{ width: "100%", paddingRight: 16, gap: 6 }, style]}>
      {(avatar || authorName) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {avatar && <PetAvatar species={avatar.species} mood={avatar.mood} size={24} />}
          {authorName && (
            <Text variant="label" style={bold}>
              {authorName}
            </Text>
          )}
          <View accessible accessibilityLabel={t("chat.aiLabel")} style={{ borderRadius: 999, backgroundColor: c.surfaceSunken, paddingHorizontal: 8 }}>
            <Text variant="caption" tone="muted" style={bold}>
              {t("chat.ai")}
            </Text>
          </View>
        </View>
      )}
      <View
        accessibilityState={{ busy: Boolean(streaming) }}
        style={[{ backgroundColor: c.surfaceRaised, borderRadius: 20, borderTopLeftRadius: 6, paddingHorizontal: 16, paddingVertical: 12 }, theme.shadow.card]}
      >
        {streaming && !hasBody ? (
          <View accessible accessibilityLabel={t("chat.thinking", { name: authorName ?? "" })} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 4 }}>
              {[0, 1, 2].map((i) => (
                <Dot key={i} index={i} />
              ))}
            </View>
            <Text variant="label" tone="muted">
              {t("chat.thinking", { name: authorName ?? "" })}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>{body}</View>
        )}
        {stopped && (
          <Text variant="caption" tone="muted" style={{ marginTop: 6 }}>
            {t("chat.stopped")}
          </Text>
        )}
        {citations && (
          <View style={{ marginTop: 10, gap: 6, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 }}>
            <Text variant="caption" tone="muted">
              {t("chat.sources")}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{citations}</View>
          </View>
        )}
      </View>
      {aiLine && (
        <Text variant="caption" tone="muted">
          {t("chat.aiLabel")}
        </Text>
      )}
      {actions && !streaming && <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>{actions}</View>}
    </View>
  );
}

export interface ChatInputProps extends ChatInputContract {
  style?: StyleProp<ViewStyle>;
  /** Left slot: camera or attach button (48 px). */
  attach?: ReactNode;
  /** Right slot before Send: the mic button. */
  trailing?: ReactNode;
}

const PAD_Y = 12;

/** The pinned input row (AI-02): attach slot, a multiline field that grows with its text up to `maxLines` (then scrolls), Send (Stop while streaming). */
export function ChatInput({ value, onChange, onSend, label, placeholder, maxLength, maxLines = 5, disabled, streaming, onStop, attach, trailing, testID, style }: ChatInputProps) {
  const theme = useTheme();
  const { t, locale } = useUI();
  const c = theme.colors;
  const script = hasDevanagari(value || placeholder || "") || locale === "hi" ? "devanagari" : "latin";
  const type = theme.type[script].body;
  const lineHeight = type.lineHeight ?? 24;
  const maxHeight = lineHeight * maxLines + PAD_Y * 2;
  const remaining = maxLength === undefined ? null : maxLength - value.length;
  const showCounter = remaining !== null && maxLength !== undefined && remaining <= Math.ceil(maxLength * 0.2);
  const canSend = !disabled && value.trim().length > 0 && (remaining === null || remaining >= 0);
  return (
    <View testID={testID} style={[{ gap: 4, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface, paddingHorizontal: 12, paddingVertical: 8 }, style]}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        {attach}
        <TextInput
          testID={testID ? `${testID}-field` : undefined}
          multiline
          value={value}
          onChangeText={onChange}
          editable={!disabled}
          maxLength={maxLength}
          placeholder={placeholder}
          placeholderTextColor={c.inkMuted}
          accessibilityLabel={label}
          accessibilityHint={showCounter && remaining !== null ? t("chat.charsLeft", { n: Math.max(0, remaining) }) : undefined}
          accessibilityState={{ disabled: Boolean(disabled) }}
          textAlignVertical="top"
          style={[
            type,
            {
              flex: 1,
              minHeight: 48,
              maxHeight,
              borderRadius: theme.radius.md,
              backgroundColor: c.surfaceSunken,
              color: c.ink,
              paddingHorizontal: 16,
              paddingTop: PAD_Y,
              paddingBottom: PAD_Y,
              opacity: disabled ? 0.6 : 1,
            },
          ]}
        />
        {trailing}
        {streaming ? (
          <PressableScale
            testID={testID ? `${testID}-stop` : undefined}
            accessibilityRole="button"
            accessibilityLabel={t("chat.stop")}
            onPress={onStop}
            style={[{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceRaised }, theme.shadow.card]}
          >
            <Icon name="Stop" weight="fill" />
          </PressableScale>
        ) : (
          <PressableScale
            testID={testID ? `${testID}-send` : undefined}
            accessibilityRole="button"
            accessibilityLabel={t("chat.send")}
            disabled={!canSend}
            onPress={onSend}
            style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: canSend ? c.primary : c.surfaceSunken }}
          >
            <Icon name="PaperPlaneRight" weight="fill" tint={canSend ? c.onPrimary : c.inkDisabled} />
          </PressableScale>
        )}
      </View>
      {showCounter && remaining !== null && (
        <View accessibilityLiveRegion="polite" style={{ paddingHorizontal: 4 }}>
          <Text variant="caption" tone={remaining <= 0 ? "error" : "muted"} numeric align="end">
            {t("chat.charsLeft", { n: Math.max(0, remaining) })}
          </Text>
        </View>
      )}
    </View>
  );
}
