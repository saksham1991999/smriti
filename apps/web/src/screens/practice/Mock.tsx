/**
 * Mock runner shell (MOCK-06 → MOCK-07/08 → MOCK-09 palette and OMR → MOCK-16 submit → a short
 * MOCK-19 score). Everything about the paper — duration, sections, marking — comes from the
 * blueprint; with no blueprint the screen shows MOCK-01's empty state and never guesses one.
 * Questions are the fixture practice questions that match each section's question types.
 * The server's mock attempt routes are not built yet, so the attempt lives on this page only.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { mockBlueprint } from "@mock-blueprint";
import type { BlueprintFile, MarkingRule, TypedBundle } from "@smriti/content-schema";
import { checkAnswer, type Answer, type AnyQuestion } from "@smriti/lesson-core";
import { PlayerProvider, QuestionView, contentUrl, initialDraft } from "@smriti/lesson-player-web";
import { Button, Chip, Dialog, EmptyState, MockPaletteCell, OmrBubbleRow, ScoreRing, SectionTabs, Sheet, Switch, Text, Timer, TopBar } from "@smriti/ui-web";
import type { MockPaletteState } from "@smriti/tokens";
import { useServices } from "../../boot/context";
import { useManifest } from "../../lib/content";
import { useI18n } from "../../lib/i18n";
import { useOnline } from "../../lib/network";
import { RouteLoading } from "../../shell/States";

interface MockQuestion {
  q: AnyQuestion;
  section: string;
  bundle: TypedBundle;
}

/** Practice questions from the published bundles, grouped into the blueprint's sections by type. */
function usePaper(bp: BlueprintFile | null) {
  const s = useServices();
  const loaded = useManifest().data ?? null;
  return useQuery({
    queryKey: ["mock-paper", bp?.paper_code ?? "none", loaded?.manifest.version ?? 0, loaded?.manifest.locale ?? ""],
    enabled: !!bp && !!loaded,
    staleTime: Infinity,
    queryFn: async () => {
      const m = loaded!.manifest;
      const pool: { q: AnyQuestion; bundle: TypedBundle }[] = [];
      for (const topic of Object.values(m.topics)) {
        const e = topic?.bundles.practice;
        if (!e) continue;
        const r = await s.fetch(`${loaded!.baseUrl}${e.path}`);
        if (!r.ok) continue;
        const bundle = (await r.json()) as TypedBundle;
        for (const q of Object.values(bundle.questions)) if (q.type !== "paragraph") pool.push({ q: q as AnyQuestion, bundle });
      }
      const used = new Set<string>();
      const out: MockQuestion[] = [];
      for (const sec of bp!.sections) {
        const counts = sec.type_counts ?? { [sec.question_types[0] as string]: sec.question_count };
        for (const [type, n] of Object.entries(counts)) {
          const picks = pool.filter((x) => x.q.type === type && !used.has(x.q.id)).slice(0, n ?? 0);
          for (const p of picks) {
            used.add(p.q.id);
            out.push({ ...p, section: sec.code });
          }
        }
      }
      return out;
    },
  });
}

function stateOf(i: number, visited: Set<number>, saved: Map<number, Answer>, marked: Set<number>): MockPaletteState {
  const a = saved.has(i);
  if (a && marked.has(i)) return "answeredMarked";
  if (marked.has(i)) return "marked";
  if (a) return "answered";
  return visited.has(i) ? "notAnswered" : "notVisited";
}

function marksFor(q: AnyQuestion, a: Answer | undefined, rule: MarkingRule | undefined): { marks: number; correct: boolean; attempted: boolean } {
  if (!rule) return { marks: 0, correct: false, attempted: !!a };
  if (!a) return { marks: rule.unattempted, correct: false, attempted: false };
  const r = checkAnswer(q, a);
  if (r.correct) return { marks: rule.correct, correct: true, attempted: true };
  if (rule.partial && r.detail.kind === "options" && (!rule.partial.requires_no_wrong || r.detail.chosenWrong.length === 0)) {
    return { marks: rule.partial.per_correct_option * r.detail.chosenCorrect.length, correct: false, attempted: true };
  }
  return { marks: rule.wrong, correct: false, attempted: true };
}

export function MockRunner() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const bp = mockBlueprint;
  const paper = usePaper(bp);
  const examName = useManifest().data?.manifest.exam.name ?? "";
  const [phase, setPhase] = useState<"intro" | "run" | "done">("intro");
  const [agreed, setAgreed] = useState(false);
  const back = () => void navigate({ to: "/practice" });

  if (!bp) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col px-4" data-testid="mock-empty">
        <TopBar title={t("practice:MOCK-01.title")} onBack={back} />
        <main id="main">
          <EmptyState illustration="ui-search-empty" text={t("practice:MOCK-01.empty", { exam_short: examName })} action={{ label: t("practice:MOCK-05.back"), onPress: back }} />
        </main>
      </div>
    );
  }
  if (paper.isPending) return <RouteLoading />;
  const questions = paper.data ?? [];

  if (phase === "intro") {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[720px] flex-col gap-4 px-4 pb-6" data-testid="mock-06">
        <TopBar title={t("practice:MOCK-06.title")} onBack={back} />
        <main id="main" className="flex flex-col gap-3">
          {bp.fixture && <Chip kind="status" tone="warning" icon="Info" label={t("learn:WEB-01.fixture_notice")} />}
          <Text>{bp.instructions[locale] ?? bp.instructions.en}</Text>
          <Text variant="label">
            {t("practice:MOCK-01.duration_fact", { duration_min: bp.duration_min })} · {t("practice:MOCK-01.questions_fact", { question_count: bp.question_count })}
          </Text>
          <ul className="m-0 flex flex-col gap-2 ps-5">
            {bp.sections.map((sec) => (
              <li key={sec.code} className="flex flex-col gap-1">
                <Text>{t("practice:MOCK-06.sections_line", { section_title: sec.title[locale] ?? sec.code, question_count: sec.question_count })}</Text>
                {Object.entries(sec.marking).map(([type, rule]) =>
                  rule ? (
                    <Text key={type} variant="caption" tone="muted">
                      {t("practice:MOCK-06.marking_line", { type: typeLabel(type, t), correct: rule.correct, wrong: rule.wrong, unattempted: rule.unattempted })}
                    </Text>
                  ) : null,
                )}
              </li>
            ))}
          </ul>
          <Switch checked={agreed} onCheckedChange={setAgreed} label={t("practice:MOCK-06.declaration")} testID="mock-declaration" />
          {!agreed && (
            <Text variant="caption" tone="muted">
              {t("practice:MOCK-06.tick_first")}
            </Text>
          )}
          <Button label={t("practice:MOCK-06.begin")} disabled={!agreed || questions.length === 0} onPress={() => setPhase("run")} testID="mock-begin" />
        </main>
      </div>
    );
  }
  return <Runner bp={bp} questions={questions} onDone={back} />;
}

type T = ReturnType<typeof useI18n>["t"];
function typeLabel(type: string, t: T): string {
  if (type === "numerical") return t("practice:MOCK-07.numerical");
  if (type === "mcq_multi") return t("practice:MOCK-07.multiple_correct");
  return t("practice:MOCK-07.single_correct");
}

function Runner({ bp, questions, onDone }: { bp: BlueprintFile; questions: MockQuestion[]; onDone: () => void }) {
  const { t, locale } = useI18n();
  const s = useServices();
  const online = useOnline();
  const startedAt = useRef(Date.now());
  const endsAt = startedAt.current + bp.duration_min * 60_000;
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Answer | null>(initialDraft(questions[0]?.q ?? null));
  const [saved, setSaved] = useState<Map<number, Answer>>(new Map());
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [visited, setVisited] = useState<Set<number>>(new Set([0]));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDone(true), Math.max(0, endsAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [endsAt]);

  const cur = questions[index] as MockQuestion;
  const section = bp.sections.find((x) => x.code === cur.section);
  const rule = section?.marking[cur.q.type];
  const go = (i: number) => {
    const n = Math.max(0, Math.min(questions.length - 1, i));
    setIndex(n);
    setDraft(saved.get(n) ?? initialDraft(questions[n]?.q ?? null));
    setVisited((v) => new Set(v).add(n));
    setPaletteOpen(false);
  };
  const isAnswered = (a: Answer | null) => !!a && !(a.kind === "options" && a.optionIds.length === 0) && !(a.kind === "number" && String(a.value).trim() === "");
  const saveNext = () => {
    if (isAnswered(draft)) setSaved((m) => new Map(m).set(index, draft as Answer));
    go(index + 1);
  };
  const markNext = () => {
    if (isAnswered(draft)) setSaved((m) => new Map(m).set(index, draft as Answer));
    setMarked((m) => new Set(m).add(index));
    go(index + 1);
  };
  const clear = () => {
    setSaved((m) => {
      const n = new Map(m);
      n.delete(index);
      return n;
    });
    setMarked((m) => {
      const n = new Set(m);
      n.delete(index);
      return n;
    });
    setDraft(initialDraft(cur.q));
  };

  const tabs = bp.sections.map((sec) => {
    const idx = questions.map((q, i) => (q.section === sec.code ? i : -1)).filter((i) => i >= 0);
    return { code: sec.code, title: sec.title[locale] ?? sec.code, answered: idx.filter((i) => saved.has(i)).length, total: idx.length, state: "open" as const };
  });

  if (done) {
    let score = 0;
    let correct = 0;
    let attempted = 0;
    questions.forEach((mq, i) => {
      const r = marksFor(mq.q, saved.get(i), bp.sections.find((x) => x.code === mq.section)?.marking[mq.q.type]);
      score += r.marks;
      if (r.correct) correct += 1;
      if (r.attempted) attempted += 1;
    });
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col items-center gap-4 px-4 pb-6" data-testid="mock-19">
        <TopBar onBack={onDone} backIcon="X" className="self-stretch" />
        <main id="main" className="flex flex-col items-center gap-4">
          <ScoreRing score={score} max={bp.max_marks} label={t("practice:MOCK-19.score_tile")} testID="mock-score" />
          <Text tone="muted">{t("practice:MOCK-19.accuracy_meta", { correct, attempted })}</Text>
          <Button label={t("practice:PRC-06.done")} onPress={onDone} testID="mock-done" />
        </main>
      </div>
    );
  }

  const palette = (
    <div className="flex flex-col gap-3" data-testid="mock-palette">
      {bp.sections.map((sec) => (
        <section key={sec.code} className="flex flex-col gap-2">
          <Text variant="label">{sec.title[locale] ?? sec.code}</Text>
          <div className="flex flex-wrap gap-2">
            {questions.map((q, i) =>
              q.section === sec.code ? <MockPaletteCell key={i} number={i + 1} state={stateOf(i, visited, saved, marked)} current={i === index} onPress={() => go(i)} testID={`palette-${i + 1}`} /> : null,
            )}
          </div>
        </section>
      ))}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {(
          [
            ["notVisited", "practice:MOCK-09.not_visited"],
            ["notAnswered", "practice:MOCK-09.not_answered"],
            ["answered", "practice:MOCK-09.answered"],
            ["marked", "practice:MOCK-09.marked"],
            ["answeredMarked", "practice:MOCK-09.answered_and_marked"],
          ] as const
        ).map(([st, key]) => (
          <li key={st} className="flex items-center gap-2">
            <MockPaletteCell number={0} state={st} />
            <Text variant="caption">{t(key)}</Text>
          </li>
        ))}
      </ul>
      <section className="flex flex-col gap-1" aria-label={t("practice:MOCK-09.omr_filled")}>
        {questions.map((mq, i) => {
          if (mq.q.type !== "mcq_single" || !("options" in mq.q)) return null;
          const opts = (mq.q.options as { id: string }[]).map((o) => o.id);
          const sel = saved.get(i);
          const selected = sel?.kind === "options" && sel.optionIds[0] ? opts.indexOf(sel.optionIds[0]) : null;
          return (
            <OmrBubbleRow
              key={i}
              questionNo={i + 1}
              options={opts.map((o) => o.toUpperCase())}
              selected={selected}
              flagged={marked.has(i)}
              onSelect={(k) => setSaved((m) => new Map(m).set(i, { kind: "options", optionIds: [opts[k] as string] }))}
              onClear={() =>
                setSaved((m) => {
                  const n = new Map(m);
                  n.delete(i);
                  return n;
                })
              }
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
        <Text variant="heading" className="min-w-0 flex-1 truncate">
          {t("practice:MOCK-07.question_n", { n: index + 1 })}
        </Text>
        <Timer mode="countdown" endsAt={endsAt} warnAtMs={5 * 60_000} finalAtMs={60_000} size="compact" testID="mock-timer" />
        <Button variant="secondary" size="sm" icon="Sliders" label={t("practice:MOCK-09.title")} onPress={() => setPaletteOpen(true)} className="md:hidden" testID="palette-open" />
      </header>
      <SectionTabs sections={tabs} activeCode={cur.section} onSelect={(code) => go(questions.findIndex((q) => q.section === code))} label={t("practice:MOCK-16.section")} className="px-2" testID="mock-sections" />
      <div className="flex flex-1 gap-6 px-4 pt-3 pb-32 md:px-8">
        <main id="main" className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Chip kind="status" tone="sunken" label={typeLabel(cur.q.type, t)} />
            {rule && <Chip kind="status" tone="sunken" label={t("practice:MOCK-07.marking", { correct: rule.correct, wrong: rule.wrong })} />}
          </div>
          <PlayerProvider value={{ t, bundle: cur.bundle, contentBaseUrl: contentUrl(s.contentBaseUrl, ""), online }}>
            <div className="rounded-card bg-surface p-4 shadow-card">
              <QuestionView key={index} q={cur.q} passage={null} draft={draft} onDraft={setDraft} locked={false} reveal="none" struck={[]} />
            </div>
          </PlayerProvider>
        </main>
        <aside className="hidden w-[300px] shrink-0 md:block" aria-label={t("practice:MOCK-09.title")}>
          {palette}
        </aside>
      </div>
      <footer className="fixed inset-x-0 bottom-0 flex flex-col gap-2 border-t border-hairline bg-surface px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" label={t("practice:MOCK-07.mark_for_review_next")} onPress={markNext} testID="mock-mark" />
          <Button variant="ghost" size="sm" label={t("practice:MOCK-07.clear_response")} onPress={clear} testID="mock-clear" />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" label={t("practice:MOCK-07.previous")} onPress={() => go(index - 1)} disabled={index === 0} className="flex-1" />
          <Button label={t("practice:MOCK-07.save_next")} onPress={saveNext} className="flex-1" testID="mock-save-next" />
          <Button variant="secondary" label={t("practice:MOCK-07.submit")} onPress={() => setConfirm(true)} className="flex-1" testID="mock-submit" />
        </div>
      </footer>
      <Sheet open={paletteOpen} onOpenChange={setPaletteOpen} title={t("practice:MOCK-09.title")} height="full" testID="mock-09">
        {palette}
      </Sheet>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("practice:MOCK-16.title")}
        description={t("practice:MOCK-16.confirm")}
        confirm={{ label: t("practice:MOCK-16.yes"), onPress: () => setDone(true) }}
        cancel={{ label: t("practice:MOCK-16.go_back"), onPress: () => setConfirm(false) }}
        testID="mock-16"
      >
        <Text variant="caption" tone="muted">
          {t("practice:MOCK-16.answered")}: {saved.size} · {t("practice:MOCK-16.not_answered")}: {questions.length - saved.size}
        </Text>
      </Dialog>
    </div>
  );
}

export { marksFor as mockMarksFor, stateOf as mockPaletteState };
