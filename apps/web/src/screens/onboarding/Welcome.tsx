import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button, Illustration, Text } from "@smriti/ui-web";
import type { Locale } from "@smriti/i18n";
import { useServices } from "../../boot/context";
import { useI18n } from "../../lib/i18n";

/** ONB-01: welcome and language. The device-locale button is primary; each shows its own script. */
export function Welcome() {
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const s = useServices();
  useEffect(() => {
    s.analytics.track("onboarding_step_viewed", { step: "welcome", step_index: 0 });
  }, [s]);

  const start = (l: Locale) => {
    setLocale(l);
    void s.record("settings_changed", { key: "content_locale", value: l });
    void navigate({ to: "/onboarding/$step", params: { step: "goal" } });
  };
  const english = { label: t("onboarding:ONB-01.english_button"), onPress: () => start("en"), testID: "start-en" };
  const hindi = { label: t("onboarding:ONB-01.hindi_button"), onPress: () => start("hi"), testID: "start-hi" };
  const [first, second] = locale === "hi" ? [hindi, english] : [english, hindi];

  return (
    <div className="flex min-h-dvh flex-col bg-bg md:flex-row" data-testid="onb-01">
      <div className="relative h-[44dvh] min-h-[260px] overflow-hidden md:h-auto md:flex-1">
        <Illustration name="scene-welcome" fit="cover" className="absolute inset-0 size-full" />
      </div>
      <main id="main" className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center gap-4 px-4 py-6 md:px-10">
        <Text variant="display" heading as="h1" align="center">
          {t("onboarding:ONB-01.headline_all_exams")}
        </Text>
        <div className="flex flex-col gap-3">
          <Button label={first.label} onPress={first.onPress} testID={first.testID} />
          <span lang={second === hindi ? "hi" : "en"}>
            <Button label={second.label} variant="secondary" onPress={second.onPress} testID={second.testID} />
          </span>
        </div>
        <Button label={t("onboarding:ONB-01.existing_account")} variant="ghost" onPress={() => void navigate({ to: "/login", search: { reason: "restore" } })} testID="existing-account" />
        <Text variant="caption" tone="muted" align="center">
          {t("onboarding:ONB-01.legal")}
        </Text>
      </main>
    </div>
  );
}
