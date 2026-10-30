/**
 * ME-01: who you are (or "Guest"), the save-your-progress card for guests, stats from the synced
 * state, the pet and plant, the Pro card, and links to memory, Your plan and Settings.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppStore } from "@smriti/app-core/react";
import { Button, Card, Icon, IconButton, PetAvatar, PetLine, PlantView, SettingsGroup, SettingsRow, StatTile, Text, TrustLine } from "@smriti/ui-web";
import { SoftPromptSheet } from "../../components/SignIn";
import { LocaleThemeToggles } from "../../shell/AppShell";
import { savedEmail } from "../../lib/auth";
import { useReviewQueue } from "../../lib/home";
import { formatDate, useI18n } from "../../lib/i18n";
import { useOnboarding } from "../../lib/onboarding";
import { useIsPro } from "../../lib/pro";

const STAGE = {
  seed: "me_money:ME-07.stage_seed",
  sprout: "me_money:ME-07.stage_sprout",
  sapling: "me_money:ME-07.stage_sapling",
  flowering: "me_money:ME-07.stage_flowering",
  tree: "me_money:ME-07.stage_tree",
} as const;

export function Me() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const guest = useAppStore((x) => x.session.isGuest);
  const profile = useAppStore((x) => x.profile);
  const streak = useAppStore((x) => x.streak);
  const wallet = useAppStore((x) => x.wallet);
  const pet = useAppStore((x) => x.pet);
  const plant = useAppStore((x) => x.plant);
  const ent = useAppStore((x) => x.entitlement);
  const lessons = useOnboarding((x) => x.lessonsCompleted);
  const pro = useIsPro();
  const queue = useReviewQueue();
  const [prompt, setPrompt] = useState(false);
  const email = guest ? null : savedEmail.get();
  const name = guest ? t("me_money:ME-01.guest_name") : (profile?.display_name ?? email ?? "");

  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-6 md:px-8 md:pt-6" data-testid="me-01">
      <header className="flex items-center gap-3">
        <Text variant="title" heading as="h1" className="flex-1">
          {t("me_money:ME-01.title")}
        </Text>
        <span className="md:hidden">
          <LocaleThemeToggles />
        </span>
        <IconButton icon="Gear" label={t("me_money:SET-01.title")} onPress={() => void navigate({ to: "/me/settings" })} testID="open-settings" />
      </header>

      <div className="flex items-center gap-3">
        {pet ? <PetAvatar species={pet.species as "cat" | "dog"} size={56} alt={pet.name} /> : <Icon name="UserCircle" size={32} color="inkMuted" />}
        <span className="flex min-w-0 flex-col">
          <Text variant="heading" testID="me-name">
            {name}
          </Text>
          {email && (
            <Text variant="caption" tone="muted">
              {email}
            </Text>
          )}
        </span>
      </div>

      {guest && (
        <Card tone="tint" testID="me-guest-card">
          <span className="flex flex-col gap-2">
            <Text variant="heading">{t("me_money:ME-01.guest_card_title")}</Text>
            <Text tone="muted">{t("me_money:ME-01.guest_card_body", { pet: pet?.name ?? "" })}</Text>
            <Button label={t("me_money:ME-01.guest_card_button")} onPress={() => setPrompt(true)} testID="me-sign-in" />
            <TrustLine />
          </span>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-2">
        <StatTile value={String(streak?.current ?? 0)} label={t("me_money:ME-01.stat_streak")} icon="Plant" testID="me-streak" />
        <StatTile value={String(wallet?.xp_total ?? 0)} label={t("me_money:ME-01.stat_xp")} icon="Lightning" />
        <StatTile value={String(lessons)} label={t("me_money:ME-01.stat_lessons")} icon="BookBookmark" />
      </div>

      {pet && <PetLine pet={{ species: pet.species as "cat" | "dog" }} petName={pet.name} text={guest ? t("me_money:ME-01.pet_line_guest") : t("me_money:ME-01.pet_line_default", { name: profile?.display_name ?? "" })} />}

      {plant && (
        <Card testID="me-plant">
          <span className="flex items-center gap-3">
            <PlantView stage={plant.stage} health={plant.health} size={72} decorative />
            <span className="flex flex-col">
              <Text variant="heading">{t("me_money:ME-01.plant_card")}</Text>
              <Text variant="caption" tone="muted">
                {t(STAGE[plant.stage])}
              </Text>
            </span>
          </span>
        </Card>
      )}

      <Card tone={pro ? "tint" : "surface"} onPress={() => void navigate(pro ? { to: "/me/plan" } : { to: "/pro", search: { source: "me_card" } })} testID="me-pro-card">
        <span className="flex items-center gap-3">
          <Icon name="Diamond" color="primary" weight="fill" />
          <Text variant="heading" className="flex-1">
            {pro && ent?.pro_until
              ? ent.cancel_at_period_end
                ? t("me_money:ME-01.pro_card_ending", { date: formatDate(ent.pro_until, locale) })
                : t("me_money:ME-01.pro_card_pro", { date: formatDate(ent.pro_until, locale) })
              : t("me_money:ME-01.pro_card_eligible")}
          </Text>
          <Icon name="CaretRight" color="inkMuted" />
        </span>
      </Card>

      <SettingsGroup title={t("me_money:ME-01.learning_group")}>
        <SettingsRow title={t("me_money:ME-01.my_memory")} icon="Brain" value={t("me_money:ME-01.my_memory_caption", { n: queue?.cards.length ?? 0 })} onPress={() => void navigate({ to: "/review" })} testID="me-memory" />
        <SettingsRow title={t("me_money:SET-01.notifications")} icon="Bell" onPress={() => void navigate({ to: "/me/notifications" })} />
        <SettingsRow title={t("me_money:SET-01.title")} icon="Gear" onPress={() => void navigate({ to: "/me/settings" })} testID="me-settings" />
      </SettingsGroup>

      <SoftPromptSheet open={prompt} reason="save_progress" onClose={() => setPrompt(false)} />
    </div>
  );
}
