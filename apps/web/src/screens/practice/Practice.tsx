/**
 * PRC-01 Practice hub and the drill flow on a topic's practice bundle: PRC-03 setup (sized to the
 * free questions left, app-core `practiceQuota`), PRC-04 runner with PRC-05 feedback and the worked
 * solution, and PRC-06 summary. Answers go to the outbox as `answer_submitted` with context
 * `practice`; the session ends with `practice_session_completed`.
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { practiceQuota, sizePracticeSession, type Quota } from "@smriti/app-core";
import { useAppStore } from "@smriti/app-core/react";
import { useQueryClient } from "@tanstack/react-query";
import { checkAnswer, workedSolution, type Answer, type AnyQuestion, type CheckResult } from "@smriti/lesson-core";
import { PlayerProvider, QuestionView, RichText, canSubmit, contentUrl, initialDraft } from "@smriti/lesson-player-web";
import { Banner, Button, Card, IconButton, Chip, Dialog, Icon, LimitMeter, PetLine, ProgressBar, StatTile, Text, TopBar } from "@smriti/ui-web";
import { TutorButton } from "../tutor/TutorButton";
import { useServices } from "../../boot/context";
import { findTopic, useBundle, useCatalog, type CatalogTopic } from "../../lib/content";
import { useTodayMinutes } from "../../lib/daily";
import { toast } from "../../lib/toast";
import { useDailyChallenge } from "../../lib/challenge";
import { useProfileIds } from "../../lib/queries";
import type { MessageKey } from "@smriti/i18n";
import { useI18n } from "../../lib/i18n";
import { useOnline } from "../../lib/network";
import { completeServerSession, startServerSession, submitServerAnswer, usePracticeLimits, useWeakSpots } from "../../lib/practice";
import { useIsPro } from "../../lib/pro";
import { LoadError, NotFound, RouteLoading } from "../../shell/States";

/** Today's practice quota from the server (`/v1/practice/limits`); the flag defaults until it answers. */
function useQuota(): Quota {
  const s = useServices();
  const pro = useIsPro();
  const server = usePracticeLimits().data?.practice_questions;
  if (!server) return practiceQuota(0, pro, s.flags);
  if (server.unlimited || server.limit === null) return { unlimited: true, limit: server.limit, used: server.used, remaining: Number.POSITIVE_INFINITY, allowed: true };
  const remaining = Math.max(0, server.limit - server.used);
  return { unlimited: false, limit: server.limit, used: server.used, remaining, allowed: remaining > 0 };
}

const mmss = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

export function PracticeHub() {
  const { t, locale } = useI18n();
  const pick = (m: Record<string, string>) => m[locale] ?? m.en ?? "";
  const navigate = useNavigate();
  const catalog = useCatalog();
  const online = useOnline();
  const pet = useAppStore((x) => x.pet);
  const quota = useQuota();
  const exam = useProfileIds()[0] ?? null;
  const weak = useWeakSpots(exam);
  const challenge = useDailyChallenge(exam);
  if (catalog.isError) return <LoadError onRetry={() => void catalog.refetch()} />;
  if (catalog.isPending) return <RouteLoading />;
  const drills: { topic: CatalogTopic; subject: string; family: string }[] = [];
  for (const subject of catalog.subjects)
    for (const ch of subject.chapters) for (const topic of ch.topics) if (topic.practiceCount > 0) drills.push({ topic, subject: subject.name, family: subject.family });
  const capReached = !quota.unlimited && !quota.allowed;
  const spots = weak.data?.items.slice(0, 2) ?? [];
  const examName = catalog.manifest?.exam.name ?? "";
  const firstSpot = spots[0];
  const petText = capReached
    ? t("practice:PRC-01.pet_line_cap_reached")
    : firstSpot
      ? t("practice:PRC-01.pet_line_weak_spots_found", { concept_name: pick(firstSpot.concept_name) })
      : t("practice:PRC-01.pet_line_new_student");
  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-6 md:px-8 md:pt-6" data-testid="prc-01">
      <Text variant="title" heading as="h1">
        {t("practice:PRC-01.title")}
      </Text>
      {!online && <Banner tone="offline" text={t("practice:PRC-01.offline_banner")} />}
      {pet && <PetLine pet={{ species: pet.species as "cat" | "dog" }} petName={pet.name} text={petText} />}
      {challenge.data && (
        <Card tone="tint" onPress={() => void navigate({ to: "/practice/challenge" })} testID="challenge-card">
          <span className="flex items-center gap-3">
            <Icon name="Lightning" color="primary" />
            <span className="flex min-w-0 flex-1 flex-col">
              <Text variant="heading">{t("practice:PRC-01.challenge_title")}</Text>
              <Text variant="caption" tone="muted">
                {challenge.data.result
                  ? challenge.data.result.correct
                    ? t("practice:PRC-01.played_correct", { time: mmss(challenge.data.result.time_ms) })
                    : t("practice:PRC-01.played_wrong")
                  : t("practice:PRC-01.challenge_sub_line", { exam_short: examName })}
              </Text>
            </span>
            <Text variant="label" tone="primary">
              {challenge.data.result ? t("practice:PRC-01.see_result") : t("practice:PRC-01.play")}
            </Text>
          </span>
        </Card>
      )}
      {spots.length > 0 && (
        <Card testID="weak-spots">
          <section className="flex flex-col gap-3">
            <Text variant="heading" heading as="h2">
              {t("practice:PRC-01.weak_spots_heading")}
            </Text>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {spots.map((w) => (
                <li key={w.concept_id} className="flex items-center gap-3 border-t border-hairline pt-3 first:border-t-0 first:pt-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Text variant="caption" tone="muted">
                      {pick(w.topic_name)}
                    </Text>
                    <Text>{pick(w.concept_name)}</Text>
                  </span>
                  {w.reasons[0] && <Chip label={t(`practice:PRC-02.reason_${w.reasons[0]}` as MessageKey)} />}
                  <Button variant="ghost" size="sm" label={t("practice:PRC-01.drill")} onPress={() => void navigate({ to: "/practice/drill/$topicId", params: { topicId: w.topic_id } })} />
                </li>
              ))}
            </ul>
          </section>
        </Card>
      )}
      {!quota.unlimited && quota.limit !== null && (
        <LimitMeter
          label={capReached ? t("practice:PRC-01.meter_full") : t("practice:PRC-01.limit_meter", { used: quota.used, limit: quota.limit })}
          used={quota.used}
          limit={quota.limit}
          onProPress={() => void navigate({ to: "/pro", search: { source: "practice_limit" } })}
          testID="practice-meter"
        />
      )}
      <section className="flex flex-col gap-2">
        <Text variant="heading" heading as="h2">
          {t("practice:PRC-03.title")}
        </Text>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {drills.map(({ topic, subject, family }) => (
            <Card key={topic.id} subject={family} tone="tint" onPress={() => void navigate({ to: "/practice/drill/$topicId", params: { topicId: topic.id } })} testID={`drill-${topic.id}`}>
              <span className="flex items-center gap-3">
                <Icon name="Exam" color="subjectText" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <Text variant="heading">{topic.name}</Text>
                  <Text variant="caption" tone="muted">
                    {subject} · {t("practice:MOCK-01.questions_fact", { question_count: topic.practiceCount })}
                  </Text>
                </span>
                <Icon name="CaretRight" color="inkMuted" />
              </span>
            </Card>
          ))}
        </div>
      </section>
      <Card onPress={() => void navigate({ to: "/practice/mocks" })} testID="mock-tile">
        <span className="flex items-center gap-3">
          <Icon name="Timer" color="primary" />
          <span className="flex min-w-0 flex-1 flex-col">
            <Text variant="heading">{t("practice:PRC-01.tile_mock_tests")}</Text>
            <Text variant="caption" tone="muted">
              {t("practice:MOCK-01.pet_line")}
            </Text>
          </span>
          <Icon name="CaretRight" color="inkMuted" />
        </span>
      </Card>
      <Card onPress={() => void navigate({ to: "/practice/mixed" })} testID="mixed-tile">
        <span className="flex items-center gap-3">
          <Icon name="Shuffle" color="primary" />
          <span className="flex min-w-0 flex-1 flex-col">
            <Text variant="heading">{t("practice:PRC-03.mixed_title")}</Text>
            <Text variant="caption" tone="muted">
              {t("practice:PRC-03.mixed_caption")}
            </Text>
          </span>
          <Icon name="CaretRight" color="inkMuted" />
        </span>
      </Card>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card onPress={() => void navigate({ to: "/practice/pyq" })} testID="pyq-tile">
          <span className="flex items-center gap-3">
            <Icon name="FileText" color="primary" />
            <Text variant="heading" className="flex-1">
              {t("practice:PRC-01.tile_pyq_bank")}
            </Text>
            <Icon name="CaretRight" color="inkMuted" />
          </span>
        </Card>
        <Card onPress={() => void navigate({ to: "/practice/progress" })} testID="progress-tile">
          <span className="flex items-center gap-3">
            <Icon name="TrendUp" color="primary" />
            <Text variant="heading" className="flex-1">
              {t("practice:PRC-01.tile_analytics")}
            </Text>
            <Icon name="CaretRight" color="inkMuted" />
          </span>
        </Card>
      </div>
    </div>
  );
}

interface Answered {
  qid: string;
  correct: boolean;
  ms: number;
}

export function Drill() {
  const { topicId } = useParams({ strict: false }) as { topicId: string };
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const bundle = useBundle(topicId, "practice");
  const online = useOnline();
  const quota = useQuota();
  const [phase, setPhase] = useState<"setup" | "run" | "done">("setup");
  const [order, setOrder] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Answer | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [answers, setAnswers] = useState<Answered[]>([]);
  const [leaving, setLeaving] = useState(false);
  const sessionId = useRef<string>("");
  const [failed, setFailed] = useState(false);
  const queryClient = useQueryClient();
  const { locale } = useI18n();
  const started = useRef(0);
  const opened = useRef(0);

  const loc = catalog.subjects.length ? findTopic(catalog.subjects, topicId) : null;
  const questions = useMemo(() => {
    const b = bundle.data?.bundle;
    if (!b) return [] as AnyQuestion[];
    return Object.values(b.questions).filter((q): q is AnyQuestion => q.type !== "paragraph");
  }, [bundle.data]);

  if (catalog.isError || bundle.isError) return <LoadError onRetry={() => void (catalog.isError ? catalog.refetch() : bundle.refetch())} />;
  if (catalog.isPending || (bundle.isPending && bundle.fetchStatus !== "idle")) return <RouteLoading />;
  if (!loc || !bundle.data) return <NotFound />;
  const b = bundle.data.bundle;
  const back = () => void navigate({ to: "/practice" });
  const size = sizePracticeSession(questions.length, quota);

  const start = async () => {
    sessionId.current = s.newId();
    // The server runs every drill (`/v1/practice/sessions`): it picks the questions, checks the
    // answers and counts the free quota. The bundle on the device only renders them.
    const server = await startServerSession(s, { sessionId: sessionId.current, topicId, count: size, exam: s.store.getState().profile?.exam_profile_ids[0] ?? null });
    const known = new Set(questions.map((q) => q.id));
    const ids = server ? server.questions.map((q) => q.question_id).filter((id) => known.has(id)) : [];
    if (!server || ids.length === 0) {
      setFailed(true);
      return;
    }
    setFailed(false);
    sessionId.current = server.id;
    void queryClient.invalidateQueries({ queryKey: ["practice"] });
    started.current = Date.now();
    opened.current = Date.now();
    setOrder(ids);
    setIndex(0);
    setAnswers([]);
    setDraft(initialDraft(questions.find((q) => q.id === ids[0]) ?? null));
    setResult(null);
    setPhase("run");
    s.analytics.track("drill_started", { session_id: sessionId.current, scope: "topic", concept_count: 0, question_count: ids.length, difficulty_mode: "adaptive", timed: false, feedback_mode: "after_each" });
  };

  const finish = async (endedBy: "finished" | "closed", list: Answered[]) => {
    const correct = list.filter((a) => a.correct).length;
    const ms = Date.now() - started.current;
    await completeServerSession(s, sessionId.current, endedBy);
    void queryClient.invalidateQueries({ queryKey: ["practice"] });
    s.analytics.track("drill_completed", { session_id: sessionId.current, answered: list.length, correct, duration_ms: ms, ended_by: endedBy, free_cap: quota.unlimited ? "none" : String(quota.limit) });
  };

  if (phase === "setup") {
    const capReached = !quota.unlimited && !quota.allowed;
    return (
      <div className="mx-auto flex min-h-dvh max-w-[640px] flex-col gap-4 px-4 pb-6" data-subject={loc.subject.family} data-testid="prc-03">
        <TopBar title={t("practice:PRC-03.title")} onBack={back} />
        <main id="main" className="flex flex-col gap-4">
          <Card tone="tint" subject={loc.subject.family}>
            <span className="flex flex-col gap-1">
              <Text variant="caption" tone="muted">
                {loc.subject.name} · {loc.chapter.name}
              </Text>
              <Text variant="heading" heading as="h1">
                {t("practice:PRC-03.scope_topic", { topic_title: loc.topic.name })}
              </Text>
              <Text variant="caption" tone="muted">
                {t("practice:MOCK-01.questions_fact", { question_count: size })} · {t("practice:PRC-03.untimed")} · {t("practice:PRC-03.after_each")}
              </Text>
            </span>
          </Card>
          {b.fixture && <Chip kind="status" tone="warning" icon="Info" label={t("learn:WEB-01.fixture_notice")} testID="fixture-notice" />}
          {!quota.unlimited && (
            <Text variant="caption" tone={capReached ? "error" : "muted"} testID="free-left">
              {capReached ? t("practice:PRC-03.cap_reached") : size < questions.length ? t("practice:PRC-03.sized_to_free", { remaining: quota.remaining }) : t("practice:PRC-03.free_left", { remaining: quota.remaining })}
            </Text>
          )}
          {!online && <Text variant="caption" tone="muted">{t("practice:WEB-06.needs_internet")}</Text>}
          {failed && online && (
            <Text variant="caption" tone="error" testID="drill-failed">
              {t("practice:WEB-06.drill_unavailable")}
            </Text>
          )}
          {capReached ? (
            <Button label={t("practice:PRC-01.pro_link")} onPress={() => void navigate({ to: "/pro", search: { source: "practice_limit" } })} testID="drill-pro" />
          ) : (
            <Button label={t("practice:PRC-03.start")} onPress={() => void start()} disabled={size === 0 || !online} testID="drill-start" />
          )}
        </main>
      </div>
    );
  }

  if (phase === "done") {
    const correct = answers.filter((a) => a.correct).length;
    const accuracy = answers.length ? Math.round((correct / answers.length) * 100) : 0;
    return <DrillSummary answered={answers.length} total={order.length} accuracy={accuracy} ms={answers.reduce((n, a) => n + a.ms, 0)} onDone={back} onAgain={() => void start()} />;
  }

  const qid = order[index] as string;
  const q = questions.find((x) => x.id === qid) as AnyQuestion;
  const last = index === order.length - 1;
  const check = async () => {
    if (!draft || result) return;
    const ms = Date.now() - opened.current;
    // The server's check is the record; the device's check of the same key only shows the
    // feedback without waiting on the network.
    const local = checkAnswer(q, draft);
    const res = await submitServerAnswer(s, sessionId.current, { questionId: qid, answer: draft, timeMs: ms, locale });
    if (!res) {
      toast.show(t("practice:WEB-06.answer_not_saved"), { tone: "error" });
      return;
    }
    const r: CheckResult = { ...local, correct: res.check.correct };
    setResult(r);
    setAnswers((xs) => [...xs, { qid, correct: r.correct, ms }]);
    void queryClient.invalidateQueries({ queryKey: ["practice", "limits"] });
  };
  const next = async () => {
    if (last) {
      await finish("finished", answers);
      setPhase("done");
      return;
    }
    const nq = questions.find((x) => x.id === order[index + 1]) ?? null;
    setIndex(index + 1);
    setDraft(initialDraft(nq));
    setResult(null);
    opened.current = Date.now();
  };
  const sol = result ? workedSolution(q) : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[720px] flex-col px-4" data-subject={loc.subject.family} data-testid="prc-04">
      <header className="flex h-14 items-center gap-3">
        <IconButton icon="X" label={t("ui:common.close")} onPress={() => (answers.length ? setLeaving(true) : back())} testID="drill-close" />
        <ProgressBar className="flex-1" value={(index + (result ? 1 : 0)) / order.length} label={t("practice:PRC-04.counter", { i: index + 1, n: order.length })} />
        <Text variant="label" testID="drill-counter">
          {t("practice:PRC-04.counter", { i: index + 1, n: order.length })}
        </Text>
      </header>
      <main id="main" className="flex flex-1 flex-col gap-4 pb-28">
        <PlayerProvider value={{ t, bundle: b, contentBaseUrl: contentUrl(bundle.data.baseUrl, ""), online }}>
          <div className="rounded-card bg-surface p-4 shadow-card" data-testid="drill-question">
            <QuestionView key={qid} q={q} passage={null} draft={draft} onDraft={setDraft} locked={!!result} reveal={result ? "final" : "none"} struck={[]} />
          </div>
          {result && sol && <TutorButton raised context={{ ref: `question:${qid}`, kind: "question", title: t("tutor_social:AI-02.context_chip_question", { n: index + 1 }) }} />}
          {result && sol && (
            <section className={`flex flex-col gap-3 rounded-card p-4 ${result.correct ? "bg-success-tint" : "bg-warning-tint"}`} data-testid="prc-05" aria-live="polite">
              <Text variant="heading" heading as="h2" tone={result.correct ? "success" : "warning"}>
                {result.correct ? t("practice:PRC-05.correct") : t("practice:PRC-05.wrong")}
              </Text>
              {q.ideal_time_s ? (
                <Text variant="caption" tone="muted">
                  {t("practice:PRC-05.time_line", { time: mmss(answers[answers.length - 1]?.ms ?? 0), time_2: mmss(q.ideal_time_s * 1000) })}
                </Text>
              ) : null}
              {sol.feynman && (
                <div className="flex flex-col gap-1">
                  <Text variant="label">{t("practice:PRC-05.in_plain_words")}</Text>
                  <RichText text={sol.feynman} />
                </div>
              )}
              {sol.steps.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Text variant="label">{t("practice:PRC-05.step_by_step")}</Text>
                  <ol className="m-0 flex flex-col gap-1 ps-5">
                    {sol.steps.map((st, i) => (
                      <li key={i}>
                        <RichText text={st} as="span" />
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {sol.shortcut && (
                <div className="flex flex-col gap-1">
                  <Text variant="label">{t("practice:PRC-05.shortcut")}</Text>
                  <RichText text={sol.shortcut} />
                </div>
              )}
              {sol.traps.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Text variant="label">{t("practice:PRC-05.common_traps")}</Text>
                  {sol.traps.map((tr, i) => (
                    <RichText key={i} text={tr.why} />
                  ))}
                </div>
              )}
            </section>
          )}
        </PlayerProvider>
      </main>
      <footer className="fixed inset-x-0 bottom-0 border-t border-hairline bg-surface px-4 py-3">
        <div className="mx-auto max-w-[720px]">
          {result ? (
            <Button label={last ? t("practice:PRC-05.see_summary") : t("practice:PRC-05.next")} onPress={() => void next()} testID="drill-next" />
          ) : (
            <Button label={t("practice:PRC-04.check")} onPress={() => void check()} disabled={!canSubmit(q, draft)} testID="drill-check" />
          )}
        </div>
      </footer>
      <Dialog
        open={leaving}
        onOpenChange={setLeaving}
        title={t("practice:PRC-04.exit_title")}
        description={t("practice:PRC-04.exit_body")}
        confirm={{ label: t("practice:PRC-04.exit_keep_going"), onPress: () => setLeaving(false) }}
        cancel={{
          label: t("practice:PRC-04.exit_leave"),
          onPress: () => {
            setLeaving(false);
            void finish("closed", answers).then(back);
          },
        }}
        testID="drill-exit"
      />
    </div>
  );
}

function DrillSummary({ answered, total, accuracy, ms, onDone, onAgain }: { answered: number; total: number; accuracy: number; ms: number; onDone: () => void; onAgain: () => void }) {
  const { t } = useI18n();
  const pet = useAppStore((x) => x.pet);
  const goal = useAppStore((x) => x.profile?.daily_goal_minutes ?? null);
  const minutes = useTodayMinutes();
  const quota = useQuota();
  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col gap-4 px-4 pb-6" data-testid="prc-06">
      <TopBar onBack={onDone} backIcon="X" />
      <main id="main" className="flex flex-col gap-4">
        <Text variant="title" heading as="h1" align="center">
          {t("practice:PRC-06.title")}
        </Text>
        {pet && <PetLine pet={{ species: pet.species as "cat" | "dog" }} petName={pet.name} text={accuracy >= 70 ? t("practice:PRC-06.pet_line_high_accuracy") : t("practice:PRC-06.pet_line_low_accuracy")} />}
        <div className="grid grid-cols-3 gap-2">
          <StatTile value={`${accuracy}%`} label={t("practice:PRC-06.accuracy_tile")} icon="CheckCircle" testID="drill-accuracy" />
          <StatTile value={mmss(ms)} label={t("practice:PRC-06.time_tile")} icon="Timer" />
          <StatTile value={`${answered}`} label={t("practice:PRC-06.questions")} icon="Exam" />
        </div>
        {answered < total && <Text tone="muted">{t("practice:PRC-06.partial_closed_early", { answered, n: total })}</Text>}
        {goal !== null && <Text tone="muted">{minutes >= goal ? t("practice:PRC-06.goal_done") : t("practice:PRC-06.goal_line", { minutes, goal })}</Text>}
        <Button label={t("practice:PRC-06.done")} onPress={onDone} testID="drill-done" />
        {(quota.unlimited || quota.allowed) && <Button variant="secondary" label={t("practice:PRC-03.start")} onPress={onAgain} />}
      </main>
    </div>
  );
}
