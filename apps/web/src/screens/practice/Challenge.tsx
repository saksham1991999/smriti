/**
 * PRC-11 daily challenge and PRC-12 result and leaderboard, on `/v1/daily-challenge`. The same
 * question for everyone in the exam each day; the server keeps the clock and ranks. No tutor
 * button until the answer is in (R24).
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@smriti/app-core/react";
import { workedSolution, type Answer } from "@smriti/lesson-core";
import { PlayerProvider, QuestionView, RichText, canSubmit, contentUrl, initialDraft } from "@smriti/lesson-player-web";
import { Button, ConfidenceRow, EmptyState, LeaderboardRow, PetLine, StatTile, Text, Timer, TopBar } from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { answerChallenge, mss, startChallenge, useChallengeLeaderboard, useDailyChallenge, type Confidence, type DailyChallenge } from "../../lib/challenge";
import { useI18n } from "../../lib/i18n";
import { localizeQuestion, stubBundle, withEmptyKey } from "../../lib/mocks";
import { useOnline } from "../../lib/network";
import { useProfileIds } from "../../lib/queries";
import { toast } from "../../lib/toast";
import { timeZone } from "../../platform/web";
import { RouteLoading } from "../../shell/States";
import { TutorButton } from "../tutor/TutorButton";

const hhmm = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

export function DailyChallengeScreen() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const exam = useProfileIds()[0] ?? null;
  const today = useDailyChallenge(exam);
  const qc = useQueryClient();
  const userId = useAppStore((x) => x.session.userId);
  const close = () => void navigate({ to: "/practice" });
  const dateLabel = today.data ? new Date(`${today.data.day}T00:00:00`).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "long" }) : "";

  let body;
  if (!online && !today.data) {
    body = <EmptyState illustration="ui-search-empty" text={t("practice:PRC-11.offline")} action={{ label: t("practice:PRC-11.offline_action"), onPress: close }} testID="prc-11-offline" />;
  } else if (today.isPending && today.fetchStatus !== "idle") {
    body = <RouteLoading />;
  } else if (today.isError || !today.data) {
    body = <EmptyState illustration="ui-search-empty" text={t("practice:PRC-11.not_published")} testID="prc-11-none" />;
  } else if (today.data.result) {
    body = <ChallengeResult c={today.data} />;
  } else {
    body = <ChallengePlay c={today.data} onUpdate={(c) => qc.setQueryData(["challenge", "today", userId, exam], c)} />;
  }
  return (
    <div className="mx-auto flex min-h-dvh max-w-[960px] flex-col gap-4 px-4 pb-8" data-testid="prc-11">
      <TopBar title={`${t("practice:PRC-11.title")}${dateLabel ? ` · ${dateLabel}` : ""}`} onBack={close} backIcon="X" />
      {body}
    </div>
  );
}

function ChallengePlay({ c, onUpdate }: { c: DailyChallenge; onUpdate: (c: DailyChallenge) => void }) {
  const { t, locale } = useI18n();
  const s = useServices();
  const online = useOnline();
  const pet = useAppStore((x) => x.pet);
  const species = pet?.species === "dog" ? "dog" : "cat";
  const [starting, setStarting] = useState(false);
  const [draft, setDraft] = useState<Answer | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [sending, setSending] = useState(false);
  const stoppedAt = useRef<number | null>(null);
  const key = useRef(s.newId());
  const q = useMemo(() => (c.question ? withEmptyKey(localizeQuestion(c.question, locale)) : null), [c.question, locale]);
  const bundle = useMemo(() => stubBundle(locale, q ? [q] : []), [locale, q]);
  const startedAt = c.started_at ? Date.parse(c.started_at) : null;

  const start = async () => {
    setStarting(true);
    const next = await startChallenge(s, c.id);
    setStarting(false);
    if (!next) return toast.show(t("practice:PRC-11.offline"), { tone: "error" });
    const nq = next.question ? withEmptyKey(localizeQuestion(next.question, locale)) : null;
    setDraft(initialDraft(nq));
    onUpdate(next);
  };
  const submit = async () => {
    if (!startedAt) return;
    // The clock stops at the first tap, so a retry after a network error isn't penalised.
    stoppedAt.current ??= Date.now();
    setSending(true);
    const res = await answerChallenge(s, c.id, { answer: draft, confidence, ms: stoppedAt.current - startedAt, tz: timeZone() }, key.current);
    setSending(false);
    if (!res) return toast.show(t("practice:WEB-06.answer_not_saved"), { tone: "error" });
    onUpdate(res);
  };

  if (!q || !startedAt) {
    return (
      <main id="main" className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8" data-testid="prc-11-before">
        <div className="flex flex-1 flex-col gap-3">
          <PetLine pet={{ species, mood: "curious" }} petName={pet?.name ?? ""} text={t("practice:PRC-11.pet_line")} />
          <Text variant="title" heading as="h1">
            {t("practice:PRC-11.headline")}
          </Text>
          <ul className="m-0 flex flex-col gap-1 ps-5">
            <li>
              <Text>{t("practice:PRC-11.rule_1")}</Text>
            </li>
            <li>
              <Text>{t("practice:PRC-11.rule_2")}</Text>
            </li>
            <li>
              <Text>{t("practice:PRC-11.rule_4")}</Text>
            </li>
            <li>
              <Text>{t("practice:PRC-11.rule_5")}</Text>
            </li>
          </ul>
          {!online && <Text tone="muted">{t("practice:PRC-11.offline")}</Text>}
          <Button label={t("practice:PRC-11.start")} onPress={() => void start()} loading={starting} disabled={!online} testID="challenge-start" />
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto flex w-full max-w-[720px] flex-col gap-4" data-testid="prc-11-playing">
      <div className="flex items-center justify-between gap-3">
        <Text variant="caption" tone="muted">
          {t("practice:PRC-11.resume_note", { time: new Date(startedAt).toLocaleTimeString(locale === "hi" ? "hi-IN" : "en-IN", { hour: "numeric", minute: "2-digit" }) })}
        </Text>
        <Timer mode="countup" startedAt={startedAt} announce="none" size="compact" testID="challenge-clock" />
      </div>
      <PlayerProvider value={{ t, bundle, contentBaseUrl: contentUrl(s.contentBaseUrl, ""), online }}>
        <div className="rounded-card bg-surface p-4 shadow-card" data-testid="challenge-question">
          <QuestionView q={q} passage={null} draft={draft} onDraft={setDraft} locked={sending} reveal="none" struck={[]} />
        </div>
      </PlayerProvider>
      <ConfidenceRow value={confidence} onChange={setConfidence} testID="challenge-confidence" />
      <Button label={t("practice:PRC-11.submit")} onPress={() => void submit()} loading={sending} disabled={!canSubmit(q, draft) || !online} testID="challenge-submit" />
    </main>
  );
}

function ChallengeResult({ c }: { c: DailyChallenge }) {
  const { t, locale } = useI18n();
  const s = useServices();
  const navigate = useNavigate();
  const online = useOnline();
  const pet = useAppStore((x) => x.pet);
  const guest = useAppStore((x) => x.session.isGuest);
  const species = pet?.species === "dog" ? "dog" : "cat";
  const r = c.result!;
  const board = useChallengeLeaderboard(c.id, true);
  const [showSolution, setShowSolution] = useState(false);
  const q = useMemo(() => {
    if (!c.question) return null;
    const base = localizeQuestion(c.question, locale) as unknown as Record<string, unknown>;
    const sol = (c.solution ?? {}) as { answer?: unknown; solution?: unknown };
    return { ...base, answer: sol.answer, solution: sol.solution ? localizeQuestion(sol.solution, locale) : undefined } as unknown as ReturnType<typeof localizeQuestion>;
  }, [c, locale]);
  const bundle = useMemo(() => stubBundle(locale, q ? [q] : []), [locale, q]);
  const ws = q ? workedSolution(q) : null;
  const nextAt = Date.parse(c.closes_at);
  const minPlayers = board.data?.min_players_for_rank ?? r.min_players_for_rank;

  return (
    <main id="main" className="grid gap-6 md:grid-cols-2" data-testid="prc-12">
      {q && <TutorButton context={{ ref: `question:${q.id}`, kind: "question", title: t("practice:PRC-11.title") }} />}
      <section className="flex flex-col gap-4">
        <PetLine pet={{ species, mood: r.correct ? "proud" : "thinking" }} petName={pet?.name ?? ""} text={r.correct ? t("practice:PRC-12.pet_line_right") : t("practice:PRC-12.pet_line_wrong")} />
        <Text variant="title" heading as="h1" tone={r.correct ? "success" : undefined} testID="challenge-result">
          {r.correct ? t("practice:PRC-12.solved") : t("practice:PRC-12.not_this_time")}
        </Text>
        <div className="grid grid-cols-2 gap-3">
          <StatTile value={mss(r.time_ms)} label={t("practice:PRC-12.time_tile")} icon="Timer" />
          <StatTile value={r.rank ? t("practice:PRC-12.rank_tile", { rank: r.rank }) : t("practice:PRC-12.rank_soon")} label={t("practice:PRC-12.all_india")} icon="TrendUp" />
          {r.beat_pct !== null && <StatTile value={t("practice:PRC-12.percent_right", { pct: Math.round(r.beat_pct) })} label={t("practice:PRC-11.players", { count: r.players })} />}
        </div>
        <Text variant="label">{t("practice:PRC-12.streak_line")}</Text>
        <Button variant="secondary" label={t("practice:PRC-12.see_solution")} onPress={() => setShowSolution((v) => !v)} testID="challenge-solution" />
        {showSolution && q && ws && (
          <PlayerProvider value={{ t, bundle, contentBaseUrl: contentUrl(s.contentBaseUrl, ""), online }}>
            <div className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" data-testid="prc-05">
              <QuestionView q={q} passage={null} draft={null} onDraft={() => {}} locked reveal="final" struck={[]} />
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
            </div>
          </PlayerProvider>
        )}
        <Text variant="caption" tone="muted">
          {t("practice:PRC-12.next", { time: hhmm(nextAt - Date.now()) })}
        </Text>
        <Button variant="ghost" label={t("practice:PRC-12.done")} onPress={() => void navigate({ to: "/practice" })} testID="challenge-done" />
      </section>
      <section className="flex flex-col gap-2" aria-label={t("practice:PRC-12.all_india")} data-testid="challenge-board">
        <Text variant="heading" heading as="h2">
          {t("practice:PRC-12.all_india")}
        </Text>
        {!online ? (
          <Text tone="muted">{t("practice:PRC-11.offline")}</Text>
        ) : !board.data || !board.data.ranked ? (
          <Text tone="muted">{minPlayers ? t("practice:PRC-12.threshold", { count: board.data?.players ?? r.players, min_players: minPlayers }) : t("practice:PRC-11.players", { count: board.data?.players ?? r.players })}</Text>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {board.data.rows.map((row) => (
              <li key={`${row.rank}:${row.name ?? ""}`}>
                <LeaderboardRow
                  rank={row.rank}
                  avatar={{ kind: "pet", species: row.avatar === "dog" ? "dog" : "cat" }}
                  name={row.is_you ? t("practice:PRC-12.you") : (row.name ?? "")}
                  score={mss(row.time_ms)}
                  isSelf={row.is_you}
                />
              </li>
            ))}
            {board.data.you && !board.data.rows.some((x) => x.is_you) && (
              <li>
                <LeaderboardRow rank={board.data.you.rank} avatar={{ kind: "pet", species }} name={t("practice:PRC-12.you")} score={mss(board.data.you.time_ms)} isSelf pinned />
              </li>
            )}
          </ul>
        )}
        {guest && r.rank ? <Text variant="caption" tone="muted">{t("practice:PRC-12.guest_private_rank", { rank: r.rank })}</Text> : null}
      </section>
    </main>
  );
}
