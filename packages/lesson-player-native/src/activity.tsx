/**
 * Shared pieces of the little learner activity players on iOS and Android (LRN-11 story, LRN-17
 * song, LRN-18 play): the props every player takes, the shell (close button, subject tint), the
 * pet line and the clocked reducer hook. The rules live in @smriti/lesson-core; these components
 * only render. Names and props follow @smriti/lesson-player-web.
 */
import type { ActivityBundle, TypedBundle } from "@smriti/content-schema";
import type { ActivityCompletion, AudioPort } from "@smriti/lesson-core";
import type { IconName } from "@smriti/tokens/ui";
import { IconButton, PetLine, Text, iconMap, useSubject, useTheme } from "@smriti/ui-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View, type ImageSourcePropType } from "react-native";

import { PlayerProvider, type PlayerContextValue, type Translate } from "./context";

export interface ActivityPlayerProps {
  /** The published activity bundle (mode story, song or play) for this topic and locale. */
  bundle: ActivityBundle;
  /** The item in `bundle.activities` to play (`sb.…`, `sg.…` or `pl.…`). */
  activityId: string;
  /** The bundle hash from the manifest (sent back in the completion). */
  bundleVersion: string;
  t: Translate;
  /** Resolves a bundle-relative picture url (`assets/<sha>.webp`): seed pack, download or CDN. */
  resolveMedia: (url: string) => ImageSourcePropType | undefined;
  /** Resolves a bundle-relative audio url to what the audio port plays (a file or CDN uri). */
  resolveAudio?: (url: string) => string | undefined;
  /** Plays songs, narration and spoken prompts; without one the players stay silent. */
  audio?: AudioPort;
  online?: boolean;
  /** The pet who says the lines; without one the lines show as plain text. */
  pet?: { species: "cat" | "dog"; name: string };
  /** Subject id or family for the tint. */
  subject?: string;
  clock?: () => number;
  /** Called once, when the activity is finished. Mark the node done and record the event. */
  onComplete: (c: ActivityCompletion) => void;
  /** Close (any time) or Done (after the end). */
  onExit: (reason: "close" | "done") => void;
  testID?: string;
}

/** A media ref's playable audio source, or null while it is not ready (never a stand-in). */
export function audioSource(props: Pick<ActivityPlayerProps, "bundle" | "resolveAudio">, ref: string | null | undefined): string | null {
  if (!ref) return null;
  const m = props.bundle.media[ref];
  if (!m || m.status !== "ready" || !m.url) return null;
  return (props.resolveAudio ? props.resolveAudio(m.url) : m.url) ?? null;
}

/** A Phosphor icon the app ships, or a neutral sparkle for a name it does not. */
export function appIcon(name: string | undefined): IconName {
  return name && Object.prototype.hasOwnProperty.call(iconMap, name) ? (name as IconName) : "Sparkle";
}

/** A reducer that stamps every action with the clock. */
export function useClocked<S, A>(reduce: (s: S, a: A & { now: number }) => S, init: () => S, clock: () => number = Date.now) {
  const [state, setState] = useState(init);
  const ref = useRef(state);
  ref.current = state;
  const dispatch = useCallback(
    (a: A) => {
      const next = reduce(ref.current, { ...a, now: clock() } as A & { now: number });
      ref.current = next;
      setState(next);
      return next;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return [state, dispatch] as const;
}

/** Calls `onComplete` once, the first time a completion appears. */
export function useCompletion(completion: ActivityCompletion | null, onComplete: (c: ActivityCompletion) => void): void {
  const sent = useRef(false);
  useEffect(() => {
    if (completion && !sent.current) {
      sent.current = true;
      onComplete(completion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completion]);
}

/** The pet's line (or a plain caption without a pet), announced politely. */
export function PetSays({ pet, text, testID }: { pet?: ActivityPlayerProps["pet"]; text: string; testID?: string }) {
  const theme = useTheme();
  if (pet) return <PetLine pet={{ species: pet.species, mood: "happy" }} petName={pet.name} text={text} testID={testID} />;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLiveRegion="polite"
      style={[styles.caption, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card }, theme.shadow.card]}
    >
      <Text variant="heading">{text}</Text>
    </View>
  );
}

/** The full-screen frame: close button, optional header content, the subject tint and the player context. */
export function ActivityShell({
  props,
  testID,
  header,
  children,
  footer,
}: {
  props: ActivityPlayerProps;
  testID: string;
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t, bundle, resolveMedia, online, subject, onExit } = props;
  const theme = useTheme();
  const ctx = useMemo<PlayerContextValue>(
    () => ({ t, bundle: bundle as unknown as TypedBundle, resolveMedia, online: online ?? true, subject }),
    [t, bundle, resolveMedia, online, subject],
  );
  return (
    <PlayerProvider value={ctx}>
      <View style={[styles.root, { backgroundColor: theme.colors.bg }]} testID={props.testID ?? testID}>
        <View style={[styles.top, { paddingHorizontal: theme.space[4], paddingTop: theme.space[3] }]}>
          <IconButton icon="X" label={t("ui:common.close")} onPress={() => onExit("close")} size={48} testID="activity-close" />
          <View style={styles.header}>{header}</View>
        </View>
        <ScrollView style={styles.grow} contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[6], gap: theme.space[3] }}>{footer}</View> : null}
      </View>
    </PlayerProvider>
  );
}

/** Round or page dots: never a number on screen for little learners, but a label for screen readers. */
export function Dots({ total, current, label }: { total: number; current: number; label: string }) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={styles.dots} testID="activity-dots">
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: i <= current ? c.primary : c.track },
            i === current ? { borderWidth: 3, borderColor: c.primaryTint } : null,
          ]}
        />
      ))}
    </View>
  );
}

/** The subject tint and text colours for highlights. */
export function useTint(subject?: string) {
  return useSubject(subject);
}

/** Buttons in a row that share the width. */
export function Row({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.row, { gap: theme.space[3] }]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grow: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  header: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  caption: { paddingHorizontal: 14, paddingVertical: 10 },
  dots: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  row: { flexDirection: "row", alignItems: "center" },
});
