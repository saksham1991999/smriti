/**
 * Shared pieces of the little learner activity players (LRN-11 story, LRN-17 song, LRN-18 play):
 * the props every player takes, the shell (close button, subject tint), the pet line and the
 * clocked reducer hook. The rules live in @smriti/lesson-core; these components only render.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActivityBundle, TypedBundle } from "@smriti/content-schema";
import type { ActivityCompletion, AudioPort } from "@smriti/lesson-core";
import { IconButton, PetLine, Text, cx, iconMap, subjectAttr, type IconName } from "@smriti/ui-web";
import { PlayerProvider, contentUrl, type PlayerContextValue, type Translate } from "./context";

export interface ActivityPlayerProps {
  /** The published activity bundle (mode story, song or play) for this topic and locale. */
  bundle: ActivityBundle;
  /** The item in `bundle.activities` to play (`sb.…`, `sg.…` or `pl.…`). */
  activityId: string;
  /** The bundle hash from the manifest (sent back in the completion). */
  bundleVersion: string;
  t: Translate;
  /** Base URL that bundle-relative media urls (`assets/<sha>.webp`) resolve against. */
  contentBaseUrl: string;
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
}

/** A media ref's playable url, or null while it is not ready (never a stand-in). */
export function mediaUrl(bundle: ActivityBundle, ref: string | null | undefined, base: string): string | null {
  if (!ref) return null;
  const m = bundle.media[ref];
  return m && m.status === "ready" && m.url ? contentUrl(base, m.url) : null;
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
  if (pet) return <PetLine pet={{ species: pet.species, mood: "happy" }} petName={pet.name} text={text} testID={testID} />;
  return (
    <p aria-live="polite" data-testid={testID} className="m-0 rounded-[18px] bg-surface px-3.5 py-2.5 text-heading text-ink shadow-card">
      {text}
    </p>
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
  const { t, bundle, contentBaseUrl, online, subject, onExit } = props;
  const ctx = useMemo<PlayerContextValue>(
    () => ({ t, bundle: bundle as unknown as TypedBundle, contentBaseUrl, online: online ?? true }),
    [t, bundle, contentBaseUrl, online],
  );
  return (
    <PlayerProvider value={ctx}>
      <div className="flex min-h-dvh flex-col bg-bg" {...subjectAttr(subject)} data-testid={testID}>
        <div className="flex items-center gap-3 px-4 pt-3">
          <IconButton icon="X" label={t("ui:common.close")} onPress={() => onExit("close")} size={48} testID="activity-close" />
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{header}</div>
        </div>
        <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col gap-4 px-4 py-4">{children}</main>
        {footer && <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 px-4 pb-6">{footer}</div>}
      </div>
    </PlayerProvider>
  );
}

/** Round or page dots: never a number on screen for little learners, but a label for screen readers. */
export function Dots({ total, current, label }: { total: number; current: number; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex items-center gap-1.5" data-testid="activity-dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cx("block h-2.5 w-2.5 rounded-full", i < current ? "bg-primary" : i === current ? "bg-primary ring-4 ring-primary-tint" : "bg-track")} />
      ))}
    </div>
  );
}

export { Text };
