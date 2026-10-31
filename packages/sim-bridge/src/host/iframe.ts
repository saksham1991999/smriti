/**
 * Web host: a sim in a sandboxed iframe (flows §6.2 "Security").
 *
 *   const host = createIframeHost({ iframe, allowedOrigins: [SIMS_ORIGIN], allowOpaqueOrigin: true, init, onEvent });
 *   iframe.src = simUrl;   // after createIframeHost, so the first hello is not missed
 */

import { isOriginAllowed } from '../origin';
import type { HostToSimMessage } from '../protocol';
import { HostSession, type HostSessionOptions } from './session';

/** `sandbox` value for sim iframes: scripts only, no same-origin, forms, popups or top navigation. */
export const SIM_IFRAME_SANDBOX = 'allow-scripts';

/** Attributes every sim iframe gets. */
export function simIframeAttributes(title: string): Record<string, string> {
  return {
    sandbox: SIM_IFRAME_SANDBOX,
    referrerpolicy: 'no-referrer',
    allow: '',
    loading: 'eager',
    title,
  };
}

interface MessageEventLike {
  data: unknown;
  origin: string;
  source: unknown;
}

interface WindowLike {
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

interface DocumentLike {
  hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

interface IframeLike {
  contentWindow: { postMessage(message: unknown, targetOrigin: string): void } | null;
}

export interface IframeHostOptions extends Omit<HostSessionOptions, 'transport'> {
  iframe: IframeLike;
  /** Origins the sim is served from. */
  allowedOrigins: readonly string[];
  /** Accept `"null"` (the sandboxed iframe's opaque origin). Default true. */
  allowOpaqueOrigin?: boolean;
  /**
   * Where to post. Defaults to the single allowed origin, or `*` when the
   * frame is opaque (a sandboxed frame cannot be targeted by origin). Host
   * messages carry no secrets: locale, theme, params and task specs.
   */
  targetOrigin?: string;
  /** Pause the sim when the tab is hidden (flows §6.2). Default true. */
  pauseWhenHidden?: boolean;
  win?: WindowLike;
  doc?: DocumentLike;
}

export interface IframeHost {
  session: HostSession;
  destroy(): void;
}

export function createIframeHost(opts: IframeHostOptions): IframeHost {
  const win = opts.win ?? (globalThis as unknown as { window?: WindowLike }).window;
  if (!win) throw new Error('createIframeHost needs a window');
  const doc = opts.doc ?? (globalThis as unknown as { document?: DocumentLike }).document;
  const allowOpaque = opts.allowOpaqueOrigin ?? true;
  const targetOrigin =
    opts.targetOrigin ??
    (allowOpaque || opts.allowedOrigins.length !== 1 ? '*' : (opts.allowedOrigins[0] ?? '*'));

  const session = new HostSession({
    ...opts,
    transport: {
      send(message: HostToSimMessage) {
        opts.iframe.contentWindow?.postMessage(message, targetOrigin);
      },
    },
  });

  const onMessage = (event: MessageEventLike): void => {
    // Messages from other frames (ads, devtools, other sims) are not ours: ignore silently.
    if (event.source === null || event.source !== opts.iframe.contentWindow) return;
    if (!isOriginAllowed(event.origin, { allowed: opts.allowedOrigins, allowOpaque })) {
      session.reject('origin', event.origin);
      return;
    }
    session.receive(event.data);
  };
  win.addEventListener('message', onMessage);

  let pausedByVisibility = false;
  const onVisibility = (): void => {
    if (!doc) return;
    if (doc.hidden && session.status === 'running') {
      pausedByVisibility = true;
      session.pause();
    } else if (!doc.hidden && pausedByVisibility) {
      pausedByVisibility = false;
      session.resume();
    }
  };
  const watchVisibility = (opts.pauseWhenHidden ?? true) && doc !== undefined;
  if (watchVisibility) doc.addEventListener('visibilitychange', onVisibility);

  session.start();

  return {
    session,
    destroy() {
      win.removeEventListener('message', onMessage);
      if (watchVisibility) doc.removeEventListener('visibilitychange', onVisibility);
      session.destroy();
    },
  };
}
