import { createWebViewHost, SIM_WEBVIEW_GUARD_SCRIPT, SIM_WEBVIEW_PROPS, type HostEvent, type HostSession, type WebViewHost } from '@smriti/sim-bridge';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import type { SimViewProps } from './SimView.types';

export type { SimViewProps } from './SimView.types';

/**
 * A downloaded sim in `react-native-webview`, driven by sim-bridge (TRD §7.3). The WebView may load
 * only from the sim's own folder, has no network (the guard script and the sim's CSP), no popups
 * and no universal file access. A killed web process reloads the page and the session sends
 * `init` again.
 */
export function SimView({ lab, location, init, readyTimeoutMs, maxStateHz, maxErrors, label, onHost, onEvent, testID }: SimViewProps) {
  const ref = useRef<WebView>(null);
  const [host, setHost] = useState<WebViewHost | null>(null);
  const cb = useRef({ onEvent, onHost });
  cb.current = { onEvent, onHost };

  useEffect(() => {
    const h = createWebViewHost({
      injectJavaScript: (js) => ref.current?.injectJavaScript(js),
      allowedUrlPrefixes: [location.folderUrl],
      expectedSimId: lab.id,
      init,
      readyTimeoutMs,
      ...(maxStateHz ? { maxStateHz } : {}),
      ...(maxErrors ? { maxErrors } : {}),
      onEvent: (e: HostEvent) => cb.current.onEvent(e),
    });
    setHost(h);
    cb.current.onHost(h.session as HostSession);
    return () => {
      cb.current.onHost(null);
      h.destroy();
    };
    // A new host only for a new sim or folder; locale, theme and power go through set_params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab.id, location.indexUrl]);

  return (
    <View style={styles.fill} accessible={false} testID={testID}>
      {host ? (
        <WebView
          ref={ref}
          source={{ uri: location.indexUrl }}
          {...SIM_WEBVIEW_PROPS}
          originWhitelist={[...SIM_WEBVIEW_PROPS.originWhitelist]}
          allowingReadAccessToURL={location.folderUrl}
          injectedJavaScriptBeforeContentLoaded={SIM_WEBVIEW_GUARD_SCRIPT}
          onShouldStartLoadWithRequest={(r) => host.shouldStartLoad(r.url)}
          onMessage={host.onMessage}
          onContentProcessDidTerminate={() => ref.current?.reload()}
          onRenderProcessGone={() => ref.current?.reload()}
          style={styles.fill}
          containerStyle={styles.fill}
          accessibilityLabel={label}
          testID={testID ? `${testID}-webview` : undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: 'transparent' } });
