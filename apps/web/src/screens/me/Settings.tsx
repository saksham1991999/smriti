/**
 * SET-01 settings with the local rows inline: account (SET-02, AUTH-12 sign out, guest erase,
 * AUTH-13 delete), Pro, language (SET-06), appearance (SET-07), daily goal (SET-10) and the
 * analytics choice (SET-11, adults only: minors are never tracked for product analytics).
 * SET-03 notifications reads and writes the server's notification prefs.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppStore } from "@smriti/app-core/react";
import {
  Banner,
  Button,
  Card,
  ChoiceChips,
  Dialog,
  Icon,
  SettingsGroup,
  SettingsRow,
  Sheet,
  Text,
  TopBar,
  TrustLine,
} from "@smriti/ui-web";
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
import { FEATURE_SCOPES, useMyConsent, type Scope } from "../../lib/guardian";
import {
  askPermission,
  hhmm,
  notificationPermission,
  useNotificationPrefs,
  usePatchPrefs,
  type NotificationPrefs,
  type NotificationPrefsPatch,
} from "../../lib/push";
import { TextField } from "../../components/Field";
import { LoadError, RouteLoading } from "../../shell/States";

const CONSENT_ROW: Record<
  Scope,
  | "me_money:SET-11.account_scope"
  | "me_money:SET-11.social"
  | "me_money:SET-11.sharing"
  | "me_money:SET-11.voice"
  | "me_money:SET-11.photo"
> = {
  account: "me_money:SET-11.account_scope",
  social: "me_money:SET-11.social",
  community: "me_money:SET-11.sharing",
  voice: "me_money:SET-11.voice",
  uploads: "me_money:SET-11.photo",
};

/** SET-11 "Your choices" for a teen: each scope's state; one that needs a guardian opens AUTH-18. */
function ConsentRows() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const consent = useMyConsent();
  const c = consent.data;
  if (!c || c.age_band === "18p" || c.state === "not_required") return null;
  return (
    <>
      <Text variant="label" className="px-4 pt-3">
        {t("me_money:SET-11.consents")}
      </Text>
      {FEATURE_SCOPES.map((scope) => {
        const on = c.state === "granted" && c.scopes.includes(scope);
        return (
          <SettingsRow
            key={scope}
            title={t(CONSENT_ROW[scope])}
            value={
              on && c.consented_at
                ? t("me_money:SET-11.status_on", { date: formatDate(c.consented_at, locale) })
                : t("me_money:SET-11.status_guardian")
            }
            trailing={on ? "none" : "caret"}
            onPress={
              on
                ? undefined
                : () =>
                    void navigate({ to: "/guardian/ask", search: { scope, from: "/me/settings" } })
            }
            testID={`set-consent-${scope}`}
          />
        );
      })}
    </>
  );
}

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
      if (r.scheduled_for)
        toast.show(t("auth:AUTH-17.title", { date: formatDate(r.scheduled_for, locale) }));
    } catch (err) {
      setDialog(null);
      if (err instanceof ApiError && err.code === "reauth_required")
        void navigate({
          to: "/login",
          search: { reason: "session_expired", next: "/me/settings" },
        });
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
              <Button
                label={t("me_money:SET-01.guest_button")}
                onPress={() => setPrompt(true)}
                testID="set-sign-in"
              />
              <TrustLine />
            </span>
          </Card>
        ) : (
          <SettingsGroup title={t("me_money:SET-02.title")}>
            <SettingsRow
              title={t("me_money:SET-01.signed_in")}
              icon="ShieldCheck"
              value={email ?? undefined}
              trailing="none"
            />
            <SettingsRow
              title={t("me_money:SET-02.sign_out")}
              icon="SignOut"
              onPress={() => setDialog("sign_out")}
              testID="set-sign-out"
            />
          </SettingsGroup>
        )}

        <SettingsGroup>
          <SettingsRow
            title={
              pro && ent?.pro_until
                ? t("me_money:SET-01.pro_row_pro", { date: formatDate(ent.pro_until, locale) })
                : t("me_money:SET-01.pro_row_free")
            }
            icon="Diamond"
            onPress={() =>
              void navigate(
                pro ? { to: "/me/plan" } : { to: "/pro", search: { source: "settings" } },
              )
            }
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
          <SettingsRow
            title={t("me_money:SET-01.notifications")}
            icon="Bell"
            onPress={() => void navigate({ to: "/me/notifications" })}
            testID="set-notifications"
          />
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
              options={(["system", "light", "dark"] as const).map((m) => ({
                value: m,
                label: t(`me_money:SET-07.${m}`),
              }))}
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
          {band === "13_17" && !guest && <ConsentRows />}
          <SettingsRow
            title={t("me_money:SET-13.title")}
            icon="ShieldCheck"
            onPress={() => void navigate({ to: "/parent" })}
            testID="set-parent"
          />
          {guest ? (
            <SettingsRow
              title={t("me_money:SET-02.guest_erase")}
              icon="Trash"
              destructive
              onPress={() => setDialog("erase")}
              testID="set-erase"
            />
          ) : (
            <SettingsRow
              title={t("me_money:SET-02.delete")}
              icon="Trash"
              destructive
              onPress={() => setDialog("delete")}
              testID="set-delete"
            />
          )}
        </SettingsGroup>

        <Text variant="caption" tone="muted" align="center">
          {t("me_money:SET-01.footer", {
            app: brand,
            version: __APP_VERSION__,
            build: "web",
            content_version: contentVersion ?? "–",
          })}
        </Text>
      </div>

      <Dialog
        open={dialog === "sign_out"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("auth:AUTH-12.title", { app_name: brand })}
        description={t("auth:AUTH-12.web_body")}
        confirm={{
          label: t("auth:AUTH-12.sign_out"),
          onPress: () => void doSignOut(),
          destructive: true,
        }}
        cancel={{ label: t("auth:AUTH-12.cancel"), onPress: () => setDialog(null) }}
        testID="auth-12"
      />
      <Dialog
        open={dialog === "erase"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("auth:AUTH-12.guest_erase_title")}
        description={t("auth:AUTH-12.guest_erase_body")}
        confirm={{
          label: t("auth:AUTH-12.guest_erase_erase"),
          onPress: () => void doErase(),
          destructive: true,
        }}
        cancel={{ label: t("auth:AUTH-12.cancel"), onPress: () => setDialog(null) }}
        testID="auth-12-erase"
      />
      <Dialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("auth:AUTH-13.title")}
        description={t("auth:AUTH-13.grace_line", {
          grace_days: s.flags.get("auth.deletion_grace_days"),
        })}
        confirm={{
          label: t("auth:AUTH-13.continue"),
          onPress: () => void doDelete(),
          destructive: true,
        }}
        cancel={{ label: t("auth:AUTH-13.keep"), onPress: () => setDialog(null) }}
        testID="auth-13"
      >
        <div className="flex flex-col gap-1">
          <Text variant="label">{t("auth:AUTH-13.deleted_heading")}</Text>
          {(
            [
              "auth:AUTH-13.row_1",
              "auth:AUTH-13.row_2",
              "auth:AUTH-13.row_3",
              "auth:AUTH-13.row_4",
              "auth:AUTH-13.row_5",
            ] as const
          ).map((k) => (
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
      {busy && (
        <span className="sr-only" aria-live="polite">
          {t("auth:AUTH-12.saving")}
        </span>
      )}
      <SoftPromptSheet open={prompt} reason="save_progress" onClose={() => setPrompt(false)} />
    </div>
  );
}

const TIMES = ["07:00", "17:00", "19:00", "21:00"] as const;

/**
 * SET-03 on `/v1/notification-prefs` (the server's rules engine reads the same rows), NTF-02 for
 * this browser's permission, and SET-05 quiet hours. Minors never see the adult-only rows the
 * server lists in `adult_only` (R34).
 */
export function NotificationSettings() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const band = useAgeBand();
  const minor = band !== "18p";
  const prefsQuery = useNotificationPrefs();
  const patch = usePatchPrefs();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(
    notificationPermission(),
  );
  const [ask, setAsk] = useState(false);
  const [quiet, setQuiet] = useState<{ start: string; end: string } | null>(null);
  const chips = parts(t("me_money:SET-04.chips"));
  const brand = s.variant.appName[locale];
  const pet = useAppStore((x) => x.pet);
  const p = prefsQuery.data;

  if (prefsQuery.isPending && prefsQuery.fetchStatus !== "idle") return <RouteLoading />;
  if (!p)
    return (
      <div className="flex flex-col gap-4 pb-6" data-testid="set-03">
        <TopBar
          title={t("me_money:SET-03.title")}
          onBack={() => void navigate({ to: "/me/settings" })}
        />
        <LoadError onRetry={() => void prefsQuery.refetch()} />
      </div>
    );

  const adultOnly = new Set(p.adult_only);
  const shown = (key: keyof NotificationPrefs) => !(minor && adultOnly.has(key));
  const set = async (body: NotificationPrefsPatch, key: string, value: string) => {
    const ok = await patch(body);
    if (ok) s.analytics.track("settings_changed", { key, value });
    else toast.show(t("learn:WEB-01.load_error"), { tone: "error" });
  };
  const row = (key: keyof NotificationPrefs & keyof NotificationPrefsPatch, title: string) =>
    shown(key) ? (
      <SettingsRow
        key={key}
        title={title}
        trailing="switch"
        checked={Boolean(p[key])}
        onCheckedChange={(on) =>
          void set({ [key]: on } as NotificationPrefsPatch, `notify.${key}`, on ? "on" : "off")
        }
        testID={`notify-${key}`}
      />
    ) : null;
  const time = p.reminder_enabled ? hhmm(p.daily_reminder_at) : null;
  const allow = async () => {
    const r = await askPermission(s, locale);
    setPerm(r.permission);
    if (r.permission === "granted") {
      setAsk(false);
      toast.show(t("me_money:NTF-03.done_toast"), { icon: "Bell" });
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-6" data-testid="set-03">
      <TopBar
        title={t("me_money:SET-03.title")}
        onBack={() => void navigate({ to: "/me/settings" })}
      />
      <div className="flex flex-col gap-4 px-4 md:px-8">
        {p.paused && (
          <Banner
            tone="info"
            text={t("me_money:SET-03.paused_note", { brand })}
            testID="notify-paused"
          />
        )}
        {perm !== "granted" && (
          <Card tone="tint" testID="notify-off">
            <span className="flex flex-col gap-2">
              <Text variant="heading">{t("me_money:SET-03.off_card", { brand })}</Text>
              <Text tone="muted">
                {perm === "denied"
                  ? t("me_money:NTF-02.denied")
                  : t("me_money:SET-03.off_card_body", { pet: pet?.name ?? "" })}
              </Text>
              {perm === "default" && (
                <Button
                  label={t("me_money:SET-03.turn_on")}
                  onPress={() => setAsk(true)}
                  testID="notify-turn-on"
                />
              )}
            </span>
          </Card>
        )}
        <SettingsGroup title={t("me_money:SET-03.daily_reminder")}>
          <div className="flex flex-col gap-2 p-4">
            <ChoiceChips
              label={t("me_money:SET-03.daily_reminder")}
              hideLabel
              options={[
                ...TIMES.map((v, i) => ({ value: v, label: chips[i] ?? v })),
                { value: "off", label: t("me_money:SET-01.off") },
              ]}
              value={[
                time && (TIMES as readonly string[]).includes(time) ? time : time ? time : "off",
              ]}
              onChange={(v) => {
                const next = v[0] && v[0] !== "off" ? v[0] : null;
                void set(
                  next
                    ? { reminder_enabled: true, daily_reminder_at: next }
                    : { reminder_enabled: false },
                  "reminder_time",
                  next ?? "off",
                );
                if (next)
                  toast.show(
                    t("me_money:SET-04.saved_toast", {
                      time: chips[TIMES.indexOf(next as (typeof TIMES)[number])] ?? next,
                    }),
                    { icon: "Bell" },
                  );
              }}
              testID="notify-time"
            />
            {minor && (
              <Text variant="caption" tone="muted">
                {t("me_money:SET-03.minor_reminder_caption")}
              </Text>
            )}
          </div>
          {row("smart_timing", t("me_money:SET-03.smart_timing"))}
          {shown("smart_timing") && (
            <Text variant="caption" tone="muted" className="px-4 pb-3">
              {t("me_money:SET-03.smart_timing_caption")}
            </Text>
          )}
        </SettingsGroup>
        {(shown("streak_saver") || shown("pet_plant_nudges")) && (
          <SettingsGroup title={t("me_money:SET-03.group_streak")}>
            {row("streak_saver", t("me_money:SET-03.streak_saver"))}
            {row("pet_plant_nudges", t("me_money:SET-03.nudges"))}
          </SettingsGroup>
        )}
        <SettingsGroup title={t("me_money:SET-03.group_learning")}>
          {minor ? (
            <Text variant="caption" tone="muted" className="p-4">
              {t("me_money:SET-03.minor_learning_caption")}
            </Text>
          ) : (
            <>
              {row("review_due", t("me_money:SET-03.reviews_due"))}
              {row("weak_area_alerts", t("me_money:SET-03.weak_area"))}
              {row("daily_challenge", t("me_money:SET-03.challenge"))}
              {row("sleep_review", t("me_money:SET-03.bedtime"))}
              {shown("sleep_review") && (
                <Text variant="caption" tone="muted" className="px-4 pb-3">
                  {t("me_money:SET-03.bedtime_caption")}
                </Text>
              )}
            </>
          )}
        </SettingsGroup>
        <SettingsGroup title={t("me_money:SET-03.group_focus")}>
          {row("focus_timer", t("me_money:SET-03.focus_row"))}
        </SettingsGroup>
        <SettingsGroup title={t("me_money:SET-03.group_friends")}>
          {row("friends", t("me_money:SET-03.friends_rows"))}
          {minor && (
            <Text variant="caption" tone="muted" className="px-4 pb-3">
              {t("me_money:SET-03.minor_friends_caption")}
            </Text>
          )}
        </SettingsGroup>
        <SettingsGroup title={t("me_money:SET-03.group_exam")}>
          {row("exam_alerts", t("me_money:SET-03.exam_row_live"))}
        </SettingsGroup>
        {shown("news") && (
          <SettingsGroup title={t("me_money:SET-03.group_news")}>
            {row("news", t("me_money:SET-03.product_news"))}
          </SettingsGroup>
        )}
        <SettingsGroup title={t("me_money:SET-03.quiet_hours")}>
          <SettingsRow
            title={t("me_money:SET-03.quiet_hours")}
            value={t("me_money:SET-03.quiet_value", {
              start: hhmm(p.quiet_start) ?? "",
              end: hhmm(p.quiet_end) ?? "",
            })}
            onPress={() =>
              setQuiet({ start: hhmm(p.quiet_start) ?? "22:00", end: hhmm(p.quiet_end) ?? "07:00" })
            }
            testID="notify-quiet"
          />
          {row("school_hours", t("me_money:SET-03.school_hours"))}
          {!minor && perm === "unsupported" && row("email_reminders", t("me_money:SET-03.email"))}
        </SettingsGroup>
        <Text variant="caption" tone="muted">
          {t("me_money:SET-03.footer")}
        </Text>
      </div>
      <Dialog
        open={ask}
        onOpenChange={setAsk}
        title={t("me_money:NTF-02.title")}
        description={t("me_money:NTF-02.body", { time: time ?? "", pet: pet?.name ?? brand })}
        confirm={{ label: t("me_money:NTF-02.allow"), onPress: () => void allow() }}
        cancel={{ label: t("me_money:NTF-02.not_now"), onPress: () => setAsk(false) }}
        testID="ntf-02"
      />
      <Sheet
        open={quiet !== null}
        onOpenChange={(o) => !o && setQuiet(null)}
        title={t("me_money:SET-05.title")}
        height="60"
        testID="set-05"
      >
        {quiet && (
          <div className="flex flex-col gap-3">
            <TextField
              label={t("me_money:SET-05.start")}
              type="time"
              value={quiet.start}
              onChange={(e) => setQuiet({ ...quiet, start: e.target.value })}
              testID="quiet-start"
            />
            <TextField
              label={t("me_money:SET-05.end")}
              type="time"
              value={quiet.end}
              onChange={(e) => setQuiet({ ...quiet, end: e.target.value })}
              testID="quiet-end"
            />
            <Text tone="muted">
              {t("me_money:SET-05.summary", { start: quiet.start, end: quiet.end })}
            </Text>
            {minor && (
              <Text variant="caption" tone="muted">
                {t("me_money:SET-05.minor_note")}
              </Text>
            )}
            <Button
              label={t("me_money:SET-05.save")}
              onPress={() => {
                void set(
                  { quiet_start: quiet.start, quiet_end: quiet.end },
                  "quiet_hours",
                  "custom",
                );
                setQuiet(null);
              }}
              testID="quiet-save"
            />
          </div>
        )}
      </Sheet>
    </div>
  );
}
