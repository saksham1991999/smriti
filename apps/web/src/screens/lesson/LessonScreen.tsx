/**
 * The lesson host (LES-01 to LES-09, ONB-13): loads the published bundle, plans the lesson with
 * @smriti/lesson-core, renders it with @smriti/lesson-player-web, writes every event to the outbox
 * and saves resume points, then shows LES-05 on exit, LES-09 at the end of a preview, and hands the
 * finished lesson to LES-08 (or ONB-14 for the first lesson).
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lessonAccess } from "@smriti/app-core";
import { planLesson, type LessonPlan, type LessonSession, type LessonState } from "@smriti/lesson-core";
import type { TypedBundle } from "@smriti/content-schema";
import { LessonPlayer, contentUrl, type SimCardData, type SimHostApi } from "@smriti/lesson-player-web";
import { Button, Dialog, Illustration, PetLine, Sheet, Spinner, Text } from "@smriti/ui-web";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../../boot/context";
import { SimFrame } from "../../components/SimFrame";
import { findTopic, lessonConfigFrom, useBundle, useCatalog, type BundleMode, type TopicLocation } from "../../lib/content";
import { parts, useI18n } from "../../lib/i18n";
import { finishLesson, recordLessonEvent, saveProgress } from "../../lib/learner";
import { useLessonResult } from "../../lib/lessonResult";
import { useOnline } from "../../lib/network";
import { useOnboarding } from "../../lib/onboarding";
import { useIsPro } from "../../lib/pro";
import { usePriceValues, usePrices } from "../../lib/pricing";
import { qk, LOCAL_KEYS } from "../../lib/queries";
import { intervalLabels } from "../../lib/srs";
import { timeZone } from "../../platform/web";
import { LoadError, NotFound } from "../../shell/States";
import type { LessonSearch } from "../../router";
import { useQueryClient } from "@tanstack/react-query";

type HostMode = "deep_dive" | "quick_revision" | "onboarding";

/** /lesson/$topicId?mode=&bite= */
export function LessonScreen() {
  const { topicId } = useParams({ strict: false }) as { topicId: string };
  const search = useSearch({ strict: false }) as LessonSearch;
  return <LessonHost topicId={topicId} mode={search.mode ?? "deep_dive"} biteId={search.bite} />;
}

/** ONB-13: the first lesson, picked from the first free chapter (the level picks the bite). */
export function FirstLesson() {
  const catalog = useCatalog();
  const { t } = useI18n();
  if (catalog.isPending) return <Loading label={t("onboarding:ONB-13.loading")} />;
  const first = catalog.subjects.flatMap((x) => x.chapters).find((c) => c.free)?.topics[0] ?? catalog.subjects[0]?.chapters[0]?.topics[0];
  if (!first) return <NotFound />;
  return <LessonHost topicId={first.id} mode="onboarding" />;
}

function Loading({ label }: { label: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg" data-testid="lesson-loading">
      <div className="flex flex-col items-center gap-3">
        <Spinner label={label} />
        <Text tone="muted">{label}</Text>
      </div>
    </div>
  );
}

function LessonHost({ topicId, mode, biteId }: { topicId: string; mode: HostMode; biteId?: string }) {
  const { t } = useI18n();
  const catalog = useCatalog();
  const bundleMode: BundleMode = mode === "quick_revision" ? "quick_revision" : "deep_dive";
  const bundle = useBundle(topicId, bundleMode);
  const loc = findTopic(catalog.subjects, topicId);
  if (catalog.isPending || bundle.isPending) return <Loading label={t(mode === "onboarding" ? "onboarding:ONB-13.loading" : "learn:WEB-01.loading")} />;
  if (catalog.isError || bundle.isError) return <LoadError onRetry={() => void bundle.refetch()} />;
  if (!loc || !bundle.data) return <NotFound />;
  return <LessonRun key={`${topicId}|${mode}|${biteId ?? ""}`} loc={loc} mode={mode} biteId={biteId} bundle={bundle.data.bundle} hash={bundle.data.entry.hash} baseUrl={bundle.data.baseUrl} />;
}

function LessonRun({ loc, mode, biteId, bundle, hash, baseUrl }: { loc: TopicLocation; mode: HostMode; biteId?: string; bundle: TypedBundle; hash: string; baseUrl: string }) {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const pro = useIsPro();
  const prices = usePrices();
  const pv = usePriceValues();
  const pet = useAppStore((x) => x.pet);
  const level = useOnboarding((x) => x.level);
  const rotating = useCatalog().manifest?.free.deep_dive_chapters ?? [];
  const sessionRef = useRef<LessonSession | null>(null);
  const [exit, setExit] = useState<number | null>(null);
  const [previewEnded, setPreviewEnded] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const config = useMemo(() => lessonConfigFrom(s.flags), [s.flags]);

  const progress = useQuery({ queryKey: [...qk.lessonProgress, loc.topic.id, mode], queryFn: () => s.storage.lesson_progress.get(`${loc.topic.id}|${mode === "quick_revision" ? "quick_revision" : "deep_dive"}`) });

  const access = lessonAccess(
    { mode, chapterIndexInSubject: loc.chapter.index, chapterId: loc.chapter.id, rotatingFreeChapters: loc.chapter.free ? [loc.chapter.id, ...rotating] : rotating, isPro: pro },
    s.flags,
  );

  const plan = useMemo<LessonPlan | null>(() => {
    try {
      const done = new Set(progress.data?.bites_completed ?? []);
      const resumeBite = mode === "deep_dive" && !biteId ? undefined : biteId;
      const p = planLesson(bundle, {
        mode,
        bundleVersion: hash,
        examDepth: null,
        biteId: resumeBite,
        previewLimited: access.kind === "preview",
        level: level === "starting" ? "new" : (level ?? undefined),
        config,
      });
      // A Deep Dive opened without a bite continues at the first bite not done yet.
      if (mode === "deep_dive" && !biteId && done.size) {
        const next = bundle.bites.find((b) => !done.has(b.id));
        if (next && next.id !== p.biteId) return planLesson(bundle, { mode, bundleVersion: hash, examDepth: null, biteId: next.id, previewLimited: access.kind === "preview", config });
      }
      return p;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, hash, mode, biteId, progress.isPending]);

  const ratingIntervals = useMemo(() => {
    const row = s.srs.newCard("preview", new Date());
    return intervalLabels(s.srs.preview(row, new Date()), t);
  }, [s.srs, t]);

  if (progress.isPending) return <Loading label={t("learn:WEB-01.loading")} />;
  if (!plan) return <NotFound />;

  const resumeIndex = progress.data && progress.data.bundle_hash === hash && !progress.data.completed_at && progress.data.last_card_index > 0 && plan.mode !== "onboarding" ? progress.data.last_card_index : undefined;

  const done = async (state: LessonState) => {
    setFinishing(true);
    const outcome = await finishLesson(s, { plan, state, bundle });
    await Promise.all(LOCAL_KEYS.map((k) => queryClient.invalidateQueries({ queryKey: k })));
    const nextBite = outcome.nextBiteId ? bundle.bites.find((b) => b.id === outcome.nextBiteId) : null;
    useLessonResult.getState().set({
      outcome,
      topicId: loc.topic.id,
      topicName: loc.topic.name,
      chapterId: loc.chapter.id,
      chapterName: loc.chapter.name,
      subject: loc.subject.family,
      mode,
      nextBiteTitle: nextBite?.title ?? null,
      synced: online,
    });
    if (mode === "onboarding") {
      useOnboarding.getState().update({ firstWinAt: new Date().toISOString(), firstLessonTopic: loc.topic.id });
      void navigate({ to: "/onboarding/first-win", replace: true });
    } else void navigate({ to: "/lesson-complete", replace: true });
  };

  const leave = () => {
    sessionRef.current?.dispatch({ type: "exit" });
    setExit(null);
    if (mode === "onboarding") void navigate({ to: "/learn", replace: true });
    else if (window.history.length > 1) window.history.back();
    else void navigate({ to: "/learn/topic/$topicId", params: { topicId: loc.topic.id } });
  };

  const renderSim = (card: SimCardData, api: SimHostApi) => {
    const media = bundle.media[card.sim];
    const simId = media?.status === "ready" && media.url ? /sims\/([a-z0-9-]+)/.exec(media.url)?.[1] : undefined;
    if (!simId || !online) return null;
    return (
      <SimFrame
        simId={simId}
        title={card.title ?? simId}
        onMeasurement={(m) => {
          const task = card.tasks.find((x) => x.id === m.taskId) ?? card.tasks[0];
          if (task) api.reportTask(task.id, { value: m.value, unit: m.unit });
        }}
      />
    );
  };

  const petLines = parts(t("learn:LES-05.pet_line_few_left", { n: exit ?? 0 }));
  const onboardingExit = mode === "onboarding";

  return (
    <div className="min-h-dvh bg-bg" data-testid="lesson-screen">
      {catalogFixture(bundle) && (
        <p className="m-0 bg-warning-tint px-4 py-1 text-center text-caption text-warning-text" data-testid="fixture-notice">
          {t("learn:WEB-01.fixture_notice")}
        </p>
      )}
      <div className="mx-auto max-w-[720px]">
        <LessonPlayer
          plan={plan}
          bundle={bundle}
          config={config}
          tz={timeZone()}
          t={t}
          contentBaseUrl={contentUrl(baseUrl, "")}
          subject={loc.subject.family}
          resumeIndex={resumeIndex}
          online={online}
          pet={pet ? { species: pet.species as "cat" | "dog", name: pet.name } : undefined}
          ratingIntervals={ratingIntervals}
          renderSim={renderSim}
          sessionRef={sessionRef}
          onEvent={(e) => void recordLessonEvent(s, e, plan)}
          onProgress={(p) => void saveProgress(s, plan, p.lastCardIndex)}
          onComplete={(state) => void done(state)}
          onPreviewEnd={() => setPreviewEnded(true)}
          onRequestExit={(left) => setExit(left)}
        />
      </div>

      <Dialog
        open={exit !== null}
        onOpenChange={(o) => !o && setExit(null)}
        title={onboardingExit ? t("learn:LES-05.onboarding_title") : t("learn:LES-05.title")}
        description={onboardingExit ? t("learn:LES-05.onboarding_body", { cards_left: exit ?? 0 }) : t("learn:LES-05.line")}
        confirm={{ label: onboardingExit ? (parts(t("learn:LES-05.onboarding_buttons"))[0] ?? "") : t("learn:LES-05.keep_going"), onPress: () => setExit(null) }}
        cancel={{ label: onboardingExit ? (parts(t("learn:LES-05.onboarding_buttons"))[1] ?? "") : t("learn:LES-05.exit"), onPress: leave }}
        testID="les-05"
      >
        {pet && exit !== null && exit <= 3 && !onboardingExit && <PetLine pet={{ species: pet.species as "cat" | "dog" }} petName={pet.name} text={petLines[0] ?? ""} />}
      </Dialog>

      <Sheet open={previewEnded} onOpenChange={() => undefined} dismissible={false} title={t("learn:LES-09.title")} description={t("learn:LES-09.line")} testID="les-09">
        <div className="flex flex-col gap-3 pb-2">
          <Illustration name="scene-paywall" width={240} height={150} decorative className="mx-auto" />
          <Text tone="muted" align="center">
            {t("learn:LES-09.left", { n: Math.max(0, plan.cards.length - (plan.previewLimit ?? 0)), minutes: Math.max(1, Math.round((plan.cards.length * 20) / 60)) })}
          </Text>
          <Button label={t("learn:LES-09.pro", pv)} onPress={() => void navigate({ to: "/pro", search: { source: "deep_dive_preview" } })} testID="les-09-pro" />
          <Button label={t("learn:LES-09.free")} variant="secondary" onPress={() => void navigate({ to: "/lesson/$topicId", params: { topicId: loc.topic.id }, search: { mode: "quick_revision" }, replace: true })} testID="les-09-free" />
          <Button label={t("learn:LES-09.back")} variant="ghost" onPress={() => void navigate({ to: "/learn/topic/$topicId", params: { topicId: loc.topic.id }, replace: true })} />
          <Text variant="caption" tone="muted" align="center">
            {prices ? t("learn:LES-09.fine_print", { trial_price: prices.trial, monthly_price: prices.monthly }) : t("me_money:PAY-01.price_loading")}
          </Text>
        </div>
      </Sheet>

      {finishing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-bg/80" aria-live="polite">
          <Spinner label={t("learn:WEB-01.loading")} />
        </div>
      )}
    </div>
  );
}

const catalogFixture = (b: TypedBundle) => (b as { fixture?: boolean }).fixture === true;

