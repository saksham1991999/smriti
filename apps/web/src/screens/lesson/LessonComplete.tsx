/**
 * LES-08: lesson complete. Renders at once from the optimistic local result (XP, accuracy, time,
 * streak, plant, daily goal), then at most one extra (R15, app-core `lessonEndExtra`): the soft
 * sign-in at the 3rd lesson (1st on Safari, `web_storage_risk`), or the Pro card every 5th.
 */
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { lessonEndExtra, type LessonEndExtra } from "@smriti/app-core";
import { useAppStore } from "@smriti/app-core/react";
import { Button, Card, IconButton, Illustration, PlantView, StatTile, Text } from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { SoftPromptSheet, useAgeBand, type SoftReason } from "../../components/SignIn";
import { parts, useI18n } from "../../lib/i18n";
import { useLessonResult } from "../../lib/lessonResult";
import { useOnboarding } from "../../lib/onboarding";
import { usePriceValues } from "../../lib/pricing";
import { useIsPro } from "../../lib/pro";
import { useTodayMinutes } from "../../lib/daily";

/** Safari and every iOS browser can clear a site's storage after 7 days away (auth flow §9). */
export function storageAtRisk(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua);
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\//.test(ua);
  return ios || safari;
}

export function LessonComplete() {
  const result = useLessonResult((x) => x.result);
  const s = useServices();
  const { t } = useI18n();
  const pv = usePriceValues();
  const navigate = useNavigate();
  const pet = useAppStore((x) => x.pet);
  const session = useAppStore((x) => x.session);
  const pro = useIsPro();
  const band = useAgeBand();
  const ob = useOnboarding();
  const today = useTodayMinutes();
  const [extra, setExtra] = useState<LessonEndExtra>("none");
  const [softOpen, setSoftOpen] = useState(false);
  const softReason: SoftReason = storageAtRisk() ? "web_storage_risk" : "lesson_3";

  useEffect(() => {
    if (!result) return;
    let live = true;
    void (async () => {
      const decision = session.isGuest
        ? await s.softPrompt.tryShow(softReason, { now: new Date().toISOString(), signedIn: false, managed: false, midActivity: false })
        : { show: false as const };
      const daysSinceInstall = Math.floor((Date.now() - new Date(ob.installedAt).getTime()) / 86_400_000);
      const todayKey = new Date().toISOString().slice(0, 10);
      const e = lessonEndExtra({
        lessonsCompleted: result.outcome.lessonsCompleted,
        deferredOnboardingPending: ob.dailyGoal === null && ob.completedAt === null,
        isGuest: session.isGuest,
        littleLearner: band === "u10",
        ageBand: band,
        isPro: pro,
        softPromptAllowed: decision.show,
        daysSinceInstall,
        upsellsShownToday: ob.upsellsShown.day === todayKey ? ob.upsellsShown.count : 0,
        softLoginAtLesson: softReason === "web_storage_risk" ? 1 : 3,
      });
      if (!live) return;
      setExtra(e);
      if (e === "soft_login") {
        setSoftOpen(true);
        s.analytics.track("auth_prompt_shown", { reason: softReason, variant: "soft", surface: "LES-08" });
      }
      if (e === "upsell") useOnboarding.getState().update({ upsellsShown: { day: todayKey, count: (ob.upsellsShown.day === todayKey ? ob.upsellsShown.count : 0) + 1 } });
    })();
    return () => {
      live = false;
    };
    // Decide once per result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  if (!result) return <Navigate to="/learn" replace />;
  const o = result.outcome;
  const labels = parts(t("learn:LES-08.stat_labels"));
  const lines = parts(t("learn:LES-08.pet_lines_rotate"));
  const next = parts(t("learn:LES-08.next_caption", { bite_title: result.nextBiteTitle ?? "", chapter_title: result.chapterName ?? "" }));
  const goal = ob.dailyGoal ?? s.store.getState().profile?.daily_goal_minutes ?? null;
  const goalLeft = goal ? Math.max(0, goal - today) : null;
  const goalParts = parts(t("learn:LES-08.goal", { left: goalLeft ?? 0 }));
  const cont = () => {
    if (result.nextBiteTitle && o.nextBiteId) void navigate({ to: "/lesson/$topicId", params: { topicId: result.topicId }, search: { mode: "deep_dive", bite: o.nextBiteId }, replace: true });
    else if (result.chapterId) void navigate({ to: "/learn/chapter/$chapterId", params: { chapterId: result.chapterId }, replace: true });
    else void navigate({ to: "/learn", replace: true });
  };

  return (
    <div className="min-h-dvh bg-bg" data-testid="les-08">
      <div className="mx-auto flex max-w-[560px] flex-col gap-4 px-4 pb-8">
        <header className="flex h-14 items-center">
          <IconButton icon="X" label={t("ui:common.close")} onPress={() => void navigate({ to: "/learn", replace: true })} testID="les-08-close" />
        </header>
        <main id="main" className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-card-large bg-streak-tint">
            <Illustration name={pet?.species === "dog" ? "dog-celebrate" : "cat-celebrate"} width={560} height={260} fit="contain" className="mx-auto h-[220px] w-full" />
          </div>
          <Text variant="display" heading as="h1" align="center">
            {o.topicLearned ? t("learn:LES-08.topic_learned", { topic_title: result.topicName }) : t("learn:LES-08.title")}
          </Text>
          <div className="grid grid-cols-3 gap-3">
            <StatTile value={`+${o.xp}`} label={labels[0] ?? ""} tint testID="stat-xp" />
            <StatTile value={o.accuracy === null ? "—" : `${o.accuracy}%`} label={labels[1] ?? ""} tint testID="stat-accuracy" />
            <StatTile value={t("learn:WEB-01.minutes", { n: o.minutes })} label={labels[2] ?? ""} testID="stat-time" />
          </div>
          {o.firstOfDay && (
            <Card tone="tint" className="flex items-center gap-3 bg-streak-tint" testID="streak-row">
              <PlantView stage={o.plantAfter.stage} health={o.plantAfter.health} size={56} decorative />
              <div className="flex flex-col">
                <Text variant="heading" tone="streak" testID="streak-line">
                  {t("learn:LES-08.streak", { n: o.streakAfter })}
                </Text>
                <Text variant="caption" tone="muted">
                  {o.plantBefore.stage !== o.plantAfter.stage ? t("learn:LES-08.plant_stage_up", { stage_name: t(`me_money:ME-07.stage_${o.plantAfter.stage}`) }) : t("learn:LES-08.plant_watered")}
                </Text>
              </div>
            </Card>
          )}
          {goalLeft !== null && (
            <Text tone={goalLeft === 0 ? "success" : "muted"} testID="goal-line">
              {goalLeft === 0 ? goalParts[0] : goalParts[1]}
            </Text>
          )}
          {extra === "upsell" && (
            <Card tone="tint" onPress={() => void navigate({ to: "/pro", search: { source: "lesson_end" } })} testID="les-08-upsell">
              <Text variant="heading">{t("me_money:PAY-01.headline_eligible", pv)}</Text>
            </Card>
          )}
          {pet && (
            <Text tone="muted" align="center">
              {lines[o.lessonsCompleted % Math.max(1, lines.length)]}
            </Text>
          )}
          <Button label={t("learn:LES-08.continue")} onPress={cont} testID="les-08-continue" />
          {result.nextBiteTitle && (
            <Text variant="caption" tone="muted" align="center">
              {next[0]}
            </Text>
          )}
          {!result.synced && (
            <Text variant="caption" tone="muted" align="center">
              {t("learn:LES-08.offline_caption")}
            </Text>
          )}
        </main>
      </div>
      <SoftPromptSheet open={softOpen} reason={softReason} onClose={() => setSoftOpen(false)} />
    </div>
  );
}
