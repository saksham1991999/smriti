/**
 * MEM-15 "What do you want to remember?": the items that go into a palace, from a learned topic
 * (each concept's key points, in the bundle's order and words) or from one of the student's decks.
 * "My hooks" waits for saved mnemonics on the web, so it isn't offered yet.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, Spinner, Text, cx } from "@smriti/ui-web";
import { useServices } from "../../../boot/context";
import { useBundle, useCatalog } from "../../../lib/content";
import { useI18n } from "../../../lib/i18n";
import { useTopicStatuses } from "../../../lib/queries";
import { cardText, deckCardRef, keyPointRef } from "./logic";

export interface PickedItem {
  ref: string;
  label: string;
}
type Tab = "topic" | "deck";

export function ItemPicker({ onUse, busy, have = [] }: { onUse: (items: PickedItem[], source: "list" | "deck") => void; busy?: boolean; have?: readonly string[] }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("topic");
  const [picked, setPicked] = useState<PickedItem[]>([]);
  const choose = (next: Tab) => {
    setTab(next);
    setPicked([]);
  };
  return (
    <section className="flex flex-col gap-4" aria-labelledby="mem-15-title" data-testid="mem-15">
      <h2 id="mem-15-title" className="m-0 text-heading">
        {t("memory_labs:MEM-15.title")}
      </h2>
      <div role="radiogroup" aria-labelledby="mem-15-title" className="flex flex-wrap gap-2">
        <Chip kind="filter" role="radio" label={t("memory_labs:MEM-15.tab_topic")} icon="BookBookmark" selected={tab === "topic"} onPress={() => choose("topic")} testID="mem-15-tab-topic" />
        <Chip kind="filter" role="radio" label={t("memory_labs:MEM-15.deck")} icon="Cards" selected={tab === "deck"} onPress={() => choose("deck")} testID="mem-15-tab-deck" />
      </div>
      {tab === "topic" ? <FromTopic picked={picked} onPicked={setPicked} have={have} /> : <FromDeck picked={picked} onPicked={setPicked} have={have} />}
      <div className="sticky bottom-0 bg-bg pt-2 pb-[max(16px,env(safe-area-inset-bottom))]">
        <Button label={t("memory_labs:MEM-15.use", { n: picked.length })} disabled={!picked.length} loading={busy} fullWidth onPress={() => onUse(picked, tab === "deck" ? "deck" : "list")} testID="mem-15-use" />
      </div>
    </section>
  );
}

function CheckRow({ checked, onChange, title, meta, testID, disabled }: { checked: boolean; onChange: (v: boolean) => void; title: string; meta?: string; testID?: string; disabled?: boolean }) {
  return (
    <label className={cx("flex min-h-12 cursor-pointer items-start gap-3 rounded-card bg-surface px-4 py-3 shadow-card", checked && "ring-2 ring-primary", disabled && "opacity-60")} data-testid={testID}>
      <input type="checkbox" className="mt-1 size-5 shrink-0 accent-primary" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body text-ink">{title}</span>
        {meta && <span className="text-caption text-ink-muted">{meta}</span>}
      </span>
    </label>
  );
}

function FromTopic({ picked, onPicked, have }: { picked: PickedItem[]; onPicked: (p: PickedItem[]) => void; have: readonly string[] }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const statuses = useTopicStatuses();
  const topics = useMemo(() => {
    const st = statuses.data;
    return catalog.subjects.flatMap((s) => s.chapters.flatMap((c) => c.topics.filter((tp) => tp.hasDeepDive && st?.get(tp.id) && st.get(tp.id)?.status !== "not_started").map((tp) => ({ ...tp, subject: s.name }))));
  }, [catalog.subjects, statuses.data]);
  const [topicId, setTopicId] = useState<string | null>(null);
  const current = topics.find((x) => x.id === topicId) ?? topics[0] ?? null;
  const bundle = useBundle(current?.id ?? null, "deep_dive");
  const [query, setQuery] = useState("");
  const lists = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (bundle.data?.bundle.concepts ?? []).filter((c) => c.key_points.length >= 2).filter((c) => !q || c.name.toLowerCase().includes(q) || c.key_points.some((k) => k.toLowerCase().includes(q)));
  }, [bundle.data, query]);

  if (catalog.isPending || statuses.isPending) return <Spinner label={t("learn:WEB-01.loading")} />;
  if (!current) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-card bg-surface p-4" data-testid="mem-15-none">
        <Text tone="muted">{t("memory_labs:MEM-15.none_learned")}</Text>
        <Button label={t("memory_labs:MEM-15.go_subjects")} variant="secondary" size="sm" onPress={() => void navigate({ to: "/learn" })} />
      </div>
    );
  }
  const isPicked = (conceptId: string) => picked.some((p) => p.ref.startsWith(`kp:${conceptId}#`));
  const toggle = (c: (typeof lists)[number], on: boolean) => {
    const rest = picked.filter((p) => !p.ref.startsWith(`kp:${c.id}#`));
    onPicked(on ? [...rest, ...c.key_points.map((k, i) => ({ ref: keyPointRef(c.id, i), label: k })).filter((p) => !have.includes(p.ref))] : rest);
  };
  return (
    <div className="flex flex-col gap-3">
      {topics.length > 1 && (
        <div role="radiogroup" aria-label={t("memory_labs:MEM-15.tab_topic")} className="flex flex-wrap gap-2">
          {topics.map((tp) => (
            <Chip key={tp.id} kind="filter" role="radio" label={tp.name} selected={tp.id === current.id} onPress={() => setTopicId(tp.id)} testID={`mem-15-topic-${tp.id}`} />
          ))}
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="sr-only">{t("memory_labs:MEM-15.search_ph")}</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("memory_labs:MEM-15.search_ph")}
          className="h-12 w-full rounded-[12px] border border-line bg-surface px-4 text-body text-ink outline-none placeholder:text-ink-muted focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="mem-15-search"
        />
      </label>
      {bundle.isPending ? (
        <Spinner label={t("learn:WEB-01.loading")} />
      ) : (
        <div className="flex flex-col gap-2">
          {lists.map((c) => (
            <div key={c.id} className="flex flex-col gap-2">
              <CheckRow checked={isPicked(c.id)} onChange={(v) => toggle(c, v)} title={c.name} meta={`${current.subject} · ${t("memory_labs:MEM-15.items_in_order", { k: c.key_points.length })}`} testID={`mem-15-list-${c.id}`} />
              {isPicked(c.id) && (
                <ul aria-label={t("memory_labs:MEM-15.preview_label", { k: c.key_points.length })} className="m-0 flex list-none flex-wrap gap-2 p-0 ps-4">
                  {c.key_points.map((k, i) => (
                    <li key={i} className="max-w-full rounded-full bg-subject-tint px-3 py-1 text-caption text-subject-text">
                      {i + 1}. {k}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {!lists.length && <Text tone="muted">{t("memory_labs:MEM-15.no_match")}</Text>}
        </div>
      )}
    </div>
  );
}

function FromDeck({ picked, onPicked, have }: { picked: PickedItem[]; onPicked: (p: PickedItem[]) => void; have: readonly string[] }) {
  const { t } = useI18n();
  const s = useServices();
  const decks = useQuery({
    queryKey: ["palace", "decks"],
    queryFn: async () => {
      const ds = (await s.storage.decks.all()).filter((d) => !d.deleted_at);
      const cards = (await s.storage.cards.all()).filter((c) => !c.deleted_at);
      return ds
        .map((d) => ({
          deck: d,
          cards: cards
            .filter((c) => c.deck_id === d.id)
            .map((c) => ({ id: c.id, label: (d.source === "tutor" ? cardText(c.back) : cardText(c.front)) || cardText(c.back) }))
            .filter((c) => c.label),
        }))
        .filter((d) => d.cards.length);
    },
  });
  const [deckId, setDeckId] = useState<string | null>(null);
  if (decks.isPending) return <Spinner label={t("learn:WEB-01.loading")} />;
  const list = decks.data ?? [];
  const current = list.find((d) => d.deck.id === deckId) ?? list[0] ?? null;
  if (!current) return <Text tone="muted">{t("memory_labs:MEM-15.no_decks")}</Text>;
  const on = (id: string) => picked.some((p) => p.ref === deckCardRef(id));
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={t("memory_labs:MEM-15.deck")} className="flex flex-wrap gap-2">
        {list.map((d) => (
          <Chip
            key={d.deck.id}
            kind="filter"
            role="radio"
            label={d.deck.title}
            selected={d.deck.id === current.deck.id}
            onPress={() => {
              setDeckId(d.deck.id);
              onPicked([]);
            }}
          />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {current.cards.map((c) => (
          <CheckRow
            key={c.id}
            checked={on(c.id) || have.includes(deckCardRef(c.id))}
            disabled={have.includes(deckCardRef(c.id))}
            onChange={(v) => onPicked(v ? [...picked, { ref: deckCardRef(c.id), label: c.label }] : picked.filter((p) => p.ref !== deckCardRef(c.id)))}
            title={c.label}
            testID={`mem-15-card-${c.id}`}
          />
        ))}
      </div>
    </div>
  );
}
