/**
 * AI-12 (mic variant) and the browser microphone. The pre-prompt explains why before the browser
 * asks; when the browser already granted it there is no pre-prompt. Denied shows how to turn it
 * back on, with the text fallback. Audio is only ever streamed or sent for one request; nothing
 * is stored on the device.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, Illustration } from "@smriti/ui-web";
import { useI18n } from "../../../lib/i18n";
import { usePet } from "./pet";

export type MicPermission = "unknown" | "granted" | "denied" | "unsupported";

export function micSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** What the browser says now, without prompting (Permissions API where it exists). */
export async function queryMic(): Promise<MicPermission> {
  if (!micSupported()) return "unsupported";
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    if (status?.state === "granted") return "granted";
    if (status?.state === "denied") return "denied";
  } catch {
    /* Firefox and Safari may not know "microphone" */
  }
  return "unknown";
}

/** Opens the mic (the browser prompts if needed). Mono, echo-cancelled, at the device's own rate. */
export async function openMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
}

/**
 * The AI-12 flow as a hook: `request()` resolves with a stream, or null when the student said
 * Not now or the browser refused (the dialog then shows the denied variant).
 */
export function useMicGate(onAnalytics?: (result: "granted" | "denied" | "dismissed") => void) {
  const [dialog, setDialog] = useState<null | "ask" | "denied">(null);
  const pending = useRef<((s: MediaStream | null) => void) | null>(null);

  const tryOpen = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await openMic();
      onAnalytics?.("granted");
      return stream;
    } catch {
      onAnalytics?.("denied");
      return null;
    }
  }, [onAnalytics]);

  const request = useCallback(async (): Promise<MediaStream | null> => {
    const state = await queryMic();
    if (state === "unsupported") {
      setDialog("denied");
      return null;
    }
    if (state === "granted") return tryOpen();
    if (state === "denied") {
      setDialog("denied");
      return null;
    }
    setDialog("ask");
    return new Promise((resolve) => {
      pending.current = resolve;
    });
  }, [tryOpen]);

  const allow = useCallback(async () => {
    setDialog(null);
    const stream = await tryOpen();
    if (!stream) setDialog("denied");
    pending.current?.(stream);
    pending.current = null;
  }, [tryOpen]);

  const dismiss = useCallback(() => {
    setDialog(null);
    if (pending.current) onAnalytics?.("dismissed");
    pending.current?.(null);
    pending.current = null;
  }, [onAnalytics]);

  useEffect(() => () => pending.current?.(null), []);
  return { dialog, request, allow, dismiss };
}

/** The AI-12 dialog (web: a 480 px dialog instead of the phone's sheet). */
export function MicDialog({ state, onAllow, onDismiss, fallbackLabel }: { state: null | "ask" | "denied"; onAllow: () => void; onDismiss: () => void; fallbackLabel?: string }) {
  const { t } = useI18n();
  const pet = usePet();
  const petName = pet?.name ?? t("tutor_social:AI-13.pet_fallback");
  const species = pet?.species ?? "cat";
  const denied = state === "denied";
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(o) => !o && onDismiss()}
      title={denied ? t("tutor_social:AI-12.mic_denied_title") : t("tutor_social:AI-12.mic_title")}
      description={denied ? t("tutor_social:AI-12.denied_body_web") : t("tutor_social:AI-12.mic_body", { pet_name: petName })}
      testID="ai-12"
    >
      <div className="flex flex-col items-center gap-4">
        <Illustration name={`${species}-headphones`} width={160} height={160} alt={t("tutor_social:AI-12.mic_alt", { pet_name: petName })} />
        <div className="flex w-full flex-col gap-2">
          {denied ? (
            <Button label={fallbackLabel ?? t("tutor_social:AI-12.mic_fallback")} onPress={onDismiss} testID="ai-12-fallback" />
          ) : (
            <>
              <Button label={t("tutor_social:AI-12.allow_mic")} icon="Microphone" onPress={onAllow} testID="ai-12-allow" />
              <Button label={t("tutor_social:AI-12.not_now")} variant="ghost" onPress={onDismiss} testID="ai-12-not-now" />
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
