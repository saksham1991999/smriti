import { useEffect, useRef, useState } from "react";
import { createIframeHost, simIframeAttributes, type HostStatus, type ParamValues, type TaskProgress, type TaskSpec } from "@smriti/sim-bridge";
import { Spinner, Text } from "@smriti/ui-web";
import { useI18n } from "../lib/i18n";
import { resolvedDark, useTheme } from "../lib/theme";
import { useUI } from "@smriti/ui-web";

export interface SimFrameProps {
  simId: string;
  title: string;
  /** "4:3" style ratio from the sim's manifest. */
  aspect?: string;
  params?: ParamValues;
  tasks?: TaskSpec[];
  onTask?: (p: TaskProgress) => void;
  onMeasurement?: (m: { taskId?: string; name: string; value: number; unit: string }) => void;
  onStatus?: (s: HostStatus) => void;
}

/**
 * A sim from /sims/<id>/ in a sandboxed iframe (scripts only, opaque origin), driven through
 * @smriti/sim-bridge. The sim never sees the app's storage, cookies or tokens.
 */
export function SimFrame({ simId, title, aspect = "4:3", params = {}, tasks = [], onTask, onMeasurement, onStatus }: SimFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const { locale, t } = useI18n();
  const { reducedMotion } = useUI();
  const mode = useTheme((s) => s.mode);
  const [status, setStatus] = useState<HostStatus>("idle");
  const cb = useRef({ onTask, onMeasurement, onStatus });
  cb.current = { onTask, onMeasurement, onStatus };

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const host = createIframeHost({
      iframe,
      allowedOrigins: [location.origin],
      allowOpaqueOrigin: true,
      expectedSimId: simId,
      init: { locale, theme: resolvedDark(mode) ? "dark" : "light", reducedMotion, lowPower: false, params, tasks },
      onEvent: (e) => {
        if (e.kind === "status") {
          setStatus(e.status);
          cb.current.onStatus?.(e.status);
        } else if (e.kind === "task") cb.current.onTask?.(e.progress);
        else if (e.kind === "message" && e.message.type === "measurement") {
          const m = e.message.payload;
          cb.current.onMeasurement?.({ taskId: m.taskId, name: m.name, value: m.value, unit: m.unit });
        }
      },
    });
    iframe.src = `/sims/${encodeURIComponent(simId)}/index.html`;
    return () => host.destroy();
    // The sim restarts only when a different sim is shown; locale and theme changes go through set_params later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simId]);

  const [w, h] = aspect.split(":").map(Number);
  const attrs = simIframeAttributes(title);
  return (
    <div className="relative w-full overflow-hidden rounded-card bg-surface-sunken" style={{ aspectRatio: `${w || 4} / ${h || 3}` }} data-testid="sim-frame" data-status={status}>
      <iframe
        ref={ref}
        title={attrs.title}
        sandbox={attrs.sandbox}
        referrerPolicy="no-referrer"
        loading="eager"
        className="absolute inset-0 size-full border-0"
      />
      {(status === "idle" || status === "waiting_hello" || status === "initializing") && (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner label={t("learn:WEB-01.loading")} />
        </div>
      )}
      {status === "failed" && (
        <div className="absolute inset-0 grid place-items-center p-4" role="alert">
          <Text tone="muted" align="center">
            {t("learn:WEB-01.load_error")}
          </Text>
        </div>
      )}
    </div>
  );
}
