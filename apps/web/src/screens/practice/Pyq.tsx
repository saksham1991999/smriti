/**
 * PRC-07 PYQ bank on `/v1/pyq` and `/v1/pyq/papers`: by topic (chapters with their past-paper
 * questions, a drill per topic) or by paper (every paper with its official source; "take as
 * mock" opens the paper's mock, which the server gates). Every PYQ cites its paper.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, ChoiceChips, EmptyState, Icon, ProgressBar, Text, TopBar } from "@smriti/ui-web";
import { usePyqPapers, usePyqQuestions, type PyqQuestion } from "../../lib/challenge";
import { useCatalog, useManifest } from "../../lib/content";
import { useI18n } from "../../lib/i18n";
import { useProfileIds } from "../../lib/queries";
import { RouteLoading } from "../../shell/States";

type View = "topic" | "paper";

const host = (url: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

export function PyqBank() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const exam = useProfileIds()[0] ?? null;
  const examName = useManifest().data?.manifest.exam.name ?? "";
  const catalog = useCatalog();
  const papers = usePyqPapers(exam);
  const questions = usePyqQuestions(exam);
  const [view, setView] = useState<View>("topic");
  const pending = (papers.isPending && papers.fetchStatus !== "idle") || (questions.isPending && questions.fetchStatus !== "idle");

  const chapters = catalog.subjects.flatMap((s) => s.chapters.map((c) => ({ subject: s, chapter: c })));
  const byChapter = new Map<string, PyqQuestion[]>();
  for (const q of questions.data ?? []) {
    if (!q.chapter_id) continue;
    byChapter.set(q.chapter_id, [...(byChapter.get(q.chapter_id) ?? []), q]);
  }
  const years = [...new Set((papers.data ?? []).map((p) => p.year))].sort((a, b) => b - a);
  const empty = !pending && (papers.data ?? []).length === 0 && (questions.data ?? []).length === 0;

  return (
    <div className="flex flex-col gap-4 pb-6" data-testid="prc-07">
      <TopBar title={t("practice:PRC-07.title")} onBack={() => void navigate({ to: "/practice" })} />
      <ChoiceChips
        label={t("practice:PRC-07.title")}
        hideLabel
        options={[
          { value: "topic", label: t("practice:PRC-07.by_topic") },
          { value: "paper", label: t("practice:PRC-07.by_paper") },
        ]}
        value={[view]}
        onChange={(v) => setView(v[0] === "paper" ? "paper" : "topic")}
        testID="pyq-view"
      />
      {pending ? (
        <RouteLoading />
      ) : empty ? (
        <EmptyState illustration="ui-search-empty" text={t("practice:PRC-07.empty_no_pyqs_yet", { exam_short: examName })} testID="pyq-empty" />
      ) : view === "topic" ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="pyq-chapters">
          {chapters
            .filter(({ chapter }) => byChapter.has(chapter.id))
            .map(({ subject, chapter }) => {
              const qs = byChapter.get(chapter.id) ?? [];
              const ys = qs.map((q) => q.year);
              const solved = qs.filter((q) => q.status === "correct").length;
              const topicId = qs.find((q) => q.topic_id)?.topic_id ?? chapter.topics[0]?.id;
              return (
                <li key={chapter.id}>
                  <Card subject={subject.family} onPress={topicId ? () => void navigate({ to: "/practice/drill/$topicId", params: { topicId } }) : undefined} testID={`pyq-chapter-${chapter.id}`}>
                    <span className="flex items-center gap-3">
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <Text variant="label">{chapter.name}</Text>
                        <Text variant="caption" tone="muted">
                          {t("practice:PRC-07.chapter_caption", { pyq_count: qs.length, first_year: Math.min(...ys), last_year: Math.max(...ys) })}
                        </Text>
                        <ProgressBar value={qs.length ? solved / qs.length : 0} subject={subject.family} label={t("practice:PRC-07.solved", { solved })} valueText={t("practice:PRC-07.solved", { solved })} thickness={8} />
                      </span>
                      <Icon name="CaretRight" color="inkMuted" />
                    </span>
                  </Card>
                </li>
              );
            })}
        </ul>
      ) : (
        <div className="flex flex-col gap-4" data-testid="pyq-papers">
          {years.map((year) => (
            <section key={year} className="flex flex-col gap-2">
              <Text variant="heading" heading as="h2">
                {year}
              </Text>
              {(papers.data ?? [])
                .filter((p) => p.year === year)
                .map((p) => {
                  const src = host(p.source_url);
                  return (
                    <Card key={p.id} onPress={() => void navigate({ to: "/practice/mock/$mockId", params: { mockId: `pyq:${p.id}` } })} testID={`pyq-paper-${p.id}`}>
                      <span className="flex items-center gap-3">
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <Text variant="label">{t("practice:PRC-07.paper_row", { exam_short: examName, year: p.year, session_label: p.session_label ?? "" })}</Text>
                          <Text variant="caption" tone="muted">
                            {p.held_on
                              ? t("practice:PRC-07.paper_caption", { question_count: p.question_count, held_on: new Date(p.held_on).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN") })
                              : t("practice:MOCK-01.questions_fact", { question_count: p.question_count })}
                          </Text>
                          {src && (
                            <span className="flex items-center gap-1">
                              <Icon name="ShieldCheck" size={16} color="inkMuted" />
                              <Text variant="caption" tone="muted">
                                {t("practice:PRC-07.source", { source_host: src })}
                              </Text>
                            </span>
                          )}
                        </span>
                        <Icon name="CaretRight" color="inkMuted" />
                      </span>
                    </Card>
                  );
                })}
            </section>
          ))}
        </div>
      )}
      <Text variant="caption" tone="muted">
        {t("practice:PRC-07.footer")}
      </Text>
    </div>
  );
}
