/**
 * Error reporting and tracing with Sentry (TRD §13). Off unless VITE_SENTRY_DSN is set; the SDK is
 * a separate chunk, loaded after the first frame, so it never delays boot.
 *
 * Calls to the API carry `traceparent` (and Sentry's own headers), so one trace spans web → API.
 * No personal data: no cookies, headers, bodies or query strings, no input text in breadcrumbs,
 * guardian link codes are masked, and the user is the internal user id only.
 */
import type { ClientEnv } from "@smriti/config";
import type { AppStore } from "@smriti/app-core";

type SentryEvent = {
  request?: { url?: string; headers?: unknown; cookies?: unknown; data?: unknown; query_string?: unknown };
  user?: { id?: string | number } & Record<string, unknown>;
};
type Crumb = { category?: string; message?: string; data?: Record<string, unknown> };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Drops the query and fragment, and masks a guardian consent code (`/guardian/<code>`). */
export function scrubUrl(url: string): string {
  const bare = url.split(/[?#]/, 1)[0] ?? "";
  return bare.replace(/(\/guardian\/)(?!ask$|handoff$|link$)[^/]+/, "$1[code]").replace(EMAIL, "[email]");
}

export function scrubEvent<E extends SentryEvent>(event: E): E {
  if (event.request) {
    const url = event.request.url ? scrubUrl(event.request.url) : undefined;
    event.request = url ? { url } : {};
  }
  const id = event.user?.id;
  event.user = id !== undefined ? { id: String(id) } : {};
  return event;
}

/** Keeps navigation and network breadcrumbs (without queries); drops console and input text. */
export function scrubBreadcrumb<B extends Crumb>(crumb: B): B | null {
  const cat = crumb.category ?? "";
  if (cat === "console" || cat.startsWith("ui.input")) return null;
  if (cat === "navigation" && crumb.data) {
    for (const key of ["from", "to"]) {
      const v = crumb.data[key];
      if (typeof v === "string") crumb.data[key] = scrubUrl(v);
    }
  }
  if ((cat === "fetch" || cat === "xhr") && crumb.data) {
    const url = crumb.data.url;
    crumb.data = {
      method: crumb.data.method,
      status_code: crumb.data.status_code,
      url: typeof url === "string" ? scrubUrl(url) : undefined,
    };
  }
  if (crumb.message) crumb.message = crumb.message.replace(EMAIL, "[email]");
  return crumb;
}

/** Traces are sampled lightly in production; errors are always sent. */
export function tracesSampleRate(appEnv: ClientEnv["APP_ENV"]): number {
  return appEnv === "production" ? 0.1 : 1;
}

export async function startErrorReporting(env: ClientEnv, store: AppStore): Promise<boolean> {
  if (!env.SENTRY_DSN) return false;
  const Sentry = await import("@sentry/react");
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    release: import.meta.env.VITE_RELEASE as string | undefined,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: tracesSampleRate(env.APP_ENV),
    tracePropagationTargets: [env.API_BASE_URL],
    propagateTraceparent: true,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
    },
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
  const setUser = (userId: string | null | undefined) => Sentry.setUser(userId ? { id: userId } : null);
  setUser(store.getState().session.userId);
  store.subscribe((s, prev) => {
    if (s.session.userId !== prev.session.userId) setUser(s.session.userId);
  });
  return true;
}
