/**
 * LRN-01 subject (chapters by unit), LRN-02 chapter (topics, next topic CTA), LRN-03 topic
 * (Deep dive or Quick revision; Pro preview from app-core `lessonAccess`).
 */
import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { lessonAccess } from "@smriti/app-core";
import { Button, Card, Chip, ChoiceChips, Icon, ProgressBar, ProgressRing, Text, TopBar } from "@smriti/ui-web";
import { TutorButton } from "../tutor/TutorButton";
import { useServices } from "../../boot/context";
import { findTopic, useCatalog, type CatalogChapter } from "../../lib/content";
import { parts, useI18n } from "../../lib/i18n";
import { useIsPro } from "../../lib/pro";
import { useLessonProgress, useTopicStatuses } from "../../lib/queries";
import { LoadError, NotFound, RouteLoading } from "../../shell/States";

function useBack(fallback: () => void) {
  return () => (window.history.length > 1 ? window.history.back() : fallback());
}

export function SubjectScreen() {
  const { subjectId } = useParams({ strict: false }) as { subjectId: string };
  const { t } = useI18n();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const statuses = useTopicStatuses().data;
  const [filter, setFilter] = useState("all");
  const back = useBack(() => void navigate({ to: "/learn" }));
  if (catalog.isError) return <LoadError onRetry={() => void catalog.refetch()} />;
  if (catalog.isPending) return <RouteLoading />;
  const subject = catalog.subjects.find((x) => x.id === subjectId);
  if (!subject) return <NotFound />;
  const pct = (c: CatalogChapter) => (c.topics.length ? c.topics.filter((x) => statuses?.get(x.id)?.status === "learned").length / c.topics.length : 0);
  const done = subject.chapters.filter((c) => pct(c) === 1).length;
  const total = subject.chapters.length;
  const filters = parts(t("learn:LRN-01.filters"));
  const shown = subject.chapters.filter((c) => (filter === "in_progress" ? pct(c) > 0 && pct(c) < 1 : filter === "not_started" ? pct(c) === 0 : true));
  const units = [...new Set(shown.map((c) => c.unit))];
  return (
    <div className="flex flex-col gap-4 pb-6" data-subject={subject.family} data-testid="lrn-01">
      <TopBar title={subject.name} onBack={back} />
      <div className="flex flex-col gap-4 px-4 md:px-8">
        <ProgressBar value={total ? done / total : 0} label={t("learn:LRN-01.progress", { done, total, percent: Math.round(total ? (done / total) * 100 : 0) })} valueText={t("learn:LRN-01.progress", { done, total, percent: Math.round(total ? (done / total) * 100 : 0) })} />
        <Text variant="caption" tone="muted">
          {t("learn:LRN-01.progress", { done, total, percent: Math.round(total ? (done / total) * 100 : 0) })}
        </Text>
        <ChoiceChips
          label={filters[0] ?? ""}
          hideLabel
          options={["all", "in_progress", "not_started"].map((v, i) => ({ value: v, label: filters[i] ?? v }))}
          value={[filter]}
          onChange={(v) => setFilter(v[0] ?? "all")}
        />
        {shown.length === 0 && <Text tone="muted">{t("learn:LRN-01.empty_filter")}</Text>}
        {units.map((unit) => (
          // Grouped by unit; the manifest carries unit ids but no unit names yet, so no unit heading shows.
          <section key={unit} className="flex flex-col gap-2">
            {shown
              .filter((c) => c.unit === unit)
              .map((c) => (
                <Card key={c.id} onPress={() => void navigate({ to: "/learn/chapter/$chapterId", params: { chapterId: c.id } })} testID={`chapter-${c.id}`}>
                  <span className="flex items-center gap-3">
                    <ProgressRing value={pct(c)} size={48} stroke={6} label={t("learn:LRN-01.ring_a11y", { percent: Math.round(pct(c) * 100) })} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Text variant="caption" tone="muted">
                        {t("learn:LRN-01.chapter_kicker", { n: c.index + 1 })}
                      </Text>
                      <Text variant="heading">{c.name}</Text>
                      <Text variant="caption" tone="muted">
                        {t("learn:WEB-01.topics_count", { n: c.topics.length })}
                      </Text>
                    </span>
                    <Icon name="CaretRight" color="inkMuted" />
                  </span>
                </Card>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export function ChapterScreen() {
  const { chapterId } = useParams({ strict: false }) as { chapterId: string };
  const { t } = useI18n();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const statuses = useTopicStatuses().data;
  const progress = useLessonProgress().data;
  const back = useBack(() => void navigate({ to: "/learn" }));
  if (catalog.isError) return <LoadError onRetry={() => void catalog.refetch()} />;
  if (catalog.isPending) return <RouteLoading />;
  const subject = catalog.subjects.find((x) => x.chapters.some((c) => c.id === chapterId));
  const chapter = subject?.chapters.find((c) => c.id === chapterId);
  if (!subject || !chapter) return <NotFound />;
  const learned = chapter.topics.filter((x) => statuses?.get(x.id)?.status === "learned").length;
  const left = chapter.topics.filter((x) => statuses?.get(x.id)?.status !== "learned");
  const next = left[0];
  const inProgress = next && progress?.get(`${next.id}|deep_dive`);
  return (
    <div className="flex flex-col gap-4 pb-6" data-subject={subject.family} data-testid="lrn-02">
      <TopBar onBack={back} />
      <div className="flex flex-col gap-4 px-4 md:px-8">
        <Text variant="caption" tone="muted">
          {t("learn:LRN-02.header_kicker.1", { n: chapter.index + 1 })}
        </Text>
        <Text variant="title" heading as="h1">
          {chapter.name}
        </Text>
        <ProgressBar value={chapter.topics.length ? learned / chapter.topics.length : 0} label={chapter.name} />
        <Text variant="caption" tone="muted">
          {t("learn:LRN-02.progress", { done: learned, total: chapter.topics.length, minutes: left.reduce((n, x) => n + x.minutes, 0) })}
        </Text>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {chapter.topics.map((x) => {
            const st = statuses?.get(x.id)?.status;
            return (
              <li key={x.id}>
                <Card onPress={() => void navigate({ to: "/learn/topic/$topicId", params: { topicId: x.id } })} testID={`topic-${x.id}`}>
                  <span className="flex items-center gap-3">
                    <Icon name={st === "learned" ? "CheckCircle" : st === "in_progress" ? "PauseCircle" : "Play"} color={st === "learned" ? "success" : "primary"} weight="fill" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Text variant="heading">{x.name}</Text>
                      <Text variant="caption" tone="muted">
                        {st === "learned" ? t("learn:WEB-01.learned") : t("learn:WEB-01.minutes", { n: x.minutes })}
                      </Text>
                    </span>
                    {x.id === next?.id && <Chip kind="status" tone="primary" label={t("learn:LRN-02.next_row_button")} />}
                  </span>
                </Card>
              </li>
            );
          })}
        </ol>
        {next ? (
          <Button
            label={inProgress ? t("learn:LRN-02.cta_continue", { topic_title: next.name }) : t("learn:LRN-02.cta_start", { topic_title: next.name })}
            onPress={() => void navigate({ to: "/lesson/$topicId", params: { topicId: next.id }, search: { mode: "deep_dive" } })}
            testID="chapter-cta"
          />
        ) : (
          <Text tone="success">{t("learn:LRN-02.chapter_learned_pet_line")}</Text>
        )}
      </div>
    </div>
  );
}

export function TopicScreen() {
  const { topicId } = useParams({ strict: false }) as { topicId: string };
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const pro = useIsPro();
  const statuses = useTopicStatuses().data;
  const progress = useLessonProgress().data;
  const back = useBack(() => void navigate({ to: "/learn" }));
  if (catalog.isError) return <LoadError onRetry={() => void catalog.refetch()} />;
  if (catalog.isPending) return <RouteLoading />;
  const loc = findTopic(catalog.subjects, topicId);
  if (!loc) return <NotFound />;
  const { topic, chapter, subject } = loc;
  const access = lessonAccess(
    { mode: "deep_dive", chapterIndexInSubject: chapter.index, chapterId: chapter.id, rotatingFreeChapters: chapter.free ? [chapter.id] : (catalog.manifest?.free.deep_dive_chapters ?? []), isPro: pro },
    s.flags,
  );
  const st = statuses?.get(topic.id);
  const dd = progress?.get(`${topic.id}|deep_dive`);
  const ctas = parts(t("learn:LRN-03.ctas"));
  const ddLine = parts(t("learn:LRN-03.deep_dive", { minutes: topic.minutes, n: Math.max(1, Math.round(topic.cardCount / 4)) }));
  const qrLine = parts(t("learn:LRN-03.quick_revision", { minutes: Math.max(1, Math.round(topic.minutes / 3)) }));
  const ddLabel = access.kind === "preview" ? ctas[3] : dd && !dd.completed_at && dd.last_card_index > 0 ? ctas[1] : ctas[0];
  return (
    <div className="flex flex-col gap-4 pb-6" data-subject={subject.family} data-testid="lrn-03">
      <TopBar onBack={back} />
      <TutorButton context={{ ref: `topic:${topic.id}`, kind: "topic", title: topic.name }} />
      <div className="flex flex-col gap-4 px-4 md:px-8">
        <Text variant="caption" tone="muted">
          {subject.name} · {chapter.name}
        </Text>
        <Text variant="title" heading as="h1">
          {topic.name}
        </Text>
        <div className="flex flex-wrap gap-2">
          {st?.status === "learned" && <Chip kind="status" tone="success" icon="CheckCircle" label={t("learn:LRN-03.learned_chip")} />}
          {st?.status === "in_progress" && <Chip kind="status" tone="primary" label={t("learn:LRN-03.in_progress", { percent: st.percent })} />}
          {access.kind === "preview" && <Chip kind="status" tone="sunken" icon="Lock" label={t("learn:LRN-03.preview_free")} />}
        </div>
        {topic.hasDeepDive && (
          <Card tone="tint" subject={subject.family} testID="deep-dive-card">
            <span className="flex flex-col gap-2">
              <Text variant="heading">{ddLine[0]}</Text>
              <Text variant="caption" tone="muted">
                {ddLine.slice(1).join(" · ")}
              </Text>
              <Button label={ddLabel ?? ""} onPress={() => void navigate({ to: "/lesson/$topicId", params: { topicId: topic.id }, search: { mode: "deep_dive" } })} testID="start-deep-dive" />
            </span>
          </Card>
        )}
        {topic.hasQuickRevision && (
          <Card testID="quick-revision-card">
            <span className="flex flex-col gap-2">
              <Text variant="heading">{qrLine[0]}</Text>
              <Text variant="caption" tone="muted">
                {qrLine.slice(1).join(" · ")}
              </Text>
              <Button label={ctas[2] ?? ""} variant="secondary" onPress={() => void navigate({ to: "/lesson/$topicId", params: { topicId: topic.id }, search: { mode: "quick_revision" } })} testID="start-quick-revision" />
              {access.kind === "preview" && (
                <Text variant="caption" tone="success">
                  {t("learn:LRN-03.free_link")}
                </Text>
              )}
            </span>
          </Card>
        )}
        <Button label={parts(t("learn:LRN-03.practise", { n: "" }))[0] ?? ""} variant="ghost" onPress={() => void navigate({ to: "/practice/drill/$topicId", params: { topicId: topic.id } })} testID="practise-topic" />
      </div>
    </div>
  );
}
