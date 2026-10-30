import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@smriti/ui-web";
import { StepFrame } from "../src/components/Frame";
import { I18nProvider, preloadLocale } from "../src/lib/i18n";

beforeAll(() => preloadLocale("en"));

function wrap(ui: React.ReactElement) {
  return render(
    <I18nProvider brand={{ en: "Smriti", hi: "स्मृति" }}>
      <UIProvider locale="en">{ui}</UIProvider>
    </I18nProvider>,
  );
}

describe("StepFrame", () => {
  it("renders the step with a labelled back button and a disabled main action until ready", async () => {
    const onBack = vi.fn();
    const onPress = vi.fn();
    wrap(
      <StepFrame onBack={onBack} progress={{ done: 1, total: 4 }} title="What are you preparing for?" primary={{ label: "Continue", onPress, disabled: true, testID: "go" }}>
        <p>content</p>
      </StepFrame>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "What are you preparing for?" })).toBeInTheDocument();
    expect(screen.getByTestId("go")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("calls the main action when enabled", async () => {
    const onPress = vi.fn();
    wrap(
      <StepFrame title="Pick a buddy" primary={{ label: "Continue", onPress, testID: "go" }}>
        <p>content</p>
      </StepFrame>,
    );
    await userEvent.click(screen.getByTestId("go"));
    expect(onPress).toHaveBeenCalledOnce();
  });
});
