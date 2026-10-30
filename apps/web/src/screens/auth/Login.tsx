/**
 * AUTH-02 hard sign-in (start Pro, restore, session expired, switch account) and AUTH-29 web
 * sign-in page. The Google step is shared with AUTH-01; on success the student goes to `next`.
 */
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button, Chip, IconButton, Illustration, Text, TrustLine } from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { GoogleStep, useSignedInToast } from "../../components/SignIn";
import { useI18n } from "../../lib/i18n";
import { usePriceValues, usePrices } from "../../lib/pricing";
import { savedEmail } from "../../lib/auth";
import type { LoginSearch } from "../../router";

export function Login() {
  const { reason, next } = useSearch({ strict: false }) as LoginSearch;
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const prices = usePrices();
  const pv = usePriceValues();
  const signedIn = useSignedInToast();
  const app = s.variant.appName;

  const copy = (() => {
    switch (reason) {
      case "start_trial":
        return { title: t("auth:AUTH-02.title_start_trial"), body: t("auth:AUTH-02.reason_start_trial") };
      case "restore":
        return { title: t("auth:AUTH-02.title_restore"), body: t("auth:AUTH-02.reason_restore") };
      case "session_expired":
        return { title: t("auth:AUTH-02.title_session_expired"), body: t("auth:AUTH-02.reason_session_expired") };
      case "switch_account":
        return { title: t("auth:AUTH-02.title_switch_account"), body: t("auth:AUTH-02.reason_switch_account") };
      default:
        return { title: t("auth:AUTH-29.title", { app_name: app.en }), body: t("auth:AUTH-29.subtitle") };
    }
  })();

  const back = () => (window.history.length > 1 ? window.history.back() : void navigate({ to: "/" }));

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col gap-4 px-4 py-6" data-testid="auth-02">
      <div>
        <IconButton icon="CaretLeft" label={t("auth:AUTH-02.back")} onPress={back} testID="login-back" />
      </div>
      <main id="main" className="flex flex-col items-center gap-4 text-center">
        <Illustration name="scene-welcome" width={280} height={180} decorative />
        <Text variant="title" heading as="h1" align="center">
          {copy.title}
        </Text>
        <Text tone="muted" align="center">
          {copy.body}
        </Text>
        {reason === "start_trial" && prices && <Chip kind="status" tone="primary" label={t("auth:AUTH-02.trial_chip_eligible", pv)} />}
        <div className="flex w-full flex-col gap-3">
          <GoogleStep
            reason={reason ?? "web_sign_in"}
            onDone={(outcome) => {
              signedIn(outcome, savedEmail.get());
              void navigate({ to: next ?? "/learn", replace: true });
            }}
            onCancel={back}
          />
        </div>
        <TrustLine />
        {!reason && (
          <Button variant="ghost" label={t("auth:AUTH-29.new_here")} onPress={() => void navigate({ to: "/welcome" })} testID="login-new" />
        )}
      </main>
    </div>
  );
}
