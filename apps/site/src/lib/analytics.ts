// Cookie-free site analytics hook.
//
// - A typed event catalogue: only these events and fields can be sent. No free text typed by
//   visitors, no identifiers, no cookies, no storage (AGENTS rules 6 and 8).
// - The default transport is a no-op. When SITE_ANALYTICS_ENDPOINT is set at build time, the
//   layout puts it on <html data-analytics-endpoint>, and events are POSTed there with
//   `credentials: "omit"`. Browsers that send Global Privacy Control or Do Not Track send nothing.
// - When packages/analytics lands, this catalogue moves there and the transport batches into
//   the same pipeline as the apps (TRD §13).

export type PageType = "home" | "exams" | "exam" | "subject" | "chapter" | "topic" | "legal" | "not_found";
export type Placement =
  | "header"
  | "hero"
  | "exam_card"
  | "pricing"
  | "cta_band"
  | "exam_hero"
  | "subject_hero"
  | "topic_hero"
  | "quiz_end"
  | "periodic"
  | "apps"
  | "exam_apps"
  | "footer";

export interface SiteEvents {
  site_page_view: { page_type: PageType; lang: "en" | "hi"; exam?: string };
  site_cta_click: { cta: "start" | "sign_in" | "try_lesson" | "open_lab" | "store_play" | "store_ios"; placement: Placement; lang: "en" | "hi"; exam?: string };
  site_lang_switch: { to: "en" | "hi"; page_type: PageType };
  site_quiz_answer: { position: number; correct: boolean; confidence: "sure" | "fifty" | "guess" | "none" };
  site_quiz_complete: { score: number; total: number };
  site_periodic_element: { atomic_number: number };
}
export type SiteEventName = keyof SiteEvents;

export interface Transport {
  send(name: string, props: Record<string, unknown>): void;
}

export class NoopTransport implements Transport {
  send(): void {
    /* analytics not configured: nothing leaves the page */
  }
}

/** POSTs one small JSON body per event, without cookies or credentials. */
export class BeaconTransport implements Transport {
  constructor(
    private readonly endpoint: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}
  send(name: string, props: Record<string, unknown>): void {
    const body = JSON.stringify({ name, props, ts: Date.now(), path: location.pathname });
    void this.fetchImpl(this.endpoint, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      mode: "cors",
      headers: { "content-type": "application/json" },
    }).catch(() => undefined);
  }
}

interface PrivacySignals {
  globalPrivacyControl?: boolean;
  doNotTrack?: string | null;
}

export function privacyOptOut(nav: PrivacySignals | undefined): boolean {
  if (!nav) return true;
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1" || nav.doNotTrack === "yes";
}

let transport: Transport | undefined;

export function resolveTransport(): Transport {
  if (transport) return transport;
  if (typeof document === "undefined" || typeof navigator === "undefined") return new NoopTransport();
  const endpoint = document.documentElement.dataset.analyticsEndpoint;
  transport = endpoint && !privacyOptOut(navigator as Navigator & PrivacySignals) ? new BeaconTransport(endpoint) : new NoopTransport();
  return transport;
}

/** For tests. */
export function setTransport(t: Transport | undefined): void {
  transport = t;
}

export function track<N extends SiteEventName>(name: N, props: SiteEvents[N]): void {
  try {
    resolveTransport().send(name, props as Record<string, unknown>);
  } catch {
    /* analytics must never break the page */
  }
}
