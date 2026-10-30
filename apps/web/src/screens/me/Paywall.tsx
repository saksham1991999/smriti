/**
 * PAY-01 paywall, PAY-06 review and pay, PAY-08 confirming, PAY-09 Pro is on, PAY-12 Your plan.
 * Prices come from `GET /v1/config` (tax-inclusive paise) and eligibility from the billing
 * provider; dates come from the product's period and the entitlement, never typed in.
 * `FakeBilling` (local and e2e) shows a test approve/decline step where Razorpay's frame would be.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { EntitlementSection } from "@smriti/app-core";
import { useAppStore } from "@smriti/app-core/react";
import { Button, Card, Chip, Icon, Illustration, PetLine, Sheet, Spinner, Text, TopBar, TrialTimeline, TrustLine } from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import type { CheckoutOutcome, CheckoutSession } from "../../lib/billing";
import { savedEmail } from "../../lib/auth";
import { formatDate, useI18n } from "../../lib/i18n";
import { useOnline } from "../../lib/network";
import { usePrices } from "../../lib/pricing";
import { useIntroEligibility, useIsPro } from "../../lib/pro";
import { toast } from "../../lib/toast";
import { useAgeBand } from "../../components/SignIn";
import type { PaywallSearch } from "../../router";

const DAY = 86_400_000;

/** One billing period (the product's `period: month`) from `from`. */
function addMonth(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

const useEligibility = useIntroEligibility;

/** Applies a new entitlement now (server wins on the next sync). */
function applyEntitlement(s: ReturnType<typeof useServices>, ent: EntitlementSection) {
  s.store.getState().patch("entitlement", ent);
  void s.refreshState().catch(() => undefined);
}

const PET_LINE: Record<string, "me_money:PAY-01.pet_deep_dive_lock" | "me_money:PAY-01.pet_practice_cap" | "me_money:PAY-01.pet_mock_lock"> = {
  deep_dive_preview: "me_money:PAY-01.pet_deep_dive_lock",
  deep_dive_lock: "me_money:PAY-01.pet_deep_dive_lock",
  practice_limit: "me_money:PAY-01.pet_practice_cap",
  mock_lock: "me_money:PAY-01.pet_mock_lock",
};

/** Phosphor icons for the benefit rows, in the order of `benefits` (no text in images, R7). */
const BENEFIT_ICON = ["BookBookmark", "Barbell", "Exam", "Sparkle", "DownloadSimple", "Snowflake"] as const;

export function Paywall() {
  const { source } = useSearch({ strict: false }) as PaywallSearch;
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const prices = usePrices();
  const pro = useIsPro();
  const guest = useAppStore((x) => x.session.isGuest);
  const pet = useAppStore((x) => x.pet);
  const band = useAgeBand();
  const elig = useEligibility();
  // ₹1 only when the server says so; a guest sees the server's hint until sign-in.
  const eligible = elig.data ? (elig.data.eligible ?? elig.data.eligibleHint) : false;
  const tracked = useRef(false);
  const now = new Date();
  const renew = addMonth(now);
  const reminder = new Date(renew.getTime() - s.flags.get("billing.trial_reminder_days_before") * DAY);
  const limit = s.flags.get("free.practice_questions_per_day");

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    s.analytics.track("paywall_opened", { source: source ?? "deeplink", platform: "web", intro_eligible: String(eligible), variant: "default" });
  }, [s, source, eligible]);

  const close = () => {
    s.analytics.track("paywall_dismissed", { source: source ?? "deeplink", method: "maybe_later" });
    if (window.history.length > 1) window.history.back();
    else void navigate({ to: "/learn" });
  };
  const cta = () => {
    s.analytics.track("paywall_cta_tapped", { source: source ?? "deeplink", intro_eligible: String(eligible) });
    if (guest) void navigate({ to: "/login", search: { reason: "start_trial", next: "/pro/checkout" } });
    else void navigate({ to: "/pro/checkout" });
  };

  if (pro) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col gap-4 px-4" data-testid="pay-01">
        <TopBar onBack={close} backIcon="X" />
        <main id="main" className="flex flex-col gap-4">
          <Text variant="title" heading as="h1">
            {t("me_money:PAY-09.title")}
          </Text>
          <Button label={t("me_money:PAY-12.title")} onPress={() => void navigate({ to: "/me/plan" })} />
        </main>
      </div>
    );
  }

  const petKey = (source && PET_LINE[source]) || "me_money:PAY-01.pet_general";
  const benefits = [
    "me_money:PAY-01.benefit_deep_dives",
    "me_money:PAY-01.benefit_practice",
    "me_money:PAY-01.benefit_mocks",
    "me_money:PAY-01.benefit_tutor",
    "me_money:PAY-01.benefit_offline",
    "me_money:PAY-01.benefit_freezes",
  ] as const;
  const teen = band === "13_17" || band === "10_12" || band === "u10";

  const species = pet?.species === "dog" ? "dog" : "cat";
  const brand = s.variant.appName[locale];
  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pb-72" data-testid="pay-01">
      {/* Hero band: the pet with the price tag and its line (PAY-01 illustration slot a). */}
      <div className="relative bg-warning-tint px-4 pb-4">
        <TopBar onBack={close} backIcon="X" />
        <div className="flex items-end gap-2">
          <Illustration name={species === "dog" ? "dog-celebrate" : "cat-price-tag"} width={150} height={150} decorative className="shrink-0" />
          {/* The big pet stands in for PetLine's avatar; the bubble keeps PetLine's look and live region. */}
          <p aria-live="polite" className="m-0 mb-6 max-w-[38ch] flex-1 rounded-[18px] rounded-bl-[6px] bg-surface px-3.5 py-2.5 text-label text-ink shadow-card">
            {pet && <span className="sr-only">{pet.name}: </span>}
            {t(petKey, { limit: limit ?? 0 })}
          </p>
        </div>
      </div>
      <main id="main" className="flex flex-col gap-4 px-4 pt-4">
        <div className="flex flex-col gap-1">
          <Text variant="title" heading as="h1">
            {eligible ? t("me_money:PAY-01.headline_eligible") : t("me_money:PAY-01.headline_not_eligible")}
          </Text>
          <Text tone="muted">{eligible ? t("me_money:PAY-01.sub_eligible") : t("me_money:PAY-01.sub_not_eligible")}</Text>
        </div>
        {prices ? (
          <Card className="flex flex-col gap-4 border-2 border-primary" testID="price-block">
            <div className="flex items-center gap-3">
              <Icon name="CheckCircle" color="primaryText" weight="fill" />
              <Text variant="label" className="shrink-0 font-bold whitespace-nowrap">
                {t("me_money:PAY-01.plan_name")}
              </Text>
              <Text variant="caption" tone="muted" className="flex-1 text-right tabular-nums">
                {eligible ? t("me_money:PAY-01.plan_price_eligible") : t("me_money:PAY-01.plan_price_not_eligible")}
              </Text>
            </div>
            <TrialTimeline
              eligible={eligible}
              todayLabel={formatDate(now, locale, { weekday: "short", day: "numeric", month: "short" })}
              reminderDate={formatDate(reminder, locale)}
              renewDate={formatDate(renew, locale)}
              trialPrice={prices.trial}
              renewPrice={prices.monthly}
              testID="trial-timeline"
            />
          </Card>
        ) : (
          <Text tone="muted">{t("me_money:PAY-01.price_loading")}</Text>
        )}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {benefits.map((k, i) => (
            <li key={k} className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-tint" aria-hidden>
                <Icon name={BENEFIT_ICON[i] ?? "CheckCircle"} color="primaryText" />
              </span>
              <span className="flex flex-col">
                <Text>{t(k)}</Text>
                {i === 0 && (
                  <Text variant="caption" tone="muted">
                    {t("me_money:PAY-01.caption")}
                  </Text>
                )}
              </span>
            </li>
          ))}
        </ul>
        <Text variant="caption" tone="muted">
          {t("me_money:PAY-01.everywhere", { brand })}
        </Text>
      </main>
      <footer className="fixed inset-x-0 bottom-0 border-t border-hairline bg-surface px-4 py-3">
        <div className="mx-auto flex max-w-[560px] flex-col gap-2">
          {!online && <Text variant="caption" tone="muted">{t("me_money:PAY-01.offline")}</Text>}
          <Button label={eligible ? t("me_money:PAY-01.cta_eligible") : t("me_money:PAY-01.cta_not_eligible")} onPress={cta} disabled={!online || !prices} testID="pay-cta" />
          {guest && (
            <Text variant="caption" tone="muted" align="center">
              {t("me_money:PAY-01.guest_hint_under_cta")}
            </Text>
          )}
          {teen && (
            <Text variant="caption" tone="muted" align="center">
              {t("me_money:PAY-01.teen_consent_caption")}
            </Text>
          )}
          <Button variant="ghost" label={t("me_money:PAY-01.maybe_later")} onPress={close} testID="pay-later" />
          <Text variant="caption" tone="muted" align="center">
            {eligible && prices ? `${t("me_money:PAY-01.fine_print_web", { date: formatDate(renew, locale), brand })} ` : ""}
            {t("me_money:PAY-01.gst_flagged")}
          </Text>
        </div>
      </footer>
    </div>
  );
}

export function Checkout() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const guest = useAppStore((x) => x.session.isGuest);
  const prices = usePrices();
  const elig = useEligibility();
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [phase, setPhase] = useState<"review" | "approve" | "confirming" | "pending">("review");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (guest) void navigate({ to: "/login", search: { reason: "start_trial", next: "/pro/checkout" }, replace: true });
  }, [guest, navigate]);
  if (guest || elig.isPending) return <Spinner label={t("learn:WEB-01.loading")} />;

  const eligible = elig.data?.eligible === true;
  const renew = addMonth(new Date());
  const reminder = new Date(renew.getTime() - s.flags.get("billing.trial_reminder_days_before") * DAY);
  const email = savedEmail.get();

  const start = async () => {
    setBusy(true);
    try {
      const co = await s.billing.start();
      s.analytics.track("checkout_started", { platform: "web", product_id: co.productId, intro: String(co.intro) });
      setSession(co);
      if (co.testMode) setPhase("approve");
      else await finish(co);
    } catch {
      toast.show(t("learn:WEB-01.load_error"), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const settle = (r: CheckoutOutcome) => {
    s.analytics.track("checkout_result", { platform: "web", result: r.status === "active" ? "success" : r.status === "cancelled" ? "user_cancelled" : r.status === "pending" ? "pending" : "failed", error_code: r.status === "failed" ? r.code : "none" });
    if (r.status === "active") {
      applyEntitlement(s, r.entitlement);
      void navigate({ to: "/pro/welcome", replace: true });
    } else if (r.status === "pending") {
      setPhase("pending");
    } else {
      if (r.status === "failed") toast.show(t("me_money:WEB-05.payment_failed"), { tone: "error" });
      setPhase("review");
    }
  };
  const finish = async (co: CheckoutSession, simulate: "success" | "failure" = "success") => {
    setPhase("confirming");
    settle(await s.billing.pay(co, { simulate }).catch((): CheckoutOutcome => ({ status: "failed", code: "error" })));
  };
  const checkAgain = async () => {
    setPhase("confirming");
    settle(await s.billing.checkAgain().catch((): CheckoutOutcome => ({ status: "pending" })));
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col gap-4 px-4 pb-6" data-testid="pay-06">
      <TopBar title={t("me_money:PAY-06.title")} onBack={() => void navigate({ to: "/pro" })} />
      {phase === "confirming" || phase === "pending" ? (
        <main id="main" className="flex flex-col items-center gap-4 py-8" data-testid="pay-08">
          {phase === "confirming" ? (
            <Spinner label={t("me_money:PAY-08.title")} />
          ) : (
            <Button variant="secondary" label={t("me_money:PAY-08.check_again")} onPress={() => void checkAgain()} testID="pay-08-check" />
          )}
          <Text variant="heading" heading as="h1" align="center">
            {t("me_money:PAY-08.title")}
          </Text>
          <Text tone="muted" align="center">
            {t("me_money:PAY-08.pet_line")}
          </Text>
        </main>
      ) : (
        <main id="main" className="flex flex-col gap-4">
          <Card tone="sunken">
            <span className="flex flex-col gap-2">
              <Text variant="heading">{t("me_money:PAY-06.plan")}</Text>
              {eligible ? (
                <>
                  <Text>{t("me_money:PAY-06.today")}</Text>
                  <Text tone="muted">{t("me_money:PAY-06.reminder", { reminder_date: formatDate(reminder, locale) })}</Text>
                  <Text tone="muted">{t("me_money:PAY-06.then", { date: formatDate(renew, locale) })}</Text>
                </>
              ) : (
                <Text>{t("me_money:PAY-06.today_not_eligible", { day: renew.getDate() })}</Text>
              )}
              {email && (
                <Text variant="caption" tone="muted">
                  {t("me_money:PAY-06.account", { email })}
                </Text>
              )}
            </span>
          </Card>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {(["me_money:PAY-06.autopay_1", "me_money:PAY-06.autopay_2", "me_money:PAY-06.autopay_3"] as const).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <Icon name="CheckCircle" color="success" />
                <Text>{t(k, { brand: s.variant.appName[locale] })}</Text>
              </li>
            ))}
          </ul>
          <Text variant="caption" tone="muted">
            {t("me_money:PAY-06.methods")} · {t("me_money:PAY-01.gst_flagged")}
          </Text>
          <Button label={eligible ? t("me_money:PAY-06.cta") : t("me_money:PAY-06.cta_not_eligible")} onPress={() => void start()} disabled={busy || !prices} testID="pay-06-cta" />
          <TrustLine />
        </main>
      )}
      <Sheet open={phase === "approve" && !!session} onOpenChange={(o) => !o && setPhase("review")} title={t("learn:WEB-01.fake_pay_title")} description={t("learn:WEB-01.fake_pay_body")} testID="fake-pay">
        <div className="flex flex-col gap-3 pb-2">
          <Chip kind="status" tone="warning" icon="Info" label={t("learn:WEB-01.fixture_notice")} />
          <Button label={t("learn:WEB-01.fake_pay_approve")} onPress={() => session && void finish(session, "success")} testID="fake-pay-approve" />
          <Button variant="secondary" label={t("learn:WEB-01.fake_pay_decline")} onPress={() => session && void finish(session, "failure")} testID="fake-pay-decline" />
        </div>
      </Sheet>
    </div>
  );
}

export function ProWelcome() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const ent = useAppStore((x) => x.entitlement);
  const pet = useAppStore((x) => x.pet);
  const until = ent?.pro_until ? new Date(ent.pro_until) : null;
  const reminder = until ? new Date(until.getTime() - s.flags.get("billing.trial_reminder_days_before") * DAY) : null;
  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col items-center gap-4 px-4 py-8 text-center" data-testid="pay-09">
      <main id="main" className="flex flex-col items-center gap-4">
        <Illustration name={pet?.species === "dog" ? "dog-celebrate" : "cat-celebrate"} width={240} height={240} decorative />
        <Text variant="title" heading as="h1" align="center" testID="pro-on">
          {t("me_money:PAY-09.title")}
        </Text>
        {pet && <PetLine pet={{ species: pet.species as "cat" | "dog" }} petName={pet.name} text={t("me_money:PAY-09.pet_line")} />}
        {until && (
          <Text tone="muted" align="center">
            {ent?.is_intro && reminder
              ? t("me_money:PAY-09.terms_intro", { date: formatDate(until, locale), reminder_date: formatDate(reminder, locale) })
              : t("me_money:PAY-09.terms_regular", { date: formatDate(until, locale) })}
          </Text>
        )}
        <Button label={t("me_money:PAY-09.continue")} onPress={() => void navigate({ to: "/learn", replace: true })} testID="pay-09-continue" />
        <Button variant="ghost" label={t("me_money:PAY-09.cancel_link")} onPress={() => void navigate({ to: "/me/plan" })} />
      </main>
    </div>
  );
}

export function YourPlan() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const pro = useIsPro();
  const ent = useAppStore((x) => x.entitlement);
  const [busy, setBusy] = useState(false);
  const until = ent?.pro_until ? new Date(ent.pro_until) : null;
  const cancel = async () => {
    setBusy(true);
    try {
      applyEntitlement(s, await s.billing.cancel());
    } catch {
      toast.show(t("learn:WEB-01.load_error"), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4 pb-6" data-testid="pay-12">
      <TopBar title={t("me_money:PAY-12.title")} onBack={() => void navigate({ to: "/me" })} />
      <div className="flex flex-col gap-4 px-4 md:px-8">
        {pro && until ? (
          <>
            <Card tone="tint">
              <span className="flex flex-col gap-2">
                <span className="flex items-center gap-2">
                  <Text variant="heading">{t("me_money:PAY-12.plan")}</Text>
                  <Chip kind="status" tone="success" label={t("me_money:PAY-12.active")} />
                </span>
                <Text tone="muted">
                  {ent?.cancel_at_period_end
                    ? t("me_money:PAY-12.ends", { date: formatDate(until, locale) })
                    : ent?.is_intro
                      ? t("me_money:PAY-12.intro_line", { date: formatDate(until, locale) })
                      : t("me_money:PAY-12.next_charge", { date: formatDate(until, locale) })}
                </Text>
              </span>
            </Card>
            {!ent?.cancel_at_period_end && <Button variant="destructive" label={t("me_money:PAY-12.cancel")} onPress={() => void cancel()} disabled={busy} testID="pay-12-cancel" />}
          </>
        ) : (
          <Button label={t("me_money:PAY-12.get_again")} onPress={() => void navigate({ to: "/pro", search: { source: "settings" } })} testID="pay-12-get" />
        )}
      </div>
    </div>
  );
}
