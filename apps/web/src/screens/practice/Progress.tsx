/**
 * PRC-14 "Your progress", from real data only: readiness, accuracy vs speed, how sure vs how right
 * and mistake types from `GET /v1/analytics/summary`, the mock score trend (`/v1/attempts`) and
 * concept mastery for weak spots (`/v1/practice/weak-spots`). A card the server holds back
 * (`shown: false`, a null value, `not_enough_data` or an unset threshold) shows a friendly empty
 * state with the real count still needed, never a made-up number.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { unwrap, type components } from "@smriti/api-client";
import { useAppStore } from "@smriti/app-core/react";
import { Button, Card, ChoiceChips, PetLine, ProgressBar, Text, TopBar } from "@smriti/ui-web";
import type { MessageKey } from "@smriti/i18n/core";
import { useServices } from "../../boot/context";
import { useI18n, type T } from "../../lib/i18n";
import { pickText, usePastAttempts } from "../../lib/mocks";
import { useWeakSpots } from "../../lib/practice";
import { useExams, useProfileIds } from "../../lib/queries";
import { RouteLoading } from "../../shell/States";

const MIN_MOCKS_FOR_TREND = 2;

type Summary = components["schemas"]["AnalyticsSummaryOut"];
type Period = Summary["period"];
type Gate = { shown: boolean; have: number; needed: number | null; reason?: string | null };

function useSummary(exam: string | null, period: Period) {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["practice", "summary", userId, exam, period],
    enabled: !!userId && !!exam && !s.fakeApi,
    retry: false,
    staleTime: 60_000,
    queryFn: () => unwrap(s.client.GET("/v1/analytics/summary", { params: { query: { exam, period } } }), s.client),
  });
}

/** The empty line for a card the server holds back; the count comes from the server's own `needed − have`. */
export function emptyLine(t: T, card: Gate | undefined, kind: "answers" | "confidence"): string | null {
  if (card && card.shown) return null;
  const left = card && card.needed != null ? Math.max(1, card.needed - card.have) : null;
  if (left === null) return t("practice:PRC-14.card_waiting");
  return kind === "confidence" ? t("practice:PRC-14.card_empty_confidence", { n: left }) : t("practice:PRC-14.card_empty_answers", { n: left });
}

/** Accuracy comes as a 0–1 fraction (readiness `percent` is already 0–100). */
const pctOf = (fraction: number | null | undefined) => (fraction == null ? null : Math.round(fraction * 100));

function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} s`;
}

const MISTAKE_KEY: Record<string, MessageKey> = {
  conceptual: "practice:PRC-05.concept",
  calculation: "practice:PRC-05.calculation",
  misread: "practice:PRC-05.misread",
  silly: "practice:PRC-05.silly",
  time: "practice:PRC-05.time",
};

function SummaryCards({ data, error, examShort }: { data: Summary | undefined; error: boolean; examShort: string }) {
  const { t } = useI18n();
  const r = data?.readiness;
  const sp = data?.speed;
  const c = data?.confidence;
  const m = data?.mistakes;
  const readinessPct = r?.shown && r.percent != null ? r.percent : null;
  const avg = sp?.shown ? sp.avg_ms : null;
  const levels = c?.shown ? (c.levels ?? []) : [];
  const counts = m?.shown ? (m.counts ?? []).filter((x) => x.count > 0) : [];
  const empty = (card: Gate | undefined, kind: "answers" | "confidence" = "answers") => (error ? t("practice:PRC-14.card_waiting") : emptyLine(t, card, kind));
  const LEVEL_KEY = { sure: "practice:PRC-14.sure_line", fifty: "practice:PRC-14.fifty_line", guess: "practice:PRC-14.guess_line" } as const;
  return (
    <>
      <Card testID="prc-14-readiness">
        <span className="flex flex-col gap-2">
          <Text variant="heading" heading as="h2">
            {t("practice:PRC-14.readiness_label", { exam_short: examShort })}
          </Text>
          {r?.shown && readinessPct !== null ? (
            <>
              <Text variant="display" className="tabular-nums" testID="prc-14-readiness-value">{`${readinessPct}%`}</Text>
              <ProgressBar value={readinessPct / 100} label={t("practice:PRC-14.readiness_label", { exam_short: examShort })} valueText={`${readinessPct}%`} />
              <Text variant="caption" tone="muted">
                {t("practice:PRC-14.readiness_basis", { practised: r.practised, total: r.total })}
              </Text>
              <Text variant="caption" tone="muted">
                {r.weighted ? t("practice:PRC-14.how_sheet_body", { exam_short: examShort }) : t("practice:PRC-14.weights_note_no_weightage_yet")}
              </Text>
            </>
          ) : (
            <Text tone="muted" testID="prc-14-readiness-empty">{empty(r) ?? t("practice:PRC-14.card_waiting")}</Text>
          )}
        </span>
      </Card>
      <Card testID="prc-14-speed">
        <span className="flex flex-col gap-2">
          <Text variant="heading" heading as="h2">
            {t("practice:PRC-14.time_per_question")}
          </Text>
          {sp?.shown && avg != null ? (
            <>
              {sp.target_ms != null ? (
                <Text variant="label" className="tabular-nums">{t("practice:PRC-14.avg_vs_target", { time: seconds(avg), time_2: seconds(sp.target_ms) })}</Text>
              ) : (
                <Text variant="label" className="tabular-nums">{seconds(avg)}</Text>
              )}
              {sp.right_but_slow != null && <Text variant="caption" className="tabular-nums">{t("practice:PRC-14.right_but_slow", { n: sp.right_but_slow })}</Text>}
              {sp.fast_and_wrong != null && <Text variant="caption" className="tabular-nums">{t("practice:PRC-14.fast_and_wrong_count", { n: sp.fast_and_wrong })}</Text>}
            </>
          ) : (
            <Text tone="muted" testID="prc-14-speed-empty">{empty(sp) ?? t("practice:PRC-14.card_waiting")}</Text>
          )}
        </span>
      </Card>
      <Card testID="prc-14-confidence">
        <span className="flex flex-col gap-2">
          <Text variant="heading" heading as="h2">
            {t("practice:PRC-14.confidence")}
          </Text>
          {levels.some((l) => l.accuracy != null) ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {levels.map((l) => {
                const pct = pctOf(l.accuracy);
                if (pct === null) return null;
                return (
                  <li key={l.confidence}>
                    <ProgressBar value={pct / 100} label={t(LEVEL_KEY[l.confidence], { pct })} valueText={`${pct}%`} />
                    <Text variant="caption" className="tabular-nums">
                      {t(LEVEL_KEY[l.confidence], { pct })}
                    </Text>
                  </li>
                );
              })}
              {c?.lucky_guesses != null && (
                <li>
                  <Text variant="caption" tone="muted" className="tabular-nums">
                    {t("practice:PRC-14.lucky", { n: c.lucky_guesses })}
                  </Text>
                </li>
              )}
            </ul>
          ) : (
            <Text tone="muted" testID="prc-14-confidence-empty">{empty(c, "confidence") ?? t("practice:PRC-14.card_waiting")}</Text>
          )}
        </span>
      </Card>
      <Card testID="prc-14-mistakes">
        <span className="flex flex-col gap-2">
          <Text variant="heading" heading as="h2">
            {t("practice:PRC-14.mistake_types")}
          </Text>
          {counts.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {counts.map((x) => (
                <li key={x.type} className="flex justify-between gap-3">
                  <Text variant="label">{t(MISTAKE_KEY[x.type] ?? "practice:PRC-05.concept")}</Text>
                  <Text variant="label" className="tabular-nums">
                    {x.count}
                  </Text>
                </li>
              ))}
            </ul>
          ) : (
            <Text tone="muted" testID="prc-14-mistakes-empty">{empty(m) ?? t("practice:PRC-14.card_waiting")}</Text>
          )}
        </span>
      </Card>
    </>
  );
}

export function ProgressScreen() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const exam = useProfileIds()[0] ?? null;
  const exams = useExams().data;
  const examShort = exams?.find((e) => e.profiles.some((p) => p.id === exam))?.name[locale] ?? "";
  const pet = useAppStore((x) => x.pet);
  const [period, setPeriod] = useState<Period>("30d");
  const attempts = usePastAttempts();
  const weak = useWeakSpots(exam);
  const summary = useSummary(exam, period);
  if ((attempts.isPending && attempts.fetchStatus !== "idle") || (weak.isPending && weak.fetchStatus !== "idle")) return <RouteLoading />;

  const scored = (attempts.data ?? [])
    .filter((a) => (a.status === "submitted" || a.status === "auto_submitted") && a.score !== null && a.max_score)
    .sort((a, b) => Date.parse(a.submitted_at ?? a.started_at) - Date.parse(b.submitted_at ?? b.started_at));
  const spots = (weak.data?.items ?? []).filter((w) => w.mastery !== null);
  const nothing = scored.length === 0 && spots.length === 0;

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 md:px-8" data-testid="prc-14">
      <TopBar className="-mx-4 md:-mx-8" title={t("practice:PRC-14.title")} onBack={() => void navigate({ to: "/practice" })} />
      {nothing ? (
        <div className="flex flex-col gap-3">
          <PetLine pet={{ species: pet?.species === "dog" ? "dog" : "cat", mood: "curious" }} petName={pet?.name ?? ""} text={t("practice:PRC-14.pet_line_empty_dashboard")} />
          <Button label={t("practice:PRC-01.tile_concept_drill")} onPress={() => void navigate({ to: "/practice" })} testID="prc-14-start" />
        </div>
      ) : null}
      <ChoiceChips
        label={t("practice:PRC-14.title")}
        hideLabel
        options={[
          { value: "7d", label: t("practice:PRC-14.7_days") },
          { value: "30d", label: t("practice:PRC-14.30_days") },
          { value: "all", label: t("practice:PRC-14.all_time") },
        ]}
        value={[period]}
        onChange={(v) => v[0] && setPeriod(v[0] as Period)}
        testID="prc-14-period"
      />
      {summary.isPending && summary.fetchStatus !== "idle" ? <RouteLoading /> : <SummaryCards data={summary.data} error={summary.isError} examShort={examShort} />}
      <Card testID="prc-14-trend">
        <span className="flex flex-col gap-3">
          <Text variant="heading" heading as="h2">
            {t("practice:PRC-14.trend")}
          </Text>
          <Text variant="label">{t("practice:PRC-14.mock_scores")}</Text>
          {scored.length < MIN_MOCKS_FOR_TREND ? (
            <Text tone="muted">{t("practice:PRC-14.card_empty_mocks", { n: MIN_MOCKS_FOR_TREND - scored.length })}</Text>
          ) : null}
          {scored.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {scored.slice(-8).map((a) => {
                const pct = Math.round(((a.score as number) / (a.max_score as number)) * 100);
                return (
                  <li key={a.id}>
                    <ProgressBar value={Math.max(0, pct) / 100} label={pickText(a.title, locale)} valueText={`${pct}%`} />
                    <Text variant="caption" tone="muted">
                      {pickText(a.title, locale)} · {a.score}/{a.max_score} · {pct}%
                    </Text>
                  </li>
                );
              })}
            </ul>
          )}
        </span>
      </Card>
      <Card testID="prc-14-weak">
        <span className="flex flex-col gap-3">
          <Text variant="heading" heading as="h2">
            {t("practice:PRC-01.weak_spots_heading")}
          </Text>
          {spots.length === 0 ? (
            <Text tone="muted">{t("practice:PRC-14.pet_line_empty_dashboard")}</Text>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {spots.slice(0, 8).map((w) => (
                <li key={w.concept_id}>
                  <ProgressBar value={w.mastery ?? 0} label={pickText(w.concept_name, locale)} valueText={`${Math.round((w.mastery ?? 0) * 100)}%`} />
                  <Text variant="caption" tone="muted">
                    {pickText(w.concept_name, locale)} · {Math.round((w.mastery ?? 0) * 100)}%
                  </Text>
                </li>
              ))}
            </ul>
          )}
          {spots[0] && <Button variant="secondary" size="sm" label={t("practice:PRC-14.practise_weak_spots")} onPress={() => void navigate({ to: "/practice/drill/$topicId", params: { topicId: spots[0]!.topic_id } })} testID="prc-14-weak-drill" />}
        </span>
      </Card>
    </div>
  );
}
