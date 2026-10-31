/**
 * Mocks on the server (mocks §5): MOCK-01 lobby → MOCK-05/06 instructions and declaration →
 * MOCK-07 (phone) / MOCK-08 (desktop CBT) runner with the MOCK-09 palette and OMR sheet →
 * MOCK-16 submit → MOCK-19 report → MOCK-22 solutions. The server builds each paper from the
 * blueprint, keeps the clock and scores it; this page never guesses marks. Where the notice
 * leaves marks out, the screen says "Not stated in the notice".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@smriti/app-core/react";
import { workedSolution, type Answer, type AnyQuestion } from "@smriti/lesson-core";
import {
  PlayerProvider,
  QuestionView,
  RichText,
  canSubmit,
  contentUrl,
  initialDraft,
} from "@smriti/lesson-player-web";
import {
  Banner,
  Button,
  Card,
  Chip,
  ChoiceChips,
  Dialog,
  EmptyState,
  Icon,
  MockPaletteCell,
  OmrBubbleRow,
  ScoreRing,
  SectionTabs,
  Sheet,
  StatTile,
  Switch,
  Text,
  Timer,
  TopBar,
} from "@smriti/ui-web";
import type { MessageKey } from "@smriti/i18n";
import type { MockPaletteState } from "@smriti/tokens";
import { useServices } from "../../boot/context";
import { useManifest } from "../../lib/content";
import { useI18n } from "../../lib/i18n";
import {
  clockOffset,
  localizeQuestion,
  markingLabel,
  pendingSaves,
  pickText,
  saveAnswers,
  startAttempt,
  stubBundle,
  submitAttempt,
  useAttempt,
  useMock,
  useMocks,
  usePastAttempts,
  useReport,
  useSolutions,
  withEmptyKey,
  type AnswerSave,
  type Attempt,
  type AttemptQuestion,
  type Locale,
  type MockCard,
  type PaletteStatus,
  type SolutionItem,
} from "../../lib/mocks";
import { useOnline } from "../../lib/network";
import { fromAnswerIn, toAnswerIn } from "../../lib/practice";
import { useProfileIds } from "../../lib/queries";
import { toast } from "../../lib/toast";
import { useTutorUI } from "../../lib/tutor";
import { RouteLoading } from "../../shell/States";

type T = ReturnType<typeof useI18n>["t"];

const PALETTE: Record<PaletteStatus, MockPaletteState> = {
  not_visited: "notVisited",
  not_answered: "notAnswered",
  answered: "answered",
  marked: "marked",
  answered_marked: "answeredMarked",
};
const LEGEND: [PaletteStatus, MessageKey][] = [
  ["not_visited", "practice:MOCK-09.not_visited"],
  ["not_answered", "practice:MOCK-09.not_answered"],
  ["answered", "practice:MOCK-09.answered"],
  ["marked", "practice:MOCK-09.marked"],
  ["answered_marked", "practice:MOCK-09.answered_and_marked"],
];

function kindLabel(kind: MockCard["kind"], t: T): string {
  switch (kind) {
    case "full":
      return t("practice:MOCK-01.full");
    case "sectional":
      return t("practice:MOCK-01.sectional");
    case "chapter":
      return t("practice:MOCK-01.chapter");
    case "pyq_paper":
      return t("practice:MOCK-01.pyq_papers");
    case "live":
      return t("practice:MOCK-01.live");
    default:
      return t("practice:MOCK-01.custom");
  }
}

function typeLabel(type: string, t: T): string {
  if (type === "numerical") return t("practice:MOCK-07.numerical");
  if (type === "mcq_multi") return t("practice:MOCK-07.multiple_correct");
  return t("practice:MOCK-07.single_correct");
}

const maxLabel = (max: number | null | undefined, t: T) =>
  max === null || max === undefined
    ? t("practice:WEB-06.not_stated")
    : t("practice:WEB-06.max_marks", { max });

function LoadFailed({
  onRetry,
  onBack,
  title,
}: {
  onRetry: () => void;
  onBack: () => void;
  title: string;
}) {
  const { t } = useI18n();
  return (
    <div
      className="mx-auto flex min-h-dvh max-w-[560px] flex-col px-4"
      data-testid="mock-load-failed"
    >
      <TopBar title={title} onBack={onBack} />
      <main id="main">
        <EmptyState
          illustration="ui-search-empty"
          text={t("practice:WEB-06.mock_load_failed")}
          action={{ label: t("practice:WEB-06.try_again"), onPress: onRetry }}
        />
      </main>
    </div>
  );
}

// ── MOCK-01 · Lobby ─────────────────────────────────────────────────────────

type KindFilter = "all" | "full" | "sectional" | "pyq_paper";

export function MockLobby() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const exam = useProfileIds()[0] ?? null;
  const examName = useManifest().data?.manifest.exam.name ?? "";
  const guest = useAppStore((x) => x.session.isGuest);
  const mocks = useMocks(exam);
  const past = usePastAttempts();
  const [kind, setKind] = useState<KindFilter>("all");
  const list = (mocks.data ?? []).filter((m) => kind === "all" || m.kind === kind);
  const kinds = new Set((mocks.data ?? []).map((m) => m.kind));
  const finished = (past.data ?? []).filter(
    (a) => a.status === "submitted" || a.status === "auto_submitted",
  );

  const open = (m: MockCard) => {
    if (!m.access.allowed)
      return void navigate({
        to: "/pro",
        search: { source: m.access.paywall_source ?? "mock_lock" },
      });
    if (m.in_progress_attempt_id)
      return void navigate({
        to: "/practice/attempt/$attemptId",
        params: { attemptId: m.in_progress_attempt_id },
      });
    if (m.kind === "live")
      return void navigate({ to: "/practice/live/$mockId", params: { mockId: m.id } });
    void navigate({ to: "/practice/mock/$mockId", params: { mockId: m.id } });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="mock-01">
      <TopBar
        title={t("practice:MOCK-01.title")}
        onBack={() => void navigate({ to: "/practice" })}
      />
      {!online && <Banner tone="offline" text={t("practice:WEB-06.needs_internet")} />}
      <ChoiceChips
        label={t("practice:MOCK-01.title")}
        hideLabel
        options={(
          [
            ["all", t("practice:MOCK-25.all")],
            ["full", t("practice:MOCK-01.full")],
            ["sectional", t("practice:MOCK-01.sectional")],
            ["pyq_paper", t("practice:MOCK-01.pyq_papers")],
          ] as const
        )
          .filter(([v]) => v === "all" || kinds.has(v))
          .map(([value, label]) => ({ value, label }))}
        value={[kind]}
        onChange={(v) => setKind((v[0] as KindFilter | undefined) ?? "all")}
        testID="mock-filter"
      />
      {mocks.isPending && mocks.fetchStatus !== "idle" ? (
        <RouteLoading />
      ) : mocks.isError ? (
        <EmptyState
          illustration="ui-search-empty"
          text={t("practice:WEB-06.mock_load_failed")}
          action={{ label: t("practice:WEB-06.try_again"), onPress: () => void mocks.refetch() }}
        />
      ) : list.length === 0 ? (
        <EmptyState
          illustration="ui-search-empty"
          text={t("practice:MOCK-01.empty", { exam_short: examName })}
          testID="mock-empty"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {list.map((m) => (
            <Card key={m.id} onPress={() => open(m)} testID={`mock-card-${m.id}`}>
              <span className="flex flex-col gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <Chip kind="status" tone="sunken" label={kindLabel(m.kind, t)} />
                  {m.access.allowed && m.access.reason === "free_quota" && (
                    <Chip kind="status" tone="success" label={t("practice:MOCK-01.free_chip")} />
                  )}
                  {m.in_progress_attempt_id && (
                    <Chip kind="status" tone="warning" label={t("practice:MOCK-01.in_progress")} />
                  )}
                  {!m.access.allowed && (
                    <Chip
                      kind="status"
                      tone="primary"
                      icon="Lock"
                      label={t("practice:MOCK-02.unlock")}
                    />
                  )}
                </span>
                <Text variant="heading">{pickText(m.title, locale)}</Text>
                <Text variant="caption" tone="muted">
                  {t("practice:MOCK-01.duration_fact", { duration_min: m.duration_min })} ·{" "}
                  {t("practice:MOCK-01.questions_fact", { question_count: m.question_count })} ·{" "}
                  {maxLabel(m.max_marks, t)}
                </Text>
                <span className="flex items-center justify-end gap-1 text-primary">
                  <Text variant="label" tone="primary">
                    {m.in_progress_attempt_id
                      ? t("practice:MOCK-02.resume")
                      : m.access.allowed
                        ? t("practice:MOCK-01.start")
                        : t("practice:MOCK-02.unlock")}
                  </Text>
                  <Icon name="CaretRight" color="primary" />
                </span>
              </span>
            </Card>
          ))}
        </div>
      )}
      <section className="flex flex-col gap-2" data-testid="mock-history">
        <Text variant="heading" heading as="h2">
          {t("practice:MOCK-01.history")}
        </Text>
        {finished.length === 0 ? (
          <Text tone="muted">{t("practice:WEB-06.your_mocks_empty")}</Text>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {finished.slice(0, 10).map((a) => (
              <li key={a.id}>
                <Card
                  onPress={() =>
                    void navigate({
                      to: "/practice/attempt/$attemptId/report",
                      params: { attemptId: a.id },
                    })
                  }
                  testID={`attempt-${a.id}`}
                >
                  <span className="flex items-center gap-3">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Text variant="label">{pickText(a.title, locale)}</Text>
                      <Text variant="caption" tone="muted">
                        {t("practice:MOCK-01.attempted.1")} · {a.score ?? "–"} /{" "}
                        {a.max_score ?? t("practice:WEB-06.not_stated")}
                      </Text>
                    </span>
                    <Icon name="CaretRight" color="inkMuted" />
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <Text variant="caption" tone="muted">
          {guest ? t("practice:MOCK-01.guest_sync_line") : t("practice:MOCK-01.sync_line")}
        </Text>
      </section>
    </div>
  );
}

// ── MOCK-05 / MOCK-06 · Instructions and declaration ───────────────────────

export function MockInstructions({ mockId }: { mockId: string }) {
  const { t, locale } = useI18n();
  const s = useServices();
  const navigate = useNavigate();
  const online = useOnline();
  const qc = useQueryClient();
  const examName = useManifest().data?.manifest.exam.name ?? "";
  const mock = useMock(mockId);
  const [agreed, setAgreed] = useState(false);
  const [language, setLanguage] = useState<Locale>(locale);
  const [starting, setStarting] = useState(false);
  const back = () => void navigate({ to: "/practice/mocks" });

  if (mock.isPending) return <RouteLoading />;
  if (mock.isError || !mock.data)
    return (
      <LoadFailed
        title={t("practice:MOCK-01.title")}
        onBack={back}
        onRetry={() => void mock.refetch()}
      />
    );
  const m = mock.data;
  const profile = m.interface_profile as {
    palette_states?: { id: PaletteStatus; label: Record<string, string> }[];
  } | null;
  const legend = (id: PaletteStatus, key: MessageKey) => {
    const fromServer = profile?.palette_states?.find((p) => p.id === id)?.label;
    return fromServer ? pickText(fromServer, locale) : t(key);
  };

  const begin = async () => {
    setStarting(true);
    const attempt = await startAttempt(s, m.id, language);
    setStarting(false);
    if (!attempt) {
      toast.show(t("practice:WEB-06.mock_start_failed"), { tone: "error" });
      return;
    }
    qc.setQueryData(["mocks", "attempt", attempt.id], attempt);
    void qc.invalidateQueries({ queryKey: ["mocks", "list"] });
    void navigate({
      to: "/practice/attempt/$attemptId",
      params: { attemptId: attempt.id },
      replace: true,
    });
  };

  return (
    <div
      className="mx-auto flex min-h-dvh max-w-[760px] flex-col gap-4 px-4 pb-8"
      data-testid="mock-06"
    >
      <TopBar title={t("practice:MOCK-05.header", { exam_name: examName })} onBack={back} />
      <main id="main" className="flex flex-col gap-4">
        <section className="flex flex-col gap-2" data-testid="mock-05">
          <Text variant="title" heading as="h1">
            {pickText(m.title, locale)}
          </Text>
          <Text variant="label">
            {t("practice:MOCK-01.duration_fact", { duration_min: m.duration_min })} ·{" "}
            {t("practice:MOCK-01.questions_fact", { question_count: m.question_count })} ·{" "}
            {maxLabel(m.max_marks, t)}
          </Text>
          <Text variant="heading" heading as="h2">
            {t("practice:MOCK-05.instructions")}
          </Text>
          <Text>{pickText(m.instructions, locale)}</Text>
          <ul
            className="m-0 flex list-none flex-col gap-2 p-0"
            aria-label={t("practice:MOCK-09.title")}
          >
            {LEGEND.map(([st]) => (
              <li key={st} className="flex items-center gap-3">
                <MockPaletteCell number={1} state={PALETTE[st]} />
                <Text variant="caption">
                  {legend(
                    st,
                    `practice:MOCK-05.legend_${st === "answered_marked" ? "answered_and_marked" : st}` as MessageKey,
                  )}
                </Text>
              </li>
            ))}
          </ul>
          <Text variant="caption" tone="muted">
            {m.marked_answer_evaluated
              ? t("practice:MOCK-05.legend_note_evaluated")
              : t("practice:MOCK-05.legend_note_not_evaluated")}
          </Text>
        </section>
        <section className="flex flex-col gap-2">
          <Text variant="heading" heading as="h2">
            {t("practice:MOCK-06.title")}
          </Text>
          <ul className="m-0 flex flex-col gap-2 ps-5">
            {m.sections.map((sec) => (
              <li key={sec.code} className="flex flex-col gap-1">
                <Text>
                  {t("practice:MOCK-06.sections_line", {
                    section_title: pickText(sec.title, locale),
                    question_count: sec.question_count,
                  })}
                </Text>
                {Object.entries(sec.marking).map(([type, rule]) => {
                  const mk = markingLabel(rule);
                  return (
                    <Text key={type} variant="caption" tone="muted">
                      {mk
                        ? t("practice:MOCK-06.marking_line", {
                            type: typeLabel(type, t),
                            correct: mk.correct,
                            wrong: mk.wrong,
                            unattempted: rule.unattempted,
                          })
                        : `${typeLabel(type, t)}: ${t("practice:WEB-06.not_stated")}`}
                    </Text>
                  );
                })}
              </li>
            ))}
          </ul>
          <Text variant="caption" tone="muted">
            {t("practice:MOCK-02.source", {
              source_title: m.source.title,
              source_published: m.source.published ?? t("practice:WEB-06.not_stated"),
              verified_at: m.verified_at,
            })}
          </Text>
        </section>
        {m.languages.length > 1 && (
          <section className="flex flex-col gap-1">
            <ChoiceChips
              label={t("practice:MOCK-06.language_label")}
              options={m.languages
                .filter((l): l is Locale => l === "en" || l === "hi")
                .map((l) => ({
                  value: l,
                  label: t(`practice:WEB-06.language_${l}` as MessageKey),
                }))}
              value={[language]}
              onChange={(v) => setLanguage(v[0] === "hi" ? "hi" : "en")}
              testID="mock-language"
            />
            <Text variant="caption" tone="muted">
              {m.language_switch === "per_question"
                ? t("practice:MOCK-06.language_caption")
                : t("practice:MOCK-06.language_fixed_caption")}
            </Text>
          </section>
        )}
        {!online && <Banner tone="offline" text={t("practice:WEB-06.needs_internet")} />}
        {m.access.allowed ? (
          <>
            <Switch
              checked={agreed}
              onCheckedChange={setAgreed}
              label={t("practice:MOCK-06.declaration")}
              testID="mock-declaration"
            />
            {!agreed && (
              <Text variant="caption" tone="muted">
                {t("practice:MOCK-06.tick_first")}
              </Text>
            )}
            {m.in_progress_attempt_id ? (
              <Button
                label={t("practice:MOCK-02.resume")}
                onPress={() =>
                  void navigate({
                    to: "/practice/attempt/$attemptId",
                    params: { attemptId: m.in_progress_attempt_id ?? "" },
                  })
                }
                testID="mock-resume"
              />
            ) : (
              <Button
                label={t("practice:MOCK-06.begin")}
                disabled={!agreed || !online}
                loading={starting}
                onPress={() => void begin()}
                testID="mock-begin"
              />
            )}
          </>
        ) : (
          <Button
            label={t("practice:MOCK-02.unlock")}
            icon="Lock"
            onPress={() =>
              void navigate({
                to: "/pro",
                search: { source: m.access.paywall_source ?? "mock_lock" },
              })
            }
            testID="mock-unlock"
          />
        )}
      </main>
    </div>
  );
}

// ── MOCK-07 / MOCK-08 / MOCK-09 / MOCK-16 · The runner ──────────────────────

interface Rec {
  answer: Answer | null;
  status: PaletteStatus;
  timeMs: number;
  visits: number;
  changes: number;
}

function safeInitialDraft(q: AnyQuestion): Answer | null {
  if (q.type === "order_steps" && !(q as { answer?: unknown }).answer)
    return { kind: "order", order: q.steps.map((x) => x.id) };
  return initialDraft(q);
}

function recFrom(q: AttemptQuestion): Rec {
  const sv = q.saved;
  return {
    answer: fromAnswerIn(sv?.answer ?? null),
    status: sv?.palette_status ?? "not_visited",
    timeMs: sv?.time_spent_ms ?? 0,
    visits: sv?.visits ?? 0,
    changes: sv?.answer_changes ?? 0,
  };
}

export function MockAttempt({ attemptId }: { attemptId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const attempt = useAttempt(attemptId);
  const back = () => void navigate({ to: "/practice/mocks" });
  useEffect(() => {
    if (attempt.data && attempt.data.status !== "in_progress")
      void navigate({
        to: "/practice/attempt/$attemptId/report",
        params: { attemptId },
        replace: true,
      });
  }, [attempt.data, attemptId, navigate]);
  if (attempt.isPending) return <RouteLoading />;
  if (attempt.isError || !attempt.data)
    return (
      <LoadFailed
        title={t("practice:MOCK-01.title")}
        onBack={back}
        onRetry={() => void attempt.refetch()}
      />
    );
  if (attempt.data.status !== "in_progress") return <RouteLoading />;
  return <Runner attempt={attempt.data} />;
}

function Runner({ attempt }: { attempt: Attempt }) {
  const { t, locale } = useI18n();
  const s = useServices();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();
  const examName = useManifest().data?.manifest.exam.name ?? "";
  const attemptId = attempt.id;

  const sectionOrder = attempt.sections.map((x) => x.code);
  const questions = useMemo(
    () =>
      [...(attempt.questions ?? [])].sort(
        (a, b) =>
          sectionOrder.indexOf(a.section_code) - sectionOrder.indexOf(b.section_code) ||
          a.position - b.position,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attempt.id],
  );
  const endsAt = useMemo(
    () => Date.parse(attempt.server_deadline_at) - clockOffset(attempt.server_time),
    [attempt.server_deadline_at, attempt.server_time],
  );

  const [recs, setRecs] = useState<Record<string, Rec>>(() =>
    Object.fromEntries(questions.map((q) => [q.question_id, recFrom(q)])),
  );
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      questions.findIndex((q) => (q.saved?.palette_status ?? "not_visited") === "not_visited"),
    ),
  );
  const [view, setView] = useState<Record<string, Locale>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // SectionTabs (Radix) points each tab at a panel it does not render; the question area is that
  // panel, so it takes the id the active tab names (reported to ui-web).
  const [panel, setPanel] = useState<{ id: string; by: string } | null>(null);
  useEffect(() => {
    const tab = document.querySelector<HTMLElement>(
      "[data-testid=mock-sections] [role=tab][data-state=active]",
    );
    const id = tab?.getAttribute("aria-controls");
    if (tab && id && (panel?.id !== id || panel.by !== tab.id)) setPanel({ id, by: tab.id });
  }, [panel, index]);
  const opened = useRef(Date.now());
  const queue = useRef(new Map<string, AnswerSave>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const finished = useRef(false);

  const cur = questions[index] as AttemptQuestion | undefined;
  const lang: Locale = (cur && view[cur.question_id]) || (attempt.language as Locale) || locale;
  const localized = useMemo(
    () => (cur ? withEmptyKey(localizeQuestion(cur.body, lang)) : null),
    [cur, lang],
  );
  const bundle = useMemo(() => stubBundle(lang, localized ? [localized] : []), [lang, localized]);
  const [draft, setDraft] = useState<Answer | null>(() => {
    const first = questions[index];
    if (!first) return null;
    return (
      recs[first.question_id]?.answer ??
      safeInitialDraft(withEmptyKey(localizeQuestion(first.body, lang)))
    );
  });

  const toRow = (qid: string, r: Rec): AnswerSave => ({
    question_id: qid,
    answer: r.answer ? (toAnswerIn(r.answer) as AnswerSave["answer"]) : null,
    palette_status: r.status,
    time_spent_ms: Math.round(r.timeMs),
    visits: r.visits,
    answer_changes: r.changes,
    client_updated_at: new Date().toISOString(),
  });

  const goToReport = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["mocks"] });
    void navigate({
      to: "/practice/attempt/$attemptId/report",
      params: { attemptId },
      replace: true,
    });
  }, [attemptId, navigate, qc]);

  const flush = useCallback(() => {
    chain.current = chain.current.then(async () => {
      const rows = [...queue.current.values()];
      if (rows.length === 0) return;
      queue.current.clear();
      const res = await saveAnswers(s, attemptId, rows);
      if (!res) {
        for (const r of rows)
          if (!queue.current.has(r.question_id)) queue.current.set(r.question_id, r);
        setSaveFailed(true);
        return;
      }
      setSaveFailed(false);
      if (res.status !== "in_progress" && !finished.current) {
        finished.current = true;
        goToReport();
      }
    });
    return chain.current;
  }, [attemptId, goToReport, s]);

  // Answers a previous visit could not save come back from `mock_local` and go first.
  useEffect(() => {
    void pendingSaves(s, attemptId).then((rows) => {
      if (rows.length === 0) return;
      setRecs((m) => {
        const next = { ...m };
        for (const r of rows) {
          const prev = next[r.question_id];
          if (!prev) continue;
          next[r.question_id] = {
            answer: fromAnswerIn(r.answer as Record<string, unknown> | null),
            status: r.palette_status,
            timeMs: r.time_spent_ms,
            visits: r.visits,
            changes: r.answer_changes,
          };
          if (!queue.current.has(r.question_id)) queue.current.set(r.question_id, r);
        }
        return next;
      });
      void flush();
    });
  }, [attemptId, flush, s]);

  useEffect(() => {
    if (!saveFailed) return;
    const id = window.setInterval(() => void flush(), 10_000);
    return () => window.clearInterval(id);
  }, [flush, saveFailed]);

  const finish = useCallback(
    async (timeUp: boolean) => {
      if (finished.current) return;
      setSubmitting(true);
      await flush();
      const report = await submitAttempt(s, attemptId);
      setSubmitting(false);
      if (!report && !timeUp) {
        toast.show(t("practice:WEB-06.mock_save_failed"), { tone: "error" });
        return;
      }
      finished.current = true;
      goToReport();
    },
    [attemptId, flush, goToReport, s, t],
  );

  useEffect(() => {
    const id = window.setTimeout(() => void finish(true), Math.max(0, endsAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [endsAt, finish]);

  /** Records time on the current question and moves to question `i`. */
  const go = (i: number, update?: (r: Rec) => Rec) => {
    if (!cur) return;
    const n = Math.max(0, Math.min(questions.length - 1, i));
    const spent = Date.now() - opened.current;
    opened.current = Date.now();
    const next = { ...recs };
    const was = next[cur.question_id] as Rec;
    let mine: Rec = { ...was, timeMs: was.timeMs + spent, visits: Math.max(1, was.visits) };
    if (update) mine = update(mine);
    else if (mine.status === "not_visited") mine = { ...mine, status: "not_answered" };
    next[cur.question_id] = mine;
    queue.current.set(cur.question_id, toRow(cur.question_id, mine));
    const target = questions[n] as AttemptQuestion;
    if (target.question_id !== cur.question_id) {
      const tr = next[target.question_id] as Rec;
      next[target.question_id] = {
        ...tr,
        visits: tr.visits + 1,
        status: tr.status === "not_visited" ? "not_answered" : tr.status,
      };
    }
    setRecs(next);
    if (n !== index) {
      setIndex(n);
      const nr = next[target.question_id] as Rec;
      setDraft(
        nr.answer ??
          safeInitialDraft(
            withEmptyKey(
              localizeQuestion(
                target.body,
                view[target.question_id] ?? (attempt.language as Locale),
              ),
            ),
          ),
      );
    }
    setPaletteOpen(false);
    void flush();
  };

  const answered = (a: Answer | null) => !!localized && canSubmit(localized, a);
  const changed = (r: Rec, a: Answer | null) =>
    JSON.stringify(r.answer) !== JSON.stringify(a) && r.answer !== null ? r.changes + 1 : r.changes;
  const saveNext = () =>
    go(index + 1, (r) =>
      answered(draft)
        ? { ...r, answer: draft, changes: changed(r, draft), status: "answered" }
        : { ...r, status: r.answer ? r.status : "not_answered" },
    );
  const saveMark = () =>
    go(index + 1, (r) =>
      answered(draft)
        ? { ...r, answer: draft, changes: changed(r, draft), status: "answered_marked" }
        : { ...r, status: "marked" },
    );
  const markNext = () =>
    go(index + 1, (r) =>
      answered(draft)
        ? { ...r, answer: draft, changes: changed(r, draft), status: "answered_marked" }
        : { ...r, status: "marked" },
    );
  const clear = () => {
    if (!cur || !localized) return;
    const keepMark =
      (attempt.interface_profile as { clear_keeps_mark?: boolean } | null)?.clear_keeps_mark ??
      true;
    go(index, (r) => ({
      ...r,
      answer: null,
      status:
        keepMark && (r.status === "marked" || r.status === "answered_marked")
          ? "marked"
          : "not_answered",
    }));
    setDraft(safeInitialDraft(localized));
  };
  const pickOmr = (qi: number, optionId: string | null) => {
    const q = questions[qi] as AttemptQuestion;
    const answer: Answer | null = optionId ? { kind: "options", optionIds: [optionId] } : null;
    setRecs((m) => {
      const r = m[q.question_id] as Rec;
      const status: PaletteStatus = answer
        ? r.status === "marked" || r.status === "answered_marked"
          ? "answered_marked"
          : "answered"
        : r.status === "answered_marked"
          ? "marked"
          : "not_answered";
      const nr = {
        ...r,
        answer,
        status,
        changes: changed(r, answer),
        visits: Math.max(1, r.visits),
      };
      queue.current.set(q.question_id, toRow(q.question_id, nr));
      return { ...m, [q.question_id]: nr };
    });
    if (qi === index) setDraft(answer);
    void flush();
  };

  // MOCK-08 keyboard shortcuts on desktop: 1–4 options, N save & next, M mark & next, C clear, ← → move, P palette.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (!window.matchMedia("(min-width: 768px)").matches || e.metaKey || e.ctrlKey || e.altKey)
      return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    if (confirm) return;
    const k = e.key.toLowerCase();
    const opts =
      localized && "options" in localized ? (localized.options as { id: string }[]) : null;
    if (/^[1-9]$/.test(k) && opts) {
      const o = opts[Number(k) - 1];
      if (!o) return;
      e.preventDefault();
      if (localized?.type === "mcq_multi") {
        const now = draft?.kind === "options" ? draft.optionIds : [];
        setDraft({
          kind: "options",
          optionIds: now.includes(o.id) ? now.filter((x) => x !== o.id) : [...now, o.id],
        });
      } else setDraft({ kind: "options", optionIds: [o.id] });
    } else if (k === "n") saveNext();
    else if (k === "m") markNext();
    else if (k === "c") clear();
    else if (k === "arrowright") go(index + 1);
    else if (k === "arrowleft") go(index - 1);
    else if (k === "p") setPaletteOpen((v) => !v);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!cur || !localized)
    return (
      <LoadFailed
        title={t("practice:MOCK-01.title")}
        onBack={() => void navigate({ to: "/practice/mocks" })}
        onRetry={() => window.location.reload()}
      />
    );

  const counts = (codes?: string) => {
    const c: Record<PaletteStatus, number> = {
      not_visited: 0,
      not_answered: 0,
      answered: 0,
      marked: 0,
      answered_marked: 0,
    };
    for (const q of questions)
      if (!codes || q.section_code === codes) c[(recs[q.question_id] as Rec).status] += 1;
    return c;
  };
  const isSaved = (st: PaletteStatus) => st === "answered" || st === "answered_marked";
  const tabs = attempt.sections.map((sec) => {
    const c = counts(sec.code);
    return {
      code: sec.code,
      title: pickText(sec.title, lang),
      answered: c.answered + c.answered_marked,
      total: sec.question_ids.length,
      state:
        sec.status === "open"
          ? ("open" as const)
          : sec.status === "closed"
            ? ("locked" as const)
            : ("not_open" as const),
    };
  });
  const profile = attempt.interface_profile as {
    buttons?: { action: string; label: Record<string, string> }[];
    palette_states?: { id: PaletteStatus; label: Record<string, string> }[];
  } | null;
  const btn = (action: string, key: MessageKey) => {
    const l = profile?.buttons?.find((b) => b.action === action)?.label;
    return l ? pickText(l, lang) : t(key);
  };
  const legend = (id: PaletteStatus, key: MessageKey) => {
    const l = profile?.palette_states?.find((p) => p.id === id)?.label;
    return l ? pickText(l, lang) : t(key);
  };
  const mk = markingLabel(cur.marking);
  const other: Locale = lang === "en" ? "hi" : "en";
  const all = counts();

  const palette = (
    <div className="flex flex-col gap-3" data-testid="mock-palette">
      <ul className="m-0 grid list-none grid-cols-1 gap-1 p-0">
        {LEGEND.map(([st, key]) => (
          <li key={st} className="flex items-center gap-2">
            <MockPaletteCell number={all[st]} state={PALETTE[st]} />
            <Text variant="caption">{legend(st, key)}</Text>
          </li>
        ))}
      </ul>
      {attempt.sections.map((sec) => (
        <section key={sec.code} className="flex flex-col gap-2">
          <Text variant="label">{pickText(sec.title, lang)}</Text>
          <div className="flex flex-wrap gap-2">
            {questions.map((q, i) =>
              q.section_code === sec.code ? (
                <MockPaletteCell
                  key={q.question_id}
                  number={i + 1}
                  state={PALETTE[(recs[q.question_id] as Rec).status]}
                  current={i === index}
                  onPress={() => go(i)}
                  testID={`palette-${i + 1}`}
                />
              ) : null,
            )}
          </div>
        </section>
      ))}
      <section className="flex flex-col gap-1" aria-label={t("practice:MOCK-09.omr_filled")}>
        {questions.map((q, i) => {
          if (q.type !== "mcq_single") return null;
          const opts = ((q.body as { options?: { id: string }[] }).options ?? []).map((o) => o.id);
          const a = (recs[q.question_id] as Rec).answer;
          const sel = a?.kind === "options" && a.optionIds[0] ? opts.indexOf(a.optionIds[0]) : null;
          const st = (recs[q.question_id] as Rec).status;
          return (
            <OmrBubbleRow
              key={q.question_id}
              questionNo={i + 1}
              options={opts.map((o) => o.toUpperCase())}
              selected={sel !== null && sel >= 0 && isSaved(st) ? sel : null}
              flagged={st === "marked" || st === "answered_marked"}
              onSelect={(k) => pickOmr(i, opts[k] ?? null)}
              onClear={() => pickOmr(i, null)}
              testID={`omr-${i + 1}`}
            />
          );
        })}
      </section>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col" data-testid="mock-07">
      <header className="flex items-center gap-3 border-b border-hairline bg-surface px-4 py-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <Text variant="caption" tone="muted" className="hidden truncate md:block">
            {t("practice:MOCK-08.header", { exam_name: examName })}
          </Text>
          <Text variant="heading" className="truncate">
            {t("practice:WEB-06.question_of", { n: index + 1, total: questions.length })}
          </Text>
        </span>
        <Timer
          mode="countdown"
          endsAt={endsAt}
          warnAtMs={5 * 60_000}
          finalAtMs={60_000}
          size="compact"
          testID="mock-timer"
        />
        <Button
          variant="secondary"
          size="sm"
          icon="Sliders"
          label={t("practice:MOCK-09.title")}
          onPress={() => setPaletteOpen(true)}
          className="md:hidden"
          testID="palette-open"
        />
        <Button
          variant="ghost"
          size="sm"
          label={btn("submit", "practice:MOCK-07.submit")}
          loading={submitting}
          onPress={() => setConfirm(true)}
          testID="mock-submit"
        />
      </header>
      {!online && <Banner tone="offline" text={t("practice:MOCK-07.offline_banner")} />}
      {saveFailed && online && (
        <Banner
          tone="warning"
          text={t("practice:WEB-06.mock_save_failed")}
          testID="mock-save-failed"
        />
      )}
      <SectionTabs
        sections={tabs}
        activeCode={cur.section_code}
        navigation={attempt.section_navigation}
        onSelect={(code) => go(questions.findIndex((q) => q.section_code === code))}
        label={t("practice:MOCK-16.section")}
        className="px-2"
        testID="mock-sections"
      />
      <div className="flex flex-1 gap-6 px-4 pt-3 pb-40 md:px-8 md:pb-28">
        <main id="main" className="flex min-w-0 flex-1 flex-col" data-testid="mock-08">
          <div
            role="tabpanel"
            id={panel?.id}
            aria-labelledby={panel?.by}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Chip kind="status" tone="sunken" label={typeLabel(cur.type, t)} />
              <Chip
                kind="status"
                tone="sunken"
                label={
                  mk
                    ? t("practice:WEB-06.marks_per_question", {
                        correct: mk.correct,
                        wrong: mk.wrong,
                      })
                    : t("practice:WEB-06.not_stated")
                }
              />
              <span className="flex-1" />
              {attempt.language_switch === "per_question" && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="Translate"
                  label={t("practice:MOCK-08.view_in", {
                    language: t(`practice:WEB-06.language_${other}` as MessageKey),
                  })}
                  onPress={() => setView((v) => ({ ...v, [cur.question_id]: other }))}
                  testID="mock-view-in"
                />
              )}
            </div>
            <PlayerProvider
              value={{ t, bundle, contentBaseUrl: contentUrl(s.contentBaseUrl, ""), online }}
            >
              <div className="rounded-card bg-surface p-4 shadow-card" lang={lang}>
                <QuestionView
                  key={`${cur.question_id}-${lang}`}
                  q={localized}
                  passage={null}
                  draft={draft}
                  onDraft={setDraft}
                  locked={false}
                  reveal="none"
                  struck={[]}
                />
              </div>
            </PlayerProvider>
            <Text variant="caption" tone="muted" className="hidden md:block">
              {t("practice:MOCK-08.shortcut_hint")}
            </Text>
          </div>
        </main>
        <aside
          className="hidden w-[300px] shrink-0 md:block"
          aria-label={t("practice:MOCK-09.title")}
        >
          {palette}
        </aside>
      </div>
      <footer className="fixed inset-x-0 bottom-0 border-t border-hairline bg-surface px-4 py-3">
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon="CaretLeft"
              label={t("practice:MOCK-08.back")}
              onPress={() => go(index - 1)}
              disabled={index === 0}
              testID="mock-prev"
            />
            <Button
              variant="ghost"
              size="sm"
              icon="CaretRight"
              iconPosition="end"
              label={t("practice:MOCK-08.next")}
              onPress={() => go(index + 1)}
              disabled={index === questions.length - 1}
              className="hidden md:inline-flex"
              testID="mock-next"
            />
            <span className="flex-1" />
            <Button
              variant="secondary"
              size="sm"
              label={btn("mark_review_next", "practice:MOCK-07.mark_for_review_next")}
              onPress={markNext}
              testID="mock-mark"
            />
            <Button
              variant="secondary"
              size="sm"
              label={t("practice:MOCK-08.save_mark")}
              onPress={saveMark}
              className="hidden md:inline-flex"
              testID="mock-save-mark"
            />
            <Button
              variant="ghost"
              size="sm"
              label={btn("clear_response", "practice:MOCK-07.clear_response")}
              onPress={clear}
              testID="mock-clear"
            />
          </div>
          <span className="hidden flex-1 md:block" />
          <Button
            label={btn("save_next", "practice:MOCK-07.save_next")}
            onPress={saveNext}
            testID="mock-save-next"
          />
        </div>
      </footer>
      <Sheet
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        title={t("practice:MOCK-09.title")}
        height="full"
        testID="mock-09"
      >
        {palette}
      </Sheet>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("practice:MOCK-16.title")}
        description={t("practice:MOCK-16.confirm")}
        confirm={{ label: t("practice:MOCK-16.yes"), onPress: () => void finish(false) }}
        cancel={{ label: t("practice:MOCK-16.go_back"), onPress: () => setConfirm(false) }}
        testID="mock-16"
      >
        <table className="w-full text-caption">
          <thead>
            <tr className="text-start">
              <th className="text-start font-semibold">{t("practice:MOCK-16.section")}</th>
              <th className="font-semibold">{t("practice:MOCK-16.answered")}</th>
              <th className="font-semibold">{t("practice:MOCK-16.not_answered")}</th>
              <th className="font-semibold">{t("practice:MOCK-16.marked")}</th>
              <th className="font-semibold">{t("practice:MOCK-16.not_visited")}</th>
            </tr>
          </thead>
          <tbody>
            {attempt.sections.map((sec) => {
              const c = counts(sec.code);
              return (
                <tr key={sec.code} className="text-center tabular-nums">
                  <td className="text-start">{pickText(sec.title, lang)}</td>
                  <td>{c.answered + c.answered_marked}</td>
                  <td>{c.not_answered}</td>
                  <td>{c.marked + c.answered_marked}</td>
                  <td>{c.not_visited}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Text variant="caption" tone="muted">
          {attempt.marked_answer_evaluated
            ? t("practice:MOCK-16.evaluated_note")
            : t("practice:MOCK-16.not_evaluated_note")}
        </Text>
      </Dialog>
    </div>
  );
}

// ── MOCK-19 · Report ─────────────────────────────────────────────────────────

const minutes = (ms: number | null | undefined) => Math.round((ms ?? 0) / 60_000);

export function MockReport({ attemptId }: { attemptId: string }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const report = useReport(attemptId);
  const done = () => void navigate({ to: "/practice/mocks" });
  if (report.isPending) return <RouteLoading />;
  if (report.isError || !report.data)
    return (
      <LoadFailed
        title={t("practice:MOCK-01.title")}
        onBack={done}
        onRetry={() => void report.refetch()}
      />
    );
  const r = report.data;
  const sum = (r.summary ?? {}) as {
    correct?: number;
    wrong?: number;
    skipped?: number;
    attempted?: number;
    time_ms?: number;
  };
  const locked = new Set(r.locked);
  const scoreKnown = r.score !== null && r.score !== undefined;

  return (
    <div
      className="mx-auto flex min-h-dvh max-w-[760px] flex-col gap-4 px-4 pb-8"
      data-testid="mock-19"
    >
      <TopBar title={pickText(r.title, locale)} onBack={done} backIcon="X" />
      <main id="main" className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          {scoreKnown && r.max_score ? (
            <ScoreRing
              score={r.score as number}
              max={r.max_score}
              label={t("practice:MOCK-19.score_tile")}
              testID="mock-score"
            />
          ) : (
            <StatTile
              value={scoreKnown ? String(r.score) : "–"}
              label={
                scoreKnown
                  ? `${t("practice:MOCK-19.score_tile")} · ${maxLabel(r.max_score, t)}`
                  : t("practice:WEB-06.score_not_stated")
              }
              testID="mock-score"
            />
          )}
          <Text tone="muted">
            {t("practice:MOCK-19.counts_line", {
              correct: sum.correct ?? 0,
              wrong: sum.wrong ?? 0,
              skipped: sum.skipped ?? 0,
            })}
          </Text>
          {r.standing?.shown &&
            r.standing.percentile !== null &&
            r.standing.percentile !== undefined && (
              <Text variant="label">
                {t("practice:MOCK-19.percentile", { percentile: r.standing.percentile })}
              </Text>
            )}
          {r.standing?.shown && r.standing.rank && r.standing.of ? (
            <Text variant="label">
              {t("practice:MOCK-19.rank", { rank: r.standing.rank, ranked_count: r.standing.of })}
            </Text>
          ) : null}
          {r.standing &&
          !r.standing.shown &&
          r.standing.reason === "below_threshold" &&
          r.standing.needed ? (
            <Text variant="caption" tone="muted">
              {t("practice:MOCK-19.threshold", {
                min: r.standing.needed,
                count: r.standing.counted ?? 0,
              })}
            </Text>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatTile
            value={
              r.accuracy === null || r.accuracy === undefined
                ? "–"
                : `${Math.round(r.accuracy * (r.accuracy <= 1 ? 100 : 1))}%`
            }
            label={t("practice:MOCK-19.accuracy_tile")}
          />
          <StatTile
            value={t("practice:MOCK-19.time_lost_value", { m: minutes(r.time_lost_wrong_ms) })}
            label={t("practice:MOCK-19.time_lost_tile")}
          />
          <StatTile
            value={t("practice:MOCK-19.accuracy_meta", {
              correct: sum.correct ?? 0,
              attempted: sum.attempted ?? 0,
            })}
            label={t("practice:MOCK-16.answered")}
          />
        </div>
        {(r.sections ?? []).length > 0 && (
          <section className="flex flex-col gap-2">
            <Text variant="heading" heading as="h2">
              {t("practice:MOCK-19.sections_and_subjects")}
            </Text>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {(r.sections ?? []).map((sec) => {
                const row = sec as unknown as {
                  code: string;
                  title: Record<string, string>;
                  marks: number | null;
                  max_marks: number | null;
                  accuracy: number | null;
                };
                return (
                  <li
                    key={row.code}
                    className="flex items-center justify-between gap-3 rounded-md bg-surface p-3 shadow-card"
                  >
                    <Text variant="label">{pickText(row.title, locale)}</Text>
                    <Text variant="caption" tone="muted">
                      {row.marks ?? "–"}/{row.max_marks ?? t("practice:WEB-06.not_stated")} ·{" "}
                      {t("practice:MOCK-19.section_meta.2", {
                        accuracy: Math.round(
                          (row.accuracy ?? 0) * ((row.accuracy ?? 0) <= 1 ? 100 : 1),
                        ),
                      })}
                    </Text>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {locked.size > 0 && (
          <Card tone="tint" testID="mock-report-locked">
            <span className="flex flex-col gap-2">
              <Text variant="heading">{t("practice:MOCK-19.pro_lock_title")}</Text>
              <Text tone="muted">{t("practice:MOCK-19.pro_lock_line")}</Text>
              <Button
                variant="secondary"
                icon="Lock"
                label={t("practice:MOCK-02.unlock")}
                onPress={() => void navigate({ to: "/pro", search: { source: "mock_report" } })}
                testID="mock-report-unlock"
              />
            </span>
          </Card>
        )}
        <Button
          label={t("practice:MOCK-19.review_solutions")}
          onPress={() =>
            void navigate({ to: "/practice/attempt/$attemptId/solutions", params: { attemptId } })
          }
          testID="mock-solutions"
        />
        <Button
          variant="secondary"
          label={t("practice:PRC-06.done")}
          onPress={done}
          testID="mock-done"
        />
      </main>
    </div>
  );
}

// ── MOCK-22 · Solutions ──────────────────────────────────────────────────────

type SolFilter = "all" | "wrong" | "skipped";

function solutionQuestion(item: SolutionItem, locale: Locale): AnyQuestion {
  const q = localizeQuestion(item.question, locale) as AnyQuestion & Record<string, unknown>;
  const sol = item.solution as { answer?: unknown; solution?: unknown; hints?: unknown };
  return {
    ...q,
    answer: sol.answer,
    solution: sol.solution ? localizeQuestion(sol.solution, locale) : undefined,
    hints: sol.hints ? localizeQuestion(sol.hints, locale) : undefined,
  } as unknown as AnyQuestion;
}

export function MockSolutions({ attemptId }: { attemptId: string }) {
  const { t, locale } = useI18n();
  const s = useServices();
  const navigate = useNavigate();
  const online = useOnline();
  const sols = useSolutions(attemptId);
  const openTutor = useTutorUI((x) => x.openTutor);
  const [filter, setFilter] = useState<SolFilter>("all");
  const back = () =>
    void navigate({ to: "/practice/attempt/$attemptId/report", params: { attemptId } });
  const items = useMemo(
    () => (sols.data?.items ?? []).map((it) => ({ it, q: solutionQuestion(it, locale) })),
    [sols.data, locale],
  );
  const bundle = useMemo(
    () =>
      stubBundle(
        locale,
        items.map((x) => x.q),
      ),
    [items, locale],
  );
  if (sols.isPending) return <RouteLoading />;
  if (sols.isError || !sols.data)
    return (
      <LoadFailed
        title={t("practice:MOCK-22.title")}
        onBack={back}
        onRetry={() => void sols.refetch()}
      />
    );
  const shown = items.filter(
    ({ it }) =>
      filter === "all" ||
      (filter === "wrong"
        ? it.status === "wrong" || it.status === "partial"
        : it.status === "skipped"),
  );

  const marksText = (n: number) =>
    n > 0
      ? t("practice:MOCK-22.marks_plus", { n })
      : n < 0
        ? t("practice:MOCK-22.marks_minus", { n: Math.abs(n) })
        : t("practice:MOCK-22.marks_zero");
  const statusChip = (st: SolutionItem["status"]) =>
    st === "correct" ? (
      <Chip kind="status" tone="success" icon="CheckCircle" label={t("practice:MOCK-02.right")} />
    ) : st === "wrong" ? (
      <Chip kind="status" tone="error" icon="XCircle" label={t("practice:MOCK-22.wrong")} />
    ) : st === "partial" ? (
      <Chip kind="status" tone="warning" label={t("practice:MOCK-02.partial")} />
    ) : st === "skipped" ? (
      <Chip kind="status" tone="sunken" icon="Minus" label={t("practice:MOCK-22.skipped")} />
    ) : (
      <Chip kind="status" tone="sunken" icon="Info" label={t("practice:MOCK-22.not_scored")} />
    );

  return (
    <div
      className="mx-auto flex min-h-dvh max-w-[760px] flex-col gap-4 px-4 pb-8"
      data-testid="mock-22"
    >
      <TopBar title={t("practice:MOCK-22.title")} onBack={back} />
      <ChoiceChips
        label={t("practice:MOCK-22.title")}
        hideLabel
        options={[
          { value: "all", label: t("practice:MOCK-22.all") },
          { value: "wrong", label: t("practice:MOCK-22.wrong") },
          { value: "skipped", label: t("practice:MOCK-22.skipped") },
        ]}
        value={[filter]}
        onChange={(v) => setFilter((v[0] as SolFilter | undefined) ?? "all")}
        testID="solutions-filter"
      />
      <main id="main" className="flex flex-col gap-4">
        {shown.length === 0 && <Text tone="muted">{t("practice:MOCK-22.filter_empty")}</Text>}
        <PlayerProvider
          value={{ t, bundle, contentBaseUrl: contentUrl(s.contentBaseUrl, ""), online }}
        >
          {shown.map(({ it, q }) => {
            const ws = workedSolution(q);
            const mine = fromAnswerIn(it.your_answer);
            return (
              <article
                key={it.question_id}
                className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card"
                data-testid={`solution-${it.position}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Text variant="label">
                    {t("practice:MOCK-07.question_n", { n: it.position })}
                  </Text>
                  {statusChip(it.status)}
                  <span className="flex-1" />
                  <Text
                    variant="label"
                    tone={it.marks < 0 ? "error" : it.marks > 0 ? "success" : "muted"}
                  >
                    {marksText(it.marks)}
                  </Text>
                </div>
                <QuestionView
                  q={q}
                  passage={null}
                  draft={mine}
                  onDraft={() => {}}
                  locked
                  reveal="final"
                  struck={[]}
                />
                {ws.feynman && <RichText text={ws.feynman} />}
                {ws.steps.length > 0 && (
                  <ol className="m-0 flex flex-col gap-1 ps-5">
                    {ws.steps.map((st, i) => (
                      <li key={i}>
                        <RichText text={st} as="span" />
                      </li>
                    ))}
                  </ol>
                )}
                {ws.shortcut && <RichText text={ws.shortcut} />}
                <Button
                  variant="secondary"
                  size="sm"
                  icon="ChatCircleText"
                  label={t("practice:MOCK-22.ask_tutor")}
                  onPress={() =>
                    openTutor({
                      ref: `question:${it.question_id}`,
                      kind: "question",
                      title: t("tutor_social:AI-02.context_chip_question", { n: it.position }),
                    })
                  }
                  testID={`ask-tutor-${it.position}`}
                />
              </article>
            );
          })}
        </PlayerProvider>
      </main>
    </div>
  );
}

// Route wrappers: read the path params and render the screen.
export function MockInstructionsRoute() {
  const { mockId } = useParams({ strict: false }) as { mockId: string };
  return <MockInstructions mockId={mockId} />;
}
export function MockAttemptRoute() {
  const { attemptId } = useParams({ strict: false }) as { attemptId: string };
  return <MockAttempt key={attemptId} attemptId={attemptId} />;
}
export function MockReportRoute() {
  const { attemptId } = useParams({ strict: false }) as { attemptId: string };
  return <MockReport attemptId={attemptId} />;
}
export function MockSolutionsRoute() {
  const { attemptId } = useParams({ strict: false }) as { attemptId: string };
  return <MockSolutions attemptId={attemptId} />;
}
