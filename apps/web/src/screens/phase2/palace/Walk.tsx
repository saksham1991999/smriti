/**
 * MEM-17 palace walk and MEM-18 palace quiz ("What's here?"). The walk visits every filled spot in
 * order, zooming the room towards the spot (a ring only, with reduced motion). The quiz hides each
 * item, shows it on request and takes an Again / Hard / Good / Easy rating; each item's schedule is
 * kept with the palace on the device, and the earliest due item sets "next walk".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { ReviewRating, SrsCardRow } from "@smriti/app-core";
import { Button, Chip, Illustration, PetLine, RatingButtons, StatTile, Text, cx, useUI } from "@smriti/ui-web";
import type { Rating } from "@smriti/ui-web";
import { useServices } from "../../../boot/context";
import { useI18n } from "../../../lib/i18n";
import { useIsPro } from "../../../lib/pro";
import { intervalLabels } from "../../../lib/srs";
import { RouteLoading } from "../../../shell/States";
import { Page } from "../shared/Page";
import { usePet } from "../shared/pet";
import { usePalaceDoc, useProOnly, useReducedMotion, whenText } from "./hooks";
import { Missing } from "./Palaces";
import { RoomView, type RoomSpot } from "./RoomView";
import { nextWalk, remembered, SPOTS_PER_ROOM, walkStops, type WalkStop } from "./logic";
import { kitRoom, type PalaceDoc } from "./store";

const RATING: Record<Rating, ReviewRating> = { again: 1, hard: 2, good: 3, easy: 4 };
const KEYS: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };

function Room({ doc, stop, mode, revealed, zoom }: { doc: PalaceDoc; stop: WalkStop; mode: "walk" | "quiz"; revealed: boolean; zoom: boolean }) {
  const { altFor } = useUI();
  const room = doc.rooms.find((r) => r.id === stop.roomId);
  const kit = kitRoom(room?.background_asset_id ?? null);
  const spots: RoomSpot[] = Array.from({ length: SPOTS_PER_ROOM }, (_, i) => {
    const ref = doc.placement.placed[`${stop.roomId}:${i}`];
    const hide = mode === "quiz" && !(i === stop.index && revealed);
    return { index: i, label: ref ? (doc.extras.labels[ref] ?? "") : null, hidden: !!ref && hide };
  });
  return <RoomView key={stop.roomId} art={kit.art} alt={altFor(kit.art) ?? ""} roomName={room?.name ?? ""} spots={spots} current={stop.index} zoom={zoom} testID={`mem-${mode === "walk" ? "17" : "18"}-room`} />;
}

function RoomChips({ doc, current }: { doc: PalaceDoc; current: string }) {
  return (
    <ol className="m-0 flex list-none flex-wrap gap-2 p-0" aria-hidden="true">
      {doc.rooms.map((r, i) => (
        <li key={r.id} className={cx("rounded-full px-3 py-1 text-caption", r.id === current ? "bg-primary font-bold text-on-primary" : "bg-surface-sunken text-ink-muted")}>
          {i + 1} · {r.name}
        </li>
      ))}
    </ol>
  );
}

export function Walk() {
  const { palaceId } = useParams({ from: "/memory/palaces/$palaceId/walk" });
  const { doc } = usePalaceDoc(palaceId);
  if (doc === undefined) return <RouteLoading />;
  if (doc === null) return <Missing />;
  return <WalkView doc={doc} />;
}

function WalkView({ doc }: { doc: PalaceDoc }) {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const isPro = useIsPro();
  const pet = usePet();
  const reduced = useReducedMotion();
  const stops = useMemo(() => walkStops(doc.rooms, doc.placement.placed), [doc]);
  const [i, setI] = useState(0);
  const started = useRef(Date.now());
  const logged = useRef(false);
  const stop = stops[i];
  const last = i === stops.length - 1;
  const params = { palaceId: doc.palace.id };

  const finish = useCallback(
    (to: "quiz" | "list") => {
      if (!logged.current) {
        logged.current = true;
        s.analytics.track("palace_walk_completed", { palace_id: doc.palace.id, spots: String(stops.length), duration_ms: Date.now() - started.current });
      }
      void (to === "quiz" ? navigate({ to: "/memory/palaces/$palaceId/quiz", params: { palaceId: doc.palace.id } }) : navigate({ to: "/memory/palaces" }));
    },
    [doc.palace.id, stops.length, navigate, s],
  );
  const move = useCallback((d: number) => setI((x) => Math.min(Math.max(0, x + d), Math.max(0, stops.length - 1))), [stops.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") move(document.dir === "rtl" ? -1 : 1);
      if (e.key === "ArrowLeft") move(document.dir === "rtl" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  if (!stop) {
    return (
      <Page title={doc.palace.name} onBack={() => void navigate({ to: "/memory/palaces" })} backIcon="X" testID="mem-17">
        <Text tone="muted">{t("memory_labs:MEM-17.empty")}</Text>
        <Button label={t("memory_labs:MEM-14.add_items")} variant="secondary" onPress={() => void navigate({ to: "/memory/palaces/$palaceId", params })} />
      </Page>
    );
  }
  const roomName = doc.rooms.find((r) => r.id === stop.roomId)?.name ?? "";
  const label = doc.extras.labels[stop.ref] ?? "";
  const note = doc.extras.notes[stop.key] ?? "";
  const next = stops[i + 1];
  const nextLabel = next && next.roomId !== stop.roomId ? t("memory_labs:MEM-17.next_room", { room_name: doc.rooms.find((r) => r.id === next.roomId)?.name ?? "" }) : t("memory_labs:MEM-17.next");
  const counter = t("memory_labs:MEM-17.counter", { n: i + 1, total: stops.length });
  return (
    <Page
      title={doc.palace.name}
      onBack={() => void navigate({ to: "/memory/palaces" })}
      backIcon="X"
      width="xl"
      trailing={
        <span className="text-label font-bold text-ink-muted tabular-nums" data-testid="mem-17-counter">
          {counter}
        </span>
      }
      testID="mem-17"
      footer={
        <div className="grid grid-cols-2 gap-3 min-[900px]:ms-auto min-[900px]:w-[480px]">
          {last ? (
            <>
              <Button label={t("memory_labs:MEM-17.done")} variant="secondary" onPress={() => finish("list")} testID="mem-17-done" />
              {isPro ? <Button label={t("memory_labs:MEM-17.quiz")} onPress={() => finish("quiz")} testID="mem-17-quiz" /> : <span />}
            </>
          ) : (
            <>
              <Button label={t("memory_labs:MEM-17.back")} variant="secondary" disabled={i === 0} onPress={() => move(-1)} testID="mem-17-back" />
              <Button label={nextLabel} icon="ArrowRight" iconPosition="end" onPress={() => move(1)} testID="mem-17-next" />
            </>
          )}
        </div>
      }
    >
      <h1 className="sr-only">{doc.palace.name}</h1>
      <p className="sr-only" aria-live="polite" data-testid="mem-17-announce">
        {t("memory_labs:MEM-17.step_a11y", { n: i + 1, total: stops.length, room_name: roomName, item_label: label, note })}
      </p>
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Room doc={doc} stop={stop} mode="walk" revealed zoom={!reduced} />
          <RoomChips doc={doc} current={stop.roomId} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {pet && (i === 0 || last) && <PetLine pet={{ species: pet.species }} petName={pet.name} text={t(last ? "memory_labs:MEM-17.pet_end" : "memory_labs:MEM-17.pet_start")} live={false} testID="mem-17-pet" />}
          <section className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card" data-testid="mem-17-card">
            <span className="text-caption text-ink-muted">
              {roomName} · {t("memory_labs:MEM-14.spot_n", { n: stop.index + 1 })}
            </span>
            <h2 className="m-0 text-heading" data-testid="mem-17-item">
              {label}
            </h2>
            {note && <p className="m-0 text-body text-ink">{note}</p>}
            {isPro && (
              <Button
                label={t("memory_labs:MEM-17.edit")}
                variant="ghost"
                size="sm"
                icon="Sliders"
                className="self-start"
                onPress={() => void navigate({ to: "/memory/palaces/$palaceId", params, search: { spot: stop.key } })}
                testID="mem-17-edit"
              />
            )}
          </section>
          <p className="m-0 text-caption text-ink-muted max-[899px]:hidden">{t("memory_labs:MEM-17.keys_hint")}</p>
        </div>
      </div>
    </Page>
  );
}

export function Quiz() {
  const { palaceId } = useParams({ from: "/memory/palaces/$palaceId/quiz" });
  const { doc, commit } = usePalaceDoc(palaceId);
  useProOnly("palace");
  // The schedule changes as the student rates; the quiz keeps the palace it started with.
  const [start, setStart] = useState<PalaceDoc | null>(null);
  if (doc && !start) setStart(doc);
  if (doc === undefined) return <RouteLoading />;
  if (doc === null) return <Missing />;
  return <QuizView doc={start ?? doc} latest={doc} commit={commit} />;
}

function QuizView({ doc, latest, commit }: { doc: PalaceDoc; latest: PalaceDoc; commit: (d: PalaceDoc) => Promise<PalaceDoc> }) {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const stops = useMemo(() => walkStops(doc.rooms, doc.placement.placed), [doc]);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [ratings, setRatings] = useState<ReviewRating[]>([]);
  const srs = useRef<Record<string, SrsCardRow>>({ ...latest.extras.srs });
  const opened = useRef(Date.now());
  const busy = useRef(false);
  const stop = stops[i];
  const done = i >= stops.length;

  const row = useMemo(() => (stop ? (srs.current[stop.ref] ?? s.srs.newCard(`palace:${stop.ref}`, new Date())) : null), [stop, s.srs]);
  const intervals = useMemo(() => (row ? intervalLabels(s.srs.preview(row, new Date()), t) : null), [row, s.srs, t]);

  const rate = useCallback(
    async (r: Rating) => {
      if (!stop || !row || busy.current) return;
      busy.current = true;
      const rating = RATING[r];
      const next = s.srs.schedule(row, rating, new Date());
      srs.current = { ...srs.current, [stop.ref]: next.card };
      await commit({ ...latest, extras: { ...latest.extras, srs: srs.current } });
      const all = [...ratings, rating];
      setRatings(all);
      if (i + 1 >= stops.length) {
        s.analytics.track("palace_quiz_completed", { palace_id: doc.palace.id, mode: "recall", spots: String(stops.length), correct: remembered(all), order_score_pct: null });
      }
      setShown(false);
      setI(i + 1);
      opened.current = Date.now();
      busy.current = false;
    },
    [stop, row, s, commit, latest, ratings, i, stops.length, doc.palace.id],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) && e.key === " ") return;
      if (!shown && (e.key === " " || e.key === "Enter") && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        setShown(true);
      } else if (shown && KEYS[e.key]) void rate(KEYS[e.key] as Rating);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, rate]);

  if (!stops.length) {
    return (
      <Page title={doc.palace.name} onBack={() => void navigate({ to: "/memory/palaces" })} backIcon="X" testID="mem-18">
        <Text tone="muted">{t("memory_labs:MEM-17.empty")}</Text>
      </Page>
    );
  }
  if (done || !stop) return <QuizResult doc={doc} stops={stops} ratings={ratings} srs={srs.current} />;

  const roomName = doc.rooms.find((r) => r.id === stop.roomId)?.name ?? "";
  const label = doc.extras.labels[stop.ref] ?? "";
  const note = doc.extras.notes[stop.key] ?? "";
  return (
    <Page
      title={doc.palace.name}
      onBack={() => void navigate({ to: "/memory/palaces" })}
      backIcon="X"
      width="xl"
      trailing={
        <span className="text-label font-bold text-ink-muted tabular-nums" data-testid="mem-18-counter">
          {t("memory_labs:MEM-17.counter", { n: i + 1, total: stops.length })}
        </span>
      }
      testID="mem-18"
    >
      <h1 className="sr-only">{t("memory_labs:MEM-18.mode_recall")}</h1>
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Room doc={doc} stop={stop} mode="quiz" revealed={shown} zoom={!reduced} />
          <RoomChips doc={doc} current={stop.roomId} />
        </div>
        <section className="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-4 shadow-card" aria-live="polite" data-testid="mem-18-card">
          <span className="text-caption text-ink-muted">
            {roomName} · {t("memory_labs:MEM-14.spot_n", { n: stop.index + 1 })}
          </span>
          <h2 className="m-0 text-heading">{t("memory_labs:MEM-18.mode_recall")}</h2>
          {shown ? (
            <>
              <p className="m-0 text-heading text-ink" data-testid="mem-18-item">
                {label}
              </p>
              {note && <p className="m-0 text-body text-ink-muted">{note}</p>}
              {intervals && <RatingButtons intervals={intervals} onRate={(r) => void rate(r)} layout="grid" testID="mem-18-rate" />}
              <p className="m-0 text-caption text-ink-muted max-[899px]:hidden">{t("memory_labs:MEM-18.keys_hint")}</p>
            </>
          ) : (
            <>
              <Chip label="?" accessibilityLabel={t("memory_labs:MEM-18.hidden")} tone="sunken" className="self-start" />
              <Button label={t("memory_labs:MEM-18.show")} variant="secondary" onPress={() => setShown(true)} testID="mem-18-show" />
            </>
          )}
        </section>
      </div>
    </Page>
  );
}

function QuizResult({ doc, stops, ratings, srs }: { doc: PalaceDoc; stops: WalkStop[]; ratings: ReviewRating[]; srs: Record<string, SrsCardRow> }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pet = usePet();
  const right = remembered(ratings);
  const good = right / Math.max(1, stops.length) >= 0.8;
  const next = nextWalk(srs, stops.map((x) => x.ref), Date.now());
  const missed = stops.filter((_, k) => ratings[k] === 1);
  const species = pet?.species ?? "cat";
  const params = { palaceId: doc.palace.id };
  return (
    <Page
      title={doc.palace.name}
      onBack={() => void navigate({ to: "/memory/palaces" })}
      backIcon="X"
      testID="mem-18-result"
      footer={
        <div className="grid grid-cols-2 gap-3">
          <Button label={t("memory_labs:MEM-18.walk_again")} variant="secondary" onPress={() => void navigate({ to: "/memory/palaces/$palaceId/walk", params })} testID="mem-18-walk-again" />
          <Button label={t("memory_labs:MEM-18.done")} onPress={() => void navigate({ to: "/memory/palaces" })} testID="mem-18-done" />
        </div>
      }
    >
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <Illustration name={`${species}-${good ? "celebrate" : "thinking"}`} alt={t(good ? "memory_labs:MEM-18.alt_good" : "memory_labs:MEM-18.alt_think")} width={160} height={160} />
        <h1 className="m-0 text-title">{t(good ? "memory_labs:MEM-18.pet_good" : "memory_labs:MEM-18.pet_retry")}</h1>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatTile value={`${right} / ${stops.length}`} label={t("memory_labs:MEM-18.remembered")} icon="Brain" testID="mem-18-remembered" />
        <StatTile value={whenText(t, next.at)} label={t("memory_labs:MEM-18.next_walk_label")} icon="CalendarCheck" testID="mem-18-next" />
      </div>
      {missed.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="mem-18-missed">
          <h2 id="mem-18-missed" className="m-0 text-heading">
            {t("memory_labs:MEM-18.missed")}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="mem-18-missed-list">
            {missed.map((m) => (
              <li key={m.key} className="flex items-center justify-between gap-3 rounded-card bg-surface p-3 shadow-card">
                <span className="flex min-w-0 flex-col">
                  <span className="text-body text-ink">{doc.extras.labels[m.ref] ?? ""}</span>
                  <span className="text-caption text-ink-muted">
                    {doc.rooms.find((r) => r.id === m.roomId)?.name} · {t("memory_labs:MEM-14.spot_n", { n: m.index + 1 })}
                  </span>
                </span>
                <Button label={t("memory_labs:MEM-18.fix")} variant="ghost" size="sm" onPress={() => void navigate({ to: "/memory/palaces/$palaceId", params, search: { spot: m.key } })} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
