/**
 * Guardian consent for 13 to 17 (auth flow §6.10) and the parent's side:
 * - AUTH-18 ask (`/guardian/ask`), AUTH-19 hand the phone and AUTH-20 on the same device
 *   (`/guardian/handoff`), AUTH-21 link and wait (`/guardian/link`), AUTH-23 result.
 * - AUTH-22 guardian landing and AUTH-20 on the guardian's own device (`/guardian/$code`).
 * - AUTH-24 parent sign-in and SET-14 parent dashboard with SET-17 consent rows (`/parent`).
 * The guardian signs in on a separate auth client (`createGuardianSession`); the teen's session is
 * never touched. Every rule is the server's: scopes granted, who may consent, expiry, retry dates.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@smriti/app-core/react";
import {
  Banner,
  Button,
  Card,
  Chip,
  Dialog,
  Icon,
  Illustration,
  OptionCard,
  PetLine,
  Sheet,
  Switch,
  Text,
  TopBar,
  TrustLine,
  type IconName,
} from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { GoogleIdentityStep } from "../../components/SignIn";
import {
  SCOPES,
  confirmConsent,
  createConsentRequest,
  createGuardianSession,
  declineConsent,
  guardianProblem,
  isScope,
  listLearners,
  readRequestAsGuardian,
  scopeAllowed,
  useConsentFlow,
  useMyConsent,
  useRequestStatus,
  withdrawScope,
  type ConsentDecision,
  type ConsentForGuardian,
  type GuardianProblem,
  type GuardianSession,
  type Learner,
  type Scope,
} from "../../lib/guardian";
import type { MessageKey } from "@smriti/i18n";
import { formatDate, useI18n, type T } from "../../lib/i18n";
import { useOnline } from "../../lib/network";
import { toast } from "../../lib/toast";
import { RouteLoading } from "../../shell/States";

const SCOPE_ICON: Record<Scope, IconName> = {
  account: "CloudCheck",
  social: "UsersThree",
  community: "Cards",
  voice: "SpeakerHigh",
  uploads: "CloudArrowUp",
};

/** SET-11 names for the consent rows a parent or teen sees in settings. */
const SCOPE_NAME: Record<Scope, MessageKey> = {
  account: "me_money:SET-11.account_scope",
  social: "me_money:SET-11.social",
  community: "me_money:SET-11.sharing",
  voice: "me_money:SET-11.voice",
  uploads: "me_money:SET-11.photo",
};

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** AUTH-18 `{feature}`: the first feature asked, or "saving your account" for an account-only ask. */
function useFeature() {
  const { t } = useI18n();
  return (scopes: readonly Scope[]) => {
    const f = scopes.find((x) => x !== "account");
    return f
      ? t(`auth:AUTH-18.feature_${f}` as MessageKey)
      : t("auth:AUTH-18.feature_account_gate_signin");
  };
}

/** "Expires in 3 days" / "in 14 minutes": whole units, the largest that fits. */
function durationText(ms: number, locale: "en" | "hi"): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  const [n, unit] =
    min >= 1440
      ? [Math.round(min / 1440), "day"]
      : min >= 60
        ? [Math.round(min / 60), "hour"]
        : [min, "minute"];
  return new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    style: "unit",
    unit,
    unitDisplay: "long",
  }).format(n);
}

/** Guardian-facing pages: a calm column with the logo and the "For parents and guardians" kicker. */
function GuardianFrame({
  children,
  testID,
  wide,
}: {
  children: ReactNode;
  testID: string;
  wide?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`mx-auto flex min-h-dvh w-full flex-col gap-4 px-4 py-6 ${wide ? "max-w-[640px]" : "max-w-[560px]"}`}
      data-testid={testID}
    >
      <div className="flex items-center gap-2">
        <Illustration name="logo-mark" width={24} height={24} decorative />
        <Text variant="caption" tone="muted" className="flex-1">
          {t("auth:AUTH-19.guardian_kicker")}
        </Text>
      </div>
      <main id="main" className="flex flex-col gap-4">
        {children}
      </main>
    </div>
  );
}

function problemLine(t: T, p: GuardianProblem, learner: string): string {
  switch (p) {
    case "is_learner":
      return learner
        ? t("auth:WEB-07.is_learner", { first_name: learner })
        : t("auth:WEB-07.is_learner_no_name");
    case "is_minor":
      return t("auth:WEB-07.is_minor");
    case "identity_required":
      return t("auth:WEB-07.identity_required");
    case "expired":
      return learner
        ? t("auth:WEB-07.review_expired", { first_name: learner })
        : t("auth:AUTH-22.expired_title");
    case "answered":
      return t("auth:WEB-07.review_answered");
    case "rate_limited":
      return t("auth:AUTH-30.too_many_line");
    case "offline":
      return t("auth:AUTH-30.offline_line");
    default:
      return t("auth:AUTH-30.our_side_line");
  }
}

// ---------------------------------------------------------------------------------------------
// AUTH-18 · Ask a parent or guardian
// ---------------------------------------------------------------------------------------------

export interface ConsentSearch {
  scope?: string;
  from?: string;
}

export function ConsentAsk() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as ConsentSearch;
  const scope: Scope = isScope(search.scope) ? search.scope : "social";
  const from = search.from && search.from.startsWith("/") ? search.from : "/me";
  const online = useOnline();
  const consent = useMyConsent();
  const held = useConsentFlow((x) => x.request);
  const pet = useAppStore((x) => x.pet);
  const feature = useFeature();
  const [busy, setBusy] = useState<"handoff" | "link" | null>(null);
  const [failed, setFailed] = useState(false);

  const c = consent.data;
  const allowed = scopeAllowed(c, scope);
  useEffect(() => {
    if (c && allowed) void navigate({ to: from, replace: true });
  }, [c, allowed, from, navigate]);

  if (consent.isPending && consent.fetchStatus !== "idle") return <RouteLoading />;

  const retryAt = c?.retry_at && Date.parse(c.retry_at) > Date.now() ? c.retry_at : null;
  const blocked = c?.state === "declined" && !!retryAt;
  const waiting = held && held.channel === "link" && c?.state === "pending" ? held : null;
  const disabled = !online || !!retryAt || busy !== null || s.fakeApi;

  const ask = async (channel: "handoff" | "link") => {
    if (channel === "link" && waiting) {
      void navigate({ to: "/guardian/link" });
      return;
    }
    setBusy(channel);
    setFailed(false);
    try {
      const scopes: Scope[] = [scope];
      await createConsentRequest(s, channel, scopes, locale, from);
      s.analytics.track("guardian_consent_requested", {
        channel,
        gate: "features",
        scopes: ["account", scope],
      });
      void navigate({ to: channel === "handoff" ? "/guardian/handoff" : "/guardian/link" });
    } catch (err) {
      s.logger.warn("guardian.request_failed", { code: guardianProblem(err) });
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const card = (channel: "handoff" | "link", icon: IconName, title: string, line: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void ask(channel)}
      data-testid={`consent-${channel}`}
      aria-label={`${title}. ${line}`}
      className="flex min-h-[88px] w-full items-center gap-3 rounded-card border border-line bg-surface p-4 text-start transition-transform active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none sm:w-[280px]"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-tint">
        <Icon name={icon} size={32} color="primary" />
      </span>
      <span className="flex min-w-0 flex-col">
        <Text variant="heading">{title}</Text>
        <Text tone="muted">{line}</Text>
      </span>
    </button>
  );

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col gap-4 px-4 pb-6"
      data-testid="auth-18"
    >
      <TopBar onBack={() => void navigate({ to: from })} />
      <main id="main" className="flex flex-col gap-4">
        <Text variant="title" heading as="h1">
          {t("auth:AUTH-18.title")}
        </Text>
        <Text>{t("auth:AUTH-18.body", { feature: feature([scope]) })}</Text>
        {blocked ? (
          <Banner
            tone="info"
            text={t("auth:WEB-07.blocked", {
              date: formatDate(retryAt, locale, { day: "numeric", month: "long" }),
            })}
            testID="consent-blocked"
          />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row">
              {card(
                "handoff",
                "UserCircle",
                t("auth:AUTH-18.option_1_title"),
                t("auth:AUTH-18.option_1_line"),
              )}
              {card(
                "link",
                "PaperPlaneRight",
                t("auth:AUTH-18.option_2_title"),
                waiting ? t("auth:AUTH-21.waiting") : t("auth:AUTH-18.option_2_line"),
              )}
            </div>
            {retryAt && (
              <Text tone="muted">
                {t("auth:WEB-07.declined_retry_date", {
                  date: formatDate(retryAt, locale, { day: "numeric", month: "long" }),
                })}
              </Text>
            )}
            {!online && <Text tone="muted">{t("auth:WEB-07.offline_ask")}</Text>}
            {failed && (
              <p role="alert" className="m-0 text-body text-error-text">
                {t("auth:WEB-07.ask_failed")}
              </p>
            )}
          </>
        )}
        <Text variant="caption" tone="muted">
          {t("auth:AUTH-18.guardian_note")}
        </Text>
        {pet && (
          <PetLine
            pet={{ species: pet.species === "dog" ? "dog" : "cat", mood: "happy" }}
            petName={pet.name}
            text={t("auth:AUTH-18.pet_line")}
          />
        )}
        <Button
          variant="ghost"
          label={t("auth:AUTH-18.not_now")}
          onPress={() => void navigate({ to: from })}
          testID="consent-not-now"
        />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// AUTH-20 · Review and agree (as the guardian, on either device)
// ---------------------------------------------------------------------------------------------

function ConsentReview({
  g,
  code,
  req,
  guardianName,
  method,
  onDecided,
  onNotYou,
}: {
  g: GuardianSession;
  code: string;
  req: ConsentForGuardian;
  guardianName: string;
  method: "google_same_device" | "google_own_device";
  onDecided: (d: ConsentDecision) => void;
  onNotYou: () => void;
}) {
  const s = useServices();
  const { t } = useI18n();
  const online = useOnline();
  const asked = SCOPES.filter((x) => x === "account" || req.scopes.includes(x));
  const [on, setOn] = useState<Set<Scope>>(() => new Set(asked));
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState<"agree" | "decline" | null>(null);
  const [problem, setProblem] = useState<GuardianProblem | null>(null);
  const [never, setNever] = useState(false);
  const learner = firstName(req.learner_first_name) || t("auth:WEB-07.your_child");
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const decide = async (agree: boolean) => {
    setBusy(agree ? "agree" : "decline");
    setProblem(null);
    try {
      const d = agree
        ? await confirmConsent(g, code, Array.from(on), method, __APP_VERSION__)
        : await declineConsent(g, code);
      onDecided(d);
    } catch (err) {
      const p = guardianProblem(err);
      s.logger.warn("guardian.decide_failed", { code: p });
      setProblem(p);
    } finally {
      setBusy(null);
    }
  };

  const closed = problem === "expired" || problem === "answered";
  return (
    <div className="flex flex-col gap-4" data-testid="auth-20">
      <Text variant="title" heading as="h1" id="consent-review-title">
        <span ref={titleRef} tabIndex={-1} className="outline-none">
          {t("auth:AUTH-20.title", { first_name: learner })}
        </span>
      </Text>
      <div className="flex flex-wrap items-center gap-2">
        <Text tone="muted">
          {t("auth:AUTH-20.signed_in_as", { guardian_first_name: guardianName })}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          label={t("auth:AUTH-20.not_you")}
          onPress={onNotYou}
          testID="consent-not-you"
        />
      </div>
      <ul
        className="m-0 flex list-none flex-col rounded-card bg-surface p-0 shadow-card"
        aria-labelledby="consent-review-title"
      >
        {asked.map((x) => {
          const title = t(`auth:AUTH-20.row_${x}.1` as MessageKey);
          const line = t(`auth:AUTH-20.row_${x}.2` as MessageKey);
          return (
            <li
              key={x}
              className="flex min-h-[72px] items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
              data-testid={`consent-row-${x}`}
            >
              <Icon name={SCOPE_ICON[x]} color="primary" />
              <span className="flex min-w-0 flex-1 flex-col">
                <Text variant="label">{title}</Text>
                <Text tone="muted">{line}</Text>
              </span>
              {x === "account" ? (
                <Chip kind="status" tone="primary" label={t("auth:AUTH-20.needed_chip")} />
              ) : (
                <Switch
                  checked={on.has(x)}
                  hideLabel
                  label={`${title}. ${line}`}
                  disabled={busy !== null}
                  onCheckedChange={(v) =>
                    setOn((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(x);
                      else next.delete(x);
                      return next;
                    })
                  }
                  testID={`consent-switch-${x}`}
                />
              )}
            </li>
          );
        })}
      </ul>
      <OptionCard
        kind="choice"
        multiple
        label={t("auth:AUTH-20.declaration", { first_name: learner })}
        state={declared ? "selected" : "idle"}
        onPress={() => setDeclared((v) => !v)}
        testID="consent-declaration"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          size="sm"
          label={t("auth:AUTH-20.never_link")}
          onPress={() => setNever(true)}
          testID="consent-never"
        />
      </div>
      <Text variant="caption" tone="muted">
        {t("auth:AUTH-20.change_later")}
      </Text>
      {problem && (
        <p role="alert" className="m-0 text-body text-error-text" data-testid="consent-problem">
          {problemLine(t, problem, learner)}
        </p>
      )}
      {!closed && (
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <Button
            label={t("auth:AUTH-20.agree")}
            loading={busy === "agree"}
            disabled={!declared || !online || busy !== null}
            onPress={() => void decide(true)}
            testID="consent-agree"
          />
          <Button
            variant="ghost"
            label={t("auth:AUTH-20.no_thanks")}
            loading={busy === "decline"}
            disabled={!online || busy !== null}
            onPress={() => void decide(false)}
            testID="consent-decline"
          />
        </div>
      )}
      <Sheet open={never} onOpenChange={setNever} title={t("auth:AUTH-20.never_link")} height="40">
        <Text>{t("auth:AUTH-20.never_list_sheet")}</Text>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// AUTH-23 · Result on the teen's device
// ---------------------------------------------------------------------------------------------

function ConsentResult({
  status,
  scopes,
  retryAt,
  onContinue,
  onSendNew,
}: {
  status: "granted" | "declined" | "expired";
  scopes: Scope[];
  retryAt: string | null;
  onContinue: () => void;
  onSendNew: () => void;
}) {
  const s = useServices();
  const { t, locale } = useI18n();
  const pet = useAppStore((x) => x.pet);
  const app = s.variant.appName[locale];
  const species = pet?.species === "dog" ? "dog" : "cat";
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  return (
    <div
      className="flex flex-col items-center gap-4 text-center"
      data-testid="auth-23"
      data-status={status}
    >
      <Illustration
        name={
          status === "granted"
            ? `${species}-celebrate`
            : species === "dog"
              ? "dog-wave"
              : "cat-plant"
        }
        width={200}
        height={200}
        decorative
      />
      <h1 ref={titleRef} tabIndex={-1} className="m-0 text-title outline-none">
        {status === "granted"
          ? t("auth:AUTH-23.agreed_title")
          : status === "declined"
            ? t("auth:AUTH-23.declined_title")
            : t("auth:AUTH-23.expired_title")}
      </h1>
      {status === "granted" && (
        <>
          <Text>{t("auth:AUTH-23.agreed_body")}</Text>
          <ul
            className="m-0 flex list-none flex-wrap justify-center gap-2 p-0"
            data-testid="consent-granted"
          >
            {scopes.map((x) => (
              <li key={x}>
                <Chip kind="status" tone="success" icon="CheckCircle" label={t(SCOPE_NAME[x])} />
              </li>
            ))}
          </ul>
        </>
      )}
      {status === "declined" && (
        <Text>
          {retryAt
            ? t("auth:AUTH-23.declined_body", {
                app_name: app,
                date: formatDate(retryAt, locale, { day: "numeric", month: "long" }),
              })
            : t("auth:AUTH-23.revoked_body")}
        </Text>
      )}
      {status === "expired" && <Text>{t("auth:AUTH-23.expired_body")}</Text>}
      {pet && status !== "expired" && (
        <PetLine
          pet={{ species, mood: status === "granted" ? "excited" : "curious" }}
          petName={pet.name}
          text={
            status === "granted"
              ? t("auth:AUTH-23.pet_line_agreed")
              : t("auth:AUTH-23.pet_line_declined")
          }
        />
      )}
      {status === "expired" ? (
        <div className="flex w-full flex-col gap-2">
          <Button
            label={t("auth:AUTH-23.send_new")}
            onPress={onSendNew}
            testID="consent-send-new"
          />
          <Button
            variant="ghost"
            label={t("auth:AUTH-18.not_now")}
            onPress={onContinue}
            testID="consent-result-continue"
          />
        </div>
      ) : (
        <Button
          label={t("auth:AUTH-23.continue")}
          onPress={onContinue}
          testID="consent-result-continue"
        />
      )}
    </div>
  );
}

/** Refreshes the teen's consent and profile after a decision, then leaves for the feature or the origin. */
function useFinish() {
  const s = useServices();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const hold = useConsentFlow((x) => x.hold);
  return async (from: string) => {
    hold(null);
    await qc.invalidateQueries({ queryKey: ["guardian"] });
    await s.refreshState(true);
    void navigate({ to: from, replace: true });
  };
}

// ---------------------------------------------------------------------------------------------
// AUTH-19 · Hand the phone (then AUTH-20 on this device, then AUTH-23)
// ---------------------------------------------------------------------------------------------

export function ConsentHandoff() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const held = useConsentFlow((x) => x.request);
  const teenId = useAppStore((x) => x.session.userId);
  const teenName = firstName(useAppStore((x) => x.profile?.display_name));
  const feature = useFeature();
  const finish = useFinish();
  const online = useOnline();
  const g = useMemo(() => createGuardianSession(s), [s]);
  const [phase, setPhase] = useState<"student" | "guardian" | "review" | "done" | "result">(
    "student",
  );
  const [req, setReq] = useState<ConsentForGuardian | null>(null);
  const [guardianName, setGuardianName] = useState("");
  const [decision, setDecision] = useState<ConsentDecision | null>(null);
  const [expired, setExpired] = useState(false);
  const status = useRequestStatus(phase === "result" && held ? held.id : null, false);
  const guardianTitle = useRef<HTMLHeadingElement>(null);

  // The guardian never stays signed in on the teen's phone (flow §6.10 step 5).
  useEffect(() => () => void g.signOut(), [g]);
  useEffect(() => {
    if (phase === "guardian") guardianTitle.current?.focus();
  }, [phase]);
  useEffect(() => {
    if (!held) void navigate({ to: "/guardian/ask", replace: true });
  }, [held, navigate]);
  if (!held) return null;

  const app = s.variant.appName[locale];
  const learner = firstName(req?.learner_first_name) || teenName;
  const giveBack = () => {
    void g.signOut();
    setPhase("student");
  };

  if (phase === "student")
    return (
      <div
        className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col items-center justify-center gap-6 px-4 py-6 text-center"
        data-testid="auth-19"
        data-view="student"
      >
        <main id="main" className="flex flex-col items-center gap-6">
          <Illustration name="logo-mark" width={96} height={96} decorative />
          <Text variant="title" heading as="h1" align="center">
            {t("auth:AUTH-19.student_title")}
          </Text>
          <Button
            label={t("auth:AUTH-19.student_button")}
            onPress={() => setPhase("guardian")}
            testID="handoff-they-have-it"
          />
          <Button
            variant="ghost"
            label={t("auth:AUTH-18.not_now")}
            onPress={() => void navigate({ to: held.from })}
            testID="handoff-cancel"
          />
        </main>
      </div>
    );

  if (phase === "result") {
    const st = decision?.status ?? status.data?.status;
    const result = st === "granted" ? "granted" : st === "declined" ? "declined" : "expired";
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-6">
        <main id="main">
          <ConsentResult
            status={result}
            scopes={(decision?.consent?.scopes ?? status.data?.granted_scopes ?? []) as Scope[]}
            retryAt={status.data?.retry_at ?? null}
            onContinue={() => void finish(held.from)}
            onSendNew={() =>
              void navigate({
                to: "/guardian/ask",
                search: {
                  scope: held.scopes.find((x) => x !== "account") ?? "social",
                  from: held.from,
                },
              })
            }
          />
        </main>
      </div>
    );
  }

  if (phase === "done")
    return (
      <GuardianFrame testID="auth-20-done">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-tint">
          <Icon name="CheckCircle" size={32} color="successText" />
        </span>
        <Text variant="title" heading as="h1">
          {t("auth:AUTH-20.done_give_back_same_phone", { first_name: learner })}
        </Text>
        <Button
          label={t("auth:AUTH-23.continue")}
          onPress={() => setPhase("result")}
          testID="handoff-given-back"
        />
      </GuardianFrame>
    );

  if (phase === "review" && req)
    return (
      <GuardianFrame testID="auth-19-review" wide>
        <ConsentReview
          g={g}
          code={held.code}
          req={req}
          guardianName={guardianName}
          method="google_same_device"
          onNotYou={() => {
            void g.signOut();
            setReq(null);
            setPhase("guardian");
          }}
          onDecided={(d) => {
            void g.signOut();
            setDecision(d);
            setPhase("done");
          }}
        />
      </GuardianFrame>
    );

  // Guardian view: sign in on the separate client, then read the request by its code.
  return (
    <GuardianFrame testID="auth-19">
      <div
        data-view="guardian"
        className="flex flex-col gap-4 motion-safe:animate-[sm-fade_var(--sm-duration-slow)_var(--sm-ease-standard)]"
      >
        <h1 ref={guardianTitle} tabIndex={-1} className="m-0 text-title outline-none">
          {teenName
            ? t("auth:AUTH-19.guardian_title", {
                first_name: teenName,
                feature: feature(held.scopes),
                app_name: app,
              })
            : t("auth:WEB-07.guardian_title_no_name", {
                feature: feature(held.scopes),
                app_name: app,
              })}
        </h1>
        <Text>{t("auth:AUTH-19.guardian_body")}</Text>
        <div className="flex flex-wrap gap-2 rounded-card bg-surface-sunken p-4">
          {held.scopes.map((x) => (
            <Chip key={x} kind="status" label={t(SCOPE_NAME[x])} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Icon name="LockSimple" size={20} color="inkMuted" />
          <Text tone="muted">{t("auth:AUTH-19.separate_promise")}</Text>
        </div>
        {expired ? (
          <p role="alert" className="m-0 text-body text-error-text" data-testid="handoff-expired">
            {t("auth:WEB-07.handoff_expired")}
          </p>
        ) : (
          <GoogleIdentityStep
            guardian
            disabled={!online}
            onIdentity={async (identity) => {
              const { userId } = await g.signIn(identity);
              if (userId === teenId) {
                await g.signOut();
                return problemLine(t, "is_learner", teenName);
              }
              try {
                const r = await readRequestAsGuardian(g, held.code);
                setReq(r);
                setGuardianName(firstName(identity.name));
                setPhase("review");
                return null;
              } catch (err) {
                const p = guardianProblem(err);
                await g.signOut();
                if (p === "expired") {
                  setExpired(true);
                  return null;
                }
                if (p === "server" || p === "offline") throw err;
                return problemLine(t, p, teenName);
              }
            }}
          />
        )}
        <Button
          variant="ghost"
          label={t("auth:AUTH-19.give_back")}
          onPress={giveBack}
          testID="handoff-give-back"
        />
        <TrustLine />
      </div>
    </GuardianFrame>
  );
}

// ---------------------------------------------------------------------------------------------
// AUTH-21 · Send a link and wait (then AUTH-23)
// ---------------------------------------------------------------------------------------------

export function ConsentLink() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const held = useConsentFlow((x) => x.request);
  const finish = useFinish();
  const online = useOnline();
  const pet = useAppStore((x) => x.pet);
  const status = useRequestStatus(held?.id ?? null, online ? 5000 : false);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!held) void navigate({ to: "/guardian/ask", replace: true });
  }, [held, navigate]);
  const st = status.data?.status;
  const expiredLocal = held ? Date.parse(held.expires_at) <= Date.now() : false;
  const expired =
    st === "expired" || st === "cancelled" || (expiredLocal && (!st || st === "pending"));
  useEffect(() => {
    if (expired) s.analytics.track("guardian_consent_expired", { channel: "link" });
  }, [expired, s]);
  if (!held) return null;

  const app = s.variant.appName[locale];
  const sendNew = () =>
    void navigate({
      to: "/guardian/ask",
      search: { scope: held.scopes.find((x) => x !== "account") ?? "social", from: held.from },
    });

  if (st === "granted" || st === "declined" || expired)
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-6">
        <main id="main">
          <ConsentResult
            status={st === "granted" ? "granted" : st === "declined" ? "declined" : "expired"}
            scopes={status.data?.granted_scopes ?? []}
            retryAt={status.data?.retry_at ?? null}
            onContinue={() => void finish(held.from)}
            onSendNew={sendNew}
          />
        </main>
      </div>
    );

  const message = t("auth:AUTH-21.share_message", { app_name: app, link: held.link });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(held.link);
      toast.show(t("auth:AUTH-21.copied_toast"), { icon: "Check" });
      s.analytics.track("guardian_consent_link_shared", { via: "copy" });
    } catch {
      toast.show(held.link);
    }
  };
  const share = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text: message });
        s.analytics.track("guardian_consent_link_shared", { via: "share_sheet" });
        return;
      } catch {
        // Cancelled or unavailable: fall back to copying.
      }
    }
    await copy();
  };

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col gap-4 px-4 pb-6"
      data-testid="auth-21"
    >
      <TopBar onBack={() => void navigate({ to: held.from })} />
      <main id="main" className="flex flex-col gap-4">
        <Text variant="title" heading as="h1">
          {t("auth:AUTH-21.title")}
        </Text>
        <Text>{t("auth:AUTH-21.body")}</Text>
        <Card tone="sunken">
          <p className="m-0 text-label break-all" data-testid="consent-link-url">
            {held.link}
          </p>
        </Card>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            label={t("auth:AUTH-21.share")}
            icon="PaperPlaneRight"
            onPress={() => void share()}
            testID="consent-share"
          />
          <Button
            variant="secondary"
            label={t("auth:AUTH-21.copy")}
            onPress={() => void copy()}
            testID="consent-copy"
          />
        </div>
        <div
          className="flex items-center gap-3"
          role="status"
          aria-live="polite"
          data-testid="consent-waiting"
        >
          <Icon name="Clock" color="inkMuted" />
          <span className="flex flex-col">
            <Text variant="label">
              {online ? t("auth:AUTH-21.waiting") : t("auth:WEB-07.link_offline")}
            </Text>
            <Text variant="caption" tone="muted">
              {t("auth:AUTH-21.expires", {
                duration: durationText(Date.parse(held.expires_at) - Date.now(), locale),
              })}
            </Text>
          </span>
        </div>
        {pet && (
          <PetLine
            pet={{ species: pet.species === "dog" ? "dog" : "cat", mood: "happy" }}
            petName={pet.name}
            text={t("auth:AUTH-21.pet_line")}
          />
        )}
        <Button
          variant="ghost"
          label={t("auth:AUTH-21.cancel")}
          onPress={() => {
            useConsentFlow.getState().hold(null);
            void navigate({ to: held.from });
          }}
          testID="consent-cancel"
        />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// AUTH-22 · Guardian landing on their own device (then AUTH-20)
// ---------------------------------------------------------------------------------------------

export function GuardianLanding() {
  const s = useServices();
  const { t, locale, setLocale } = useI18n();
  const { code } = useParams({ strict: false }) as { code: string };
  const online = useOnline();
  const g = useMemo(() => createGuardianSession(s), [s]);
  const [phase, setPhase] = useState<"landing" | "review" | "done" | "expired" | "answered">(
    "landing",
  );
  const [req, setReq] = useState<ConsentForGuardian | null>(null);
  const [guardianName, setGuardianName] = useState("");
  const [decision, setDecision] = useState<ConsentDecision | null>(null);
  const app = s.variant.appName[locale];
  useEffect(() => {
    s.analytics.track("auth_prompt_shown", {
      reason: "guardian_link",
      variant: "hard",
      surface: "web",
    });
  }, [s]);
  useEffect(() => () => void g.signOut(), [g]);

  const toggle = (
    <div className="flex justify-end gap-1" data-testid="guardian-language">
      <Button
        variant={locale === "hi" ? "secondary" : "ghost"}
        size="sm"
        label={t("auth:AUTH-22.language_toggle.1")}
        onPress={() => setLocale("hi")}
      />
      <Button
        variant={locale === "en" ? "secondary" : "ghost"}
        size="sm"
        label={t("auth:AUTH-22.language_toggle.2")}
        onPress={() => setLocale("en")}
      />
    </div>
  );
  const learner = firstName(req?.learner_first_name);

  if (phase === "expired" || phase === "answered")
    return (
      <GuardianFrame testID="auth-22">
        {toggle}
        <div data-state={phase} className="flex flex-col gap-3">
          <Text variant="title" heading as="h1">
            {phase === "expired" ? t("auth:AUTH-22.expired_title") : t("auth:AUTH-22.used_title")}
          </Text>
          {phase === "expired" && (
            <Text>
              {t("auth:AUTH-22.expired_body", {
                first_name: learner || t("auth:WEB-07.your_child"),
              })}
            </Text>
          )}
        </div>
      </GuardianFrame>
    );

  if (phase === "done")
    return (
      <GuardianFrame testID="auth-20-done">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-tint">
          <Icon name="CheckCircle" size={32} color="successText" />
        </span>
        <Text variant="title" heading as="h1">
          {decision?.status === "granted"
            ? t("auth:AUTH-20.done_guardian_s_own_phone", {
                first_name: learner || t("auth:WEB-07.your_child"),
              })
            : t("auth:AUTH-22.used_title")}
        </Text>
      </GuardianFrame>
    );

  if (phase === "review" && req)
    return (
      <GuardianFrame testID="auth-22-review" wide>
        <ConsentReview
          g={g}
          code={code}
          req={req}
          guardianName={guardianName}
          method="google_own_device"
          onNotYou={() => {
            void g.signOut();
            setReq(null);
            setPhase("landing");
          }}
          onDecided={(d) => {
            void g.signOut();
            setDecision(d);
            setPhase("done");
          }}
        />
      </GuardianFrame>
    );

  return (
    <GuardianFrame testID="auth-22">
      {toggle}
      <Text variant="title" heading as="h1">
        {t("auth:AUTH-22.title_no_name_yet_consent_first_variant")}
      </Text>
      <Text>{t("auth:AUTH-22.body")}</Text>
      <div className="flex gap-3 rounded-card bg-surface-sunken p-4">
        <Icon name="ShieldCheck" color="primary" />
        <span className="flex flex-col gap-1">
          <Text>{t("auth:AUTH-22.about_line_1", { app_name: app })}</Text>
          <Text>{t("auth:AUTH-22.about_line_2")}</Text>
        </span>
      </div>
      <GoogleIdentityStep
        guardian
        disabled={!online}
        onIdentity={async (identity) => {
          await g.signIn(identity);
          try {
            const r = await readRequestAsGuardian(g, code);
            setReq(r);
            setGuardianName(firstName(identity.name));
            setPhase("review");
            return null;
          } catch (err) {
            const p = guardianProblem(err);
            await g.signOut();
            if (p === "expired" || p === "not_found") {
              setPhase("expired");
              return null;
            }
            if (p === "answered") {
              setPhase("answered");
              return null;
            }
            if (p === "server" || p === "offline") throw err;
            return problemLine(t, p, "");
          }
        }}
      />
      <TrustLine />
      <Text variant="caption" tone="muted">
        {t("auth:AUTH-01.legal_footer")}
      </Text>
    </GuardianFrame>
  );
}

// ---------------------------------------------------------------------------------------------
// AUTH-24 · Parent sign-in, then SET-14 parent dashboard (SET-17 consent rows per learner)
// ---------------------------------------------------------------------------------------------

const PARENT_KEY = "parent";

export function ParentMode() {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const [stay, setStay] = useState(false);
  // A parent who stayed signed in on this browser comes straight back to the dashboard.
  const remembered = useMemo(() => createGuardianSession(s, { persist: true }), [s]);
  const [g, setG] = useState<GuardianSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState("");
  useEffect(() => {
    let live = true;
    void remembered.auth
      .getSession()
      .catch(() => null)
      .then((session) => {
        if (!live) return;
        if (session && !session.user.isAnonymous) {
          setG(remembered);
          s.analytics.track("parent_mode_opened", { entry: "device" });
        }
        setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [remembered, s]);

  const exit = async () => {
    if (g && g !== remembered) await g.signOut();
    void navigate({ to: "/" });
  };

  if (checking) return <RouteLoading />;
  if (g)
    return (
      <ParentDashboard
        g={g}
        name={name}
        onExit={() => void exit()}
        onSignOut={async () => {
          await g.signOut();
          setG(null);
        }}
      />
    );

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-4 px-4 pb-6"
      data-testid="auth-24"
    >
      <TopBar onBack={() => void navigate({ to: "/" })} />
      <main id="main" className="flex flex-col gap-4">
        <Text variant="caption" tone="muted" heading as="h2">
          {t("auth:AUTH-24.kicker")}
        </Text>
        <Text variant="title" heading as="h1">
          {t("auth:AUTH-24.title")}
        </Text>
        <Text>{t("me_money:SET-13.body")}</Text>
        <GoogleIdentityStep
          guardian
          disabled={!online}
          onIdentity={async (identity) => {
            const session = stay ? remembered : createGuardianSession(s);
            await session.signIn(identity);
            setName(firstName(identity.name));
            setG(session);
            s.analytics.track("parent_signed_in", { entry: "set_gate", stay_signed_in: stay });
            s.analytics.track("parent_mode_opened", { entry: "own_account" });
            return null;
          }}
        />
        <Switch
          checked={stay}
          onCheckedChange={setStay}
          label={t("auth:AUTH-24.stay_signed_in")}
          testID="parent-stay"
        />
        <Text variant="caption" tone="muted">
          {t("auth:AUTH-24.child_note")}
        </Text>
        <TrustLine />
        <Text variant="caption" tone="muted">
          {t("auth:AUTH-01.legal_footer")}
        </Text>
      </main>
    </div>
  );
}

function ParentDashboard({
  g,
  name,
  onExit,
  onSignOut,
}: {
  g: GuardianSession;
  name: string;
  onExit: () => void;
  onSignOut: () => Promise<void>;
}) {
  const { t } = useI18n();
  const learners = useQuery({
    queryKey: ["guardian", "learners", PARENT_KEY],
    retry: false,
    queryFn: () => listLearners(g),
  });
  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-[960px] flex-col gap-4 px-4 pb-6"
      data-testid="set-14"
    >
      <TopBar
        title={t("me_money:SET-14.title")}
        trailing={
          <Button
            variant="ghost"
            size="sm"
            label={t("me_money:SET-14.exit")}
            onPress={onExit}
            testID="parent-exit"
          />
        }
      />
      <main id="main" className="flex flex-col gap-4">
        {name && (
          <Text tone="muted">{t("auth:AUTH-20.signed_in_as", { guardian_first_name: name })}</Text>
        )}
        {learners.isPending ? (
          <RouteLoading />
        ) : learners.isError ? (
          <Banner
            tone="warning"
            text={t("auth:AUTH-30.our_side_line")}
            action={{ label: t("auth:AUTH-30.try_again"), onPress: () => void learners.refetch() }}
          />
        ) : learners.data.length === 0 ? (
          <Card tone="sunken" testID="set-14-empty">
            <Text>{t("me_money:SET-14.empty")}</Text>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {learners.data.map((l) => (
              <LearnerCard
                key={l.user_id}
                g={g}
                learner={l}
                onChanged={() => void learners.refetch()}
              />
            ))}
          </div>
        )}
        <Button
          variant="ghost"
          label={t("auth:WEB-07.parent_sign_out")}
          onPress={() => void onSignOut()}
          testID="parent-sign-out"
        />
      </main>
    </div>
  );
}

function LearnerCard({
  g,
  learner,
  onChanged,
}: {
  g: GuardianSession;
  learner: Learner;
  onChanged: () => void;
}) {
  const s = useServices();
  const { t, locale } = useI18n();
  const online = useOnline();
  const [confirm, setConfirm] = useState<Scope | null>(null);
  const [busy, setBusy] = useState(false);
  const child = firstName(learner.first_name) || t("auth:WEB-07.your_child");
  const c = learner.consent && !learner.consent.revoked_at ? learner.consent : null;
  const turnOff = async (scope: Scope) => {
    if (!c) return;
    setBusy(true);
    try {
      await withdrawScope(g, c.id, scope);
      s.analytics.track("consent_withdrawn", { consent_type: scope });
      onChanged();
    } catch (err) {
      s.logger.warn("guardian.withdraw_failed", { code: guardianProblem(err) });
      toast.show(t("auth:AUTH-30.our_side_line"), { tone: "error" });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  return (
    <Card testID={`learner-${learner.user_id}`}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Icon name="UserCircle" size={32} color="primary" />
          <Text variant="heading" heading as="h2" className="flex-1">
            {child}
          </Text>
        </div>
        <Text variant="label" heading as="h3">
          {t("me_money:SET-17.title", { child })}
        </Text>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {SCOPES.map((x) => {
            const on = !!c && c.scopes.includes(x);
            return (
              <li
                key={x}
                className="flex min-h-12 items-center gap-3"
                data-testid={`learner-scope-${x}`}
                data-on={on}
              >
                <Icon name={SCOPE_ICON[x]} color={on ? "primary" : "inkMuted"} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <Text variant="label">{t(SCOPE_NAME[x])}</Text>
                  <Text variant="caption" tone="muted">
                    {on && c
                      ? t("me_money:SET-17.status_allowed", {
                          date: formatDate(c.consented_at, locale, {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          }),
                        })
                      : t("me_money:SET-17.status_not")}
                  </Text>
                </span>
                {on && x !== "account" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    label={t("me_money:SET-17.turn_off")}
                    disabled={!online || busy}
                    onPress={() => setConfirm(x)}
                    testID={`learner-off-${x}`}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm ? t("me_money:SET-11.withdraw_title", { consent: t(SCOPE_NAME[confirm]) }) : ""
        }
        description={confirm ? t(`auth:AUTH-20.row_${confirm}.2` as MessageKey) : undefined}
        confirm={{
          label: t("me_money:SET-17.turn_off"),
          onPress: () => confirm && void turnOff(confirm),
          destructive: true,
        }}
        cancel={{ label: t("auth:AUTH-30.back"), onPress: () => setConfirm(null) }}
        testID="learner-off-confirm"
      />
    </Card>
  );
}
