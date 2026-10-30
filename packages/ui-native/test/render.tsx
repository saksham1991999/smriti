import type { ReactElement } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { Mode } from "@smriti/tokens";
import type { Locale } from "@smriti/tokens/ui";
import { UIProvider } from "../src/theme";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

export function renderUI(ui: ReactElement, opts: { mode?: Mode; locale?: Locale; reducedMotion?: boolean } & RenderOptions = {}): Promise<RenderResult> {
  const { mode = "light", locale = "en", reducedMotion = true, ...rest } = opts;
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <UIProvider mode={mode} locale={locale} reducedMotion={reducedMotion} assetBaseUrl="https://cdn.example.test/assets/">
        {ui}
      </UIProvider>
    </SafeAreaProvider>,
    rest,
  );
}
