/**
 * ME-04 pet room, ME-08 revival quest, ME-17 shop (with the ME-18 buy dialog) and ME-20 quests,
 * on the server's game routes (`lib/game`). Caps, prices and rewards come from the server and
 * config, never from this file. Pet and item art are Agnes stills (PetView / PlantView).
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ApiError } from "@smriti/api-client";
import { derivePetState, type PetCareAction } from "@smriti/app-core";
import { useAppStore } from "@smriti/app-core/react";
import {
  Button,
  Card,
  Chip,
  DayDots,
  Dialog,
  EmptyState,
  Icon,
  Meter,
  PetLine,
  PetView,
  PlantView,
  ProgressBar,
  Text,
  TopBar,
  type IconName,
} from "@smriti/ui-web";
import type { MessageKey } from "@smriti/i18n/core";
import { useServices } from "../../boot/context";
import { useAgeBand } from "../../components/SignIn";
import {
  buyItem,
  careForPet,
  careLeft,
  careUsed,
  claimQuest,
  revivalLevel,
  timeLeft,
  useGameRefresh,
  usePet,
  usePlant,
  useQuests,
  useShop,
  type Quest,
  type ShopItem,
} from "../../lib/game";
import { useReviewQueue } from "../../lib/home";
import { useI18n, type T } from "../../lib/i18n";
import { useOnline } from "../../lib/network";
import { useIsPro } from "../../lib/pro";
import { toast } from "../../lib/toast";
import { LoadError, RouteLoading } from "../../shell/States";

const PET_STATE = ["happy", "content", "sleepy", "tired", "missing_you", "resting"] as const;
type PetStateWord = (typeof PET_STATE)[number];
const asState = (s: string | undefined): PetStateWord =>
  (PET_STATE as readonly string[]).includes(s ?? "") ? (s as PetStateWord) : "content";
const PET_MOOD = {
  happy: "happy",
  content: "happy",
  sleepy: "sleepy",
  tired: "tired",
  missing_you: "sadButHopeful",
  resting: "resting",
} as const;

function Page({ testID, children }: { testID: string; children: React.ReactNode }) {
  return (
    <div
      className="mx-auto flex w-full max-w-[960px] flex-col gap-4 px-4 pb-6 md:px-8"
      data-testid={testID}
    >
      {children}
    </div>
  );
}

function problemText(t: T, err: unknown, fallback: MessageKey): string {
  if (err instanceof ApiError && err.code === "not_enough_gems") return t("me_money:ME-18.error");
  return t(fallback);
}

/** ME-04: the pet's mood and energy, three care actions, and "Study together". */
export function PetRoom() {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const band = useAgeBand();
  const under10 = band === "u10";
  const q = usePet();
  const plant = usePlant();
  const queue = useReviewQueue();
  const refresh = useGameRefresh();
  const [busy, setBusy] = useState<PetCareAction | null>(null);
  const [capLine, setCapLine] = useState(false);
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current || !q.data?.pet) return;
    viewed.current = true;
    s.analytics.track("pet_room_viewed", { pet_state: q.data.pet.state });
  }, [q.data, s]);

  if (q.isPending) return <RouteLoading />;
  if (q.isError || !q.data) return <LoadError onRetry={() => void q.refetch()} />;
  const pet = q.data.pet;
  if (!pet)
    return (
      <Page testID="me-04">
        <TopBar title={t("me_money:WEB-09.pet_room")} onBack={() => void navigate({ to: "/me" })} />
        <EmptyState
          illustration="ui-all-caught-up"
          text={t("me_money:WEB-09.revival_not_needed")}
        />
      </Page>
    );

  const species = pet.species;
  const state = under10
    ? asState(derivePetState({ mood: pet.mood, energy: pet.energy }, { under10: true }))
    : asState(pet.state);
  const stateWord = t(`me_money:ME-04.state_${state}` as MessageKey);
  const left = careLeft(careUsed(q.data), {
    moodCap: s.flags.get("game.pet.care_mood_cap_per_day"),
    petGain: s.flags.get("game.pet.pet_mood_gain"),
    plays: s.flags.get("game.pet.plays_per_day"),
    treats: s.flags.get("game.pet.treats_per_day"),
  });
  const treats = q.data.treats_held;
  const reviews = queue?.cards.length ?? 0;
  const revival = revivalLevel(plant.data);

  const care = async (action: PetCareAction) => {
    if (action === "treat" && treats <= 0) {
      void navigate({ to: "/me/shop" });
      return;
    }
    setBusy(action);
    try {
      await careForPet(s, action);
      s.analytics.track("pet_care_action", { action, pet_state_before: pet.state });
      refresh();
      const after = { ...left, [action]: left[action] - 1 };
      if (after[action] <= 0) setCapLine(true);
    } catch {
      toast.show(t("me_money:ME-18.error"), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const careButton = (action: PetCareAction, icon: IconName, label: string) => {
    const n = left[action];
    const done = n <= 0 && !(action === "treat" && treats <= 0);
    return (
      <div className="flex flex-col items-center gap-1">
        <Button
          variant="secondary"
          icon={icon}
          label={label}
          onPress={() => void care(action)}
          disabled={done || !online || busy !== null}
          loading={busy === action}
          accessibilityLabel={`${label}, ${t("me_money:WEB-09.care_left", { n })}`}
          testID={`care-${action}`}
        />
        <Text variant="caption" tone="muted">
          {done
            ? t("me_money:ME-04.care_done")
            : action === "treat" && treats <= 0
              ? t("me_money:ME-04.no_treats")
              : t("me_money:WEB-09.care_left", { n })}
        </Text>
      </div>
    );
  };

  return (
    <Page testID="me-04">
      <TopBar
        title={t("me_money:ME-04.title", { pet: pet.name })}
        onBack={() => void navigate({ to: "/me" })}
      />
      <main id="main" className="grid gap-6 md:grid-cols-[minmax(0,640px)_1fr]">
        <div
          className="flex flex-col items-center gap-3 rounded-card-large bg-primary-tint p-6"
          data-testid="pet-scene"
        >
          <PetLine
            pet={{ species, mood: PET_MOOD[state] }}
            petName={pet.name}
            text={
              capLine
                ? t("me_money:ME-04.pet_line_care_cap")
                : under10 && state === "sleepy"
                  ? t("me_money:ME-04.little_learner_pet_line_under_10_sleepy")
                  : t(`me_money:ME-04.pet_line_${state}` as MessageKey)
            }
            className="self-start"
          />
          <PetView
            species={species}
            mood={PET_MOOD[state]}
            under10={under10}
            size={200}
            alt={`${pet.name}: ${stateWord}`}
            testID="pet-view"
          />
          {plant.data && (
            <PlantView
              stage={plant.data.stage}
              health={plant.data.health}
              size={72}
              decorative
              className="self-end"
            />
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Meter
            kind="mood"
            label={t("me_money:ME-04.mood.1")}
            stateWord={stateWord}
            value={pet.mood}
            testID="meter-mood"
          />
          <Meter
            kind="energy"
            label={t("me_money:ME-04.energy")}
            stateWord={String(Math.round(pet.energy))}
            value={pet.energy}
            testID="meter-energy"
          />
          <div className="grid grid-cols-3 gap-2" data-testid="care-row">
            {careButton("pet", "Smiley", t("me_money:ME-04.care_pet"))}
            {careButton("play", "Star", t("me_money:ME-04.care_play"))}
            {careButton("treat", "Gift", t("me_money:ME-04.care_treat", { n: treats }))}
          </div>
          {revival !== "none" && plant.data && (
            <Card
              tone="tint"
              onPress={() => void navigate({ to: "/me/revival" })}
              testID="revival-card"
            >
              <span className="flex items-center gap-3">
                <Icon name="Plant" color="primary" />
                <Text variant="label" className="flex-1">
                  {t("me_money:ME-04.revival_card", {
                    x: plant.data.revival_progress + 1,
                    y: plant.data.revival_target ?? plant.data.revival_days ?? 0,
                    pet: pet.name,
                  })}
                </Text>
                <Icon name="CaretRight" color="inkMuted" />
              </span>
            </Card>
          )}
          <Button
            label={t("me_money:ME-04.study_together")}
            onPress={() => void navigate(reviews > 0 ? { to: "/review" } : { to: "/learn" })}
            testID="study-together"
          />
          {reviews > 0 && (
            <Text variant="caption" tone="muted" align="center">
              {t("me_money:ME-04.caption_reviews", { n: reviews })}
            </Text>
          )}
        </div>
      </main>
    </Page>
  );
}

/** ME-08: the revival quest for a wilted (3 days) or resting (5 days) plant. */
export function Revival() {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const q = usePlant();
  const pet = useAppStore((x) => x.pet);
  const streak = useAppStore((x) => x.streak);
  const started = useRef(false);
  const level = revivalLevel(q.data);

  useEffect(() => {
    if (started.current || level === "none") return;
    started.current = true;
    s.analytics.track("revival_quest_started", {
      kind: level === "resting" ? "dormant" : "wilted",
      day: (q.data?.revival_progress ?? 0) + 1,
    });
  }, [level, s, q.data]);

  if (q.isPending) return <RouteLoading />;
  if (q.isError || !q.data) return <LoadError onRetry={() => void q.refetch()} />;
  const p = q.data;
  const back = () =>
    window.history.length > 1 ? window.history.back() : void navigate({ to: "/me" });

  if (level === "none")
    return (
      <Page testID="me-08">
        <TopBar onBack={back} backIcon="X" />
        <EmptyState
          plant={{ stage: p.stage, health: p.health }}
          text={t("me_money:WEB-09.revival_not_needed")}
        />
      </Page>
    );

  const days = p.revival_target ?? p.revival_days ?? 0;
  const done = Math.min(days, p.revival_progress);
  const todayDone = streak?.today_qualified === true;
  const dots = Array.from({ length: days }, (_, i) => ({
    label: String(i + 1),
    state: i < done ? ("done" as const) : i === done ? ("today" as const) : ("todo" as const),
  }));

  return (
    <Page testID="me-08">
      <TopBar onBack={back} backIcon="X" />
      <main id="main" className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
        <div className="flex items-end justify-center gap-4">
          {pet && <PetView species={pet.species} mood="sadButHopeful" size={120} decorative />}
          <PlantView
            stage={p.stage}
            health={p.health}
            size={140}
            alt={t(`me_money:ME-07.health_${p.health}` as MessageKey)}
          />
        </div>
        <Text variant="display" heading as="h1">
          {level === "resting"
            ? t("me_money:ME-08.title_resting")
            : t("me_money:ME-08.title_wilted")}
        </Text>
        <Text tone="muted">{t("me_money:ME-08.body", { days, pet: pet?.name ?? "" })}</Text>
        <DayDots
          days={dots}
          label={t("me_money:ME-08.progress", { x: done, y: days })}
          testID="revival-dots"
        />
        <Text variant="caption">{t("me_money:ME-08.what_counts")}</Text>
        <Text variant="caption" tone="muted">
          {t("me_money:ME-08.rescue_note")}
        </Text>
        <Card tone="sunken">
          <span className="flex items-center gap-3">
            <Icon name="Gift" color="primary" />
            <Text variant="label">
              {t("me_money:ME-08.reward", { n: s.flags.get("game.economy.first_revival_gems") })}
            </Text>
          </span>
        </Card>
        {todayDone ? (
          <Text variant="label" testID="revival-done-today">
            {t("me_money:ME-08.done_today")}
          </Text>
        ) : (
          <Button
            label={t("me_money:ME-08.start")}
            onPress={() => void navigate({ to: "/learn" })}
            testID="revival-start"
          />
        )}
        <Button
          variant="ghost"
          label={t("me_money:ME-08.later")}
          onPress={back}
          testID="revival-later"
        />
      </main>
    </Page>
  );
}

const ITEM_ICON: Record<string, IconName> = { freeze: "Snowflake", treat: "Gift" };

/** ME-17 shop with the ME-18 buy dialog. Only items with names and art in the app are listed. */
export function Shop() {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const pro = useIsPro();
  const band = useAgeBand();
  const q = useShop();
  const petQ = usePet();
  const pet = useAppStore((x) => x.pet);
  const streak = useAppStore((x) => x.streak);
  const refresh = useGameRefresh();
  const [pick, setPick] = useState<ShopItem | null>(null);
  const [busy, setBusy] = useState(false);
  const viewed = useRef(false);
  const slots = s.flags.get("streak.freeze_slots_max");
  const treatsCap = s.flags.get("game.shop.treats_max_held");

  useEffect(() => {
    if (viewed.current || !q.data) return;
    viewed.current = true;
    s.analytics.track("shop_viewed", { gems: q.data.gems });
  }, [q.data, s]);

  if (q.isPending) return <RouteLoading />;
  if (q.isError || !q.data) return <LoadError onRetry={() => void q.refetch()} />;
  const gems = q.data.gems;
  const held = (it: ShopItem) =>
    it.kind === "freeze"
      ? (streak?.freezes_available ?? 0) + (streak?.freezes_equipped ?? 0)
      : it.kind === "treat"
        ? (petQ.data?.treats_held ?? it.owned)
        : it.owned;
  const name = (it: ShopItem) =>
    it.kind === "freeze"
      ? t("me_money:ME-17.freeze")
      : t("me_money:ME-17.treats", { pet: pet?.name ?? "" });
  // Under-10s can't buy freezes (ME-17 states); other kinds have no names or art yet.
  const items = q.data.items.filter(
    (it) =>
      (it.kind === "treat" || it.kind === "freeze") && !(band === "u10" && it.kind === "freeze"),
  );
  const blocked = (it: ShopItem): string | null => {
    if (!online) return t("me_money:ME-17.offline");
    if (it.pro_only && !pro) return t("me_money:ME-17.pro_only");
    if (it.kind === "freeze" && (streak?.freezes_equipped ?? 0) >= slots)
      return t("me_money:ME-17.slots_full");
    if (it.kind === "treat" && held(it) >= treatsCap) return t("me_money:ME-18.cap_reached");
    if (gems < it.price_gems) return t("me_money:ME-18.not_enough", { n: it.price_gems - gems });
    return null;
  };

  const buy = async (it: ShopItem) => {
    setBusy(true);
    try {
      await buyItem(s, it.id);
      s.analytics.track("shop_item_purchased", {
        item_id: it.id,
        kind: it.kind,
        price_gems: it.price_gems,
      });
      toast.show(t("me_money:ME-18.bought_toast"), { icon: "CheckCircle" });
      setPick(null);
      refresh();
    } catch (err) {
      s.analytics.track("shop_purchase_blocked", {
        item_id: it.id,
        reason: err instanceof ApiError && err.code === "not_enough_gems" ? "balance" : "cap",
      });
      toast.show(problemText(t, err, "me_money:ME-18.error"), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page testID="me-17">
      <TopBar title={t("me_money:ME-17.title")} onBack={() => void navigate({ to: "/me" })} />
      <span
        className="flex items-center gap-2 self-start rounded-full bg-surface px-3 py-1.5 text-label font-bold shadow-card"
        data-testid="shop-balance"
      >
        <Icon name="Diamond" size={20} color="primary" weight="fill" />
        {t("me_money:ME-17.balance", { n: gems })}
      </span>
      <Card tone="sunken">
        <span className="flex items-center gap-3">
          <Icon name="Info" color="inkMuted" />
          <Text variant="caption">{t("me_money:ME-17.how_to_earn")}</Text>
        </span>
      </Card>
      {items.length === 0 ? (
        <EmptyState illustration="ui-all-caught-up" text={t("me_money:WEB-09.shop_more_soon")} />
      ) : (
        <ul
          className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2"
          data-testid="shop-items"
        >
          {items.map((it) => {
            const why = blocked(it);
            return (
              <li key={it.id}>
                <Card
                  onPress={() => setPick(it)}
                  testID={`shop-item-${it.id}`}
                  accessibilityLabel={`${name(it)}, ${t("me_money:ME-17.balance", { n: it.price_gems })}${why ? `, ${why}` : ""}`}
                >
                  <span className="flex items-center gap-3">
                    <Icon name={ITEM_ICON[it.kind] ?? "Gift"} size={32} color="primary" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <Text variant="label">{name(it)}</Text>
                      {it.kind === "freeze" && (
                        <Text variant="caption" tone="muted">
                          {t("me_money:ME-17.freeze_have", {
                            n: streak?.freezes_equipped ?? 0,
                            slots,
                          })}
                        </Text>
                      )}
                      {why && (
                        <Text variant="caption" tone="muted">
                          {why}
                        </Text>
                      )}
                    </span>
                    <Chip kind="status" icon="Diamond" label={String(it.price_gems)} />
                    {it.pro_only && <Chip kind="status" label={t("me_money:ME-17.pro_only")} />}
                  </span>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <Text variant="caption" tone="muted">
        {t("me_money:ME-17.no_money_line")}
      </Text>
      <Dialog
        open={pick !== null}
        onOpenChange={(o) => !o && setPick(null)}
        title={pick ? name(pick) : ""}
        description={
          pick
            ? t("me_money:ME-18.balance", {
                balance: gems,
                after: Math.max(0, gems - pick.price_gems),
              })
            : undefined
        }
        confirm={
          pick && !blocked(pick)
            ? {
                label: t("me_money:ME-18.buy", { n: pick.price_gems }),
                onPress: () => !busy && void buy(pick),
              }
            : undefined
        }
        cancel={{ label: t("me_money:ME-18.not_now"), onPress: () => setPick(null) }}
        testID="me-18"
      >
        {pick?.kind === "freeze" && !blocked(pick) && (
          <Text variant="caption">
            {t("me_money:ME-18.freeze_hold", { n: held(pick) + 1, cap: slots })}
          </Text>
        )}
        {pick && blocked(pick) && (
          <span className="flex flex-col gap-2">
            <Text variant="caption">{blocked(pick)}</Text>
            {gems < pick.price_gems && (
              <Button
                variant="secondary"
                size="sm"
                label={t("me_money:ME-20.title")}
                onPress={() => void navigate({ to: "/me/quests" })}
                testID="shop-see-quests"
              />
            )}
          </span>
        )}
      </Dialog>
    </Page>
  );
}

function questText(t: T, q: Quest): string {
  const n = q.target;
  switch (q.counter) {
    case "lessons_completed":
      return t("me_money:ME-20.template_lessons", { n });
    case "reviews":
      return t("me_money:ME-20.template_reviews", { n });
    case "minutes":
      return t("me_money:ME-20.template_minutes", { n });
    case "mock_sections":
      return t("me_money:ME-20.template_mock");
    case "practice_questions":
      return t("me_money:WEB-09.quest_practice", { n });
    case "correct_answers":
      return t("me_money:WEB-09.quest_correct", { n });
    case "daily_challenge":
      return t("me_money:WEB-09.quest_challenge");
    case "focus_sessions":
      return t("me_money:WEB-09.quest_focus", { n });
    case "xp":
      return t("me_money:WEB-09.quest_xp", { n });
    default:
      return t("me_money:WEB-09.quest_other");
  }
}

const QUEST_ICON: Record<string, IconName> = {
  lessons_completed: "BookBookmark",
  reviews: "Cards",
  minutes: "Timer",
  mock_sections: "Exam",
  practice_questions: "Barbell",
  correct_answers: "CheckCircle",
  daily_challenge: "Lightning",
  focus_sessions: "Timer",
  xp: "Star",
};

/** ME-20: daily, weekly and event quests with their rewards shown up front. */
export function Quests() {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const band = useAgeBand();
  const q = useQuests();
  const pet = useAppStore((x) => x.pet);
  const refresh = useGameRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current || !q.data) return;
    viewed.current = true;
    const done = (p: string) => String(q.data.filter((x) => x.period === p && x.completed).length);
    s.analytics.track("quests_viewed", { daily_done: done("daily"), weekly_done: done("weekly") });
  }, [q.data, s]);

  if (q.isPending) return <RouteLoading />;
  if (q.isError || !q.data) return <LoadError onRetry={() => void q.refetch()} />;
  // Under-10s see only daily quests (ME-20 states).
  const all = q.data.filter((x) => band !== "u10" || x.period === "daily");
  const daily = all.filter((x) => x.period === "daily");
  const weekly = all.filter((x) => x.period === "weekly");
  const events = all.filter((x) => x.period === "event");
  const claimable = all.some((x) => x.completed && !x.claimed);
  const allDone = all.length > 0 && all.every((x) => x.claimed);

  const claim = async (quest: Quest) => {
    setBusy(quest.id);
    try {
      await claimQuest(s, quest.id);
      s.analytics.track("quest_claimed", { quest_id: quest.id, period: quest.period });
      toast.show(reward(quest) ?? t("me_money:ME-20.claimed"), { icon: "Diamond" });
      refresh();
    } catch (err) {
      toast.show(problemText(t, err, "me_money:ME-18.error"), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const reward = (quest: Quest) => {
    const g = quest.reward.gems ?? 0;
    const x = quest.reward.xp ?? 0;
    if (g && x) return t("me_money:ME-20.reward", { n: g, x });
    if (g) return t("me_money:ME-20.reward.1", { n: g });
    if (x) return t("me_money:ME-20.reward.2", { x });
    return null;
  };

  const card = (quest: Quest) => {
    const text = questText(t, quest);
    const r = reward(quest);
    const progress = Math.min(quest.progress, quest.target);
    return (
      <li key={quest.id}>
        <Card testID={`quest-${quest.id}`}>
          <span className="flex flex-col gap-2">
            <span className="flex items-center gap-3">
              <Icon name={QUEST_ICON[quest.counter ?? ""] ?? "Star"} color="primary" />
              <Text variant="label" className="flex-1">
                {text}
              </Text>
              {r && <Chip kind="status" icon="Diamond" label={r} />}
            </span>
            <ProgressBar
              value={quest.target ? progress / quest.target : 0}
              label={text}
              valueText={t("me_money:WEB-09.quest_progress", { x: progress, y: quest.target })}
            />
            <span className="flex items-center gap-2">
              <Text variant="caption" tone="muted" className="flex-1">
                {t("me_money:WEB-09.quest_progress", { x: progress, y: quest.target })}
              </Text>
              {quest.claimed ? (
                <Chip
                  kind="status"
                  tone="success"
                  icon="Check"
                  label={t("me_money:ME-20.claimed")}
                />
              ) : quest.completed ? (
                <Button
                  size="sm"
                  label={t("me_money:ME-20.claim")}
                  accessibilityLabel={`${t("me_money:ME-20.claim")}: ${text}`}
                  onPress={() => void claim(quest)}
                  disabled={!online || busy !== null}
                  loading={busy === quest.id}
                  testID={`claim-${quest.id}`}
                />
              ) : null}
            </span>
          </span>
        </Card>
      </li>
    );
  };

  const section = (title: string, list: Quest[], testID: string) =>
    list.length > 0 && (
      <section className="flex flex-col gap-2" aria-label={title} data-testid={testID}>
        <Text variant="heading" heading as="h2">
          {title}
        </Text>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">{list.map(card)}</ul>
      </section>
    );

  const dailyEnd = daily[0]?.period_end;
  const left = dailyEnd ? timeLeft(dailyEnd) : null;
  return (
    <Page testID="me-20">
      <TopBar title={t("me_money:ME-20.title")} onBack={() => void navigate({ to: "/me" })} />
      {all.length === 0 ? (
        <EmptyState illustration="ui-all-caught-up" text={t("me_money:WEB-09.quests_empty")} />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {section(
            left
              ? t("me_money:ME-20.daily", { time: t("me_money:WEB-09.time_left", left) })
              : t("me_money:ME-20.daily.1"),
            daily,
            "quests-daily",
          )}
          {section(t("me_money:ME-20.weekly"), weekly, "quests-weekly")}
          {section(t("me_money:ME-20.title"), events, "quests-event")}
        </div>
      )}
      {allDone && pet && (
        <PetLine
          pet={{ species: pet.species, mood: "proud" }}
          petName={pet.name}
          text={t("me_money:ME-20.pet_line_all_done")}
        />
      )}
      <Text variant="caption" tone="muted">
        {t("me_money:ME-20.auto_claimed_note")}
      </Text>
      {!claimable && (
        <Button
          label={t("me_money:ME-20.start")}
          onPress={() => void navigate({ to: "/learn" })}
          testID="quests-start"
        />
      )}
    </Page>
  );
}
