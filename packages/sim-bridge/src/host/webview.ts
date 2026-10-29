/**
 * React Native host: a sim in `react-native-webview`. This file has no React
 * Native import, so it stays platform-free; the screen wires it up:
 *
 *   const host = useMemo(() => createWebViewHost({
 *     injectJavaScript: (js) => ref.current?.injectJavaScript(js),
 *     allowedUrlPrefixes: [simFolderUrl],
 *     init, onEvent,
 *   }), []);
 *   <WebView ref={ref} source={{ uri: simIndexUrl }}
 *     {...SIM_WEBVIEW_PROPS}
 *     injectedJavaScriptBeforeContentLoaded={SIM_WEBVIEW_GUARD_SCRIPT}
 *     onShouldStartLoadWithRequest={(r) => host.shouldStartLoad(r.url)}
 *     onMessage={host.onMessage} />
 *
 * Sim → host: the sim SDK calls `window.ReactNativeWebView.postMessage(json)`.
 * Host → sim: `injectJavaScript` calls `window.SmritiSimBridge.receive(json)`.
 */

import { isUrlUnderPrefix } from '../origin';
import type { HostToSimMessage } from '../protocol';
import { HostSession, type HostSessionOptions } from './session';

export interface WebViewMessageEvent {
  nativeEvent: { data: string; url?: string };
}

export interface WebViewHostOptions extends Omit<HostSessionOptions, 'transport'> {
  injectJavaScript: (script: string) => void;
  /** Folder URLs (ending in `/`) the sim may load from, for example the cached sim folder. */
  allowedUrlPrefixes: readonly string[];
}

export interface WebViewHost {
  session: HostSession;
  onMessage: (event: WebViewMessageEvent) => void;
  /** For `onShouldStartLoadWithRequest`: blocks navigation out of the sim folder. */
  shouldStartLoad: (url: string) => boolean;
  destroy(): void;
}

/**
 * Props for the WebView: no file access outside the sim folder, no popups, no
 * universal access from file URLs (flows §6.2).
 */
export const SIM_WEBVIEW_PROPS = {
  originWhitelist: ['file://*'],
  javaScriptEnabled: true,
  domStorageEnabled: false,
  allowFileAccess: true,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  setSupportMultipleWindows: false,
  javaScriptCanOpenWindowsAutomatically: false,
  mediaPlaybackRequiresUserAction: true,
  allowsLinkPreview: false,
  geolocationEnabled: false,
  cacheEnabled: false,
  incognito: true,
} as const;

/**
 * Runs before the sim's own scripts: blocks popups and network APIs as a second
 * line behind the sim's CSP (`connect-src 'none'`). Sims make no network calls.
 */
export const SIM_WEBVIEW_GUARD_SCRIPT = `(function(){
  try {
    window.open = function(){ return null; };
    var deny = function(){ throw new Error('network disabled in sims'); };
    window.fetch = function(){ return Promise.reject(new Error('network disabled in sims')); };
    window.XMLHttpRequest = deny;
    window.WebSocket = deny;
    window.EventSource = deny;
    if (navigator.sendBeacon) navigator.sendBeacon = function(){ return false; };
    window.__SMRITI_HOST__ = 'react-native';
  } catch (e) {}
})(); true;`;

/** Encodes a message as a JS string literal safe to embed in injected code. */
export function encodeForInjection(message: HostToSimMessage): string {
  return JSON.stringify(JSON.stringify(message))
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029')
    .replace(/<\/script/gi, '<\\/script');
}

export function injectionScript(message: HostToSimMessage): string {
  return `(function(){var b=window.SmritiSimBridge;if(b&&typeof b.receive==='function'){b.receive(${encodeForInjection(message)});}})();true;`;
}

export function createWebViewHost(opts: WebViewHostOptions): WebViewHost {
  const session = new HostSession({
    ...opts,
    transport: {
      send(message) {
        opts.injectJavaScript(injectionScript(message));
      },
    },
  });

  const onMessage = (event: WebViewMessageEvent): void => {
    const { data, url } = event.nativeEvent;
    if (url !== undefined && !isUrlUnderPrefix(url, opts.allowedUrlPrefixes)) {
      session.reject('origin', url.slice(0, 200));
      return;
    }
    session.receive(data);
  };

  session.start();

  return {
    session,
    onMessage,
    shouldStartLoad: (url: string) => url === 'about:blank' || isUrlUnderPrefix(url, opts.allowedUrlPrefixes),
    destroy() {
      session.destroy();
    },
  };
}
