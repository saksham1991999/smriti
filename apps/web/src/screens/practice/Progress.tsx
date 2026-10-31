/**
 * PRC-14 "Your progress", from real data only. The API has no analytics dashboard route yet, so
 * this shows the two cards it can back today: mock score trend (`/v1/attempts`) and concept
 * mastery for weak spots (`/v1/practice/weak-spots`). Readiness, subject mastery, accuracy vs
 * speed, confidence and mistake types wait for that route (reported); nothing is estimated here.
 */
import { useNavigate } from "@tanstack/react-router";
import { useAppStore } from "@smriti/app-core/react";
import { Button, Card, PetLine, ProgressBar, Text, TopBar } from "@smriti/ui-web";
import { useI18n } from "../../lib/i18n";
import { pickText, usePastAttempts } from "../../lib/mocks";
import { useWeakSpots } from "../../lib/practice";
import { useProfileIds } from "../../lib/queries";
import { RouteLoading } from "../../shell/States";

const MIN_MOCKS_FOR_TREND = 2;

export function ProgressScreen() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const exam = useProfileIds()[0] ?? null;
  const pet = useAppStore((x) => x.pet);
  const attempts = usePastAttempts();
  const weak = useWeakSpots(exam);
  if ((attempts.isPending && attempts.fetchStatus !== "idle") || (weak.isPending && weak.fetchStatus !== "idle")) return <RouteLoading />;

  const scored = (attempts.data ?? [])
    .filter((a) => (a.status === "submitted" || a.status === "auto_submitted") && a.score !== null && a.max_score)
    .sort((a, b) => Date.parse(a.submitted_at ?? a.started_at) - Date.parse(b.submitted_at ?? b.started_at));
  const spots = (weak.data?.items ?? []).filter((w) => w.mastery !== null);
  const nothing = scored.length === 0 && spots.length === 0;

  return (
    <div className="flex flex-col gap-4 pb-6" data-testid="prc-14">
      <TopBar title={t("practice:PRC-14.title")} onBack={() => void navigate({ to: "/practice" })} />
      {nothing ? (
        <div className="flex flex-col gap-3">
          <PetLine pet={{ species: pet?.species === "dog" ? "dog" : "cat", mood: "curious" }} petName={pet?.name ?? ""} text={t("practice:PRC-14.pet_line_empty_dashboard")} />
          <Button label={t("practice:PRC-01.tile_concept_drill")} onPress={() => void navigate({ to: "/practice" })} testID="prc-14-start" />
        </div>
      ) : null}
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
