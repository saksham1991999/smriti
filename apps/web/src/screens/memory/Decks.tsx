/**
 * MEM-07 decks, from this device's schedule: system decks are a topic's content cards (no
 * `deck_id`), "Mine" and "Shared with me" are the learner's own decks (`decks`, synced). Each row
 * shows cards, due and known counts and opens MEM-03 on that deck. MEM-08 detail, MEM-10 new
 * deck and SOC-21 shared decks are separate screens.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { DeckRow, SrsCardRow } from "@smriti/app-core";
import { Button, Card, ChoiceChips, EmptyState, Icon, Text, TopBar } from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { findTopic, useCatalog } from "../../lib/content";
import { useI18n } from "../../lib/i18n";
import { useSrsCards } from "../../lib/queries";
import { RouteLoading } from "../../shell/States";

type Filter = "all" | "system" | "mine" | "shared";

interface DeckView {
  id: string;
  kind: "system" | "mine" | "shared";
  title: string;
  cards: number;
  due: number;
  known: number;
}

/** "Known": cards in review state that the scheduler still expects you to recall (≥ 90%). */
function summarise(rows: readonly SrsCardRow[], retrievability: (c: SrsCardRow) => number) {
  const now = Date.now();
  const live = rows.filter((c) => !c.suspended);
  return {
    cards: live.length,
    due: live.filter((c) => Date.parse(c.due_at) <= now).length,
    known: live.length
      ? Math.round(
          (live.filter((c) => c.state === 2 && retrievability(c) >= 0.9).length / live.length) *
            100,
        )
      : 0,
  };
}

export function Decks() {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const srs = useSrsCards();
  const own = useQuery({ queryKey: ["decks", "local"], queryFn: () => s.storage.decks.all() });
  const catalog = useCatalog();
  const [filter, setFilter] = useState<Filter>("all");

  const decks = useMemo<DeckView[]>(() => {
    if (!srs.data || !own.data) return [];
    const r = (c: SrsCardRow) => s.srs.retrievability(c, Date.now());
    const byTopic = new Map<string, SrsCardRow[]>();
    const byDeck = new Map<string, SrsCardRow[]>();
    for (const c of srs.data) {
      if (c.deck_id) byDeck.set(c.deck_id, [...(byDeck.get(c.deck_id) ?? []), c]);
      else if (c.topic_id) byTopic.set(c.topic_id, [...(byTopic.get(c.topic_id) ?? []), c]);
    }
    const system: DeckView[] = [...byTopic].map(([topicId, rows]) => ({
      id: `topic:${topicId}`,
      kind: "system",
      title: findTopic(catalog.subjects, topicId)?.topic.name ?? topicId,
      ...summarise(rows, r),
    }));
    const mine: DeckView[] = own.data
      .filter((d: DeckRow) => !d.deleted_at)
      .map((d) => ({
        id: d.id,
        kind: d.source === "shared_copy" ? "shared" : "mine",
        title: d.title,
        ...summarise(byDeck.get(d.id) ?? [], r),
      }));
    return [...mine, ...system].sort((a, b) => b.due - a.due || a.title.localeCompare(b.title));
  }, [srs.data, own.data, s, catalog.subjects]);

  if (srs.isPending || own.isPending) return <RouteLoading />;
  const shown = decks.filter((d) => filter === "all" || d.kind === filter);
  const due = decks.reduce((n, d) => n + d.due, 0);
  const study = (deck: string) => void navigate({ to: "/review", search: { deck } });

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 md:px-8" data-testid="mem-07">
      <TopBar
        title={t("memory_labs:MEM-07.title")}
        onBack={() => void navigate({ to: "/learn" })}
      />
      {due > 0 && (
        <Card tone="tint" testID="decks-due">
          <span className="flex flex-wrap items-center gap-3">
            <Icon name="Cards" color="primary" />
            <Text variant="label" className="flex-1">
              {t("memory_labs:MEM-07.due_strip", { n: due })}
            </Text>
            <Button
              size="sm"
              label={t("memory_labs:MEM-07.study_all")}
              onPress={() => void navigate({ to: "/review" })}
              testID="decks-study-all"
            />
          </span>
        </Card>
      )}
      <ChoiceChips
        label={t("memory_labs:MEM-07.title")}
        hideLabel
        options={(["all", "system", "mine", "shared"] as const).map((f) => ({
          value: f,
          label: t(`memory_labs:MEM-07.${f}`),
        }))}
        value={[filter]}
        onChange={(v) => v[0] && setFilter(v[0] as Filter)}
        testID="decks-filter"
      />
      {shown.length === 0 ? (
        <EmptyState
          illustration="ui-all-caught-up"
          text={
            filter === "mine"
              ? t("memory_labs:MEM-07.empty_mine")
              : t("memory_labs:MEM-01.today_none")
          }
        />
      ) : (
        <ul
          className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2"
          data-testid="decks-list"
        >
          {shown.map((d) => (
            <li key={d.id}>
              <Card testID={`deck-${d.id}`}>
                <span className="flex items-center gap-3">
                  <Icon name={d.kind === "system" ? "BookBookmark" : "Cards"} color="primary" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Text variant="label">{d.title}</Text>
                    <Text variant="caption" tone="muted">
                      {t("memory_labs:MEM-07.meta", { c: d.cards, d: d.due, p: d.known })}
                    </Text>
                  </span>
                  {d.due > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      label={t("memory_labs:MEM-07.study_all")}
                      onPress={() => study(d.id)}
                      testID={`deck-study-${d.id}`}
                    />
                  )}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
