/**
 * G-2 voice tutor: AI-13 (connecting), AI-14 (live), AI-15 (ended) on `/tutor/voice`, with the
 * AI-12 mic dialog and the AI-07 teaser for free students. The API mints a short-lived Gemini
 * Live token (`POST /v1/voice/sessions`); asking again with the same client id reconnects. Tool
 * calls go through the API; the transcript is sent once at the end. Audio is never stored here.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearch } from "@tanstack/react-router";
import { unwrap } from "@smriti/api-client";
import { Banner, Button, Chip, Dialog, EmptyState, Icon, IconButton, Illustration, PetLine, Spinner, StatTile, Switch, Text, cx } from "@smriti/ui-web";
import { useServices } from "../../../boot/context";
import { useI18n } from "../../../lib/i18n";
import { useOnline } from "../../../lib/network";
import { useIsPro } from "../../../lib/pro";
import { toast } from "../../../lib/toast";
import { errorCode, problemField } from "../shared/errors";
import { MicDialog, useMicGate } from "../shared/mic";
import { useClose } from "../shared/nav";
import { Page } from "../shared/Page";
import { usePet, type PetInfo } from "../shared/pet";
import { ProTeaser } from "../shared/ProTeaser";
import { canReconnect, capCause, captionsReduce, endKind, endReasons, minutesLeft, resetTime, timer, transcriptTurns, visibleCaptions, type CaptionLine, type EndCause, type PetState, type VoiceQuota, type VoiceSessionOut } from "./logic";
import { FakeVoiceSession, GeminiLiveSession, type VoiceSession, type VoiceSessionHandlers } from "./session";

export interface VoiceSearch {
  context?: string;
  from?: string;
}

type Phase =
  | { kind: "checking" }
  | { kind: "unavailable"; reason: string | null }
  | { kind: "consent" }
  | { kind: "no_time"; resetsAt: string | null }
  | { kind: "offline" }
  | { kind: "permission" }
  | { kind: "connecting"; quota: VoiceQuota | null }
  | { kind: "connect_error"; quota: VoiceQuota | null }
  | { kind: "live" }
  | { kind: "ended"; cause: EndCause; seconds: number; flashcards: number; sessionId: string | null; resetsAt: string | null };

const CONNECT_TIMEOUT_MS = 10_000;

export function Voice() {
  const search = useSearch({ from: "/tutor/voice" });
  const s = useServices();
  const isPro = useIsPro();
  const online = useOnline();
  const close = useClose(search.from ?? "/learn");
  const pet = usePet();
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const gate = useMicGate((r) => s.analytics.track("voice_permission_result", { result: r === "granted" ? "granted" : "denied" }));
  const clientId = useRef(crypto.randomUUID());
  const stream = useRef<MediaStream | null>(null);
  const live = useRef<LiveHandle | null>(null);

  const quotaOf = useCallback(async (): Promise<VoiceQuota | null> => {
    try {
      return await unwrap(s.client.GET("/v1/voice/quota"), s.client);
    } catch (e) {
      const code = errorCode(e);
      if (code === "guardian_consent_required") setPhase({ kind: "consent" });
      else if (code === "voice_not_for_age") setPhase({ kind: "unavailable", reason: "not_for_age" });
      else setPhase({ kind: "connect_error", quota: null });
      return null;
    }
  }, [s]);

  const mint = useCallback(async (): Promise<VoiceSessionOut | null> => {
    try {
      return await unwrap(s.client.POST("/v1/voice/sessions", { body: { client_session_id: clientId.current, ...(search.context ? { context_ref: search.context } : {}) } }), s.client);
    } catch (e) {
      const code = errorCode(e);
      if (code === "voice_unavailable") setPhase({ kind: "unavailable", reason: (problemField(e, "reason") as string | undefined) ?? null });
      else if (code === "voice_daily_limit") setPhase({ kind: "no_time", resetsAt: (problemField(e, "resets_at") as string | undefined) ?? null });
      else if (code === "guardian_consent_required") setPhase({ kind: "consent" });
      else if (code === "voice_not_for_age") setPhase({ kind: "unavailable", reason: "not_for_age" });
      else return Promise.reject(e);
      return null;
    }
  }, [s, search.context]);

  /** Quota → mic → token → socket, with the 10 s connect timeout. */
  const start = useCallback(async () => {
    if (!navigator.onLine) {
      setPhase({ kind: "offline" });
      return;
    }
    setPhase({ kind: "checking" });
    const quota = await quotaOf();
    if (!quota) return;
    if (!quota.available) {
      setPhase({ kind: "unavailable", reason: quota.reason ?? null });
      return;
    }
    if (quota.remaining_seconds !== null && quota.remaining_seconds <= 0) {
      setPhase({ kind: "no_time", resetsAt: quota.resets_at });
      return;
    }
    if (!stream.current) {
      setPhase({ kind: "permission" });
      const st = await gate.request();
      if (!st) return;
      stream.current = st;
    }
    setPhase({ kind: "connecting", quota });
    const startedAt = Date.now();
    try {
      const session = await Promise.race([mint(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), CONNECT_TIMEOUT_MS))]);
      if (!session) return;
      live.current = { session, startedAt: Date.now(), connectMs: Date.now() - startedAt };
      setPhase({ kind: "live" });
    } catch {
      setPhase({ kind: "connect_error", quota });
    }
  }, [gate, mint, quotaOf]);

  useEffect(() => {
    if (isPro) void start();
    return () => {
      stream.current?.getTracks().forEach((tr) => tr.stop());
      stream.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro]);

  const switchToText = (reason: string) => {
    s.analytics.track("voice_fallback_to_text", { reason });
    close();
  };

  if (!isPro) return <ProTeaser tool="voice" onClose={close} />;

  if (phase.kind === "live" && live.current && stream.current) {
    return (
      <Live
        handle={live.current}
        stream={stream.current}
        pet={pet}
        reconnect={async () => {
          try {
            return await mint();
          } catch {
            return null;
          }
        }}
        onEnded={(cause, seconds, flashcards, sessionId) => {
          stream.current?.getTracks().forEach((tr) => tr.stop());
          stream.current = null;
          setPhase({ kind: "ended", cause, seconds, flashcards, sessionId, resetsAt: live.current?.session.quota.resets_at ?? null });
        }}
        onSwitchToText={() => switchToText("user")}
      />
    );
  }
  if (phase.kind === "ended") return <Ended {...phase} pet={pet} onBack={close} onContinueInText={() => switchToText(endKind(phase.cause))} />;

  return (
    <>
      <Connecting
        phase={phase}
        pet={pet}
        online={online}
        onCancel={close}
        onRetry={() => void start()}
        onSwitchToText={() => switchToText(phase.kind)}
      />
      <MicDialog
        state={gate.dialog}
        onAllow={() => void gate.allow()}
        onDismiss={() => {
          gate.dismiss();
          if (gate.dialog === "denied") switchToText("mic_denied");
          else close();
        }}
      />
    </>
  );
}

interface LiveHandle {
  session: VoiceSessionOut;
  startedAt: number;
  connectMs: number;
}

// ── AI-13 (and the states shown instead of it) ────────────────────────────

function Connecting({ phase, pet, online, onCancel, onRetry, onSwitchToText }: { phase: Phase; pet: PetInfo | null; online: boolean; onCancel: () => void; onRetry: () => void; onSwitchToText: () => void }) {
  const { t, locale } = useI18n();
  const species = pet?.species ?? "cat";
  const petName = pet?.name ?? t("tutor_social:AI-13.pet_fallback");
  const quota = phase.kind === "connecting" || phase.kind === "connect_error" ? phase.quota : null;
  const mins = minutesLeft(quota?.remaining_seconds);

  let body: ReactNode;
  if (phase.kind === "unavailable" || phase.kind === "consent") {
    body = (
      <>
        <Illustration name={`${species}-thinking`} alt={t("tutor_social:AI-13.pet_alt", { pet_name: petName })} width={200} height={200} />
        <Text variant="title" as="h1" align="center">
          {t("tutor_social:AI-13.unavailable_title")}
        </Text>
        <Text tone="muted" align="center">
          {phase.kind === "consent" ? t("tutor_social:AI-13.consent_needed") : t("tutor_social:AI-13.unavailable_body", { pet_name: petName })}
        </Text>
      </>
    );
  } else if (phase.kind === "no_time") {
    body = (
      <>
        <Illustration name={`${species}-sleepy`} alt={t("tutor_social:AI-13.pet_alt", { pet_name: petName })} width={200} height={200} />
        <Text variant="title" as="h1" align="center" testID="ai-13-no-time">
          {t("tutor_social:AI-13.no_time_left", { reset_time: resetTime(phase.resetsAt, locale) })}
        </Text>
      </>
    );
  } else if (phase.kind === "offline" || phase.kind === "connect_error") {
    body = (
      <>
        <Illustration name={phase.kind === "offline" ? "ui-offline" : `${species}-worried`} alt={t("tutor_social:AI-13.pet_alt", { pet_name: petName })} width={200} height={200} />
        <div role="alert" className="flex flex-col items-center gap-1">
          <Text variant="title" as="h1" align="center">
            {t("tutor_social:AI-13.error")}
          </Text>
          {(phase.kind === "offline" || !online) && <Text tone="muted">{t("tutor_social:AI-13.needs_internet")}</Text>}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <Illustration name={`${species}-headphones`} alt={t("tutor_social:AI-13.pet_alt", { pet_name: petName })} width={240} height={240} className="max-h-[45dvh]" />
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
          <Text variant="heading" as="h1" align="center">
            {t("tutor_social:AI-13.connecting", { pet_name: petName })}
          </Text>
          <Spinner />

          {mins !== null && (
            <span className="inline-flex items-center gap-1 text-caption text-ink-muted tabular-nums">
              <Icon name="Timer" size={16} />
              {t("tutor_social:AI-13.time_left", { n: mins })}
            </span>
          )}
        </div>
        {pet && <PetLine pet={{ species: pet.species }} petName={pet.name} text={t("tutor_social:AI-13.tip")} />}
      </>
    );
  }

  const failed = phase.kind === "connect_error" || phase.kind === "offline";
  const blocked = phase.kind === "unavailable" || phase.kind === "consent" || phase.kind === "no_time";
  return (
    <Page onBack={onCancel} backIcon="X" testID={`ai-13-${phase.kind}`}>
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center gap-4 rounded-card-large py-6 min-[600px]:my-6 min-[600px]:bg-surface min-[600px]:px-8 min-[600px]:shadow-raised">
        {body}
        <div className="flex w-full flex-col gap-2 pt-2">
          {failed && <Button label={t("tutor_social:AI-13.try_again")} onPress={onRetry} testID="ai-13-retry" />}
          {(failed || blocked) && <Button label={t("tutor_social:AI-13.switch_to_text")} variant={failed ? "secondary" : "primary"} icon="Keyboard" onPress={onSwitchToText} testID="ai-13-text" />}
          {!failed && !blocked && <Button label={t("tutor_social:AI-13.cancel")} variant="ghost" onPress={onCancel} testID="ai-13-cancel" />}
        </div>
      </div>
    </Page>
  );
}

// ── AI-14 ────────────────────────────────────────────────────────────────

const POSES = ["listening", "thinking", "speaking"] as const;
const PET_ART: Record<PetState, (s: "cat" | "dog") => string> = {
  listening: (sp) => `${sp}-headphones`,
  thinking: (sp) => `${sp}-thinking`,
  speaking: (sp) => `${sp}-wave`,
  interrupted: (sp) => `${sp}-headphones`,
};

function Live({
  handle,
  stream,
  pet,
  reconnect,
  onEnded,
  onSwitchToText,
}: {
  handle: LiveHandle;
  stream: MediaStream;
  pet: PetInfo | null;
  reconnect: () => Promise<VoiceSessionOut | null>;
  onEnded: (cause: EndCause, seconds: number, flashcards: number, sessionId: string | null) => void;
  onSwitchToText: () => void;
}) {
  const s = useServices();
  const { t } = useI18n();
  const [state, setState] = useState<PetState>("listening");
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [ptt, setPtt] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const cards = useRef(0);
  const sessionRef = useRef<VoiceSession | null>(null);
  const meta = useRef(handle.session);
  const ended = useRef(false);
  const stats = useRef({ interruptions: 0, reconnects: 0 });
  const linesRef = useRef<CaptionLine[]>([]);
  const species = pet?.species ?? "cat";
  const petName = pet?.name ?? t("tutor_social:AI-13.pet_fallback");
  const startedAt = handle.startedAt;
  const fake = handle.session.provider === "fake";

  const finish = useCallback(
    async (cause: EndCause) => {
      if (ended.current) return;
      ended.current = true;
      sessionRef.current?.close();
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      const reasons = endReasons(cause);
      s.analytics.track("voice_session_ended", { seconds: String(seconds), interruptions: String(stats.current.interruptions), reconnects: String(stats.current.reconnects), end_reason: reasons.analytics });
      const id = meta.current.id;
      try {
        await unwrap(s.client.POST("/v1/voice/sessions/{session_id}/end", { params: { path: { session_id: id } }, body: { seconds, end_reason: reasons.api, flashcards_made: cards.current, turns: transcriptTurns(linesRef.current) } }), s.client);
      } catch {
        /* the server also closes stale sessions; the summary still shows */
      }
      onEnded(cause, seconds, cards.current, id);
    },
    [onEnded, s, startedAt],
  );

  const open = useCallback(
    (out: VoiceSessionOut) => {
      const handlers: VoiceSessionHandlers = {
        onOpen: () => setReconnecting(false),
        onState: (st) => {
          if (st === "interrupted") stats.current.interruptions += 1;
          setState(st);
        },
        onCaption: (e) => {
          linesRef.current = captionsReduce(linesRef.current, e);
          setLines(linesRef.current);
        },
        onLevel: setLevel,
        onToolCall: async (call) => {
          const res = await unwrap(
            s.client.POST("/v1/voice/sessions/{session_id}/tools", { params: { path: { session_id: meta.current.id } }, body: { call_id: call.id, name: call.name as "queue_cards", args: call.args } }),
            s.client,
          );
          if (call.name === "queue_cards") {
            cards.current += 1;
            toast.show(t("tutor_social:AI-14.flashcard_toast"));
            s.analytics.track("tutor_flashcard_saved", { source: "voice", edited: false });
          }
          return res.result;
        },
        onClose: (why) => {
          if (ended.current || why === "normal") return;
          void resume();
        },
      };
      const cfg = { token: out.token, model: out.model, provider: out.provider, stream, clock: () => Date.now() - startedAt };
      const session = out.provider === "fake" ? new FakeVoiceSession(cfg, handlers) : new GeminiLiveSession(cfg, handlers);
      sessionRef.current = session;
      return session.connect();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, stream, startedAt, t],
  );

  /** Network drop or goAway: a fresh token for the same session, until the reconnect window closes. */
  const resume = useCallback(async () => {
    setReconnecting(true);
    setState("thinking");
    const droppedAt = Date.now();
    const windowS = meta.current.quota.reconnect_seconds ?? s.flags.get("voice.reconnect_seconds");
    while (!ended.current && canReconnect(droppedAt, Date.now(), windowS)) {
      if (navigator.onLine) {
        const out = await reconnect();
        if (out) {
          meta.current = out;
          stats.current.reconnects += 1;
          try {
            await open(out);
            return;
          } catch {
            /* try again below */
          }
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    void finish("network");
  }, [finish, open, reconnect, s]);

  // Connect once on mount.
  useEffect(() => {
    s.analytics.track("voice_session_started", { connect_ms: handle.connectMs });
    open(handle.session).catch(() => void resume());
    return () => sessionRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Session timer, the 2-minute warning and the caps.
  useEffect(() => {
    const id = window.setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(sec);
      const cap = capCause(sec, meta.current);
      if (cap) void finish(cap);
    }, 500);
    return () => window.clearInterval(id);
  }, [finish, startedAt]);

  // Background grace: hidden for longer than the flag ends the call (cost and privacy).
  useEffect(() => {
    let timerId: number | null = null;
    const grace = meta.current.quota.background_grace_seconds ?? s.flags.get("voice.background_grace_seconds");
    const onVis = () => {
      if (document.visibilityState === "hidden") timerId = window.setTimeout(() => void finish("background"), grace * 1000);
      else if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [finish, s]);

  // Mute, push-to-talk (Space) and Esc to end (after a confirm).
  useEffect(() => sessionRef.current?.setMuted(muted || ptt), [muted, ptt]);
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmEnd(true);
      if (ptt && e.code === "Space" && !typing(e)) {
        e.preventDefault();
        sessionRef.current?.setMuted(muted);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (ptt && e.code === "Space" && !typing(e)) sessionRef.current?.setMuted(true);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [ptt, muted]);

  // e2e: the fake session can drop its "socket" to exercise reconnecting.
  useEffect(() => {
    if (!fake || !s.fakeApi) return;
    const onDrop = () => (sessionRef.current as FakeVoiceSession | null)?.drop();
    document.addEventListener("smriti:voice-drop", onDrop);
    return () => document.removeEventListener("smriti:voice-drop", onDrop);
  }, [fake, s.fakeApi]);

  const warnAt = meta.current.warn_at_seconds;
  const leftMin = Math.max(1, Math.ceil((meta.current.max_seconds - elapsed) / 60));
  const stateLabel = state === "thinking" ? t("tutor_social:AI-14.thinking") : state === "speaking" ? petName : t("tutor_social:AI-14.listening");
  const shown = visibleCaptions(lines);
  const ring = 1 + Math.min(0.1, level * 0.1);

  return (
    <Page
      onBack={() => setConfirmEnd(true)}
      backIcon="X"
      width="lg"
      testID="ai-14"
      trailing={
        <div className="flex items-center gap-1">
          <IconButton icon="ClosedCaptioning" label={t("tutor_social:AI-14.captions")} variant={captions ? "filled" : "plain"} onPress={() => setCaptions((c) => !c)} testID="ai-14-captions" />
        </div>
      }
      footer={
        <div className="flex flex-col items-center gap-3 min-[600px]:hidden">{controls("narrow")}</div>
      }
    >
      <div className="flex items-center justify-center">
        <span role="timer" aria-label={t("tutor_social:AI-14.session_timer_label")} className="text-heading tabular-nums" data-testid="ai-14-timer">
          {timer(elapsed)}
        </span>
      </div>
      {reconnecting && <Banner tone="warning" icon="WifiSlash" text={t("tutor_social:AI-14.weak_connection")} testID="ai-14-reconnecting" />}
      {!reconnecting && elapsed >= warnAt && <Banner tone="warning" icon="Timer" text={t("tutor_social:AI-14.time_warning", { n: leftMin })} testID="ai-14-warning" />}
      {fake && (
        <Text variant="caption" tone="muted" align="center" testID="ai-14-fake">
          {t("tutor_social:AI-13.test_voice_note")}
        </Text>
      )}
      <div className="grid gap-6 min-[600px]:grid-cols-2">
        <div className="flex flex-col items-center gap-3">
          {/* Every pose is loaded up front and stacked, so a state change is a 400 ms fade, never a blank. */}
          <div className="relative grid size-[240px] max-h-[34dvh] place-items-center" role="img" aria-label={`${petName}, ${stateLabel}`} data-testid="ai-14-pet" data-state={state}>
            {POSES.map((pose) => (
              <Illustration key={pose} name={PET_ART[pose](species)} decorative width={240} height={240} className={cx("absolute inset-0 size-full transition-opacity duration-[400ms] motion-reduce:transition-none", PET_ART[pose](species) === PET_ART[state](species) ? "opacity-100" : "opacity-0")} />
            ))}
          </div>
          <p aria-live="polite" className="m-0 text-label text-ink-muted" data-testid="ai-14-state">
            {muted ? t("tutor_social:AI-14.muted_hint") : stateLabel}
          </p>
          <div className="hidden flex-col items-center gap-3 min-[600px]:flex">
            {controls("wide")}
            <Switch checked={ptt} onCheckedChange={setPtt} label={t("tutor_social:AI-14.push_to_talk")} testID="ai-14-ptt" />
            {ptt && (
              <Text variant="caption" tone="muted">
                {t("tutor_social:AI-14.push_to_talk_hint")}
              </Text>
            )}
          </div>
        </div>
        <section aria-label={t("tutor_social:AI-14.captions")} className="flex min-h-[160px] flex-col gap-2 rounded-card bg-surface p-4" data-testid="ai-14-captions-panel">
          {!captions ? (
            <Chip label={t("tutor_social:AI-14.captions_off")} icon="ClosedCaptioning" className="self-start" />
          ) : shown.length === 0 ? (
            <Text tone="muted">{t("tutor_social:AI-14.listening")}</Text>
          ) : (
            // Captions are not a live region: a screen reader would talk over the tutor (AI-14).
            shown.map((l, i) => (
              <p key={i} className={cx("m-0 text-body", l.role === "student" ? "self-end text-end text-ink-muted" : "self-start text-ink")} data-role={l.role}>
                {l.text}
              </p>
            ))
          )}
        </section>
      </div>
      <Dialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title={t("tutor_social:AI-14.end_confirm_title")}
        confirm={{ label: t("tutor_social:AI-14.end"), destructive: true, onPress: () => void finish("user") }}
        cancel={{ label: t("tutor_social:AI-14.end_confirm_keep"), onPress: () => setConfirmEnd(false) }}
        testID="ai-14-confirm"
      />
    </Page>
  );

  // Rendered twice (phone footer, desktop column); only one is visible, so test ids carry the layout.
  function controls(layout: "narrow" | "wide") {
    const id = (x: string) => (layout === "wide" ? `${x}-wide` : x);
    return (
      <>
        <div className="flex items-center gap-4">
          <IconButton icon={muted ? "MicrophoneSlash" : "Microphone"} label={muted ? t("tutor_social:AI-14.unmute") : t("tutor_social:AI-14.mute")} variant="filled" size={56} onPress={() => setMuted((m) => !m)} testID={id("ai-14-mute")} />
          <span
            role="img"
            aria-label={muted ? t("tutor_social:AI-14.muted_hint") : t("tutor_social:AI-14.listening")}
            className={cx("grid size-20 place-items-center rounded-full border-4 transition-transform motion-reduce:transition-none", muted ? "border-ink-disabled bg-surface-sunken text-ink-disabled" : "border-primary bg-primary-tint text-primary-text")}
            style={{ transform: `scale(${muted ? 1 : ring})` }}
          >
            <Icon name={muted ? "MicrophoneSlash" : "Microphone"} size={32} />
          </span>
          <IconButton icon="Keyboard" label={t("tutor_social:AI-14.switch_to_text")} variant="filled" size={56} onPress={onSwitchToText} testID={id("ai-14-text")} />
        </div>
        <Button label={t("tutor_social:AI-14.end")} variant="destructive" onPress={() => void finish("user")} className="w-full max-w-[320px]" testID={id("ai-14-end")} />
      </>
    );
  }
}

// ── AI-15 ────────────────────────────────────────────────────────────────

function Ended({
  cause,
  seconds,
  flashcards,
  sessionId,
  resetsAt,
  pet,
  onBack,
  onContinueInText,
}: {
  cause: EndCause;
  seconds: number;
  flashcards: number;
  sessionId: string | null;
  resetsAt: string | null;
  pet: PetInfo | null;
  onBack: () => void;
  onContinueInText: () => void;
}) {
  const { t, locale } = useI18n();
  const [transcript, setTranscript] = useState(false);
  const kind = endKind(cause);
  const species = pet?.species ?? "cat";
  const minutes = Math.round(seconds / 60);
  const title = kind === "dropped" ? t("tutor_social:AI-15.title_dropped") : kind === "time_cap" ? t("tutor_social:AI-15.title_time_cap") : t("tutor_social:AI-15.title_normal");
  const back = t("tutor_social:AI-15.back_no_source");
  if (transcript && sessionId) return <Transcript sessionId={sessionId} onClose={() => setTranscript(false)} />;
  return (
    <Page onBack={onBack} backIcon="X" testID={`ai-15-${kind}`}>
      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col items-center justify-center gap-4 py-6">
        <Illustration name={kind === "dropped" ? `${species}-thinking` : `${species}-wave`} decorative width={120} height={120} />
        <Text variant="title" as="h1" align="center">
          {title}
        </Text>
        {kind === "time_cap" && (
          <Text tone="muted" align="center">
            {t("tutor_social:AI-15.time_cap_line", { reset_time: resetTime(resetsAt, locale) })}
          </Text>
        )}
        <div className="grid w-full grid-cols-2 gap-3" aria-label={t("tutor_social:AI-15.stats_a11y", { minutes, cards: flashcards })} role="group">
          <StatTile value={String(minutes)} label={t("tutor_social:AI-15.stat_labels.1")} icon="Clock" />
          <StatTile value={String(flashcards)} label={t("tutor_social:AI-15.stat_labels.2")} icon="Cards" />
        </div>
        <div className="flex w-full flex-col gap-2">
          {kind === "normal" ? (
            <Button label={back} onPress={onBack} testID="ai-15-back" />
          ) : (
            <>
              <Button label={t("tutor_social:AI-15.continue_in_text")} icon="Keyboard" onPress={onContinueInText} testID="ai-15-text" />
              {kind === "time_cap" && <Button label={back} variant="secondary" onPress={onBack} testID="ai-15-back" />}
            </>
          )}
          {sessionId && <Button label={t("tutor_social:AI-15.view_transcript")} variant="ghost" icon="FileText" onPress={() => setTranscript(true)} testID="ai-15-transcript" />}
        </div>
      </div>
    </Page>
  );
}

function Transcript({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const s = useServices();
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "none" } | { kind: "ok"; turns: { role: string; text: string }[] }>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const load = async () => {
      try {
        const out = await unwrap(s.client.GET("/v1/voice/sessions/{session_id}/transcript", { params: { path: { session_id: sessionId } } }), s.client);
        if (alive) setState({ kind: "ok", turns: out.turns });
      } catch (e) {
        // Still being written: try a few times, then say there is none.
        if (errorCode(e) === "no_transcript" && tries++ < 3 && alive) setTimeout(() => void load(), 1500);
        else if (alive) setState({ kind: "none" });
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [s, sessionId]);
  return (
    <Page onBack={onClose} title={t("tutor_social:AI-15.transcript_title")} testID="ai-15-transcript-view">
      {state.kind === "loading" && (
        <div className="flex items-center gap-2" role="status">
          <Spinner label={t("tutor_social:AI-15.transcript_processing")} />
          <Text tone="muted">{t("tutor_social:AI-15.transcript_processing")}</Text>
        </div>
      )}
      {state.kind === "none" && <EmptyState illustration="ui-search-empty" text={t("tutor_social:AI-15.no_transcript")} />}
      {state.kind === "ok" && (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {state.turns.map((turn, i) => (
            <li key={i} className={cx("flex max-w-[85%] flex-col gap-1 rounded-card p-3", turn.role === "student" ? "self-end bg-primary-tint" : "self-start bg-surface")}>
              <Text>{turn.text}</Text>
              {turn.role === "tutor" && <ReadAloud text={turn.text} locale={locale} />}
            </li>
          ))}
        </ol>
      )}
    </Page>
  );
}

/** Read-aloud through `/v1/speech/read-aloud` (Deepgram text-to-speech on the server). */
function ReadAloud({ text, locale }: { text: string; locale: "en" | "hi" }) {
  const s = useServices();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      label={t("tutor_social:AI-02.read_aloud")}
      variant="ghost"
      size="sm"
      icon="SpeakerHigh"
      loading={busy}
      className="self-start"
      onPress={async () => {
        setBusy(true);
        try {
          const out = await unwrap(s.client.POST("/v1/speech/read-aloud", { body: { text: text.slice(0, 3000), locale } }), s.client);
          await new Audio(out.url).play().catch(() => undefined);
        } catch (e) {
          if (errorCode(e) === "speech_unavailable" || errorCode(e) === "ai_budget") toast.show(t("tutor_social:AI-13.unavailable_title"));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
