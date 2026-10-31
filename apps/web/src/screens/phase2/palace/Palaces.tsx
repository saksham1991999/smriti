/**
 * G-6 memory palaces, the list and the new-palace flow: MEM-12 (My palaces), MEM-13 (pick a
 * place and name it) and MEM-15 (what to remember), then on to the builder. Palaces are kept on
 * this device (see store.ts). Building one is Pro; walking one you already have is not.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Banner, Button, EmptyState, Icon, Illustration, RoomCard, SegmentedProgress, Text, cx, useUI } from "@smriti/ui-web";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../../../boot/context";
import { useI18n } from "../../../lib/i18n";
import { useIsPro } from "../../../lib/pro";
import { RouteLoading } from "../../../shell/States";
import { useClose } from "../shared/nav";
import { Page } from "../shared/Page";
import { usePet } from "../shared/pet";
import { palaceKeys, usePalaceDoc, useProOnly, whenText } from "./hooks";
import { ItemPicker, type PickedItem } from "./Items";
import { addItems, nextWalk, walkStops } from "./logic";
import { KIT_ROOMS, TEMPLATES, createPalace, kitRoom, listPalaces, type TemplateId } from "./store";

const INTRO_SEEN = "palace.intro_seen";

/** MEM-12: the student's palaces, newest first. */
export function Palaces() {
  const s = useServices();
  const { t } = useI18n();
  const { altFor } = useUI();
  const isPro = useIsPro();
  const navigate = useNavigate();
  const close = useClose("/learn");
  const pet = usePet();
  const palaces = useQuery({ queryKey: palaceKeys.all, queryFn: () => listPalaces(s) });
  const [intro, setIntro] = useState(false);

  useEffect(() => {
    s.analytics.track("screen_view", { screen: "palaces" });
    void s.kv.get(INTRO_SEEN).then((v) => setIntro(!v));
  }, [s]);
  const dismissIntro = () => {
    setIntro(false);
    void s.kv.set(INTRO_SEEN, "1");
  };
  const known = useAppStore((x) => x.entitlement !== null);
  const free = known && !isPro;
  const build = () => void (!free ? navigate({ to: "/memory/palaces/new" }) : navigate({ to: "/pro", search: { source: "palace" } }));

  if (palaces.isPending) return <RouteLoading />;
  const list = palaces.data ?? [];
  const now = Date.now();
  return (
    <Page title={t("memory_labs:MEM-12.title")} onBack={close} width="lg" testID="mem-12" footer={<Button label={t("memory_labs:MEM-12.build")} icon={free ? "LockSimple" : "Plus"} onPress={build} testID="mem-12-build" />}>
      <h1 className="sr-only">{t("memory_labs:MEM-12.title")}</h1>
      {intro && (
        <div className="flex items-start gap-2 rounded-card bg-surface p-3 shadow-card" data-testid="mem-12-intro">
          <Illustration name={`${pet?.species ?? "cat"}-wave`} decorative width={56} height={56} />
          <Text className="flex-1 self-center">{t("memory_labs:MEM-12.intro")}</Text>
          <button type="button" onClick={dismissIntro} aria-label={t("memory_labs:MEM-12.intro_dismiss")} className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted hover:bg-surface-sunken focus-visible:outline-[3px] focus-visible:outline-primary">
            <Icon name="X" size={20} />
          </button>
        </div>
      )}
      {free && <Banner tone="info" icon="Sparkle" text={t("memory_labs:MEM-12.pro_line")} testID="mem-12-pro" />}
      {list.length === 0 ? (
        <EmptyState illustration="scene-memory-palace" alt={altFor("scene-memory-palace")} text={t("memory_labs:MEM-12.empty")} testID="mem-12-empty" />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 min-[600px]:grid-cols-2" aria-label={t("memory_labs:MEM-12.title")}>
          {list.map((d) => {
            const stops = walkStops(d.rooms, d.placement.placed);
            const items = stops.length + d.placement.tray.length;
            const next = nextWalk(d.extras.srs, stops.map((x) => x.ref), now);
            const art = kitRoom(d.rooms[0]?.background_asset_id ?? null).art;
            const params = { palaceId: d.palace.id };
            const go = (mode: "walk" | "quiz" | "edit") =>
              void (mode === "edit" ? navigate({ to: "/memory/palaces/$palaceId", params }) : mode === "walk" ? navigate({ to: "/memory/palaces/$palaceId/walk", params }) : navigate({ to: "/memory/palaces/$palaceId/quiz", params }));
            return (
              <li key={d.palace.id}>
                <RoomCard
                  name={d.palace.name}
                  image={art}
                  imageAlt={altFor(art)}
                  meta={t("memory_labs:MEM-12.meta", { rooms: d.rooms.length, items, when: whenText(t, next.at, now) })}
                  due={next.due}
                  onPress={isPro ? () => go("edit") : undefined}
                  onWalk={stops.length ? () => go("walk") : undefined}
                  onQuiz={isPro && stops.length ? () => go("quiz") : undefined}
                  testID={`mem-12-palace-${d.palace.id}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}

/** MEM-13 then MEM-15: pick a place, name it, choose the items; the builder comes next. */
export function NewPalace() {
  const s = useServices();
  const { t } = useI18n();
  const { altFor } = useUI();
  useProOnly("palace");
  const navigate = useNavigate();
  const close = useClose("/memory/palaces");
  const [step, setStep] = useState<"pick" | "items">("pick");
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const templates: { id: TemplateId; title: string; sub: string; art: string }[] = [
    { id: "home", title: t("memory_labs:MEM-13.home"), sub: t("memory_labs:MEM-12.meta.1", { rooms: TEMPLATES.home.length }), art: KIT_ROOMS[0].art },
    { id: "custom", title: t("memory_labs:MEM-13.mix"), sub: t("memory_labs:MEM-13.mix_sub"), art: KIT_ROOMS[1].art },
  ];
  const pick = (id: TemplateId) => {
    setTemplate(id);
    const title = templates.find((x) => x.id === id)?.title ?? "";
    if (!name || templates.some((x) => x.title === name)) setName(id === "home" ? title : t("memory_labs:MEM-13.custom_name"));
  };
  const create = async (items: PickedItem[], source: "list" | "deck") => {
    if (!template || busy) return;
    setBusy(true);
    const doc = await createPalace(s, { name: name.trim() || templates[0]?.title || "", template, roomName: (k) => t(`memory_labs:MEM-13.${k.name}`), items, source });
    s.analytics.track("palace_created", { palace_id: doc.palace.id, template });
    void navigate({ to: "/memory/palaces/$palaceId", params: { palaceId: doc.palace.id }, replace: true });
  };

  const stepIndex = step === "pick" ? 0 : 1;
  const progress = <SegmentedProgress total={3} done={stepIndex} current={stepIndex} label={t("memory_labs:MEM-13.step", { n: stepIndex + 1 })} className="w-full max-w-[240px]" />;
  if (step === "items") {
    return (
      <Page title={name} onBack={() => setStep("pick")} width="lg" testID="mem-15-page">
        {progress}
        <ItemPicker onUse={(items, source) => void create(items, source)} busy={busy} />
      </Page>
    );
  }
  return (
    <Page
      title={t("memory_labs:MEM-13.title")}
      onBack={close}
      backIcon="X"
      width="xl"
      testID="mem-13"
      footer={<Button label={t("memory_labs:MEM-13.next")} disabled={!template || !name.trim()} onPress={() => setStep("items")} testID="mem-13-next" />}
    >
      {progress}
      <Text tone="muted">{t("memory_labs:MEM-13.tip")}</Text>
      <div className="grid gap-4 min-[1024px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div role="radiogroup" aria-label={t("memory_labs:MEM-13.title")} className="grid grid-cols-2 gap-3 min-[600px]:grid-cols-3 min-[1024px]:grid-cols-2">
          {templates.map((x) => {
            const on = template === x.id;
            return (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick(x.id)}
                className={cx("relative flex cursor-pointer flex-col overflow-hidden rounded-card bg-surface text-start shadow-card focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary", on && "ring-2 ring-primary")}
                data-testid={`mem-13-${x.id}`}
              >
                <span className="relative block aspect-[3/2] w-full bg-surface-sunken">
                  <Illustration name={x.art} alt={altFor(x.art)} fit="cover" className="absolute inset-0 size-full" />
                  {on && (
                    <span className="absolute end-2 top-2 grid size-8 place-items-center rounded-full bg-primary text-on-primary shadow-card motion-safe:animate-[sm-pop_300ms]">
                      <Icon name="Check" size={20} weight="bold" />
                    </span>
                  )}
                </span>
                <span className="flex flex-col gap-0.5 p-3">
                  <span className="text-heading text-ink">{x.title}</span>
                  <span className="text-caption text-ink-muted">{x.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        {template && (
          <label className="flex flex-col gap-2 self-start" data-testid="mem-13-name">
            <span className="text-label font-bold text-ink">{t("memory_labs:MEM-13.name")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              className="h-12 w-full rounded-[12px] border border-line bg-surface px-4 text-body text-ink outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary"
              data-testid="mem-13-name-input"
            />
          </label>
        )}
      </div>
    </Page>
  );
}

/** MEM-15 from the builder ([+ items]): new items go to the end of the tray. */
export function AddPalaceItems() {
  const { palaceId } = useParams({ from: "/memory/palaces/$palaceId/items" });
  const navigate = useNavigate();
  const { doc, commit } = usePalaceDoc(palaceId);
  const close = useClose(`/memory/palaces/${palaceId}`);
  const { t } = useI18n();
  if (doc === undefined) return <RouteLoading />;
  if (doc === null) return <Missing />;
  const have = [...doc.placement.tray, ...Object.values(doc.placement.placed)];
  const use = async (items: PickedItem[]) => {
    const labels = { ...doc.extras.labels, ...Object.fromEntries(items.map((i) => [i.ref, i.label])) };
    await commit({ ...doc, placement: addItems(doc.placement, items.map((i) => i.ref)), extras: { ...doc.extras, labels } });
    void navigate({ to: "/memory/palaces/$palaceId", params: { palaceId }, replace: true });
  };
  return (
    <Page title={doc.palace.name} onBack={close} width="lg" testID="mem-15-page">
      <span className="sr-only">{t("memory_labs:MEM-14.add_items")}</span>
      <ItemPicker onUse={(items) => void use(items)} have={have} />
    </Page>
  );
}

/** A palace that isn't on this device (deleted, or a link from another device). */
export function Missing() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <Page title={t("memory_labs:MEM-12.title")} onBack={() => void navigate({ to: "/memory/palaces" })} testID="palace-missing">
      <EmptyState illustration="ui-search-empty" text={t("memory_labs:MEM-12.missing")} action={{ label: t("memory_labs:MEM-12.title"), onPress: () => void navigate({ to: "/memory/palaces" }) }} />
    </Page>
  );
}
