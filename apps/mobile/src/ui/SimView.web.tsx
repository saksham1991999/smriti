import { createIframeHost, simIframeAttributes, type HostEvent } from '@smriti/sim-bridge';
import { createElement, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import type { SimViewProps } from './SimView.types';

export type { SimViewProps } from './SimView.types';

function originOf(url: string): string {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return window.location.origin;
  }
}

/**
 * Web preview: the sim from the CDN in a sandboxed iframe (`allow-scripts` only, opaque origin),
 * as in apps/web. The sim never sees the app's storage, cookies or tokens.
 */
export function SimView({ lab, location, init, readyTimeoutMs, maxStateHz, maxErrors, label, onHost, onEvent, testID }: SimViewProps) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const cb = useRef({ onEvent, onHost });
  cb.current = { onEvent, onHost };

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const host = createIframeHost({
      iframe,
      allowedOrigins: [originOf(location.indexUrl)],
      allowOpaqueOrigin: true,
      expectedSimId: lab.id,
      init,
      readyTimeoutMs,
      ...(maxStateHz ? { maxStateHz } : {}),
      ...(maxErrors ? { maxErrors } : {}),
      onEvent: (e: HostEvent) => cb.current.onEvent(e),
    });
    cb.current.onHost(host.session);
    // The host listens before the page loads, so the first `hello` is not missed.
    iframe.src = location.indexUrl;
    return () => {
      cb.current.onHost(null);
      host.destroy();
      iframe.src = 'about:blank';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.id, location.indexUrl]);

  const attrs = simIframeAttributes(label);
  return (
    <View style={styles.fill} testID={testID}>
      {createElement('iframe', {
        ref,
        title: attrs.title,
        sandbox: attrs.sandbox,
        referrerPolicy: 'no-referrer',
        allow: '',
        loading: 'eager',
        style: { border: 0, width: '100%', height: '100%', display: 'block', background: 'transparent' },
        'data-testid': testID ? `${testID}-frame` : undefined,
      })}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
