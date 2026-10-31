/**
 * ENT-08 streak check-in sheet, lazy on Home. Comeback (droopy, dry), resting (wilted, dormant,
 * with the revival quest) and long break (30+ days away, adds the comeback plan row). The freeze
 * and incident variants wait for a server "freeze used" fact; the exam-date row waits for an
 * ONB-06 edit mode on the web. Nothing here is computed from copy: days come from the plant.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { displayHealth } from "@smriti/app-core";
import { useAppStore } from "@smriti/app-core/react";
import { Button, DayDots, Icon, PetView, PlantView, Sheet, Text } from "@smriti/ui-web";
import type { MessageKey } from "@smriti/i18n/core";
import { useServices } from "../../boot/context";
import { useAgeBand } from "../../components/SignIn";
import { markCheckinShown, type Checkin } from "../../lib/checkin";
import { useI18n } from "../../lib/i18n";
import { useOnline } from "../../lib/network";

export function StreakCheckin({ checkin, today, onLesson }: { checkin: Checkin; today: string; onLesson: () => void }) {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const plant = useAppStore((x) => x.plant);
  const pet = useAppStore((x) => x.pet);
  const little = useAgeBand() === "u10";
  const [open, setOpen] = useState(false);
  const shown = useRef(false);
  const { variant, tone, daysAway } = checkin;

  // The sheet rises 600 ms after Home paints (UX ENT-08).
  useEffect(() => {
    const id = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!open || shown.current) return;
    shown.current = true;
    markCheckinShown(today);
    s.analytics.track("streak_checkin_shown", { variant, days_away_bucket: daysAway });
  }, [open, today, s, variant, daysAway]);

  if (!plant) return null;
  const act = (action: string, go?: () => void) => {
    s.analytics.track("streak_checkin_action", { variant, days_away_bucket: daysAway, action });
    setOpen(false);
    go?.();
  };
  const daysLeft = plant.revival_days != null ? Math.max(0, plant.revival_days - (plant.revival_progress ?? 0)) : null;
  const resting = tone === "resting";
  const title = little ? t("onboarding:ENT-08.little_learner_title") : resting ? t("onboarding:ENT-08.resting_title") : t("onboarding:ENT-08.comeback_title");
  const body = little ? null : resting ? (daysLeft != null ? t("onboarding:ENT-08.resting_body", { days: daysLeft }) : null) : t("onboarding:ENT-08.comeback_body");
  const primary = little ? t("onboarding:ENT-08.little_learner_primary") : resting ? t("onboarding:ENT-08.start_revival") : t("onboarding:ENT-08.comeback_primary");
  const stage = t(`me_money:ME-07.stage_${plant.stage}` as MessageKey);
  const dots =
    resting && !little && plant.revival_days
      ? Array.from({ length: plant.revival_days }, (_, i) => {
          const done = plant.revival_progress ?? 0;
          return { label: String(i + 1), state: i < done ? ("done" as const) : i === done ? ("today" as const) : ("todo" as const) };
        })
      : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o && open) act("dismiss");
      }}
      title={title}
      hideTitle
      testID="ent-08"
      footer={
        <span className="flex flex-col gap-2">
          <Button label={primary} onPress={() => act("primary", resting && !little ? () => void navigate({ to: "/me/revival" }) : onLesson)} testID="checkin-primary" />
          <Button variant="ghost" label={t("onboarding:ENT-08.secondary")} onPress={() => act("dismiss")} testID="checkin-home" />
        </span>
      }
    >
      <div className="flex flex-col gap-4" data-variant={variant}>
        <div className="flex items-end justify-center gap-3">
          <PlantView stage={plant.stage} health={displayHealth(plant.health, { under10: little })} size={200} alt={`${stage} · ${t(`me_money:ME-07.health_${displayHealth(plant.health, { under10: little })}` as MessageKey)}`} />
          {pet && <PetView species={pet.species} mood={little ? "sleepy" : resting ? "resting" : "sadButHopeful"} under10={little} size={96} decorative />}
        </div>
        <Text variant="title" heading as="h2">
          {title}
        </Text>
        {body && <Text tone="muted">{body}</Text>}
        <p className="m-0 flex items-center gap-2 rounded-card bg-surface-sunken px-4 py-3" data-testid="checkin-growth">
          <Icon name="Plant" color="primary" weight="fill" />
          <Text variant="label" as="span" className="tabular-nums">
            {t("onboarding:ENT-08.growth_stat", { stage_name: stage })}
          </Text>
        </p>
        {dots && <DayDots days={dots} label={t("me_money:ME-08.progress", { x: plant.revival_progress ?? 0, y: plant.revival_days })} testID="checkin-dots" />}
        {variant === "long_break" && !little && (
          <button
            type="button"
            onClick={() => act("comeback_plan", () => void navigate({ to: "/review" }))}
            className="flex min-h-14 items-center gap-3 rounded-card bg-surface px-4 text-start shadow-card"
            data-testid="checkin-comeback-plan"
          >
            <Icon name="CalendarCheck" color="primary" />
            <span className="flex min-w-0 flex-1 flex-col">
              <Text variant="label">{t("onboarding:ENT-08.long_break_row_1")}</Text>
              <Text variant="caption" tone="muted">
                {t("onboarding:ENT-08.long_break_row_1_caption")}
              </Text>
            </span>
            <Icon name="CaretRight" color="inkMuted" />
          </button>
        )}
        {!online && (
          <Text variant="caption" tone="muted">
            {t("onboarding:ENT-08.offline_caption")}
          </Text>
        )}
      </div>
    </Sheet>
  );
}
