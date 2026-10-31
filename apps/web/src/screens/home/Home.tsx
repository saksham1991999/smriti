/**
 * HOME-01: greeting, streak card with plant and daily goal, one hero from app-core `selectHero`,
 * the "up next" strip, one secondary row, subject tiles, and Memory. No Pro upsell here (R15).
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppStore } from "@smriti/app-core/react";
import {
  Banner,
  Card,
  Chip,
  ContinueCard,
  Icon,
  IconButton,
  PetAvatar,
  StreakCard,
  StreakPill,
  SubjectTile,
  Text,
} from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { SoftPromptSheet } from "../../components/SignIn";
import { useCatalog } from "../../lib/content";
import { useHomeModel } from "../../lib/home";
import { parts, useI18n, type T } from "../../lib/i18n";
import { useOnline } from "../../lib/network";
import { useExams, useProfileIds, useTopicStatuses } from "../../lib/queries";
import { LocaleThemeToggles } from "../../shell/AppShell";
import { useSearchUI } from "../../shell/SearchHost";
import { LoadError, RouteLoading } from "../../shell/States";

/** Splits "Kicker · meta · [Action]" catalogue rows. */
export function heroText(text: string): { kicker: string; meta: string[]; actions: string[] } {
  const p = parts(text);
  const actions: string[] = [];
  const rest: string[] = [];
  for (const x of p) {
    const found = [...x.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1] ?? "");
    if (found.length) actions.push(...found);
    else rest.push(x);
  }
  return { kicker: rest[0] ?? "", meta: rest.slice(1), actions };
}

function streakMessage(
  t: T,
  s: { today_qualified: boolean; at_risk: boolean } | null,
  health: string | undefined,
): string {
  if (health === "droopy") return t("learn:HOME-01.streak_card_droopy");
  if (health === "dry") return t("learn:HOME-01.streak_card_dry");
  if (health === "wilted") return t("learn:HOME-01.streak_card_wilted");
  if (s?.today_qualified) return t("learn:HOME-01.streak_card_watered");
  if (s?.at_risk) return t("learn:HOME-01.streak_card_at_risk");
  return t("learn:HOME-01.streak_card_not_yet_today");
}

export function Home() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const catalog = useCatalog();
  const model = useHomeModel();
  const statuses = useTopicStatuses().data;
  const exams = useExams().data;
  const profileId = useProfileIds()[0];
  const session = useAppStore((x) => x.session);
  const profile = useAppStore((x) => x.profile);
  const streak = useAppStore((x) => x.streak);
  const plant = useAppStore((x) => x.plant);
  const wallet = useAppStore((x) => x.wallet);
  const pet = useAppStore((x) => x.pet);
  const [soft, setSoft] = useState(false);

  if (catalog.isError) return <LoadError onRetry={() => void catalog.refetch()} />;
  if (catalog.isPending || (!model && !catalog.unpublished)) return <RouteLoading />;

  const exam = exams?.find((e) => e.profiles.some((p) => p.id === profileId));
  const name =
    profile && !session.isGuest ? (profile as { display_name?: string | null }).display_name : null;
  const greeting = name
    ? t("learn:HOME-01.greeting_any", { name })
    : t("learn:HOME-01.greeting_guest");
  const goal = model?.dailyGoal ?? null;

  const openTopic = (topicId: string, mode: "deep_dive" | "quick_revision" = "deep_dive") =>
    void navigate({ to: "/lesson/$topicId", params: { topicId }, search: { mode } });

  const hero = (() => {
    if (!model) return null;
    const h = model.hero;
    const a = h.action;
    if (a.type === "none") return null;
    if (a.type === "review") {
      const txt = heroText(
        t("learn:HOME-01.hero_review", {
          count: a.count,
          minutes: Math.max(
            1,
            Math.round((a.count * s.flags.get("memory.default_seconds_per_card")) / 60),
          ),
        }),
      );
      return (
        <ContinueCard
          subject="physics"
          eyebrow={txt.kicker}
          eyebrowIcon="Cards"
          title={txt.meta.join(" · ")}
          actionLabel={txt.actions[0]}
          illustration="ui-all-caught-up"
          onPress={() => void navigate({ to: "/review" })}
          testID="hero"
        />
      );
    }
    if (a.type === "daily_challenge") return null;
    const topicId = a.type === "resume" ? a.bite.topicId : a.topic.topicId;
    const mode = a.type === "resume" ? a.bite.mode : a.topic.mode;
    const info = model.topics.get(topicId);
    if (!info) return null;
    const p = info.topic;
    let txt;
    if (h.kind === "continue")
      txt = heroText(
        t("learn:HOME-01.hero_continue", { percent: statuses?.get(topicId)?.percent ?? 0 }),
      );
    else if (h.kind === "start_here") txt = heroText(t("learn:HOME-01.hero_start_here"));
    else if (h.kind === "goal_met") txt = heroText(t("learn:HOME-01.hero_goal_met"));
    else if (h.kind === "streak_saver")
      txt = heroText(t("learn:HOME-01.hero_streak_saver_lesson", { minutes: p.minutes }));
    else txt = heroText(t("learn:HOME-01.hero_next_topic"));
    const action =
      h.kind === "next_topic"
        ? mode === "quick_revision"
          ? txt.actions[1]
          : txt.actions[0]
        : txt.actions[0];
    return (
      <ContinueCard
        subject={info.subject.family}
        eyebrow={txt.kicker}
        eyebrowIcon={h.kind === "streak_saver" ? "Lightning" : "Play"}
        title={p.name}
        meta={`${info.subject.name} · ${t("learn:WEB-01.minutes", { n: a.type === "resume" ? a.bite.minutesLeft : p.minutes })}`}
        progress={h.kind === "continue" ? (statuses?.get(topicId)?.percent ?? 0) / 100 : undefined}
        progressLabel={h.kind === "continue" ? txt.meta[0] : undefined}
        illustration={`subject-${info.subject.family === "maths" ? "maths" : info.subject.family}`}
        actionLabel={action}
        onPress={() => openTopic(topicId, mode)}
        testID="hero"
      />
    );
  })();

  const reviews = model?.queue?.cards.length ?? 0;

  return (
    <div className="flex flex-col gap-5 px-4 pt-3 pb-6 md:px-8 md:pt-6" data-testid="home-01">
      <header className="flex items-center gap-2">
        {exam && (
          <Chip
            kind="filter"
            label={exam.name[locale] ?? exam.name.en ?? ""}
            icon="CaretDown"
            accessibilityLabel={t("learn:HOME-01.exam_chip_a11y", { exam_name: exam.name[locale] })}
            onPress={() => void navigate({ to: "/me/settings" })}
            testID="exam-chip"
          />
        )}
        <span className="flex-1" />
        {(streak?.current ?? 0) > 0 && (
          <StreakPill
            days={streak?.current ?? 0}
            testID="home-streak"
            onPress={() => void navigate({ to: "/me" })}
          />
        )}
        {wallet && (
          <button
            type="button"
            onClick={() => void navigate({ to: "/me/shop" })}
            className="flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-label font-bold shadow-card focus-visible:outline-[3px] focus-visible:outline-primary"
            aria-label={t("learn:HOME-01.gem_pill_a11y", { n: wallet.gems })}
            data-testid="home-gems"
          >
            <Icon name="Diamond" size={20} color="primary" weight="fill" />
            {wallet.gems}
          </button>
        )}
        <IconButton
          icon="MagnifyingGlass"
          label={t("learn:WEB-10.search")}
          onPress={() => useSearchUI.getState().show()}
          testID="open-search"
        />
        <LocaleThemeToggles className="md:hidden" />
      </header>

      {!online && <Banner tone="offline" text={t("learn:HOME-01.offline_banner")} />}

      <div className="flex items-center gap-3">
        {pet && (
          <button
            type="button"
            onClick={() => void navigate({ to: "/me/pet" })}
            className="rounded-full focus-visible:outline-[3px] focus-visible:outline-primary"
            data-testid="home-pet"
          >
            <PetAvatar species={pet.species as "cat" | "dog"} size={44} alt={pet.name} />
          </button>
        )}
        <Text variant="title" heading as="h1">
          {greeting}
        </Text>
      </div>

      {catalog.fixture && (
        <Chip
          kind="status"
          tone="warning"
          icon="Info"
          label={t("learn:WEB-01.fixture_notice")}
          className="self-start"
          testID="fixture-chip"
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <StreakCard
            message={streakMessage(t, streak, plant?.health)}
            goal={
              goal
                ? {
                    done: Math.min(goal, model?.todayMinutes ?? 0),
                    target: goal,
                    label: t("learn:HOME-01.daily_goal", { done: model?.todayMinutes ?? 0, goal }),
                  }
                : undefined
            }
            freezes={
              streak
                ? { ready: streak.freezes_available, slots: streak.freezes_equipped }
                : undefined
            }
            atRisk={streak?.at_risk}
            plant={{ stage: plant?.stage ?? "seed", health: plant?.health ?? "thriving" }}
            onPress={() => void navigate({ to: "/me" })}
            testID="streak-card"
          />
          {session.isGuest && (
            <button
              type="button"
              onClick={() => setSoft(true)}
              className="self-start rounded-xs px-1 text-label font-bold text-primary-text underline-offset-2 hover:underline focus-visible:outline-[3px] focus-visible:outline-primary"
              data-testid="save-plant-link"
            >
              {t("learn:HOME-01.guest_link_day_2")}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {hero}
          {model?.secondary?.kind === "reviews" && (
            <Card onPress={() => void navigate({ to: "/review" })} testID="secondary-reviews">
              <span className="flex items-center gap-3">
                <Icon name="Cards" color="primary" />
                <Text variant="label" className="flex-1">
                  {t("learn:HOME-01.secondary_reviews", {
                    count: reviews,
                    minutes: Math.max(
                      1,
                      Math.round((reviews * s.flags.get("memory.default_seconds_per_card")) / 60),
                    ),
                  })}
                </Text>
                <Icon name="CaretRight" color="inkMuted" />
              </span>
            </Card>
          )}
          {model?.secondary?.kind === "topic" &&
            (() => {
              const info = model.topics.get(model.secondary.topic.topicId);
              return info ? (
                <Card onPress={() => openTopic(info.topic.id)} testID="secondary-topic">
                  <span className="flex items-center gap-3">
                    <Icon name="Play" color="primary" />
                    <Text variant="label" className="flex-1">
                      {t("learn:HOME-01.secondary_continue", { topic_title: info.topic.name })}
                    </Text>
                    <Icon name="CaretRight" color="inkMuted" />
                  </span>
                </Card>
              ) : null;
            })()}
          {model && model.hero.action.type === "none" && reviews === 0 && (
            <Text tone="muted" testID="all-caught-up">
              {t("learn:HOME-01.all_caught_up", { duration: "—" })}
            </Text>
          )}
        </div>
      </div>

      {model?.nextInChapter && (
        <section className="flex flex-col gap-2" aria-labelledby="strip-label">
          <div className="flex items-center justify-between gap-2">
            <Text variant="label" id="strip-label">
              {
                parts(
                  t("learn:HOME-01.strip_label", {
                    chapter_title: model.nextInChapter.chapterName,
                    n: model.nextInChapter.topics.filter(
                      (x) => statuses?.get(x.id)?.status !== "learned",
                    ).length,
                  }),
                )[0]
              }
            </Text>
            <button
              type="button"
              className="rounded-xs text-label font-bold text-primary-text focus-visible:outline-[3px] focus-visible:outline-primary"
              onClick={() =>
                void navigate({
                  to: "/learn/chapter/$chapterId",
                  params: { chapterId: model.nextInChapter?.chapterId ?? "" },
                })
              }
            >
              {parts(t("learn:HOME-01.strip_chips"))[1]}
            </button>
          </div>
          <ol className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1">
            {model.nextInChapter.topics.map((x) => {
              const learned = statuses?.get(x.id)?.status === "learned";
              return (
                <li key={x.id}>
                  <Chip
                    kind="filter"
                    label={x.name}
                    icon={learned ? "CheckCircle" : "Play"}
                    selected={learned}
                    onPress={() =>
                      void navigate({ to: "/learn/topic/$topicId", params: { topicId: x.id } })
                    }
                    testID={`strip-${x.id}`}
                  />
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="subjects-heading">
        <Text variant="title" heading as="h2" id="subjects-heading">
          {t("learn:HOME-01.subjects_heading")}
        </Text>
        {catalog.unpublished && <Text tone="muted">{t("learn:WEB-01.load_error")}</Text>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {catalog.subjects.map((sub) => {
            const topicsAll = sub.chapters.flatMap((c) => c.topics);
            const done = topicsAll.filter((x) => statuses?.get(x.id)?.status === "learned").length;
            const next = topicsAll.find((x) => statuses?.get(x.id)?.status !== "learned");
            return (
              <SubjectTile
                key={sub.id}
                subject={sub.family}
                name={sub.name}
                progress={topicsAll.length ? done / topicsAll.length : 0}
                caption={t("learn:HOME-01.tile_meta", { n: sub.chapters.length })}
                next={next ? t("learn:HOME-01.tile_next", { topic_title: next.name }) : undefined}
                illustration={`subject-${sub.family}`}
                onPress={() =>
                  void navigate({ to: "/learn/subject/$subjectId", params: { subjectId: sub.id } })
                }
                testID={`subject-${sub.id}`}
              />
            );
          })}
          <Card onPress={() => void navigate({ to: "/review" })} testID="memory-tile">
            <span className="flex flex-col gap-1">
              <Icon name="Brain" color="primary" />
              <Text variant="heading">{parts(t("learn:HOME-01.memory_tile"))[0]}</Text>
              <Text variant="caption" tone="muted">
                {parts(t("learn:HOME-01.memory_tile"))[1]}
              </Text>
            </span>
          </Card>
        </div>
      </section>
      <SoftPromptSheet open={soft} reason="save_progress" onClose={() => setSoft(false)} />
    </div>
  );
}
