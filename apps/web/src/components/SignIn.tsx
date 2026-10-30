/**
 * AUTH-01 (soft sign-in sheet) and the shared Google step. Locally (AUTH_MODE=dev) the Google
 * button opens a test-email form that stands in for Google (WEB-01 dev sign-in); the same
 * `connectGoogle` runs either way.
 */
import { useState } from "react";
import { useAppStore } from "@smriti/app-core/react";
import { Button, GoogleButton, Illustration, Sheet, StatTile, Text, TrustLine } from "@smriti/ui-web";
import { useServices } from "../boot/context";
import { connectGoogle, signInErrorCode, type ConnectOutcome } from "../lib/auth";
import { parts, useI18n } from "../lib/i18n";
import { useOnline } from "../lib/network";
import { ageBandFrom, useOnboarding } from "../lib/onboarding";
import { toast } from "../lib/toast";
import { TextField } from "./Field";

export type SoftReason = "lesson_3" | "streak_day_2" | "web_storage_risk" | "save_progress" | "leaderboard";

/** The student's age band: the server's, else from onboarding answers. */
export function useAgeBand() {
  const server = useAppStore((s) => s.profile?.age_band ?? null);
  const d = useOnboarding();
  return server ?? ageBandFrom(d);
}

/** Google, then (dev only) the test-email form. Calls `onDone` after a link, merge or sign-in. */
export function GoogleStep({ reason, onDone, onCancel }: { reason: string; onDone: (o: ConnectOutcome) => void; onCancel?: () => void }) {
  const s = useServices();
  const { t } = useI18n();
  const online = useOnline();
  const [form, setForm] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dev = s.env.AUTH_MODE === "dev";

  const submit = async () => {
    if (!email.includes("@")) {
      setError(t("learn:WEB-01.dev_email_error"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await connectGoogle(s, { email: email.trim(), name: name.trim() || email.split("@")[0] || "Student" }, reason);
      onDone(outcome);
    } catch (err) {
      s.logger.warn("auth.connect_failed", { code: signInErrorCode(err) });
      setError(t("learn:WEB-01.load_error"));
    } finally {
      setBusy(false);
    }
  };

  if (!online) return <Text tone="muted">{t("auth:AUTH-01.offline_line")}</Text>;
  if (!form)
    return (
      <GoogleButton
        platform="web"
        onPress={() => {
          s.analytics.track("auth_provider_tapped", { provider: "google", flow: "button" });
          if (dev) setForm(true);
          else toast.show(t("learn:WEB-01.load_error"), { tone: "error" });
        }}
        testID="google-button"
      />
    );
  return (
    <form
      className="flex flex-col gap-3 rounded-card bg-surface-sunken p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-testid="dev-sign-in"
      aria-labelledby="dev-sign-in-title"
    >
      <Text variant="heading" heading id="dev-sign-in-title">
        {t("learn:WEB-01.dev_sign_in_title")}
      </Text>
      <Text variant="caption" tone="muted">
        {t("learn:WEB-01.dev_sign_in_body")}
      </Text>
      <TextField label={t("learn:WEB-01.dev_email")} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={error} testID="dev-email" />
      <TextField label={t("learn:WEB-01.dev_name")} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} testID="dev-name" />
      <Button label={busy ? t("auth:AUTH-04.signing_in") : t("learn:WEB-01.dev_submit")} loading={busy} disabled={busy} onPress={() => void submit()} testID="dev-submit" />
      {onCancel && <Button label={t("auth:AUTH-02.back")} variant="ghost" onPress={() => setForm(false)} />}
    </form>
  );
}

/** The AUTH-06 toast after a link or merge. */
export function useSignedInToast() {
  const { t } = useI18n();
  const streak = useAppStore((s) => s.streak);
  const pet = useAppStore((s) => s.pet);
  return (o: ConnectOutcome, email: string | null) => {
    const n = streak?.current ?? 0;
    const line1 =
      n > 1 ? t("auth:AUTH-06.toast_line_1_link", { pet_name: pet?.name ?? "", n }) : t("auth:AUTH-06.toast_line_1_link_first_day", { pet_name: pet?.name ?? "" });
    toast.show(o.path === "restore" ? t("auth:AUTH-06.title_restore_no_name") : `${line1} ${email ? t("auth:AUTH-06.toast_line_2", { email }) : ""}`.trim(), { icon: "CloudCheck" });
  };
}

/** AUTH-01: the soft sign-in sheet for a guest at a value moment or a tap. */
export function SoftPromptSheet({ open, reason, onClose }: { open: boolean; reason: SoftReason; onClose: (how: "later" | "done") => void }) {
  const s = useServices();
  const { t } = useI18n();
  const pet = useAppStore((x) => x.pet);
  const streak = useAppStore((x) => x.streak);
  const lessons = useOnboarding((x) => x.lessonsCompleted);
  const band = useAgeBand();
  const signedToast = useSignedInToast();
  const tiles = parts(t("auth:AUTH-01.stat_tiles", { n: streak?.current ?? 0 }));
  const kid = band === "u10" || band === "10_12";
  const later = async () => {
    const rec = await s.softPrompt.later(new Date().toISOString());
    s.analytics.track("auth_prompt_dismissed", { reason, variant: "soft", via: "later", later_count: rec.laterCount });
    onClose("later");
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && void later()} title={kid ? t("learn:LRN-05.kid_title_10_12") : t(`auth:AUTH-01.title_${reason}`)} height="full" testID="auth-01">
      <div className="flex flex-col gap-4 pb-2">
        <Illustration name={pet?.species === "dog" ? "dog-wave" : "cat-plant"} width={160} height={160} className="mx-auto" />
        {kid ? (
          <Text tone="muted" align="center">
            {t("learn:LRN-05.kid_body")}
          </Text>
        ) : (
          <>
            <Text tone="muted" align="center">
              {t(`auth:AUTH-01.reason_${reason}`, { pet_name: pet?.name ?? "" })}
            </Text>
            <div className="grid grid-cols-2 gap-3">
              <StatTile value={String(streak?.current ?? 0)} label={(tiles[0] ?? "").replace(/^\d+-?/, "").trim() || tiles[0] || ""} icon="Plant" tint />
              <StatTile value={String(lessons)} label={(tiles[1] ?? "").replace(/^\d+\s?/, "").trim() || tiles[1] || ""} icon="BookBookmark" tint />
            </div>
            <GoogleStep
              reason={reason}
              onCancel={() => undefined}
              onDone={(o) => {
                signedToast(o, null);
                onClose("done");
              }}
            />
          </>
        )}
        <Button label={t("auth:AUTH-01.later")} variant="secondary" onPress={() => void later()} testID="auth-later" />
        <TrustLine />
        <Text variant="caption" tone="muted" align="center">
          {t("auth:AUTH-01.legal_footer")}
        </Text>
      </div>
    </Sheet>
  );
}
