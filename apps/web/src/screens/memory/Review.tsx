/**
 * MEM-03: today's review session. Cards come from app-core's capped daily queue; each card is
 * shown from its bundle (question or summary card), then rated Again / Hard / Good / Easy with
 * the FSRS next-interval previews. Ratings are scheduled on the device (R18) and sent as
 * `review_rated` with the client's FSRS state.
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { sessionSlice, type ReviewRating, type SrsCardRow } from "@smriti/app-core";
import { useAppStore } from "@smriti/app-core/react";
import { CardView, PlayerProvider, QuestionView, contentUrl, initialDraft } from "@smriti/lesson-player-web";
import { Button, EmptyState, PetLine, RatingButtons, SegmentedProgress, Spinner, Text, TopBar } from "@smriti/ui-web";
import type { Rating } from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { useBundle } from "../../lib/content";
import { useReviewQueue } from "../../lib/home";
import { useI18n } from "../../lib/i18n";
import { rateCard } from "../../lib/learner";
import { useOnline } from "../../lib/network";
import { qk } from "../../lib/queries";
import { intervalLabels } from "../../lib/srs";
import { toast } from "../../lib/toast";
import { RouteLoading } from "../../shell/States";

const RATING: Record<Rating, ReviewRating> = { again: 1, hard: 2, good: 3, easy: 4 };

export function Review() {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queue = useReviewQueue();
  const pet = useAppStore((x) => x.pet);
  const queryClient = useQueryClient();
  const [cards, setCards] = useState<SrsCardRow[] | null>(null);
  const [index, setIndex] = useState(0);
  const [again, setAgain] = useState(0);
  const started = useRef(Date.now());

  if (!queue) return <RouteLoading />;
  const session = cards ?? sessionSlice(queue.cards, s.flags.get("memory.session_size"));
  if (!cards && session.length) setCards(session);
  const done = index >= session.length;
  const close = () => {
    const left = session.length - index;
    if (left > 0 && index > 0) toast.show(t("memory_labs:MEM-03.exit_toast", { n: left }));
    void queryClient.invalidateQueries({ queryKey: qk.srs });
    void navigate({ to: "/learn" });
  };

  if (session.length === 0 || done) {
    if (done && session.length) {
      s.analytics.track("review_session_completed", { mode: "daily", reviewed: session.length, again_count: again, duration_ms: Date.now() - started.current });
    }
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col gap-4 px-4" data-testid="mem-03-done">
        <TopBar onBack={close} backIcon="X" />
        <main id="main" className="flex flex-col gap-4">
          <Text variant="title" heading as="h1" align="center">
            {t("memory_labs:MEM-01.today_none")}
          </Text>
          <EmptyState illustration="ui-all-caught-up" text={pet ? t("memory_labs:MEM-03.pet_watered") : t("memory_labs:MEM-01.today_none")} action={{ label: t("learn:WEB-01.not_found_action"), onPress: close }} />
        </main>
      </div>
    );
  }

  const row = session[index] as SrsCardRow;
  return (
    <div className="mx-auto flex min-h-dvh max-w-[640px] flex-col px-4" data-testid="mem-03">
      <header className="flex h-14 items-center gap-2">
        <TopBar onBack={close} backIcon="X" className="px-0" />
        <SegmentedProgress className="flex-1" total={session.length} done={index} current={index} label={t("ui:progress.segments", { done: index + 1, total: session.length })} />
      </header>
      <main id="main" className="flex flex-1 flex-col gap-4 pb-6">
        <ReviewCard
          key={row.card_ref}
          row={row}
          onRated={(rating) => {
            if (rating === 1) setAgain((n) => n + 1);
            setIndex((i) => i + 1);
          }}
        />
        {pet && index === Math.floor(session.length / 2) && index > 0 && <PetLine pet={{ species: pet.species as "cat" | "dog" }} petName={pet.name} text={t("memory_labs:MEM-03.pet_half")} />}
      </main>
    </div>
  );
}

function ReviewCard({ row, onRated }: { row: SrsCardRow; onRated: (r: ReviewRating) => void }) {
  const s = useServices();
  const { t } = useI18n();
  const online = useOnline();
  const bundle = useBundle(row.topic_id ?? null, "deep_dive");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const opened = useRef(Date.now());
  const intervals = useMemo(() => intervalLabels(s.srs.preview(row, new Date()), t), [row, s.srs, t]);

  if (bundle.isPending) return <Spinner label={t("learn:WEB-01.loading")} />;
  const b = bundle.data?.bundle;
  const [kind, id] = [row.card_ref.slice(0, 1), row.card_ref.slice(2)];
  const card = b && kind === "c" ? b.cards.find((c) => c.id === id) : undefined;
  const qid = card?.type === "question" ? card.question : kind === "q" ? id : null;
  const question = b && qid ? (b.questions[qid] ?? Object.values(b.questions).flatMap((q) => (q.type === "paragraph" ? q.children : [])).find((c) => c.id === qid)) : undefined;

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
    <PlayerProvider value={{ t, bundle: b, contentBaseUrl: contentUrl(bundle.data?.baseUrl ?? "", ""), online }}>
      <div className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card" data-testid="review-card">
        {question && question.type !== "paragraph" ? (
          <QuestionView q={question} passage={null} draft={initialDraft(question)} onDraft={() => undefined} locked reveal={shown ? "final" : "none"} struck={[]} />
        ) : card ? (
          <CardView card={card} locked onWidget={() => undefined} simApi={{ reportTask: () => undefined }} taskDone={shown} />
        ) : null}
      </div>
      {!shown ? (
        <Button label={t("memory_labs:MEM-03.show_answer")} onPress={() => setShown(true)} testID="show-answer" />
      ) : (
        <RatingButtons intervals={intervals} onRate={(r) => void rate(r)} disabled={busy} testID="rating-buttons" />
      )}
    </PlayerProvider>
  );
}
