/**
 * After the first lesson (onboarding §5.4): ONB-14 first win, ONB-08 daily goal, ONB-15 reminder.
 */
import { useState } from "react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useAppStore } from "@smriti/app-core/react";
import { Chip, ChoiceChips, PlantView, StatTile, StreakPill, Text } from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { StepFrame } from "../../components/Frame";
import { parts, useI18n } from "../../lib/i18n";
import { useLessonResult } from "../../lib/lessonResult";
import { useOnboarding } from "../../lib/onboarding";
import { useOnline } from "../../lib/network";
import { toast } from "../../lib/toast";

/** ONB-14: the seed sprouted. Day 1 of the streak, the lesson's XP, accuracy and time. */
export function FirstWin() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const result = useLessonResult((x) => x.result);
  const pet = useAppStore((x) => x.pet);
  const plant = useAppStore((x) => x.plant);
  const streak = useAppStore((x) => x.streak);
  const online = useOnline();
  if (!result) return <Navigate to="/onboarding/daily-goal" replace />;
  const o = result.outcome;
  return (
    <StepFrame
      testID="onb-14"
      title={t("onboarding:ONB-14.headline")}
      pet={pet ? { species: pet.species as "cat" | "dog", name: pet.name, text: t("onboarding:ONB-14.pet_line") } : undefined}
      primary={{ label: t("onboarding:ONB-14.primary"), onPress: () => void navigate({ to: "/onboarding/daily-goal" }), testID: "first-win-continue" }}
    >
      <div className="flex flex-col items-center gap-3 py-2">
        <PlantView stage={plant?.stage === "seed" ? "sprout" : (plant?.stage ?? "sprout")} health={plant?.health ?? "thriving"} size={180} />
        <span aria-label={t("onboarding:ONB-14.streak_pill_a11y")} data-testid="streak-day" data-streak={streak?.current ?? o.streakAfter}>
          <StreakPill days={streak?.current ?? o.streakAfter} />
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StatTile value={t("onboarding:ONB-14.xp_tile", { xp: o.xp })} label={parts(t("learn:LES-08.stat_labels"))[0] ?? ""} tint testID="first-xp" />
        <StatTile value={o.accuracy === null ? "—" : `${o.accuracy}%`} label={(parts(t("onboarding:ONB-14.accuracy_tile", { accuracy: o.accuracy ?? 0 }))[1] ?? "").trim()} tint />
        <StatTile value={t("learn:WEB-01.minutes", { n: o.minutes })} label={(parts(t("onboarding:ONB-14.time_tile", { minutes: o.minutes }))[1] ?? "").trim()} />
      </div>
      {!online && <Chip kind="status" tone="sunken" icon="CloudSlash" label={t("onboarding:ONB-14.sync_note_web")} />}
    </StepFrame>
  );
}

const GOALS = [5, 10, 20, 30] as const;

/** ONB-08: how much time a day? */
export function DailyGoal() {
  const { t } = useI18n();
  const s = useServices();
  const navigate = useNavigate();
  const d = useOnboarding();
  const result = useLessonResult((x) => x.result);
  const pet = useAppStore((x) => x.pet);
  const [goal, setGoal] = useState<number>(d.dailyGoal ?? 10);
  const submit = () => {
    useOnboarding.getState().update({ dailyGoal: goal });
    void s.record("onboarding_answer", { step: "daily_goal", value: goal });
    s.analytics.track("daily_goal_selected", { minutes: goal });
    void navigate({ to: "/onboarding/reminder" });
  };
  return (
    <StepFrame
      testID="onb-08"
      title={t("onboarding:ONB-08.headline")}
      helper={result ? t("onboarding:ONB-08.helper", { minutes: result.outcome.minutes }) : t("onboarding:ONB-08.helper_deferred")}
      pet={pet ? { species: pet.species as "cat" | "dog", name: pet.name, text: t("onboarding:ONB-08.pet_line") } : undefined}
      primary={{ label: t("onboarding:ONB-08.primary"), onPress: submit, testID: "goal-set" }}
    >
      <div role="radiogroup" aria-label={t("onboarding:ONB-08.headline")} className="flex flex-col gap-2">
        {GOALS.map((g) => {
          const on = goal === g;
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setGoal(g)}
              data-testid={`goal-${g}`}
              className={`flex h-14 items-center rounded-md px-4 text-start text-heading outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary ${on ? "bg-primary-tint text-primary-text ring-2 ring-inset ring-primary" : "bg-surface shadow-card"}`}
            >
              {t(`onboarding:ONB-08.stop_${g}`)}
            </button>
          );
        })}
      </div>
      <Text variant="caption" tone="muted">
        {t("onboarding:ONB-08.streak_note")} {t("onboarding:ONB-08.change_note")}
      </Text>
    </StepFrame>
  );
}

const TIMES = ["07:00", "17:00", "19:00", "21:00"] as const;

/** ONB-15: a daily reminder. On the web the browser asks for notification permission. */
export function Reminder() {
  const { t } = useI18n();
  const s = useServices();
  const navigate = useNavigate();
  const pet = useAppStore((x) => x.pet);
  const labels = parts(t("onboarding:ONB-15.chip_times"));
  const [time, setTime] = useState<string>(TIMES[2]);
  const label = labels[TIMES.indexOf(time as (typeof TIMES)[number])] ?? time;
  const finish = (reminder: string | null) => {
    const ob = useOnboarding.getState();
    ob.update({ reminder: reminder ?? false, completedAt: new Date().toISOString() });
    s.analytics.track("onboarding_completed", { total_ms: Date.now() - new Date(ob.installedAt).getTime(), first_session_done: "yes" });
    void navigate({ to: "/learn", replace: true });
  };
  const yes = async () => {
    let granted = false;
    try {
      if (typeof Notification !== "undefined") granted = (await Notification.requestPermission()) === "granted";
    } catch {
      granted = false;
    }
    void s.record("onboarding_answer", { step: "reminder", value: time });
    if (granted) toast.show(t("onboarding:ONB-15.granted_toast", { time: label }), { icon: "Bell" });
    else toast.show(t("onboarding:ONB-15.denied_title"), { icon: "Bell" });
    finish(time);
  };
  return (
    <StepFrame
      testID="onb-15"
      title={t("onboarding:ONB-15.headline", { time: label })}
      helper={t("onboarding:ONB-15.body")}
      pet={pet ? { species: pet.species as "cat" | "dog", name: pet.name, text: t("onboarding:ONB-08.pet_line") } : undefined}
      primary={{ label: t("onboarding:ONB-15.primary"), onPress: () => void yes(), testID: "reminder-yes" }}
      secondary={{ label: t("onboarding:ONB-15.secondary"), onPress: () => finish(null), testID: "reminder-later" }}
    >
      <ChoiceChips label={t("onboarding:ONB-15.headline", { time: label })} hideLabel options={TIMES.map((v, i) => ({ value: v, label: labels[i] ?? v }))} value={[time]} onChange={(v) => v[0] && setTime(v[0])} testID="reminder-times" />
    </StepFrame>
  );
}
