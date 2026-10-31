/**
 * MEM-03 review session, with MEM-02 (comeback plan) before it and MEM-04 (session complete)
 * after it. Cards come from app-core's capped daily queue, today's chunk of an active comeback
 * plan, or one deck or topic (MEM-07 "Study due"). Ratings are scheduled on the device (R18) and
 * sent as `review_rated` with the client's FSRS state.
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildComebackPlan,
  comebackChunkFor,
  comebackStartedPayload,
  localDate,
  sessionSlice,
  shouldOfferComeback,
  type ComebackPlan,
  type ReviewRating,
  type SrsCardRow,
} from "@smriti/app-core";
import { useAppStore } from "@smriti/app-core/react";
import {
  CardView,
  PlayerProvider,
  QuestionView,
  contentUrl,
  initialDraft,
} from "@smriti/lesson-player-web";
import {
  Button,
  ChoiceChips,
  Illustration,
  PetLine,
  RatingButtons,
  SegmentedProgress,
  Spinner,
  StatTile,
  Text,
  TopBar,
} from "@smriti/ui-web";
import type { Rating } from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { useBundle } from "../../lib/content";
import { useReviewQueue } from "../../lib/home";
import { formatDate, useI18n } from "../../lib/i18n";
import { rateCard } from "../../lib/learner";
import { useOnline } from "../../lib/network";
import { qk, useSrsCards } from "../../lib/queries";
import { intervalLabels } from "../../lib/srs";
import { toast } from "../../lib/toast";
import { timeZone } from "../../platform/web";
import { RouteLoading } from "../../shell/States";

const RATING: Record<Rating, ReviewRating> = { again: 1, hard: 2, good: 3, easy: 4 };
const PLAN_KEY = "comeback_plan";

export interface ReviewSearch {
  mode?: "normal";
  deck?: string;
  topic?: string;
}

interface StoredPlan {
  plan: ComebackPlan;
  daysAway: number;
}

function useComebackPlan() {
  const s = useServices();
  return useQuery({
    queryKey: ["comeback-plan"],
    queryFn: async () =>
      ((await s.storage.session_state.get(PLAN_KEY))?.data as unknown as StoredPlan | undefined) ??
      null,
  });
}

/** Cards due now in one deck (system decks are a topic's content cards) or topic. */
function dueIn(
  cards: readonly SrsCardRow[],
  filter: { deck?: string; topic?: string },
): SrsCardRow[] {
  const now = Date.now();
  return cards
    .filter((c) => !c.suspended && Date.parse(c.due_at) <= now)
    .filter((c) =>
      filter.deck
        ? c.deck_id === filter.deck ||
          (filter.deck.startsWith("topic:") && c.topic_id === filter.deck.slice(6))
        : c.topic_id === filter.topic,
    )
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
}

/** Days since the last review on this device (for the plan's first-session rule and its event). */
function daysAway(cards: readonly SrsCardRow[]): number {
  const last = cards.reduce(
    (m, c) => Math.max(m, c.last_review_at ? Date.parse(c.last_review_at) : 0),
    0,
  );
  return last ? Math.floor((Date.now() - last) / 86_400_000) : 0;
}

export function Review() {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as ReviewSearch;
  const queue = useReviewQueue();
  const all = useSrsCards().data;
  const stored = useComebackPlan();
  const pet = useAppStore((x) => x.pet);
  const queryClient = useQueryClient();
  const [cards, setCards] = useState<SrsCardRow[] | null>(null);
  const [ratings, setRatings] = useState<ReviewRating[]>([]);
  const [skipPlan, setSkipPlan] = useState(search.mode === "normal");
  const started = useRef(Date.now());
  const sessionSize = s.flags.get("memory.session_size");

  if (!queue || !all || stored.isPending) return <RouteLoading />;
  const today = localDate(Date.now(), timeZone());
  const active = stored.data ? comebackChunkFor(stored.data.plan, today) : null;
  const filtered = search.deck || search.topic;

  // MEM-02: a big backlog gets a plan first (never a wall: "Just review normally" skips it).
  const offer =
    !cards &&
    !filtered &&
    !skipPlan &&
    !active &&
    shouldOfferComeback(queue.dueTotal, [], { minDue: s.flags.get("memory.comeback.min_due") });
  if (offer)
    return (
      <ComebackPlanView
        backlog={all.filter((c) => !c.suspended && Date.parse(c.due_at) <= Date.now())}
        daysAway={daysAway(all)}
        onClose={() => void navigate({ to: "/learn" })}
        onNormal={() => setSkipPlan(true)}
        onStart={async (stored) => {
          await s.storage.session_state.put({
            key: PLAN_KEY,
            data: stored as never,
            updated_at: new Date().toISOString(),
          });
          await s.record(
            "comeback_plan_started",
            comebackStartedPayload(stored.plan, stored.daysAway),
          );
          s.analytics.track("comeback_plan_started", {
            plan_days: stored.plan.planDays,
            daily_chunk: stored.plan.dailyChunk,
            relearn_topics: stored.plan.relearnTopics.length,
          });
          await queryClient.invalidateQueries({ queryKey: ["comeback-plan"] });
        }}
      />
    );

  const byRef = new Map(all.map((c) => [c.card_ref, c]));
  const fromPlan =
    active && !skipPlan && !filtered
      ? (stored.data?.plan.firstSession && active.dayIndex === 1
          ? stored.data.plan.firstSession
          : active.cardRefs
        )
          .map((r) => byRef.get(r))
          .filter((c): c is SrsCardRow => !!c && !c.suspended)
      : null;
  const session =
    cards ??
    (filtered
      ? sessionSlice(dueIn(all, search), sessionSize)
      : (fromPlan ?? sessionSlice(queue.cards, sessionSize)));
  if (!cards && session.length) setCards(session);
  const index = ratings.length;
  const done = index >= session.length;
  const close = () => {
    const left = session.length - index;
    if (left > 0 && index > 0) toast.show(t("memory_labs:MEM-03.exit_toast", { n: left }));
    if (index > 0 && left > 0)
      s.analytics.track("review_session_completed", {
        mode: filtered ? "deck" : fromPlan ? "comeback" : "daily",
        reviewed: index,
        again_count: ratings.filter((r) => r === 1).length,
        duration_ms: Date.now() - started.current,
        left_early: true,
      });
    void queryClient.invalidateQueries({ queryKey: qk.srs });
    void navigate({ to: "/learn" });
  };

  if (session.length === 0 || done)
    return (
      <ReviewComplete
        ratings={ratings}
        ms={Date.now() - started.current}
        comeback={
          active && fromPlan && stored.data
            ? { day: active.dayIndex, total: stored.data.plan.planDays }
            : null
        }
        mode={filtered ? "deck" : fromPlan ? "comeback" : "daily"}
        onDone={close}
        onAnother={() => {
          setCards(null);
          setRatings([]);
          setSkipPlan(true);
          started.current = Date.now();
          void queryClient.invalidateQueries({ queryKey: qk.srs });
        }}
      />
    );

  const row = session[index] as SrsCardRow;
  return (
    <div className="mx-auto flex min-h-dvh max-w-[640px] flex-col px-4" data-testid="mem-03">
      <header className="flex h-14 items-center gap-2">
        <TopBar onBack={close} backIcon="X" className="px-0" />
        <SegmentedProgress
          className="flex-1"
          total={session.length}
          done={index}
          current={index}
          label={t("ui:progress.segments", { done: index + 1, total: session.length })}
        />
      </header>
      <main id="main" className="flex flex-1 flex-col gap-4 pb-6">
        <ReviewCard
          key={row.card_ref}
          row={row}
          onRated={(rating) => setRatings((r) => [...r, rating])}
        />
        {pet && index === Math.floor(session.length / 2) && index > 0 && (
          <PetLine
            pet={{ species: pet.species as "cat" | "dog" }}
            petName={pet.name}
            text={t("memory_labs:MEM-03.pet_half")}
          />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// MEM-02 · Comeback plan
// ---------------------------------------------------------------------------------------------

function ComebackPlanView({
  backlog,
  daysAway: away,
  onStart,
  onNormal,
  onClose,
}: {
  backlog: SrsCardRow[];
  daysAway: number;
  onStart: (p: StoredPlan) => Promise<void>;
  onNormal: () => void;
  onClose: () => void;
}) {
  const s = useServices();
  const { t } = useI18n();
  const pet = useAppStore((x) => x.pet);
  const goal = useAppStore((x) => x.profile?.daily_goal_minutes ?? 10);
  const name = (useAppStore((x) => x.profile?.display_name) ?? "").trim().split(/\s+/)[0] ?? "";
  const lengths = s.flags.get("memory.comeback.plan_lengths");
  const config = useMemo(
    () => ({
      minDue: s.flags.get("memory.comeback.min_due"),
      relearnBelow: s.flags.get("memory.comeback.relearn_below"),
      firstSession: s.flags.get("memory.comeback.first_session"),
      planLengths: lengths,
      sessionSize: s.flags.get("memory.session_size"),
      defaultSecondsPerCard: s.flags.get("memory.default_seconds_per_card"),
    }),
    [s, lengths],
  );
  const base = useMemo(
    () =>
      buildComebackPlan({
        backlog,
        now: Date.now(),
        today: localDate(Date.now(), timeZone()),
        scheduler: s.srs,
        goalMinutes: goal,
        secondsPerCard: config.defaultSecondsPerCard,
        isCore: () => false,
        longBreak: away >= 30,
        config,
      }),
    [backlog, s, goal, config, away],
  );
  const [days, setDays] = useState(base.planDays);
  const [busy, setBusy] = useState(false);
  const plan = useMemo(
    () =>
      days === base.planDays
        ? base
        : buildComebackPlan({
            backlog,
            now: Date.now(),
            today: localDate(Date.now(), timeZone()),
            scheduler: s.srs,
            goalMinutes: goal,
            secondsPerCard: config.defaultSecondsPerCard,
            isCore: () => false,
            longBreak: away >= 30,
            chosenDays: days,
            config,
          }),
    [days, base, backlog, s, goal, config, away],
  );
  const shownRef = useRef(false);
  if (!shownRef.current) {
    shownRef.current = true;
    s.analytics.track("comeback_plan_shown", {
      due_total_bucket: backlog.length,
      days_away_bucket: away,
    });
  }
  const perDay = plan.firstSession
    ? plan.firstSession.length
    : Math.max(...plan.chunks.map((c) => c.cardRefs.length), 0);
  const minutes = Math.max(1, Math.round((perDay * config.defaultSecondsPerCard) / 60));
  const relearnCards = plan.relearnTopics.reduce((n, x) => n + x.cardRefs.length, 0);
  return (
    <div
      className="mx-auto flex min-h-dvh max-w-[560px] flex-col gap-4 px-4 pb-6"
      data-testid="mem-02"
    >
      <TopBar onBack={onClose} backIcon="X" />
      <main id="main" className="flex flex-col gap-4">
        <Illustration
          name={pet?.species === "dog" ? "dog-wave" : "cat-watering"}
          width={200}
          height={200}
          className="mx-auto"
          decorative
        />
        <Text variant="title" heading as="h1">
          {name
            ? t("memory_labs:MEM-02.title", { first_name: name })
            : t("memory_labs:MEM-02.title_guest")}
        </Text>
        <Text tone="muted">{t("memory_labs:MEM-02.body", { total: plan.total })}</Text>
        <ChoiceChips
          label={t("memory_labs:MEM-02.suggested")}
          hideLabel
          options={lengths.map((d) => ({
            value: String(d),
            label: `${t(`memory_labs:MEM-02.days_${d}` as "memory_labs:MEM-02.days_3")}${d === base.planDays ? ` · ${t("memory_labs:MEM-02.suggested")}` : ""}`,
          }))}
          value={[String(days)]}
          onChange={(v) => v[0] && setDays(Number(v[0]))}
          testID="comeback-days"
        />
        <div className="grid grid-cols-2 gap-3">
          <StatTile
            value={String(perDay)}
            label={t("memory_labs:MEM-02.per_day", { k: perDay })
              .replace(String(perDay), "")
              .trim()}
            icon="Cards"
            tint
          />
          <StatTile
            value={String(minutes)}
            label={t("memory_labs:MEM-02.minutes", { m: minutes })
              .replace(String(minutes), "")
              .trim()}
            icon="Clock"
            tint
          />
        </div>
        {relearnCards > 0 && (
          <Text tone="muted" testID="comeback-relearn">
            {t("memory_labs:MEM-02.relearn", { r: relearnCards, t: plan.relearnTopics.length })}
          </Text>
        )}
        {pet && (
          <PetLine
            pet={{ species: pet.species === "dog" ? "dog" : "cat", mood: "happy" }}
            petName={pet.name}
            text={t("memory_labs:MEM-02.pet_plant", { plant_days: plan.planDays })}
          />
        )}
        <Button
          label={t("memory_labs:MEM-02.start", { k: perDay })}
          loading={busy}
          onPress={() => {
            setBusy(true);
            void onStart({ plan, daysAway: away }).finally(() => setBusy(false));
          }}
          testID="comeback-start"
        />
        <Button
          variant="ghost"
          label={t("memory_labs:MEM-02.normal")}
          onPress={onNormal}
          testID="comeback-normal"
        />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// MEM-04 · Review session complete
// ---------------------------------------------------------------------------------------------

function nextReview(
  cards: readonly SrsCardRow[],
  tz: string,
): { day: string; count: number } | null {
  const now = Date.now();
  const future = cards
    .filter((c) => !c.suspended && Date.parse(c.due_at) > now)
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  const first = future[0];
  if (!first) return null;
  const day = localDate(first.due_at, tz);
  return { day, count: future.filter((c) => localDate(c.due_at, tz) === day).length };
}

function ReviewComplete({
  ratings,
  ms,
  comeback,
  mode,
  onDone,
  onAnother,
}: {
  ratings: ReviewRating[];
  ms: number;
  comeback: { day: number; total: number } | null;
  mode: string;
  onDone: () => void;
  onAnother: () => void;
}) {
  const s = useServices();
  const { t, locale } = useI18n();
  const pet = useAppStore((x) => x.pet);
  const queryClient = useQueryClient();
  const fresh = useQuery({
    queryKey: [...qk.srs, "after", ratings.length],
    queryFn: () => s.storage.srs_cards.all(),
  });
  const queue = useReviewQueue();
  const logged = useRef(false);
  if (!logged.current && ratings.length) {
    logged.current = true;
    s.analytics.track("review_session_completed", {
      mode,
      reviewed: ratings.length,
      again_count: ratings.filter((r) => r === 1).length,
      duration_ms: ms,
      left_early: false,
    });
    void queryClient.invalidateQueries({ queryKey: qk.srs });
  }
  const tz = timeZone();
  const next = fresh.data ? nextReview(fresh.data, tz) : null;
  const remembered = ratings.filter((r) => r > 1).length;
  const more = queue ? Math.max(0, queue.cards.length) : 0;
  const nextDay = next
    ? next.day === localDate(Date.now(), tz)
      ? t("memory_labs:WEB-08.today")
      : formatDate(`${next.day}T12:00:00`, locale, {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
    : null;
  const species = pet?.species === "dog" ? "dog" : "cat";
  return (
    <div
      className="mx-auto flex min-h-dvh max-w-[560px] flex-col gap-4 px-4 pb-6"
      data-testid="mem-04"
    >
      <TopBar onBack={onDone} backIcon="X" />
      <main id="main" className="flex flex-col items-center gap-4 text-center">
        <Illustration
          name={
            ratings.length
              ? `${species}-celebrate`
              : species === "dog"
                ? "dog-sleepy"
                : "cat-sleepy"
          }
          width={180}
          height={180}
          decorative
        />
        <Text variant="title" heading as="h1" align="center">
          {!ratings.length
            ? t("memory_labs:MEM-01.today_none")
            : comeback
              ? t("memory_labs:MEM-04.title_comeback", { d: comeback.day, total: comeback.total })
              : t("memory_labs:MEM-04.title")}
        </Text>
        {ratings.length > 0 && (
          <div className="grid w-full grid-cols-3 gap-3" data-testid="mem-04-stats">
            <StatTile
              value={`${remembered}/${ratings.length}`}
              label={t("memory_labs:MEM-04.remembered")}
              icon="Brain"
              tint
            />
            <StatTile
              value={`${Math.max(1, Math.round(ms / 60_000))}`}
              label={t("memory_labs:MEM-04.time")}
              icon="Clock"
              tint
            />
            <StatTile
              value={nextDay ?? "–"}
              label={
                next
                  ? `${t("memory_labs:MEM-04.next")} · ${t("memory_labs:MEM-04.next_value.2", { count: next.count })}`
                  : t("memory_labs:MEM-04.next")
              }
              icon="CalendarCheck"
              tint
            />
          </div>
        )}
        {pet && !more && nextDay && (
          <PetLine
            pet={{ species, mood: "happy" }}
            petName={pet.name}
            text={t("memory_labs:MEM-04.pet_all", { when: nextDay })}
          />
        )}
        <div className="flex w-full flex-col gap-2">
          <Button label={t("memory_labs:MEM-04.done")} onPress={onDone} testID="mem-04-done" />
          {more > 0 && (
            <Button
              variant="secondary"
              label={t("memory_labs:MEM-04.another", {
                n: Math.min(more, s.flags.get("memory.session_size")),
              })}
              onPress={onAnother}
              testID="mem-04-another"
            />
          )}
        </div>
        {fresh.isPending && <Spinner label={t("learn:WEB-01.loading")} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One card
// ---------------------------------------------------------------------------------------------

function ReviewCard({ row, onRated }: { row: SrsCardRow; onRated: (r: ReviewRating) => void }) {
  const s = useServices();
  const { t } = useI18n();
  const online = useOnline();
  const bundle = useBundle(row.topic_id ?? null, "deep_dive");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const opened = useRef(Date.now());
  const intervals = useMemo(
    () => intervalLabels(s.srs.preview(row, new Date()), t),
    [row, s.srs, t],
  );

  if (bundle.isPending) return <Spinner label={t("learn:WEB-01.loading")} />;
  const b = bundle.data?.bundle;
  const [kind, id] = [row.card_ref.slice(0, 1), row.card_ref.slice(2)];
  const card = b && kind === "c" ? b.cards.find((c) => c.id === id) : undefined;
  const qid = card?.type === "question" ? card.question : kind === "q" ? id : null;
  const question =
    b && qid
      ? (b.questions[qid] ??
        Object.values(b.questions)
          .flatMap((q) => (q.type === "paragraph" ? q.children : []))
          .find((c) => c.id === qid))
      : undefined;

  const rate = async (r: Rating) => {
    if (busy) return;
    setBusy(true);
    await rateCard(s, row, RATING[r], null, Date.now() - opened.current);
    onRated(RATING[r]);
  };

  if (!b || (!card && !question)) {
    return (
      <div className="flex flex-col gap-3" data-testid="review-missing">
        <Text tone="muted">{t("memory_labs:MEM-03.needs_net")}</Text>
        <Button label={t("learn:LES-08.continue")} onPress={() => onRated(3)} />
      </div>
    );
  }
  return (
    <PlayerProvider
      value={{ t, bundle: b, contentBaseUrl: contentUrl(bundle.data?.baseUrl ?? "", ""), online }}
    >
      <div
        className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card"
        data-testid="review-card"
      >
        {question && question.type !== "paragraph" ? (
          <QuestionView
            q={question}
            passage={null}
            draft={initialDraft(question)}
            onDraft={() => undefined}
            locked
            reveal={shown ? "final" : "none"}
            struck={[]}
          />
        ) : card ? (
          <CardView
            card={card}
            locked
            onWidget={() => undefined}
            simApi={{ reportTask: () => undefined }}
            taskDone={shown}
          />
        ) : null}
      </div>
      {!shown ? (
        <Button
          label={t("memory_labs:MEM-03.show_answer")}
          onPress={() => setShown(true)}
          testID="show-answer"
        />
      ) : (
        <RatingButtons
          intervals={intervals}
          onRate={(r) => void rate(r)}
          disabled={busy}
          testID="rating-buttons"
        />
      )}
    </PlayerProvider>
  );
}
