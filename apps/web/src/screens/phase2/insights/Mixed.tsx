/**
 * The interleaved practice builder (G-8, practice §5.3) on the web: PRC-03 with a mixed scope, then
 * the PRC-04 runner over `POST /v1/practice/interleaved`'s questions, which take turns across the
 * chapters (or subjects, or topics) the student has learned. Each question renders from its own
 * topic's practice bundle. Answers carry the student's Sure / 50:50 / Guess tag, which feeds MEM-25.
 * When the server can't take an answer, it goes through the outbox as `answer_submitted`.
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { newIdempotencyKey, unwrap } from "@smriti/api-client";
import type { TypedBundle } from "@smriti/content-schema";
import { checkAnswer, type Answer, type AnyQuestion, type CheckResult } from "@smriti/lesson-core";
import { PlayerProvider, QuestionView, canSubmit, contentUrl, initialDraft } from "@smriti/lesson-player-web";
import { Banner, Button, Chip, ConfidenceRow, IconButton, ProgressBar, StatTile, Text } from "@smriti/ui-web";
import type { Confidence } from "@smriti/ui-web";
import { useServices } from "../../../boot/context";
import type { Services } from "../../../boot/services";
import { bundleEntry, contentKeys, useManifest } from "../../../lib/content";
import { useDaily } from "../../../lib/daily";
import { useI18n } from "../../../lib/i18n";
import { useOnline } from "../../../lib/network";
import { completeServerSession, toAnswerIn, type ServerSession } from "../../../lib/practice";
import { RouteLoading } from "../../../shell/States";
import { errorCode, problemField } from "../shared/errors";
import { useClose } from "../shared/nav";
import { Page } from "../shared/Page";
import { COUNTS, playable, sessionTopics, type GroupBy } from "./logic";

const CONF: Record<Confidence, "sure" | "fifty_fifty" | "guess"> = { sure: "sure", half: "fifty_fifty", guess: "guess" };
const GROUPS: GroupBy[] = ["chapter", "subject", "topic"];

type Phase = { kind: "setup" } | { kind: "run"; session: ServerSession } | { kind: "done"; answered: number; correct: number; total: number; ms: number };

export function Mixed() {
  const s = useServices();
  const { t } = useI18n();
  const close = useClose("/practice");
  const online = useOnline();
  const [groupBy, setGroupBy] = useState<GroupBy>("chapter");
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string | null; needed?: number } | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await unwrap(s.client.POST("/v1/practice/interleaved", { body: { count, group_by: groupBy, session_id: s.newId(), exam: s.store.getState().profile?.exam_profile_ids[0] ?? null } }), s.client);
      setPhase({ kind: "run", session });
      s.analytics.track("drill_started", { session_id: session.id, scope: "mixed", concept_count: 0, question_count: session.questions.length, difficulty_mode: "adaptive", timed: false, feedback_mode: "after_each" });
    } catch (e) {
      const n = problemField(e, "needed");
      setError({ code: errorCode(e), needed: typeof n === "number" ? n : undefined });
    } finally {
      setBusy(false);
    }
  };

  if (phase.kind === "run") return <Runner session={phase.session} onDone={(r) => setPhase({ kind: "done", ...r })} onClose={close} />;
  if (phase.kind === "done") {
    const accuracy = phase.answered ? Math.round((phase.correct / phase.answered) * 100) : 0;
    return (
      <Page title={t("practice:PRC-06.title")} onBack={close} backIcon="X" testID="mixed-done" footer={<Button label={t("practice:PRC-06.done")} onPress={close} testID="mixed-finish" />}>
        <h1 className="sr-only">{t("practice:PRC-06.title")}</h1>
        <div className="grid grid-cols-2 gap-3">
          <StatTile value={`${accuracy}%`} label={t("practice:PRC-06.accuracy_tile")} icon="CheckCircle" testID="mixed-accuracy" />
          <StatTile value={String(phase.answered)} label={t("practice:PRC-06.questions")} icon="Exam" />
        </div>
        {phase.answered < phase.total && <Text tone="muted">{t("practice:PRC-06.partial_closed_early", { answered: phase.answered, n: phase.total })}</Text>}
        <Button label={t("practice:PRC-03.start")} variant="secondary" onPress={() => setPhase({ kind: "setup" })} />
      </Page>
    );
  }

  return (
    <Page
      title={t("practice:PRC-03.mixed_title")}
      onBack={close}
      backIcon="X"
      testID="mixed-setup"
      footer={<Button label={t("practice:PRC-03.start")} icon="Shuffle" loading={busy} disabled={!online} onPress={() => void start()} testID="mixed-start" />}
    >
      <h1 className="sr-only">{t("practice:PRC-03.mixed_title")}</h1>
      <Text tone="muted">{t("practice:PRC-03.mixed_caption")}</Text>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-label font-bold text-ink">{t("practice:PRC-03.mix_by")}</legend>
        <div role="radiogroup" aria-label={t("practice:PRC-03.mix_by")} className="flex flex-wrap gap-2">
          {GROUPS.map((g) => (
            <Chip key={g} kind="filter" role="radio" label={t(`practice:PRC-03.mix_${g}`)} selected={groupBy === g} onPress={() => setGroupBy(g)} testID={`mixed-by-${g}`} />
          ))}
        </div>
      </fieldset>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-label font-bold text-ink">{t("practice:PRC-03.questions")}</legend>
        <div role="radiogroup" aria-label={t("practice:PRC-03.questions")} className="flex flex-wrap gap-2">
          {COUNTS.map((n) => (
            <Chip key={n} kind="filter" role="radio" label={String(n)} selected={count === n} onPress={() => setCount(n)} testID={`mixed-count-${n}`} />
          ))}
        </div>
      </fieldset>
      {!online && <Banner tone="offline" icon="WifiSlash" text={t("practice:PRC-03.mixed_online")} />}
      {error && (
        <Banner
          tone="warning"
          icon="WarningCircle"
          text={error.code === "not_enough_variety" ? t("practice:PRC-03.mixed_variety", { needed: error.needed ?? 2 }) : error.code === "feature_disabled" ? t("practice:PRC-03.mixed_off") : t("practice:PRC-03.mixed_failed")}
          testID="mixed-error"
        />
      )}
    </Page>
  );
}

/** Practice bundles for every topic in the session, loaded side by side. */
function useBundles(topicIds: readonly string[]) {
  const s = useServices();
  const loaded = useManifest().data ?? null;
  const results = useQueries({
    queries: topicIds.map((id) => {
      const entry = bundleEntry(loaded?.manifest, id, "practice");
      return {
        queryKey: contentKeys.bundle(entry?.hash ?? `none-${id}`),
        enabled: !!entry && !!loaded,
        staleTime: Infinity,
        queryFn: async () => {
          const res = await s.fetch(`${loaded?.baseUrl ?? ""}${entry?.path ?? ""}`);
          if (!res.ok) throw new Error(`bundle ${res.status}`);
          return { bundle: (await res.json()) as TypedBundle, entry, baseUrl: loaded?.baseUrl ?? "" };
        },
      };
    }),
  });
  const pending = !loaded || results.some((r) => r.isPending && r.fetchStatus !== "idle");
  const byTopic = new Map<string, TypedBundle>();
  results.forEach((r, i) => {
    const id = topicIds[i];
    if (id && r.data) byTopic.set(id, r.data.bundle as TypedBundle);
  });
  return { pending, byTopic, baseUrl: loaded?.baseUrl ?? "" };
}

async function submitAnswer(s: Services, sessionId: string, a: { qid: string; topicId: string; draft: Answer; r: CheckResult; ms: number; confidence: Confidence | null; locale: "en" | "hi" }) {
  try {
    const res = await unwrap(
      s.client.POST("/v1/practice/sessions/{session_id}/answers", {
        params: { path: { session_id: sessionId }, header: { "Idempotency-Key": newIdempotencyKey() } },
        body: { question_id: a.qid, answer: toAnswerIn(a.draft), attempt: 1, time_ms: Math.round(Math.min(3_600_000, a.ms)), locale: a.locale, confidence: a.confidence ? CONF[a.confidence] : null },
      }),
      s.client,
    );
    if (res.counted) useDaily.getState().addPractice(1);
    return;
  } catch {
    // The server didn't take it (offline, or the in-process fake): the outbox carries it.
  }
  await s.record("answer_submitted", {
    topic_id: a.topicId,
    question_id: a.qid,
    context: "practice",
    response: a.r.response as never,
    correct: a.r.correct,
    attempt: 1,
    confidence: a.confidence ? CONF[a.confidence] : null,
    ms_to_answer: Math.round(a.ms),
  });
  useDaily.getState().addPractice(1);
}

function Runner({ session, onDone, onClose }: { session: ServerSession; onDone: (r: { answered: number; correct: number; total: number; ms: number }) => void; onClose: () => void }) {
  const s = useServices();
  const { t, locale } = useI18n();
  const online = useOnline();
  const navigate = useNavigate();
  const topics = useMemo(() => sessionTopics(session.questions), [session]);
  const bundles = useBundles(topics);
  const items = useMemo(
    () =>
      playable(session.questions, (topicId, id) => {
        const q = bundles.byTopic.get(topicId)?.questions[id];
        return q && q.type !== "paragraph" ? (q as AnyQuestion) : undefined;
      }),
    [session, bundles.byTopic],
  );
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Answer | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const started = useRef(Date.now());
  const opened = useRef(Date.now());

  if (bundles.pending) return <RouteLoading />;
  const item = items[index];
  const finish = async (list: boolean[], endedBy: "finished" | "closed") => {
    const ms = Date.now() - started.current;
    const correct = list.filter(Boolean).length;
    const server = await completeServerSession(s, session.id, endedBy);
    if (!server && list.length) await s.record("practice_session_completed", { session_id: session.id, kind: "drill", answered: list.length, correct, ms_total: ms });
    if (list.length) useDaily.getState().add(ms);
    s.analytics.track("drill_completed", { session_id: session.id, answered: list.length, correct, duration_ms: ms, ended_by: endedBy, free_cap: "none" });
    onDone({ answered: list.length, correct, total: items.length, ms });
  };
  if (!item) {
    return (
      <Page title={t("practice:PRC-03.mixed_title")} onBack={onClose} backIcon="X" testID="mixed-empty">
        <Text tone="muted">{t("practice:PRC-04.not_loaded")}</Text>
        <Button label={t("practice:PRC-06.done")} onPress={() => void navigate({ to: "/practice" })} />
      </Page>
    );
  }
  const b = bundles.byTopic.get(item.topicId) as TypedBundle;
  const last = index === items.length - 1;
  const check = async () => {
    if (!draft || result) return;
    const r = checkAnswer(item.q, draft);
    const ms = Date.now() - opened.current;
    setResult(r);
    setAnswers((xs) => [...xs, r.correct]);
    await submitAnswer(s, session.id, { qid: item.id, topicId: item.topicId, draft, r, ms, confidence, locale });
  };
  const next = () => {
    if (last) {
      void finish(answers, "finished");
      return;
    }
    setIndex(index + 1);
    setDraft(initialDraft(items[index + 1]?.q ?? null));
    setConfidence(null);
    setResult(null);
    opened.current = Date.now();
  };
  const counter = t("practice:PRC-04.counter", { i: index + 1, n: items.length });
  return (
    <div className="mx-auto flex min-h-dvh max-w-[720px] flex-col px-4" data-testid="mixed-run">
      <header className="flex h-14 items-center gap-3">
        <IconButton icon="X" label={t("ui:common.close")} onPress={() => void finish(answers, "closed")} testID="mixed-close" />
        <ProgressBar className="flex-1" value={(index + (result ? 1 : 0)) / items.length} label={counter} />
        <Text variant="label" testID="mixed-counter">
          {counter}
        </Text>
      </header>
      <main id="main" className="flex flex-1 flex-col gap-4 pb-28">
        <h1 className="sr-only">{t("practice:PRC-03.mixed_title")}</h1>
        <PlayerProvider value={{ t, bundle: b, contentBaseUrl: contentUrl(bundles.baseUrl, ""), online }}>
          <div className="rounded-card bg-surface p-4 shadow-card" data-testid="mixed-question" data-topic={item.topicId}>
            <QuestionView key={item.id} q={item.q} passage={null} draft={draft} onDraft={setDraft} locked={!!result} reveal={result ? "final" : "none"} struck={[]} />
          </div>
          {!result && <ConfidenceRow value={confidence} onChange={setConfidence} testID="mixed-confidence" />}
          {result && (
            <section className={`flex flex-col gap-2 rounded-card p-4 ${result.correct ? "bg-success-tint" : "bg-warning-tint"}`} aria-live="polite" data-testid="mixed-feedback">
              <Text variant="heading" heading as="h2" tone={result.correct ? "success" : "warning"}>
                {result.correct ? t("practice:PRC-05.correct") : t("practice:PRC-05.wrong")}
              </Text>
            </section>
          )}
        </PlayerProvider>
      </main>
      <footer className="fixed inset-x-0 bottom-0 border-t border-hairline bg-surface px-4 py-3">
        <div className="mx-auto max-w-[720px]">
          {result ? (
            <Button label={last ? t("practice:PRC-05.see_summary") : t("practice:PRC-05.next")} onPress={next} testID="mixed-next" />
          ) : (
            <Button label={t("practice:PRC-04.check")} onPress={() => void check()} disabled={!canSubmit(item.q, draft)} testID="mixed-check" />
          )}
        </div>
      </footer>
    </div>
  );
}
