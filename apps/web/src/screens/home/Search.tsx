/**
 * HOME-05 global search as a command palette: topics from the content catalogue, labs from the
 * sims index and the student's decks, all searched on this device. Formula and PYQ search wait for
 * a server search route, so those scopes are not offered yet. Analytics get the query length only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@smriti/app-core/react";
import {
  Button,
  ChoiceChips,
  EmptyState,
  Icon,
  IconButton,
  Text,
  type IconName,
} from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { useCatalog } from "../../lib/content";
import { useI18n } from "../../lib/i18n";
import { useOnline } from "../../lib/network";
import { useTutorUI } from "../../lib/tutor";
import { prefs } from "../../platform/web";
import { useSearchUI } from "../../shell/SearchHost";

type Scope = "all" | "topics" | "labs" | "mine";
type Group = "topics" | "labs" | "mine";

interface Hit {
  id: string;
  group: Group;
  title: string;
  meta: string;
  icon: IconName;
  go: () => void;
}

const RECENT_KEY = "search.recent";

function readRecent(): string[] {
  try {
    const v = JSON.parse(prefs.get(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Case- and accent-insensitive match on any word start or substring. */
export function matches(text: string, query: string): boolean {
  const norm = (x: string) => x.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const q = norm(query.trim());
  return q.length > 0 && norm(text).includes(q);
}

function Highlight({ text, query }: { text: string; query: string }) {
  const i = text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());
  if (i < 0 || !query.trim()) return <>{text}</>;
  const end = i + query.trim().length;
  return (
    <>
      {text.slice(0, i)}
      <strong className="font-bold text-ink">{text.slice(i, end)}</strong>
      {text.slice(end)}
    </>
  );
}

export function SearchPalette() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const close = useSearchUI((x) => x.close);
  const pet = useAppStore((x) => x.pet);
  const catalog = useCatalog();
  const sims = useQuery({
    queryKey: ["sims", "index"],
    staleTime: Infinity,
    queryFn: async () => {
      const r = await s.fetch("/sims/index.json");
      if (!r.ok) throw new Error(`sims ${r.status}`);
      return (
        (await r.json()) as {
          sims: { id: string; title: Record<string, string>; subject: string }[];
        }
      ).sims;
    },
  });
  const decks = useQuery({ queryKey: ["decks", "local"], queryFn: () => s.storage.decks.all() });
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [recent, setRecent] = useState(readRecent);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const maxRecent = s.flags.get("search.recent_max");

  useEffect(() => {
    input.current?.focus();
    s.analytics.track("search_opened", { query_length: "0", result_count: 0 });
  }, [s]);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  const remember = (q: string) => {
    const next = [q, ...recent.filter((x) => x !== q)].slice(0, maxRecent ?? 0); // owner flag: no recents until it is set
    setRecent(next);
    prefs.set(RECENT_KEY, JSON.stringify(next));
  };
  const open = (hit: Hit, position: number) => {
    s.analytics.track("search_result_tapped", { group: hit.group, position });
    if (debounced.trim()) remember(debounced.trim());
    close();
    hit.go();
  };

  const hits = useMemo<Hit[]>(() => {
    const q = debounced;
    if (!q.trim()) return [];
    const out: Hit[] = [];
    if (scope === "all" || scope === "topics")
      for (const sub of catalog.subjects)
        for (const ch of sub.chapters)
          for (const tp of ch.topics)
            if (matches(tp.name, q) || matches(ch.name, q))
              out.push({
                id: `topic:${tp.id}`,
                group: "topics",
                title: tp.name,
                meta: `${sub.name} · ${ch.name}`,
                icon: "BookBookmark",
                go: () =>
                  void navigate({ to: "/learn/topic/$topicId", params: { topicId: tp.id } }),
              });
    if (scope === "all" || scope === "labs")
      for (const sim of sims.data ?? []) {
        const title = sim.title[locale] ?? sim.title.en ?? sim.id;
        if (matches(title, q))
          out.push({
            id: `lab:${sim.id}`,
            group: "labs",
            title,
            meta: t("learn:HOME-05.group_headings.4"),
            icon: "Flask",
            go: () => void navigate({ to: "/labs/$simId", params: { simId: sim.id } }),
          });
      }
    if (scope === "all" || scope === "mine")
      for (const d of decks.data ?? [])
        if (!d.deleted_at && matches(d.title, q))
          out.push({
            id: `deck:${d.id}`,
            group: "mine",
            title: d.title,
            meta: t("learn:HOME-05.group_headings.5"),
            icon: "Cards",
            go: () => void navigate({ to: "/review", search: { deck: d.id } }),
          });
    return out;
  }, [debounced, scope, catalog.subjects, sims.data, decks.data, locale, navigate, t]);

  useEffect(() => {
    setActive(0);
    if (!debounced.trim()) return;
    s.analytics.track("search_performed", {
      query_length: String(Math.min(debounced.trim().length, 20)),
      result_count: hits.length,
      groups_with_results: String(new Set(hits.map((h) => h.group)).size),
      is_offline: !online,
    });
    // Only the query changes trigger this; hits follow it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const groups: { key: Group; title: string }[] = [
    { key: "topics", title: t("learn:HOME-05.group_headings.1") },
    { key: "labs", title: t("learn:HOME-05.group_headings.4") },
    { key: "mine", title: t("learn:HOME-05.group_headings.5") },
  ];
  const flat = groups.flatMap((g) =>
    hits.filter((h) => h.group === g.key).slice(0, scope === "all" ? 3 : 50),
  );
  const petName = pet?.name ?? "";

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      open(flat[active], active);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-4 pt-[10vh]"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("learn:WEB-10.search")}
        className="flex max-h-[80vh] w-full max-w-[640px] flex-col gap-3 overflow-hidden rounded-card-large bg-surface-raised p-4 text-ink shadow-raised"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        data-testid="home-05"
      >
        <div className="flex items-center gap-2">
          <label className="flex h-12 flex-1 items-center gap-2 rounded-md bg-surface-sunken px-3">
            <Icon name="MagnifyingGlass" color="inkMuted" />
            <span className="sr-only">{t("learn:WEB-10.search")}</span>
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("learn:HOME-05.placeholder")}
              className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
              data-testid="search-input"
              enterKeyHint="search"
            />
            {query && (
              <IconButton icon="X" label={t("learn:HOME-05.clear")} onPress={() => setQuery("")} />
            )}
          </label>
          <Button
            variant="ghost"
            size="sm"
            label={t("learn:HOME-05.cancel")}
            onPress={close}
            testID="search-cancel"
          />
        </div>
        <ChoiceChips
          label={t("learn:WEB-10.search")}
          hideLabel
          options={[
            { value: "all", label: t("learn:HOME-05.scopes.1") },
            { value: "topics", label: t("learn:HOME-05.scopes.2") },
            { value: "labs", label: t("learn:HOME-05.scopes.5") },
            { value: "mine", label: t("learn:HOME-05.scopes.6") },
          ]}
          value={[scope]}
          onChange={(v) => v[0] && setScope(v[0] as Scope)}
          testID="search-scopes"
        />
        {!online && (
          <Text variant="caption" tone="muted">
            {t("learn:HOME-05.offline")}
          </Text>
        )}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {!debounced.trim() ? (
            recent.length > 0 && (
              <section className="flex flex-col gap-1" data-testid="search-recent">
                <span className="flex items-center">
                  <Text variant="label" className="flex-1">
                    {t("learn:HOME-05.recent")}
                  </Text>
                  <Button
                    variant="ghost"
                    size="sm"
                    label={t("learn:HOME-05.clear")}
                    onPress={() => {
                      setRecent([]);
                      prefs.set(RECENT_KEY, null);
                    }}
                  />
                </span>
                {recent.map((r, i) => (
                  <button
                    key={r}
                    type="button"
                    className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-body hover:bg-surface-sunken focus-visible:outline-[3px] focus-visible:outline-primary"
                    onClick={() => {
                      s.analytics.track("search_recent_tapped", { group: "recent", position: i });
                      setQuery(r);
                    }}
                  >
                    <Icon name="Clock" size={20} color="inkMuted" />
                    {r}
                  </button>
                ))}
              </section>
            )
          ) : flat.length === 0 ? (
            <div data-testid="search-empty">
              <EmptyState
                pet={pet ? { species: pet.species, mood: "thinking" } : undefined}
                text={t("learn:HOME-05.no_results", { pet_name: petName })}
                action={{
                  label: t("learn:HOME-05.no_results_cta", { pet_name: petName }),
                  onPress: () => {
                    s.analytics.track("search_no_results_tutor_tapped", {});
                    close();
                    useTutorUI.getState().openTutor(null, query);
                  },
                }}
              />
              <Text variant="caption" tone="muted" align="center">
                {t("learn:HOME-05.no_results_hint")}
              </Text>
            </div>
          ) : (
            groups.map((g) => {
              const list = flat.filter((h) => h.group === g.key);
              const total = hits.filter((h) => h.group === g.key).length;
              if (!list.length) return null;
              return (
                <section
                  key={g.key}
                  aria-label={t("learn:WEB-10.results_count", { group: g.title, n: total })}
                  className="flex flex-col gap-1"
                  data-testid={`search-group-${g.key}`}
                >
                  <Text variant="label" tone="muted">
                    {g.title}
                  </Text>
                  <ul
                    className="m-0 flex list-none flex-col p-0"
                    role="listbox"
                    aria-label={g.title}
                  >
                    {list.map((h) => {
                      const i = flat.indexOf(h);
                      return (
                        <li key={h.id} role="option" aria-selected={i === active}>
                          <button
                            type="button"
                            onClick={() => open(h, i)}
                            onMouseEnter={() => setActive(i)}
                            className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left focus-visible:outline-[3px] focus-visible:outline-primary ${i === active ? "bg-primary-tint" : ""}`}
                            data-testid={`search-hit-${h.id}`}
                          >
                            <Icon name={h.icon} color="primary" />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-body text-ink-muted">
                                <Highlight text={h.title} query={debounced} />
                              </span>
                              <span className="truncate text-caption text-ink-muted">{h.meta}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {scope === "all" && total > list.length && (
                    <Button
                      variant="ghost"
                      size="sm"
                      label={t("learn:HOME-05.see_all", { n: total })}
                      onPress={() =>
                        setScope(g.key === "topics" ? "topics" : g.key === "labs" ? "labs" : "mine")
                      }
                    />
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
