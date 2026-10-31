/**
 * G-8 on the web: MEM-25 "How well I know it" (calibration from the student's own tagged answers),
 * with the two other learning-science views beside it: topics fading soon (predicted recall from
 * the student's FSRS state) and tonight's sleep review set. The mixed drill starts from here.
 * Everything comes from `/v1/insights/*`; the web shows no estimate of its own.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@smriti/api-client";
import { Banner, Button, EmptyState, Icon, PetLine, Spinner, StatTile, Text, cx } from "@smriti/ui-web";
import { useServices } from "../../../boot/context";
import { findTopic, useCatalog } from "../../../lib/content";
import { useI18n } from "../../../lib/i18n";
import { useOnline } from "../../../lib/network";
import { LoadError } from "../../../shell/States";
import { useClose } from "../shared/nav";
import { Page, PageColumns } from "../shared/Page";
import { usePet } from "../shared/pet";
import { bars, clockLabel, fadingRows, headline, sleepState, stillNeeded, targetsFrom, type Bar } from "./logic";

const LEVEL_KEY = { sure: "memory_labs:MEM-25.level_sure", fifty: "memory_labs:MEM-25.level_fifty", guess: "memory_labs:MEM-25.level_guess" } as const;

export function Insights() {
  const s = useServices();
  const { t } = useI18n();
  const close = useClose("/learn");
  const online = useOnline();
  const calibration = useQuery({ queryKey: ["insights", "calibration"], queryFn: () => unwrap(s.client.GET("/v1/insights/calibration"), s.client) });
  const viewed = calibration.data?.shown;
  useEffect(() => {
    if (viewed !== undefined) s.analytics.track("metacog_viewed", { range: "all", has_enough_data: viewed });
  }, [viewed, s]);

  return (
    <Page title={t("memory_labs:MEM-25.title")} onBack={close} width="xl" testID="mem-25">
      <h1 className="sr-only">{t("memory_labs:MEM-25.title")}</h1>
      {!online && <Banner tone="offline" icon="WifiSlash" text={t("memory_labs:MEM-25.offline")} />}
      <PageColumns
        className="min-[600px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
        left={<Calibration q={calibration} />}
        right={
          <>
            <Fading />
            <SleepReview />
            <MixedCard />
          </>
        }
      />
    </Page>
  );
}

function Calibration({ q }: { q: UseQueryResult<Schemas["CalibrationOut"]> }) {
  const s = useServices();
  const { t } = useI18n();
  const pet = usePet();
  const [table, setTable] = useState(false);
  if (q.isPending) return <Spinner label={t("learn:WEB-01.loading")} />;
  if (q.isError) return <LoadError onRetry={() => void q.refetch()} />;
  const c = q.data;
  if (!c.shown) {
    const k = stillNeeded(c);
    return (
      <section className="flex flex-col gap-3" data-testid="mem-25-empty">
        <EmptyState illustration={`${pet?.species ?? "cat"}-thinking`} alt={t("memory_labs:MEM-25.empty_alt")} text={k === null ? t("memory_labs:MEM-25.not_ready") : t("memory_labs:MEM-25.empty", { k })} />
        {pet && <PetLine pet={{ species: pet.species }} petName={pet.name} text={t("memory_labs:MEM-25.pet_empty")} live={false} />}
      </section>
    );
  }
  const b = bars(c.levels, targetsFrom(s.flags.get("metacog.targets")));
  const h = headline(b);
  return (
    <section className="flex flex-col gap-4" aria-labelledby="mem-25-chart" data-testid="mem-25-data">
      <div className="grid grid-cols-2 gap-3">
        <StatTile value={String(h.sureWrong)} label={t("memory_labs:MEM-25.sure_wrong")} icon="WarningCircle" testID="mem-25-sure-wrong" />
        <StatTile value={String(h.lucky)} label={t("memory_labs:MEM-25.lucky")} icon="Shuffle" testID="mem-25-lucky" />
      </div>
      <div className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="mem-25-chart" className="m-0 text-heading">
            {t("memory_labs:MEM-25.chart_title")}
          </h2>
          <span className="text-caption text-ink-muted">{t("memory_labs:MEM-25.tagged_line", { n: c.tagged })}</span>
        </div>
        {table ? <CalibrationTable bars={b} /> : <Bars bars={b} />}
        <p className="m-0 text-caption text-ink-muted">{t("memory_labs:MEM-25.chart_note")}</p>
        <button type="button" onClick={() => setTable(!table)} className="min-h-12 self-start rounded-[12px] px-2 text-label font-bold text-primary-text underline-offset-4 hover:underline focus-visible:outline-[3px] focus-visible:outline-primary" data-testid="mem-25-table-toggle">
          {table ? t("memory_labs:MEM-25.show_chart") : t("memory_labs:MEM-25.show_table")}
        </button>
      </div>
    </section>
  );
}

function Bars({ bars: list }: { bars: Bar[] }) {
  const { t } = useI18n();
  return (
    <ul className="m-0 flex list-none flex-col gap-4 p-0" data-testid="mem-25-bars">
      {list.map((b) => {
        const label = t(LEVEL_KEY[b.level]);
        return (
          <li key={b.level} className="flex flex-col gap-1" aria-label={b.pct === null ? `${label}: ${t("memory_labs:MEM-25.no_answers")}` : t("memory_labs:MEM-25.bar_a11y", { level: label, pct: b.pct, count: b.answers, target: b.target })}>
            <div className="flex items-baseline justify-between gap-2" aria-hidden="true">
              <span className="flex items-center gap-1 text-label font-bold text-ink">
                {label}
                {b.below && <Icon name="WarningCircle" size={16} className="text-warning-text" />}
              </span>
              <span className="text-caption text-ink-muted tabular-nums">{b.pct === null ? t("memory_labs:MEM-25.no_answers") : t("memory_labs:MEM-25.bar_label", { pct: b.pct, count: b.answers })}</span>
            </div>
            <div className="relative h-4 rounded-full bg-surface-sunken" aria-hidden="true">
              <div className={cx("h-full rounded-full bg-primary", "motion-safe:transition-[width] motion-safe:duration-500")} style={{ width: `${b.pct ?? 0}%` }} />
              <div className="absolute -top-1 h-6 w-0.5 rounded-full bg-ink" style={{ insetInlineStart: `calc(${b.target}% - 1px)` }} />
            </div>
            <span className="text-caption text-ink-muted" aria-hidden="true" style={{ paddingInlineStart: `max(0px, calc(${b.target}% - 24px))` }}>
              {t("memory_labs:MEM-25.target")} {b.target}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CalibrationTable({ bars: list }: { bars: Bar[] }) {
  const { t } = useI18n();
  return (
    <table className="w-full border-collapse text-start text-body" data-testid="mem-25-table">
      <thead>
        <tr className="text-caption text-ink-muted">
          <th scope="col" className="py-2 text-start font-bold">{t("memory_labs:MEM-25.col_level")}</th>
          <th scope="col" className="py-2 text-end font-bold">{t("memory_labs:MEM-25.col_right")}</th>
          <th scope="col" className="py-2 text-end font-bold">{t("memory_labs:MEM-25.col_answers")}</th>
          <th scope="col" className="py-2 text-end font-bold">{t("memory_labs:MEM-25.target")}</th>
        </tr>
      </thead>
      <tbody>
        {list.map((b) => (
          <tr key={b.level} className="border-t border-hairline">
            <th scope="row" className="py-2 text-start font-normal">{t(LEVEL_KEY[b.level])}</th>
            <td className="py-2 text-end tabular-nums">{b.pct === null ? "–" : `${b.pct}%`}</td>
            <td className="py-2 text-end tabular-nums">{b.answers}</td>
            <td className="py-2 text-end tabular-nums">{b.target}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Card({ title, icon, children, testID }: { title: string; icon: "TrendUp" | "Moon" | "Shuffle"; children: ReactNode; testID: string }) {
  const id = `${testID}-title`;
  return (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" aria-labelledby={id} data-testid={testID}>
      <h2 id={id} className="m-0 flex items-center gap-2 text-heading">
        <Icon name={icon} size={20} className="text-primary-text" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fading() {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const weak = useQuery({ queryKey: ["insights", "weak-areas"], queryFn: () => unwrap(s.client.GET("/v1/insights/weak-areas"), s.client) });
  const rows = fadingRows(weak.data, (id) => {
    const loc = findTopic(catalog.subjects, id);
    return loc ? { name: loc.topic.name, subject: loc.subject.name } : null;
  });
  return (
    <Card title={t("memory_labs:MEM-25.fading_title")} icon="TrendUp" testID="mem-25-fading">
      {weak.isPending ? (
        <Spinner label={t("learn:WEB-01.loading")} />
      ) : weak.isError ? (
        <Text tone="muted">{t("memory_labs:MEM-25.load_failed")}</Text>
      ) : rows.length === 0 ? (
        <Text tone="muted">{t("memory_labs:MEM-25.fading_none", { days: weak.data.horizon_days })}</Text>
      ) : (
        <>
          <p className="m-0 text-caption text-ink-muted">{t("memory_labs:MEM-25.fading_note", { target: Math.round(weak.data.target_retention * 100), days: weak.data.horizon_days })}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((r) => (
              <li key={r.topicId} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-surface-sunken p-3" data-testid={`mem-25-fading-${r.topicId}`}>
                <span className="flex min-w-0 flex-col">
                  <span className="text-body text-ink">{r.name ?? t("memory_labs:MEM-25.unknown_topic")}</span>
                  <span className="text-caption text-ink-muted tabular-nums">
                    {r.subject ? `${r.subject} · ` : ""}
                    {t("memory_labs:MEM-25.fading_row", { n: r.cards, pct: r.recallPct })}
                  </span>
                </span>
                {r.name && <Button label={t("memory_labs:MEM-25.practise_topic")} variant="secondary" size="sm" onPress={() => void navigate({ to: "/practice/drill/$topicId", params: { topicId: r.topicId } })} />}
              </li>
            ))}
          </ul>
          <Button label={t("memory_labs:MEM-25.review_now")} size="sm" icon="Cards" onPress={() => void navigate({ to: "/review" })} testID="mem-25-review" />
        </>
      )}
    </Card>
  );
}

function SleepReview() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["insights", "sleep-review"], queryFn: () => unwrap(s.client.GET("/v1/insights/sleep-review"), s.client) });
  if (q.isPending) return null;
  const st = sleepState(q.isError ? undefined : q.data);
  return (
    <Card title={t("memory_labs:MEM-25.sleep_title")} icon="Moon" testID="mem-25-sleep">
      {st.kind === "ready" ? (
        <>
          <Text>{st.at ? t("memory_labs:MEM-25.sleep_ready", { n: st.cards, time: clockLabel(st.at, locale) }) : t("memory_labs:MEM-25.sleep_ready_now", { n: st.cards })}</Text>
          <p className="m-0 text-caption text-ink-muted">{t("memory_labs:MEM-25.sleep_web_note")}</p>
          <Button label={t("memory_labs:MEM-25.review_now")} size="sm" variant="secondary" icon="Moon" onPress={() => void navigate({ to: "/review" })} testID="mem-25-sleep-review" />
        </>
      ) : (
        <>
          <Text tone="muted" testID={`mem-25-sleep-${st.reason}`}>
            {t(`memory_labs:MEM-25.sleep_${st.reason}`)}
          </Text>
          {st.reason === "pro_required" && <Button label={t("memory_labs:MEM-25.sleep_pro")} size="sm" variant="secondary" icon="Sparkle" onPress={() => void navigate({ to: "/pro", search: { source: "sleep_review" } })} />}
        </>
      )}
    </Card>
  );
}

function MixedCard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <Card title={t("practice:PRC-03.mixed_title")} icon="Shuffle" testID="mem-25-mixed">
      <Text tone="muted">{t("practice:PRC-03.mixed_caption")}</Text>
      <Button label={t("practice:PRC-03.mixed_set_up")} size="sm" variant="secondary" onPress={() => void navigate({ to: "/practice/mixed" })} testID="mem-25-mixed-start" />
    </Card>
  );
}
