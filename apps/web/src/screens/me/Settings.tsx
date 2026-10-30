/**
 * SET-01 settings with the local rows inline: account (SET-02, AUTH-12 sign out, guest erase,
 * AUTH-13 delete), Pro, language (SET-06), appearance (SET-07), daily goal (SET-10) and the
 * analytics choice (SET-11, adults only: minors are never tracked for product analytics).
 * SET-03 notifications keeps its choices on this device and sends the reminder as a setting.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppStore } from "@smriti/app-core/react";
import { Button, Card, ChoiceChips, Dialog, Icon, SettingsGroup, SettingsRow, Text, TopBar, TrustLine } from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { SoftPromptSheet, useAgeBand } from "../../components/SignIn";
import { ApiError } from "../../lib/api";
import { useManifest } from "../../lib/content";
import { eraseGuest, requestDeletion, savedEmail, signOut } from "../../lib/auth";
import { formatDate, parts, useI18n } from "../../lib/i18n";
import { useIsPro } from "../../lib/pro";
import { useTheme, type ThemeMode } from "../../lib/theme";
import { toast } from "../../lib/toast";
import { prefs } from "../../platform/web";

const GOALS = [5, 10, 20, 30] as const;

export function Settings() {
  const s = useServices();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const guest = useAppStore((x) => x.session.isGuest);
  const profile = useAppStore((x) => x.profile);
  const pro = useIsPro();
  const ent = useAppStore((x) => x.entitlement);
  const band = useAgeBand();
  const theme = useTheme();
  const contentVersion = useManifest().data?.manifest.version;
  const [dialog, setDialog] = useState<"sign_out" | "erase" | "delete" | null>(null);
  const [prompt, setPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(prefs.get("analytics_opt_in") !== "0");
  const adult = band === "18p";
  const email = guest ? null : savedEmail.get();
  const goal = profile?.daily_goal_minutes ?? null;
  const brand = s.variant.appName[locale];
  const goalLabels = parts(t("me_money:SET-10.stops"));

  const setGoal = async (minutes: number) => {
    await s.record("settings_changed", { key: "daily_goal_minutes", value: minutes });
    s.store.getState().patch("profile", { daily_goal_minutes: minutes });
    s.analytics.track("settings_changed", { key: "daily_goal", value: String(minutes) });
  };
  const setLanguage = (l: "en" | "hi") => {
    setLocale(l);
    void s.record("settings_changed", { key: "content_locale", value: l });
  };
  const doSignOut = async () => {
    setBusy(true);
    await signOut(s).catch(() => undefined);
    setBusy(false);
    void navigate({ to: "/welcome", replace: true });
  };
  const doErase = async () => {
    setBusy(true);
    await eraseGuest(s).catch(() => undefined);
    setBusy(false);
    void navigate({ to: "/welcome", replace: true });
  };
  const doDelete = async () => {
    setBusy(true);
    try {
      const r = await requestDeletion(s);
      setDialog(null);
      if (r.scheduled_for) toast.show(t("auth:AUTH-17.title", { date: formatDate(r.scheduled_for, locale) }));
    } catch (err) {
      setDialog(null);
      if (err instanceof ApiError && err.code === "reauth_required") void navigate({ to: "/login", search: { reason: "session_expired", next: "/me/settings" } });
      else toast.show(t("learn:WEB-01.load_error"), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-6" data-testid="set-01">
      <TopBar title={t("me_money:SET-01.title")} onBack={() => void navigate({ to: "/me" })} />
      <div className="flex flex-col gap-4 px-4 md:px-8">
        {guest ? (
          <Card tone="tint" testID="set-guest-card">
            <span className="flex flex-col gap-2">
              <Text variant="heading">{t("me_money:SET-02.guest_title", { brand })}</Text>
              <Text tone="muted">{t("me_money:SET-01.guest_card")}</Text>
              <Button label={t("me_money:SET-01.guest_button")} onPress={() => setPrompt(true)} testID="set-sign-in" />
              <TrustLine />
            </span>
          </Card>
        ) : (
          <SettingsGroup title={t("me_money:SET-02.title")}>
            <SettingsRow title={t("me_money:SET-01.signed_in")} icon="ShieldCheck" value={email ?? undefined} trailing="none" />
            <SettingsRow title={t("me_money:SET-02.sign_out")} icon="SignOut" onPress={() => setDialog("sign_out")} testID="set-sign-out" />
          </SettingsGroup>
        )}

        <SettingsGroup>
          <SettingsRow
            title={pro && ent?.pro_until ? t("me_money:SET-01.pro_row_pro", { date: formatDate(ent.pro_until, locale) }) : t("me_money:SET-01.pro_row_free")}
            icon="Diamond"
            onPress={() => void navigate(pro ? { to: "/me/plan" } : { to: "/pro", search: { source: "settings" } })}
            testID="set-pro"
          />
        </SettingsGroup>

        <SettingsGroup title={t("me_money:SET-01.group_learning")}>
          <div className="flex flex-col gap-2 p-4">
            <Text variant="label">{t("me_money:SET-10.daily_goal")}</Text>
            <ChoiceChips
              label={t("me_money:SET-10.daily_goal")}
              hideLabel
              options={GOALS.map((g, i) => ({ value: String(g), label: goalLabels[i] ?? `${g}` }))}
              value={goal ? [String(goal)] : []}
              onChange={(v) => v[0] && void setGoal(Number(v[0]))}
              testID="set-goal"
            />
            <Text variant="caption" tone="muted">
              {t("me_money:SET-10.caption")}
            </Text>
          </div>
        </SettingsGroup>

        <SettingsGroup title={t("me_money:SET-01.group_app")}>
          <SettingsRow title={t("me_money:SET-01.notifications")} icon="Bell" onPress={() => void navigate({ to: "/me/notifications" })} testID="set-notifications" />
          <div className="flex flex-col gap-2 p-4">
            <Text variant="label">{t("me_money:SET-06.app_language")}</Text>
            <ChoiceChips
              label={t("me_money:SET-06.app_language")}
              hideLabel
              options={[
                { value: "en", label: "English" },
                { value: "hi", label: "हिन्दी" },
              ]}
              value={[locale]}
              onChange={(v) => (v[0] === "en" || v[0] === "hi") && setLanguage(v[0])}
              testID="set-language"
            />
          </div>
          <div className="flex flex-col gap-2 p-4">
            <Text variant="label">{t("me_money:SET-07.title")}</Text>
            <ChoiceChips
              label={t("me_money:SET-07.title")}
              hideLabel
              options={(["system", "light", "dark"] as const).map((m) => ({ value: m, label: t(`me_money:SET-07.${m}`) }))}
              value={[theme.mode]}
              onChange={(v) => v[0] && theme.setMode(v[0] as ThemeMode)}
              testID="set-theme"
            />
          </div>
        </SettingsGroup>

        <SettingsGroup title={t("me_money:SET-01.group_privacy")}>
          {adult && (
            <SettingsRow
              title={t("me_money:SET-11.analytics", { brand })}
              icon="TrendUp"
              trailing="switch"
              checked={analyticsOn}
              onCheckedChange={(on) => {
                prefs.set("analytics_opt_in", on ? "1" : "0");
                if (!on) s.analytics.clear();
                setAnalyticsOn(on);
              }}
              testID="set-analytics"
            />
          )}
          {adult && (
            <Text variant="caption" tone="muted" className="px-4 pb-3">
              {t("me_money:SET-11.analytics_caption")}
            </Text>
          )}
          {guest ? (
            <SettingsRow title={t("me_money:SET-02.guest_erase")} icon="Trash" destructive onPress={() => setDialog("erase")} testID="set-erase" />
          ) : (
            <SettingsRow title={t("me_money:SET-02.delete")} icon="Trash" destructive onPress={() => setDialog("delete")} testID="set-delete" />
          )}
        </SettingsGroup>

        <Text variant="caption" tone="muted" align="center">
          {t("me_money:SET-01.footer", { app: brand, version: __APP_VERSION__, build: "web", content_version: contentVersion ?? "–" })}
        </Text>
      </div>

      <Dialog
        open={dialog === "sign_out"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("auth:AUTH-12.title", { app_name: brand })}
        description={t("auth:AUTH-12.web_body")}
        confirm={{ label: t("auth:AUTH-12.sign_out"), onPress: () => void doSignOut(), destructive: true }}
        cancel={{ label: t("auth:AUTH-12.cancel"), onPress: () => setDialog(null) }}
        testID="auth-12"
      />
      <Dialog
        open={dialog === "erase"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("auth:AUTH-12.guest_erase_title")}
        description={t("auth:AUTH-12.guest_erase_body")}
        confirm={{ label: t("auth:AUTH-12.guest_erase_erase"), onPress: () => void doErase(), destructive: true }}
        cancel={{ label: t("auth:AUTH-12.cancel"), onPress: () => setDialog(null) }}
        testID="auth-12-erase"
      />
      <Dialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("auth:AUTH-13.title")}
        description={t("auth:AUTH-13.grace_line", { grace_days: s.flags.get("auth.deletion_grace_days") })}
        confirm={{ label: t("auth:AUTH-13.continue"), onPress: () => void doDelete(), destructive: true }}
        cancel={{ label: t("auth:AUTH-13.keep"), onPress: () => setDialog(null) }}
        testID="auth-13"
      >
        <div className="flex flex-col gap-1">
          <Text variant="label">{t("auth:AUTH-13.deleted_heading")}</Text>
          {(["auth:AUTH-13.row_1", "auth:AUTH-13.row_2", "auth:AUTH-13.row_3", "auth:AUTH-13.row_4", "auth:AUTH-13.row_5"] as const).map((k) => (
            <span key={k} className="flex items-center gap-2">
              <Icon name="Trash" size={16} color="inkMuted" />
              <Text variant="caption">{t(k)}</Text>
            </span>
          ))}
          <Text variant="label">{t("auth:AUTH-13.kept_heading")}</Text>
          <Text variant="caption" tone="muted">
            {t("auth:AUTH-13.kept_row")}
          </Text>
        </div>
      </Dialog>
      {busy && <span className="sr-only" aria-live="polite">{t("auth:AUTH-12.saving")}</span>}
      <SoftPromptSheet open={prompt} reason="save_progress" onClose={() => setPrompt(false)} />
    </div>
  );
}

const TIMES = ["07:00", "17:00", "19:00", "21:00"] as const;

export function NotificationSettings() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const band = useAgeBand();
  const minor = band !== "18p";
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [time, setTime] = useState<string | null>(prefs.get("reminder_time"));
  const [rows, setRows] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(prefs.get("notify_rows") ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const chips = parts(t("me_money:SET-04.chips"));
  const brand = s.variant.appName[locale];
  const pet = useAppStore((x) => x.pet);

  const ask = async () => {
    if (typeof Notification === "undefined") return;
    setPerm(await Notification.requestPermission());
  };
  const pick = (v: string | null) => {
    setTime(v);
    prefs.set("reminder_time", v);
    void s.record("settings_changed", { key: "reminder_time", value: v });
  };
  const toggle = (key: string, on: boolean) => {
    const next = { ...rows, [key]: on };
    setRows(next);
    prefs.set("notify_rows", JSON.stringify(next));
    void s.record("settings_changed", { key: `notify.${key}`, value: on });
  };
  const row = (key: string, title: string) => (
    <SettingsRow key={key} title={title} trailing="switch" checked={rows[key] ?? true} onCheckedChange={(on) => toggle(key, on)} testID={`notify-${key}`} />
  );

  return (
    <div className="flex flex-col gap-4 pb-6" data-testid="set-03">
      <TopBar title={t("me_money:SET-03.title")} onBack={() => void navigate({ to: "/me/settings" })} />
      <div className="flex flex-col gap-4 px-4 md:px-8">
        {perm !== "granted" && (
          <Card tone="tint" testID="notify-off">
            <span className="flex flex-col gap-2">
              <Text variant="heading">{t("me_money:SET-03.off_card", { brand })}</Text>
              <Text tone="muted">{t("me_money:SET-03.off_card_body", { pet: pet?.name ?? "" })}</Text>
              {perm === "default" && <Button label={t("me_money:SET-03.turn_on")} onPress={() => void ask()} testID="notify-turn-on" />}
            </span>
          </Card>
        )}
        <SettingsGroup title={t("me_money:SET-03.daily_reminder")}>
          <div className="flex flex-col gap-2 p-4">
            <ChoiceChips
              label={t("me_money:SET-03.daily_reminder")}
              hideLabel
              options={[...TIMES.map((v, i) => ({ value: v, label: chips[i] ?? v })), { value: "off", label: t("me_money:SET-01.off") }]}
              value={[time ?? "off"]}
              onChange={(v) => pick(v[0] && v[0] !== "off" ? v[0] : null)}
              testID="notify-time"
            />
            {minor && (
              <Text variant="caption" tone="muted">
                {t("me_money:SET-03.minor_reminder_caption")}
              </Text>
            )}
          </div>
        </SettingsGroup>
        <SettingsGroup title={t("me_money:SET-03.group_streak")}>
          {row("streak_saver", t("me_money:SET-03.streak_saver"))}
          {row("nudges", t("me_money:SET-03.nudges"))}
        </SettingsGroup>
        <SettingsGroup title={t("me_money:SET-03.group_learning")}>
          {minor ? (
            <Text variant="caption" tone="muted" className="p-4">
              {t("me_money:SET-03.minor_learning_caption")}
            </Text>
          ) : (
            <>
              {row("reviews_due", t("me_money:SET-03.reviews_due"))}
              {row("weak_area", t("me_money:SET-03.weak_area"))}
              {row("challenge", t("me_money:SET-03.challenge"))}
            </>
          )}
        </SettingsGroup>
        <Text variant="caption" tone="muted">
          {t("me_money:SET-03.footer")}
        </Text>
      </div>
    </div>
  );
}
