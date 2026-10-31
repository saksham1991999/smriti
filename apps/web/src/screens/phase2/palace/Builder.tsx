/**
 * MEM-14 palace builder with the MEM-16 spot panel. Rooms are tabs in walk order; each room shows
 * its spots on the illustration. An item goes onto a spot by dragging it there, or (always
 * available, and the keyboard way) by choosing the item and then the spot. A filled spot opens
 * its panel: the scene note, move, remove. Every change is saved on the device straight away.
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Banner, Button, Chip, Dialog, IconButton, PetLine, cx, useUI } from "@smriti/ui-web";
import { useServices } from "../../../boot/context";
import { useI18n } from "../../../lib/i18n";
import { RouteLoading } from "../../../shell/States";
import { Page } from "../shared/Page";
import { usePet } from "../shared/pet";
import { usePalaceDoc, useProOnly } from "./hooks";
import { Missing } from "./Palaces";
import { RoomView } from "./RoomView";
import { allSpots, autoPlace, parseSpot, place, removeItem, shortLabel, sourceOf, spotKey, SPOTS_PER_ROOM, unplace, walkStops, type SpotKey } from "./logic";
import { deletePalace, KIT_ROOMS, kitRoom, newRoom, type PalaceDoc } from "./store";

export interface BuilderSearch {
  spot?: string;
}

const NOTE_MAX = 300;

export function Builder() {
  const { palaceId } = useParams({ from: "/memory/palaces/$palaceId" });
  const search = useSearch({ from: "/memory/palaces/$palaceId" });
  const { doc, commit } = usePalaceDoc(palaceId);
  if (doc === undefined) return <RouteLoading />;
  if (doc === null) return <Missing />;
  return <BuilderView doc={doc} commit={commit} initialSpot={search.spot ?? null} />;
}

function BuilderView({ doc, commit, initialSpot }: { doc: PalaceDoc; commit: (d: PalaceDoc) => Promise<PalaceDoc>; initialSpot: string | null }) {
  const s = useServices();
  const { t } = useI18n();
  const { altFor } = useUI();
  const navigate = useNavigate();
  useProOnly("palace");
  const pet = usePet();
  const initial = initialSpot && doc.placement.placed[initialSpot as SpotKey] ? parseSpot(initialSpot) : null;
  const [roomId, setRoomId] = useState(initial?.roomId ?? doc.rooms[0]?.id ?? "");
  const [held, setHeld] = useState<string | null>(null);
  const [open, setOpen] = useState<SpotKey | null>(initial ? (initialSpot as SpotKey) : null);
  const [options, setOptions] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(doc.palace.name);
  const placedAtStart = useRef(Object.keys(doc.placement.placed).length);

  const room = doc.rooms.find((r) => r.id === roomId) ?? doc.rooms[0];
  const stops = useMemo(() => walkStops(doc.rooms, doc.placement.placed), [doc]);
  const label = (ref: string) => doc.extras.labels[ref] ?? "";
  const roomName = (id: string) => doc.rooms.find((r) => r.id === id)?.name ?? "";
  const full = allSpots(doc.rooms).every((k) => doc.placement.placed[k]);

  const leave = (to: "list" | "walk") => {
    const placed = Object.keys(doc.placement.placed).length;
    if (placed !== placedAtStart.current) {
      s.analytics.track("palace_items_placed", { palace_id: doc.palace.id, items: String(placed), rooms: String(doc.rooms.length), source: doc.extras.source === "mnemonics" ? "mnemonics" : sourceOf(Object.values(doc.placement.placed)) });
      placedAtStart.current = placed;
    }
    void (to === "walk" ? navigate({ to: "/memory/palaces/$palaceId/walk", params: { palaceId: doc.palace.id } }) : navigate({ to: "/memory/palaces" }));
  };

  const update = (placement: PalaceDoc["placement"], extra?: Partial<PalaceDoc>) => void commit({ ...doc, ...extra, placement });
  const onSpot = (index: number) => {
    if (!room) return;
    const key = spotKey(room.id, index);
    if (held) {
      update(place(doc.placement, held, key));
      setHeld(null);
      setOpen(null);
      return;
    }
    setOpen(doc.placement.placed[key] ? key : null);
  };
  const addRoom = () => {
    const used = doc.rooms.map((r) => r.background_asset_id);
    const kit = [...KIT_ROOMS].sort((a, b) => used.filter((u) => u === a.art).length - used.filter((u) => u === b.art).length)[0] ?? KIT_ROOMS[0];
    const base = t(`memory_labs:MEM-13.${kit.name}`);
    const same = doc.rooms.filter((r) => r.background_asset_id === kit.art).length;
    const r = newRoom(doc.palace.id, kit, same ? t("memory_labs:MEM-13.room_copy", { room_name: base, n: same + 1 }) : base, doc.rooms.length);
    void commit({ ...doc, rooms: [...doc.rooms, r] });
    setRoomId(r.id);
  };

  if (!room) return <Missing />;
  const kit = kitRoom(room.background_asset_id);
  const spots = Array.from({ length: SPOTS_PER_ROOM }, (_, i) => ({ index: i, label: doc.placement.placed[spotKey(room.id, i)] ? label(doc.placement.placed[spotKey(room.id, i)] as string) : null }));
  const openRef = open ? doc.placement.placed[open] : undefined;

  const tray = (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" aria-labelledby="mem-14-tray" data-testid="mem-14-tray">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="mem-14-tray" className="m-0 text-heading">
          {t("memory_labs:MEM-14.to_place", { n: doc.placement.tray.length })}
        </h2>
        <Button label={t("memory_labs:MEM-14.auto")} variant="secondary" size="sm" icon="Sparkle" disabled={!doc.placement.tray.length || full} onPress={() => update(autoPlace(doc.placement, allSpots(doc.rooms)))} testID="mem-14-auto" />
      </div>
      {doc.placement.tray.length > 0 ? (
        <>
          <p className="m-0 text-caption text-ink-muted">{t("memory_labs:MEM-14.place_hint")}</p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {doc.placement.tray.map((ref, i) => (
              <li key={ref}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", ref);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => setHeld(held === ref ? null : ref)}
                  aria-pressed={held === ref}
                  className={cx(
                    "min-h-12 max-w-[280px] cursor-grab rounded-[12px] bg-subject-tint px-3 py-2 text-start text-label text-subject-text focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary",
                    held === ref && "scale-105 shadow-card ring-2 ring-primary motion-reduce:scale-100",
                  )}
                  data-testid={`mem-14-item-${i}`}
                >
                  <span className="line-clamp-2">{label(ref)}</span>
                </button>
              </li>
            ))}
          </ul>
          {full && <Banner tone="warning" text={t("memory_labs:MEM-14.rooms_full")} action={{ label: t("memory_labs:MEM-14.add_room"), onPress: addRoom }} testID="mem-14-full" />}
        </>
      ) : null}
      <Button label={t("memory_labs:MEM-14.add_items")} variant="ghost" size="sm" icon="Plus" onPress={() => void navigate({ to: "/memory/palaces/$palaceId/items", params: { palaceId: doc.palace.id } })} testID="mem-14-add-items" />
      {stops.length > 0 && (
        <>
          <h3 className="m-0 text-label font-bold text-ink-muted">{t("memory_labs:MEM-14.placed")}</h3>
          <ol className="m-0 flex list-none flex-col gap-1 p-0" data-testid="mem-14-placed">
            {stops.map((st, i) => (
              <li key={st.key}>
                <button
                  type="button"
                  onClick={() => {
                    setRoomId(st.roomId);
                    setHeld(null);
                    setOpen(st.key);
                  }}
                  className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-[12px] px-2 text-start hover:bg-surface-sunken focus-visible:outline-[3px] focus-visible:outline-primary"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-subject-strong text-caption font-bold tabular-nums">{i + 1}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body text-ink">{label(st.ref)}</span>
                    <span className="text-caption text-ink-muted">
                      {roomName(st.roomId)} · {t("memory_labs:MEM-14.spot_n", { n: st.index + 1 })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );

  return (
    <Page
      title={doc.palace.name}
      onBack={() => leave("list")}
      width="xl"
      actions={[{ icon: "DotsThreeVertical", label: t("memory_labs:MEM-14.options"), onPress: () => setOptions(true) }]}
      testID="mem-14"
      footer={<Button label={t("memory_labs:MEM-14.walk")} icon="Footprints" disabled={!stops.length} onPress={() => leave("walk")} testID="mem-14-walk" />}
    >
      <h1 className="sr-only">{doc.palace.name}</h1>
      <div role="radiogroup" aria-label={t("memory_labs:MEM-14.rooms")} className="flex flex-wrap items-center gap-2" data-testid="mem-14-rooms">
        {doc.rooms.map((r, i) => (
          <Chip key={r.id} kind="filter" role="radio" label={`${i + 1} · ${r.name}`} selected={r.id === room.id} onPress={() => setRoomId(r.id)} testID={`mem-14-room-${i}`} />
        ))}
        <Chip kind="filter" icon="Plus" label={t("memory_labs:MEM-14.add_room")} onPress={addRoom} testID="mem-14-add-room" />
      </div>
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,720px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <RoomView
            art={kit.art}
            alt={altFor(kit.art) ?? ""}
            roomName={room.name}
            spots={spots}
            selected={open && parseSpot(open).roomId === room.id ? parseSpot(open).index : null}
            placing={!!held}
            onSpot={onSpot}
            onDropItem={(index, ref) => {
              update(place(doc.placement, ref, spotKey(room.id, index)));
              setHeld(null);
            }}
            testID="mem-14-canvas"
          />
          {held && (
            <p className="m-0 text-label text-ink" role="status" data-testid="mem-14-holding">
              {t("memory_labs:MEM-14.holding", { item_label: shortLabel(label(held), 60) })}
            </p>
          )}
          {pet && <PetLine pet={{ species: pet.species }} petName={pet.name} text={t("memory_labs:MEM-14.pet_tip")} live={false} />}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {open && openRef ? (
            <SpotPanel
              key={open}
              n={parseSpot(open).index + 1}
              roomName={roomName(parseSpot(open).roomId)}
              itemLabel={label(openRef)}
              note={doc.extras.notes[open] ?? ""}
              onClose={() => setOpen(null)}
              onSave={(note) => {
                const notes = { ...doc.extras.notes };
                if (note.trim()) notes[open] = note.trim();
                else delete notes[open];
                void commit({ ...doc, extras: { ...doc.extras, notes } });
                setOpen(null);
              }}
              onMove={() => {
                const notes = { ...doc.extras.notes };
                delete notes[open];
                void commit({ ...doc, placement: unplace(doc.placement, open), extras: { ...doc.extras, notes } });
                setHeld(openRef);
                setOpen(null);
              }}
              onRemove={() => {
                const notes = { ...doc.extras.notes };
                delete notes[open];
                const srs = { ...doc.extras.srs };
                delete srs[openRef];
                void commit({ ...doc, placement: removeItem(doc.placement, openRef), extras: { ...doc.extras, notes, srs } });
                setOpen(null);
              }}
            />
          ) : (
            tray
          )}
        </div>
      </div>
      <Dialog open={options} onOpenChange={setOptions} title={t("memory_labs:MEM-14.options")} testID="mem-14-options">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-label font-bold text-ink">{t("memory_labs:MEM-14.rename")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="h-12 w-full rounded-[12px] border border-line bg-surface px-4 text-body text-ink outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary" data-testid="mem-14-name" />
          </label>
          <Button
            label={t("memory_labs:MEM-16.save")}
            size="sm"
            disabled={!name.trim()}
            onPress={() => {
              void commit({ ...doc, palace: { ...doc.palace, name: name.trim() } });
              setOptions(false);
            }}
          />
          <Button
            label={t("memory_labs:MEM-14.delete")}
            variant="destructive"
            size="sm"
            icon="Trash"
            onPress={() => {
              setOptions(false);
              setConfirmDelete(true);
            }}
            testID="mem-14-delete"
          />
        </div>
      </Dialog>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("memory_labs:MEM-14.delete_confirm", { name: doc.palace.name })}
        confirm={{
          label: t("memory_labs:MEM-14.delete"),
          destructive: true,
          onPress: () => void deletePalace(s, doc).then(() => navigate({ to: "/memory/palaces", replace: true })),
        }}
        cancel={{ label: t("memory_labs:MEM-14.delete_keep"), onPress: () => setConfirmDelete(false) }}
        testID="mem-14-confirm-delete"
      />
    </Page>
  );
}

/** MEM-16: one spot's scene, as a panel beside the room (a sheet's content on phones). */
function SpotPanel({ n, roomName, itemLabel, note, onClose, onSave, onMove, onRemove }: { n: number; roomName: string; itemLabel: string; note: string; onClose: () => void; onSave: (note: string) => void; onMove: () => void; onRemove: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(note);
  return (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" aria-labelledby="mem-16-title" data-testid="mem-16">
      <div className="flex items-start justify-between gap-2">
        <h2 id="mem-16-title" className="m-0 text-heading">
          {t("memory_labs:MEM-16.header", { n, room_name: roomName })}
        </h2>
        <IconButton icon="X" label={t("memory_labs:MEM-16.close")} onPress={onClose} />
      </div>
      <p className="m-0 self-start rounded-[12px] bg-subject-tint px-3 py-2 text-label text-subject-text" data-testid="mem-16-item">
        {itemLabel}
      </p>
      <label className="flex flex-col gap-2">
        <span className="text-label font-bold text-ink">{t("memory_labs:MEM-16.scene")}</span>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={NOTE_MAX}
          rows={4}
          placeholder={t("memory_labs:MEM-16.scene_ph", { item_label: shortLabel(itemLabel, 40) })}
          className="w-full resize-y rounded-[12px] border border-line bg-surface-sunken p-3 text-body text-ink outline-none placeholder:text-ink-muted focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="mem-16-note"
        />
        <span className="self-end text-caption text-ink-muted tabular-nums" aria-hidden="true">
          {value.length}/{NOTE_MAX}
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button label={t("memory_labs:MEM-16.move")} variant="ghost" size="sm" icon="ArrowRight" onPress={onMove} testID="mem-16-move" />
        <Button label={t("memory_labs:MEM-16.remove")} variant="ghost" size="sm" icon="Trash" onPress={onRemove} testID="mem-16-remove" className="text-error-text" />
      </div>
      <Button label={t("memory_labs:MEM-16.save")} onPress={() => onSave(value)} testID="mem-16-save" />
    </section>
  );
}
