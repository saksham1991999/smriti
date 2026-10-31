/**
 * Phase 3 parent mode on the web: SET-13 (the gate: parent mode needs the parent's own signed-in
 * account), SET-14 (dashboard with "Needs you" and a card per child), SET-15 (weekly report),
 * SET-16 (time limits and the per-child switches) and SET-17 (consents and the child's friends).
 * Everything here reads `/v1/guardian/*`; nothing about the child is kept on this device.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@smriti/api-client";
import { useAppStore } from "@smriti/app-core/react";
import { Banner, Button, Chip, ChoiceChips, Dialog, EmptyState, Icon, IconButton, Illustration, PetLine, SettingsGroup, SettingsRow, StatTile, Switch, cx, useUI } from "@smriti/ui-web";
import { useServices } from "../../../boot/context";
import { useI18n } from "../../../lib/i18n";
import { useOnline } from "../../../lib/network";
import { toast } from "../../../lib/toast";
import { LoadError, RouteLoading } from "../../../shell/States";
import { errorCode } from "../shared/errors";
import { useClose } from "../shared/nav";
import { Page, PageColumns, SectionTitle } from "../shared/Page";
import { LIMITS, barHeights, busiestDay, canGoNext, changes, consentRows, friendName, hoursValid, isLittle, needs, parseDay, shiftWeek, toControls, toForm, weekStart, type ChildCard, type ControlsForm, type Scope } from "./logic";

const keys = {
  dashboard: ["parent", "dashboard"] as const,
  learners: ["parent", "learners"] as const,
  report: (id: string, week: string) => ["parent", id, "report", week] as const,
  controls: (id: string) => ["parent", id, "controls"] as const,
  friends: (id: string) => ["parent", id, "friends"] as const,
};

function useDashboard() {
  const s = useServices();
  return useQuery({ queryKey: keys.dashboard, queryFn: () => unwrap(s.client.GET("/v1/guardian/dashboard"), s.client), retry: (n, e) => errorCode(e) !== "login_required" && n < 2 });
}

function useChildName() {
  const { t } = useI18n();
  return (c: { first_name: string | null } | null | undefined) => c?.first_name ?? t("me_money:SET-14.your_child");
}

function useFormat() {
  const { locale } = useI18n();
  const tag = locale === "hi" ? "hi-IN" : "en-IN";
  return useMemo(
    () => ({
      day: (d: string) => new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" }).format(parseDay(d)),
      weekday: (d: string) => new Intl.DateTimeFormat(tag, { weekday: "short" }).format(parseDay(d)),
      weekdayLong: (d: string) => new Intl.DateTimeFormat(tag, { weekday: "long" }).format(parseDay(d)),
      date: (iso: string) => new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)),
      when: (iso: string) => new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)),
    }),
    [tag],
  );
}

/** A child's pet portrait, or a plain icon when the child has no pet yet. */
function PetPortrait({ pet, size = 56 }: { pet: ChildCard["pet"]; size?: number }) {
  const species = pet?.species === "cat" || pet?.species === "dog" ? pet.species : null;
  return species ? <Illustration name={`${species}-base`} decorative width={size} height={size} className="shrink-0 rounded-full bg-primary-tint" /> : <Icon name="UserCircle" size={32} className="shrink-0 text-ink-muted" />;
}

/** The learner pages share the dashboard query for the child's name and pet. */
function useChild(learnerId: string) {
  const dash = useDashboard();
  return { dash, child: dash.data?.learners.find((c) => c.user_id === learnerId) ?? null };
}

function NotLinked() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <Page title={t("me_money:SET-14.title")} onBack={() => void navigate({ to: "/parent" })} testID="set-14-not-linked">
      <EmptyState illustration="ui-search-empty" text={t("me_money:SET-14.not_linked")} action={{ label: t("me_money:SET-14.back_parent"), onPress: () => void navigate({ to: "/parent" }) }} />
    </Page>
  );
}

// ── SET-13 and SET-14 ───────────────────────────────────────────────────────

export function ParentHome() {
  const s = useServices();
  const dash = useDashboard();
  const opened = useRef(false);
  useEffect(() => {
    if (dash.data && !opened.current) {
      opened.current = true;
      s.analytics.track("parent_mode_opened", { entry: "own_account" });
    }
  }, [dash.data, s]);
  if (dash.isPending) return <RouteLoading />;
  if (dash.isError) return errorCode(dash.error) === "login_required" ? <Gate /> : <LoadError onRetry={() => void dash.refetch()} />;
  return <Dashboard cards={dash.data.learners} />;
}

function Gate() {
  const { t } = useI18n();
  const { altFor } = useUI();
  const navigate = useNavigate();
  const online = useOnline();
  const pet = useAppStore((x) => x.pet);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-4 py-8 min-[600px]:bg-bg" data-testid="set-13">
      <main id="main" className="flex w-full max-w-[560px] flex-col gap-4 min-[600px]:rounded-card-large min-[600px]:bg-surface min-[600px]:p-8 min-[600px]:shadow-card">
        <div className="overflow-hidden rounded-card-large bg-primary-tint">
          <Illustration name="scene-grown-up-first" alt={altFor("scene-grown-up-first")} fit="cover" className="aspect-[3/2] w-full" />
        </div>
        <h1 className="m-0 text-display">{t("me_money:SET-13.title")}</h1>
        <p className="m-0 text-body text-ink">{t("me_money:SET-13.body")}</p>
        {!online && <Banner tone="offline" icon="WifiSlash" text={t("me_money:SET-14.offline")} />}
        <Button label={t("me_money:SET-13.continue_google")} disabled={!online} onPress={() => void navigate({ to: "/login", search: { next: "/parent" } })} testID="set-13-google" />
        <p className="m-0 text-center text-caption text-ink-muted">{t("me_money:SET-13.trust_line_r40")}</p>
        <Button label={pet?.name ? t("me_money:SET-13.back", { pet: pet.name }) : t("me_money:SET-14.exit")} variant="ghost" onPress={() => void navigate({ to: "/learn" })} testID="set-13-back" />
      </main>
    </div>
  );
}

function Dashboard({ cards }: { cards: ChildCard[] }) {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const nameOf = useChildName();
  const queryClient = useQueryClient();
  const waiting = needs(cards);
  const decide = useMutation({
    mutationFn: ({ requestId, allow }: { requestId: string; allow: boolean; child: string }) =>
      unwrap(s.client.POST("/v1/guardian/time-requests/{request_id}/decision", { params: { path: { request_id: requestId } }, body: { allow } }), s.client),
    onSuccess: (_r, v) => {
      s.analytics.track("time_request_decided", { decision: v.allow ? "allowed" : "declined" });
      toast.show(v.allow ? t("me_money:SET-14.allowed_toast", { child: v.child }) : t("me_money:SET-14.declined_toast", { child: v.child }));
      void queryClient.invalidateQueries({ queryKey: keys.dashboard });
    },
    onError: () => toast.show(t("me_money:SET-14.decision_failed")),
  });

  return (
    <Page title={t("me_money:SET-14.title")} width="lg" trailing={<Button label={t("me_money:SET-14.exit")} variant="ghost" size="sm" icon="SignOut" onPress={() => void navigate({ to: "/learn" })} testID="set-14-exit" />} testID="set-14">
      <h1 className="sr-only">{t("me_money:SET-14.title")}</h1>
      {!online && <Banner tone="offline" icon="WifiSlash" text={t("me_money:SET-14.offline")} testID="set-14-offline" />}
      {waiting.length > 0 && (
        <section className="flex flex-col gap-3 rounded-card bg-primary-tint p-4" aria-labelledby="set-14-needs" data-testid="set-14-needs">
          <h2 id="set-14-needs" className="m-0 text-heading">
            {t("me_money:SET-14.needs_you")}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-live="polite">
            {waiting.map((n) => {
              const child = nameOf(n.child);
              return (
                <li key={n.kind === "time" ? n.requestId : `consent-${n.child.user_id}`} className="flex flex-col gap-2 rounded-card bg-surface p-3 min-[600px]:flex-row min-[600px]:items-center">
                  <span className="flex flex-1 items-center gap-2 text-body text-ink">
                    <Icon name={n.kind === "time" ? "Timer" : "UsersThree"} size={24} className="text-primary-text" />
                    {n.kind === "time" ? t("me_money:SET-14.time_request", { child }) : t("me_money:SET-14.consent_request", { child })}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {n.kind === "time" ? (
                      <>
                        <Button label={t("me_money:SET-14.allow")} size="sm" disabled={!online || decide.isPending} onPress={() => decide.mutate({ requestId: n.requestId, allow: true, child })} testID={`set-14-allow-${n.child.user_id}`} />
                        <Button label={t("me_money:SET-14.not_today")} size="sm" variant="secondary" disabled={!online || decide.isPending} onPress={() => decide.mutate({ requestId: n.requestId, allow: false, child })} testID={`set-14-decline-${n.child.user_id}`} />
                      </>
                    ) : (
                      <Button label={t("me_money:SET-14.review")} size="sm" variant="secondary" onPress={() => void navigate({ to: "/parent/$learnerId/consents", params: { learnerId: n.child.user_id } })} testID={`set-14-review-${n.child.user_id}`} />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {cards.length === 0 ? (
        <EmptyState illustration="scene-guardian-consent" text={t("me_money:SET-14.empty")} testID="set-14-empty" />
      ) : (
        <ul className={cx("m-0 grid list-none gap-4 p-0", cards.length > 1 && "min-[600px]:grid-cols-2")} data-testid="set-14-children">
          {cards.map((c) => (
            <ChildCardView key={c.user_id} card={c} />
          ))}
        </ul>
      )}
    </Page>
  );
}

function ChildCardView({ card }: { card: ChildCard }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const nameOf = useChildName();
  const name = nameOf(card);
  const go = (to: "/parent/$learnerId/report" | "/parent/$learnerId/limits" | "/parent/$learnerId/consents") => void navigate({ to, params: { learnerId: card.user_id } });
  const score = card.last_mock?.score;
  return (
    <li className="flex flex-col gap-4 rounded-card-large bg-surface p-4 shadow-card" aria-labelledby={`child-${card.user_id}`} data-testid={`set-14-child-${card.user_id}`}>
      <div className="flex items-center gap-3">
        <PetPortrait pet={card.pet} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={`child-${card.user_id}`} className="m-0 truncate text-heading">
            {name}
          </h2>
          <span className="text-caption text-ink-muted">{t("me_money:SET-14.streak", { n: card.streak })}</span>
        </div>
        {card.is_pro && <Chip kind="status" tone="primary" label={t("me_money:SET-14.pro")} />}
      </div>
      <p className="m-0 text-title font-bold text-ink tabular-nums">{t("me_money:SET-14.minutes", { n: card.week_minutes })}</p>
      <p className="m-0 text-body text-ink-muted tabular-nums">
        {score !== null && score !== undefined ? t("me_money:SET-14.practice_line", { q: card.practice_questions, score }) : t("me_money:SET-14.practice_line.1", { q: card.practice_questions })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button label={t("me_money:SET-14.weekly_report")} size="sm" icon="TrendUp" onPress={() => go("/parent/$learnerId/report")} testID={`set-14-report-${card.user_id}`} />
        <Button label={t("me_money:SET-14.time_limits")} size="sm" variant="secondary" icon="Timer" onPress={() => go("/parent/$learnerId/limits")} testID={`set-14-limits-${card.user_id}`} />
        <Button label={t("me_money:SET-14.consents")} size="sm" variant="secondary" icon="ShieldCheck" onPress={() => go("/parent/$learnerId/consents")} testID={`set-14-consents-${card.user_id}`} />
      </div>
    </li>
  );
}

// ── SET-15 weekly report ────────────────────────────────────────────────────

export function WeekReport() {
  const { learnerId } = useParams({ from: "/parent/$learnerId/report" });
  const search = useSearch({ from: "/parent/$learnerId/report" });
  const s = useServices();
  const { t, locale } = useI18n();
  const f = useFormat();
  const navigate = useNavigate();
  const close = useClose("/parent");
  const nameOf = useChildName();
  const { dash, child } = useChild(learnerId);
  const week = search.week ?? weekStart(new Date());
  const report = useQuery({ queryKey: keys.report(learnerId, week), queryFn: () => unwrap(s.client.GET("/v1/guardian/learners/{learner_id}/report", { params: { path: { learner_id: learnerId }, query: { week } } }), s.client) });
  const [table, setTable] = useState(false);

  if (report.isPending || dash.isPending) return <RouteLoading />;
  if (report.isError) return errorCode(report.error) === "learner_not_found" ? <NotLinked /> : <LoadError onRetry={() => void report.refetch()} />;
  const r = report.data;
  const name = nameOf(child ?? r);
  const setWeek = (w: string) => void navigate({ to: "/parent/$learnerId/report", params: { learnerId }, search: { week: w }, replace: true });
  const best = busiestDay(r.days);
  const heights = barHeights(r.days);
  const quiet = r.minutes === 0;
  const pet = child?.pet;
  const species = pet?.species === "cat" || pet?.species === "dog" ? pet.species : null;

  const chart = (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" aria-labelledby="set-15-per-day" data-testid="set-15-chart">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle id="set-15-per-day">{t("me_money:SET-15.per_day")}</SectionTitle>
        <Button label={table ? t("me_money:SET-15.show_chart") : t("me_money:SET-15.show_table")} variant="ghost" size="sm" onPress={() => setTable((v) => !v)} testID="set-15-table-toggle" />
      </div>
      <p className="m-0 text-caption text-ink-muted" data-testid="set-15-summary">
        {best ? t("me_money:SET-15.chart_summary", { day: f.weekdayLong(best.day), n: best.minutes }) : t("me_money:SET-15.quiet_chart")}
      </p>
      {table ? (
        <table className="w-full border-collapse text-body" data-testid="set-15-table">
          <thead>
            <tr className="text-caption text-ink-muted">
              <th scope="col" className="py-2 text-start font-bold">{t("me_money:SET-15.day_col")}</th>
              <th scope="col" className="py-2 text-end font-bold">{t("me_money:SET-15.minutes")}</th>
            </tr>
          </thead>
          <tbody>
            {r.days.map((d) => (
              <tr key={d.day} className="border-t border-hairline">
                <th scope="row" className="py-2 text-start font-normal">{f.weekdayLong(d.day)}</th>
                <td className="py-2 text-end tabular-nums">{d.minutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ol className="m-0 grid h-40 list-none grid-cols-7 items-end gap-2 p-0" aria-hidden="true">
          {r.days.map((d, i) => (
            <li key={d.day} className="flex h-full flex-col items-center justify-end gap-1">
              <span className="text-caption text-ink-muted tabular-nums">{d.minutes || ""}</span>
              <span className="w-full max-w-8 rounded-t-sm bg-primary" style={{ height: `${Math.max(heights[i] ?? 0, d.minutes ? 4 : 1)}%` }} />
              <span className="text-caption text-ink-muted">{f.weekday(d.day)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  const subjects = (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" aria-labelledby="set-15-subjects" data-testid="set-15-subjects">
      <SectionTitle id="set-15-subjects">{t("me_money:SET-15.subjects")}</SectionTitle>
      {r.subjects.length === 0 ? (
        <p className="m-0 text-body text-ink-muted">{t("me_money:SET-15.quiet_chart")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {r.subjects.map((sub) => (
            <li key={sub.subject_id} className="flex gap-3" data-subject={sub.color_token}>
              <span className="mt-1 h-4 w-1.5 shrink-0 rounded-full bg-subject" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span className="text-label font-bold text-ink">{sub.name[locale] ?? sub.name.en}</span>
                <span className="text-caption text-ink-muted">{sub.topics.map((tp) => tp[locale] ?? tp.en).join(" · ")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <Page title={t("me_money:SET-15.title", { child: name })} onBack={close} width="lg" testID="set-15">
      <h1 className="sr-only">{t("me_money:SET-15.title", { child: name })}</h1>
      <div className="flex items-center justify-between gap-2" data-testid="set-15-week">
        <IconButton label={t("me_money:SET-15.previous_week")} icon="CaretLeft" onPress={() => setWeek(shiftWeek(week, -1))} testID="set-15-prev" />
        <span className="text-label font-bold text-ink tabular-nums">
          {f.day(r.week_start)} – {f.day(r.week_end)}
        </span>
        <IconButton label={t("me_money:SET-15.next_week")} icon="CaretRight" disabled={!canGoNext(week, new Date())} onPress={() => setWeek(shiftWeek(week, 1))} testID="set-15-next" />
      </div>
      <div className="grid grid-cols-2 gap-3 min-[600px]:grid-cols-4" data-testid="set-15-tiles">
        <StatTile value={String(r.minutes)} label={t("me_money:SET-15.minutes")} icon="Timer" />
        <StatTile value={String(r.lessons)} label={t("me_money:SET-15.lessons")} icon="BookBookmark" />
        <StatTile value={String(r.reviews)} label={t("me_money:SET-15.reviews")} icon="Cards" />
        <StatTile value={String(r.streak)} label={t("me_money:SET-15.streak")} icon="Lightning" />
      </div>
      {species && pet && <PetLine pet={{ species, mood: quiet ? "sleepy" : "happy" }} petName={pet.name} text={quiet ? t("me_money:SET-15.pet_line_quiet") : t("me_money:SET-15.pet_line_good")} live={false} testID="set-15-pet" />}
      <PageColumns left={chart} right={subjects} />
      {r.mocks.length > 0 && (
        <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" aria-labelledby="set-15-mocks" data-testid="set-15-mocks">
          <SectionTitle id="set-15-mocks">{t("me_money:SET-15.mocks")}</SectionTitle>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {r.mocks.map((m) => (
              <li key={m.attempt_id} className="flex items-center justify-between gap-3 text-body text-ink tabular-nums">
                <span>{m.submitted_at ? f.date(m.submitted_at) : ""}</span>
                <span className="flex gap-3">
                  {m.score !== null && <span>{m.max_score !== null ? t("me_money:SET-15.mock_score", { score: m.score, max: m.max_score }) : m.score}</span>}
                  {m.percentile !== null && <span className="text-ink-muted">{t("me_money:SET-15.mock_percentile", { p: m.percentile })}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.coming_up.length > 0 && (
        <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" aria-labelledby="set-15-coming" data-testid="set-15-coming">
          <SectionTitle id="set-15-coming">{t("me_money:SET-15.coming_up")}</SectionTitle>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {r.coming_up.slice(0, 3).map((c) => (
              <li key={c.mock_id} className="flex items-center justify-between gap-3 text-body text-ink">
                <span className="flex items-center gap-2">
                  <Icon name="CalendarCheck" size={20} className="text-primary-text" />
                  {c.title[locale] ?? c.title.en}
                </span>
                <span className="text-caption text-ink-muted tabular-nums">{f.when(c.starts_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="m-0 flex items-center gap-2 text-caption text-ink-muted">
        <Icon name="LockSimple" size={16} />
        {t("me_money:SET-15.privacy_line", { child: name })}
      </p>
    </Page>
  );
}

// ── SET-16 time limits ──────────────────────────────────────────────────────

export function TimeLimits() {
  const { learnerId } = useParams({ from: "/parent/$learnerId/limits" });
  const s = useServices();
  const controls = useQuery({ queryKey: keys.controls(learnerId), queryFn: () => unwrap(s.client.GET("/v1/guardian/learners/{learner_id}/controls", { params: { path: { learner_id: learnerId } } }), s.client) });
  const { dash, child } = useChild(learnerId);
  if (controls.isPending || dash.isPending) return <RouteLoading />;
  if (controls.isError) return errorCode(controls.error) === "learner_not_found" ? <NotLinked /> : <LoadError onRetry={() => void controls.refetch()} />;
  return <LimitsForm learnerId={learnerId} base={controls.data} child={child} />;
}

function LimitsForm({ learnerId, base, child }: { learnerId: string; base: Schemas["ControlsOut"]; child: ChildCard | null }) {
  const s = useServices();
  const { t } = useI18n();
  const close = useClose("/parent");
  const online = useOnline();
  const nameOf = useChildName();
  const queryClient = useQueryClient();
  const name = nameOf(child);
  const initial = useMemo(() => toForm(base), [base]);
  const [form, setForm] = useState<ControlsForm>(initial);
  const set = <K extends keyof ControlsForm>(k: K, v: ControlsForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valid = hoursValid(form);
  const save = useMutation({
    mutationFn: () => unwrap(s.client.PUT("/v1/guardian/learners/{learner_id}/controls", { params: { path: { learner_id: learnerId } }, body: toControls(form, base) }), s.client),
    onSuccess: (out) => {
      for (const c of changes(initial, form)) s.analytics.track("parent_limit_changed", c);
      queryClient.setQueryData(keys.controls(learnerId), out);
      toast.show(t("me_money:SET-16.saved", { child: name }));
    },
    onError: () => toast.show(t("me_money:SET-16.save_failed")),
  });
  const little = isLittle(child?.age_band);

  return (
    <Page
      title={t("me_money:SET-16.title", { child: name })}
      onBack={close}
      testID="set-16"
      footer={<Button label={t("me_money:SET-16.save")} disabled={!online || !valid} loading={save.isPending} onPress={() => save.mutate()} testID="set-16-save" />}
    >
      <h1 className="sr-only">{t("me_money:SET-16.title", { child: name })}</h1>
      {!online && <Banner tone="offline" icon="WifiSlash" text={t("me_money:SET-14.offline")} testID="set-16-offline" />}
      <section className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card">
        <ChoiceChips
          label={t("me_money:SET-16.daily_limit")}
          options={LIMITS.map((l) => ({ value: l === null ? "off" : String(l), label: l === null ? t("me_money:SET-16.off") : t("me_money:SET-16.minutes", { n: l }) }))}
          value={[form.limit === null ? "off" : String(form.limit)]}
          onChange={([v]) => set("limit", LIMITS.find((l) => String(l) === v) ?? null)}
          testID="set-16-limit"
        />
      </section>
      <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card">
        <Switch label={t("me_money:SET-16.allowed_hours")} checked={form.hoursOn} onCheckedChange={(v) => set("hoursOn", v)} className="justify-between" testID="set-16-hours" />
        {form.hoursOn && (
          <div className="grid grid-cols-2 gap-3">
            <TimeField label={t("me_money:SET-16.from")} value={form.from} onChange={(v) => set("from", v)} testID="set-16-from" />
            <TimeField label={t("me_money:SET-16.to")} value={form.to} onChange={(v) => set("to", v)} testID="set-16-to" />
          </div>
        )}
        {!valid && <p className="m-0 flex items-center gap-2 text-caption text-error-text" role="alert" data-testid="set-16-invalid"><Icon name="WarningCircle" size={16} />{t("me_money:SET-16.hours_invalid")}</p>}
        <Switch label={t("me_money:SET-16.breaks", { child: name })} checked={form.breaks} onCheckedChange={(v) => set("breaks", v)} className="justify-between text-start" testID="set-16-breaks" />
      </section>
      <SettingsGroup title={t("me_money:SET-16.more", { child: name })} testID="set-16-more">
        <SettingsRow title={t("me_money:SET-14.weekly_email")} icon="Bell" trailing="switch" checked={form.weeklyReport} onCheckedChange={(v) => set("weeklyReport", v)} testID="set-16-weekly" />
        <SettingsRow title={t("me_money:SET-14.ask_before_switching")} icon="UsersThree" trailing="switch" checked={form.askBeforeSwitching} onCheckedChange={(v) => set("askBeforeSwitching", v)} testID="set-16-ask" />
        {little && <SettingsRow title={t("me_money:SET-14.picture_rhymes", { child: name })} icon="Sparkle" trailing="switch" checked={form.pictureRhymes} onCheckedChange={(v) => set("pictureRhymes", v)} testID="set-16-rhymes" />}
        {little && <SettingsRow title={t("me_money:SET-14.tutor_button", { child: name })} icon="ChatCircleText" trailing="switch" checked={form.tutorButton} onCheckedChange={(v) => set("tutorButton", v)} testID="set-16-tutor" />}
      </SettingsGroup>
      {little && (
        <p className="m-0 text-caption text-ink-muted">
          {t("me_money:SET-14.picture_rhymes_caption")} {t("me_money:SET-14.tutor_caption", { child: name })}
        </p>
      )}
      <p className="m-0 flex items-center gap-2 text-caption text-ink-muted">
        <Icon name="Info" size={16} />
        {t("me_money:SET-16.note")}
      </p>
    </Page>
  );
}

function TimeField({ label, value, onChange, testID }: { label: string; value: string; onChange: (v: string) => void; testID: string }) {
  return (
    <label className="flex flex-col gap-1 text-label text-ink-muted">
      {label}
      <input type="time" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testID} className="min-h-12 rounded-md border border-hairline bg-surface px-3 text-body text-ink tabular-nums outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary" />
    </label>
  );
}

// ── SET-17 consents ─────────────────────────────────────────────────────────

const SCOPE_KEY = {
  account: "me_money:SET-17.scope_account",
  social: "me_money:SET-17.scope_social",
  community: "me_money:SET-17.scope_community",
  voice: "me_money:SET-17.scope_voice",
  uploads: "me_money:SET-17.scope_uploads",
} as const;
const EFFECT_KEY = {
  account: "me_money:SET-17.effect_account",
  social: "me_money:SET-17.effect_social",
  community: "me_money:SET-17.effect_sharing",
  voice: "me_money:SET-17.effect_voice",
  uploads: "me_money:SET-17.effect_photo",
} as const;
const SCOPE_ICON = { account: "UserCircle", social: "UsersThree", community: "Cards", voice: "Microphone", uploads: "Question" } as const;

export function Consents() {
  const { learnerId } = useParams({ from: "/parent/$learnerId/consents" });
  const s = useServices();
  const { t } = useI18n();
  const f = useFormat();
  const close = useClose("/parent");
  const online = useOnline();
  const nameOf = useChildName();
  const queryClient = useQueryClient();
  const learners = useQuery({ queryKey: keys.learners, queryFn: () => unwrap(s.client.GET("/v1/guardian/learners"), s.client) });
  const learner = learners.data?.learners.find((l) => l.user_id === learnerId) ?? null;
  const rows = consentRows(learner?.consent, learner?.age_band ?? null);
  const social = rows.some((r) => r.scope === "social" && r.allowed);
  const friends = useQuery({ queryKey: keys.friends(learnerId), enabled: social, queryFn: () => unwrap(s.client.GET("/v1/guardian/learners/{learner_id}/friends", { params: { path: { learner_id: learnerId } } }), s.client) });
  const [confirm, setConfirm] = useState<{ kind: "scope"; scope: Scope } | { kind: "friend"; id: string; name: string } | null>(null);

  const withdraw = useMutation({
    mutationFn: (scope: Scope) => unwrap(s.client.DELETE("/v1/guardian/consents/{consent_id}/scopes/{scope}", { params: { path: { consent_id: learner?.consent?.id ?? "", scope } } }), s.client),
    onSuccess: (_r, scope) => {
      s.analytics.track("consent_withdrawn", { consent_type: scope });
      toast.show(t("me_money:SET-17.turned_off"));
      void queryClient.invalidateQueries({ queryKey: keys.learners });
      void queryClient.invalidateQueries({ queryKey: keys.dashboard });
    },
    onError: () => toast.show(t("me_money:SET-14.decision_failed")),
  });
  const removeFriend = useMutation({
    mutationFn: (friendId: string) => unwrap(s.client.DELETE("/v1/guardian/learners/{learner_id}/friends/{friend_id}", { params: { path: { learner_id: learnerId, friend_id: friendId } } }), s.client),
    onSuccess: () => {
      toast.show(t("me_money:SET-17.removed"));
      void queryClient.invalidateQueries({ queryKey: keys.friends(learnerId) });
    },
    onError: () => toast.show(t("me_money:SET-14.decision_failed")),
  });

  if (learners.isPending) return <RouteLoading />;
  if (learners.isError) return <LoadError onRetry={() => void learners.refetch()} />;
  if (!learner) return <NotLinked />;
  const name = nameOf(learner);
  const scopeName = (sc: Scope) => t(SCOPE_KEY[sc]);

  return (
    <Page title={t("me_money:SET-17.title", { child: name })} onBack={close} testID="set-17">
      <h1 className="sr-only">{t("me_money:SET-17.title", { child: name })}</h1>
      {!online && <Banner tone="offline" icon="WifiSlash" text={t("me_money:SET-14.offline")} testID="set-17-offline" />}
      <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="set-17-rows">
        {rows.map((r) => (
          <li key={r.scope} className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card" data-testid={`set-17-${r.scope}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Icon name={SCOPE_ICON[r.scope]} size={24} className="text-ink-muted" />
              <h2 className="m-0 min-w-[9rem] flex-1 text-label font-bold text-ink">{scopeName(r.scope)}</h2>
              <Chip kind="status" tone={r.allowed ? "success" : "neutral"} icon={r.allowed ? "CheckCircle" : "Circle"} label={r.allowed && r.since ? t("me_money:SET-17.status_allowed", { date: f.date(r.since) }) : t("me_money:SET-17.status_not")} />
            </div>
            <p className="m-0 text-body text-ink-muted">{t(EFFECT_KEY[r.scope], { child: name })}</p>
            {r.canTurnOff && <Button label={t("me_money:SET-17.turn_off")} variant="secondary" size="sm" disabled={!online} onPress={() => setConfirm({ kind: "scope", scope: r.scope })} className="self-start" testID={`set-17-off-${r.scope}`} />}
            {!r.allowed && <p className="m-0 text-caption text-ink-muted">{t("me_money:SET-17.allow_in_app")}</p>}
          </li>
        ))}
      </ul>
      {social && (
        <section className="flex flex-col gap-2" aria-labelledby="set-17-friends" data-testid="set-17-friends">
          <SectionTitle id="set-17-friends">{t("me_money:SET-14.friends_row", { child: name })}</SectionTitle>
          {friends.isPending ? null : friends.isError ? (
            <LoadError onRetry={() => void friends.refetch()} />
          ) : friends.data.length === 0 ? (
            <p className="m-0 text-body text-ink-muted">{t("me_money:SET-17.friends_empty", { child: name })}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-hairline rounded-card bg-surface p-0 shadow-card">
              {friends.data.map((fr) => {
                const shown = friendName(fr.person) ?? t("me_money:SET-17.a_friend");
                const id = fr.person.user_id;
                const species = fr.person.avatar?.species ?? null;
                return (
                  <li key={id ?? shown} className="flex min-h-14 items-center gap-3 px-4 py-2">
                    {species ? <Illustration name={`${species}-base`} decorative width={40} height={40} className="shrink-0 rounded-full bg-primary-tint" /> : <Icon name="UserCircle" size={32} className="shrink-0 text-ink-muted" />}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-label text-ink">{shown}</span>
                      {fr.since && <span className="text-caption text-ink-muted">{t("me_money:SET-17.friend_since", { date: f.date(fr.since) })}</span>}
                    </span>
                    {id && <Button label={t("me_money:SET-14.remove_friend")} variant="ghost" size="sm" disabled={!online} onPress={() => setConfirm({ kind: "friend", id, name: shown })} testID={`set-17-remove-${id}`} />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === "scope" ? t("me_money:SET-17.off_title", { scope: scopeName(confirm.scope) }) : t("me_money:SET-17.remove_title", { name: confirm?.kind === "friend" ? confirm.name : "" })}
        description={confirm?.kind === "scope" ? t("me_money:SET-17.off_body", { child: name }) : t("me_money:SET-17.remove_body", { child: name })}
        confirm={{
          label: confirm?.kind === "scope" ? t("me_money:SET-17.turn_off") : t("me_money:SET-14.remove_friend"),
          destructive: true,
          onPress: () => {
            if (confirm?.kind === "scope") withdraw.mutate(confirm.scope);
            else if (confirm?.kind === "friend") removeFriend.mutate(confirm.id);
            setConfirm(null);
          },
        }}
        cancel={{ label: t("me_money:SET-17.cancel"), onPress: () => setConfirm(null) }}
        testID="set-17-confirm"
      />
    </Page>
  );
}

