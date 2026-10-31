/**
 * One renderer per card type (content-format §7). Renderers read the card and send the student's
 * actions up; lesson-core decides what they mean.
 */
import type { BundleCard } from "@smriti/content-schema/runtime";
import type { MessageKey } from "@smriti/i18n";
import { checkInteractive, checkSimTask, type LessonAction, type WidgetResponse, type WidgetResult } from "@smriti/lesson-core";
import { Banner, Button, Card, Chip, FormulaBox, OptionCard, Text } from "@smriti/ui-native";
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { sharedKey, usePlayer } from "./context";
import { Media } from "./Media";
import { shuffleStable } from "./questions";
import { RichText } from "./RichText";

export type InteractiveCardData = Extract<BundleCard, { type: "interactive" }>;
export type SimCardData = Extract<BundleCard, { type: "sim" }>;

/** What a host sim renderer (a WebView with sim-bridge on mobile) reports back. */
export interface SimHostApi {
  /** A measurement for a task; lesson-core checks it (unit-aware). */
  measure: (taskId: string, measurement: { value: number; unit: string | null }) => void;
  skip: () => void;
}

/** The renderer kinds the player knows. `cardKind` maps every card type onto one of them. */
export type CardKind =
  | "concept"
  | "worked_example"
  | "formula"
  | "derivation"
  | "interactive"
  | "sim"
  | "recap"
  | "memory"
  | "experiment"
  | "media_fallback"
  | "online_only";

export function cardKind(card: BundleCard): CardKind {
  switch (card.type) {
    case "story":
    case "explainer":
    case "animation":
      return "concept";
    case "worked_example":
      return "worked_example";
    case "formula":
      return "formula";
    case "derivation":
      return "derivation";
    case "interactive":
      return "interactive";
    case "sim":
      return "sim";
    case "summary":
    case "common_traps":
    case "cheat_sheet_ref":
      return "recap";
    case "memory_hook":
      return "memory";
    case "experiment":
      return "experiment";
    case "model3d":
    case "pano360":
      return "media_fallback";
    case "video":
    case "roleplay":
      return "online_only";
    case "question":
      // Questions render through QuestionView; this kind is never used for them.
      return "concept";
  }
}

export interface CardViewProps {
  card: BundleCard;
  readOnly: boolean;
  pendingTask: boolean;
  act: (a: LessonAction) => void;
  renderSim?: (card: SimCardData, api: SimHostApi) => ReactNode | null;
}

export function CardView({ card, readOnly, pendingTask, act, renderSim }: CardViewProps) {
  const { t, subject } = usePlayer();
  switch (card.type) {
    case "story":
    case "explainer":
      return (
        <View style={styles.stack} testID={`card-${card.type}`}>
          <Media mediaRef={card.media} />
          <RichText text={card.title} variant="title" />
          <RichText text={card.body} />
        </View>
      );
    case "animation":
      return (
        <View style={styles.stack} testID="card-animation">
          <Media mediaRef={card.poster ?? null} />
          <RichText text={card.title} variant="title" />
          {card.caption ? <RichText text={card.caption} tone="muted" /> : null}
          {card.transcript ? <RichText text={card.transcript} /> : null}
        </View>
      );
    case "summary":
      return (
        <Card tone="tint" subject={subject} testID="card-summary">
          <View style={styles.stack}>
            {card.points.map((p, i) => (
              <View key={i} style={styles.bullet}>
                <Text variant="body" tone="subject" subject={subject}>
                  •
                </Text>
                <View style={styles.grow}>
                  <RichText text={p} />
                </View>
              </View>
            ))}
          </View>
        </Card>
      );
    case "common_traps":
      return (
        <View style={styles.stack} testID="card-common_traps">
          {card.title ? <RichText text={card.title} variant="title" /> : null}
          {card.traps.map((tr, i) => (
            <Card key={i} tone="sunken">
              <View style={styles.stackTight}>
                <RichText text={tr.mistake} tone="error" />
                <RichText text={tr.correct} tone="success" />
              </View>
            </Card>
          ))}
        </View>
      );
    case "cheat_sheet_ref":
      return <CheatSheetRef sheetId={card.sheet} />;
    case "formula":
      return <FormulaCard card={card} />;
    case "worked_example":
      return <WorkedExample card={card} />;
    case "derivation":
      return (
        <View style={styles.stack} testID="card-derivation">
          <RichText text={card.title} variant="title" />
          {card.steps.map((s, i) => (
            <View key={i} style={styles.stackTight}>
              <RichText text={`$$${s.latex}$$`} />
              <RichText text={s.say} />
              {s.why ? <RichText text={`${t(sharedKey("why_step"))}: ${s.why}`} tone="muted" /> : null}
            </View>
          ))}
        </View>
      );
    case "memory_hook":
      return <MemoryHook mnemonicId={card.mnemonic} />;
    case "experiment":
      return (
        <View style={styles.stack} testID="card-experiment">
          <Media mediaRef={card.media ?? null} />
          <RichText text={card.title} variant="title" />
          {card.adult_supervision ? <Banner tone="warning" icon="Warning" text={t(sharedKey("adult_supervision"))} /> : null}
          <Section title={t(sharedKey("materials"))} items={card.materials} />
          <Section title={t(sharedKey("steps"))} items={card.steps} numbered />
          {card.safety.length ? <Section title={t(sharedKey("safety"))} items={card.safety} /> : null}
          <Text variant="label">{t(sharedKey("why_it_works"))}</Text>
          <RichText text={card.why_it_works} />
        </View>
      );
    case "interactive":
      return <Interactive card={card} readOnly={readOnly} pendingTask={pendingTask} act={act} />;
    case "sim": {
      const api: SimHostApi = {
        measure: (taskId, m) => {
          const r = checkSimTask(card, taskId, m);
          if (r.known) act({ type: "sim_task", taskId, correct: r.correct });
        },
        skip: () => act({ type: "skip_task" }),
      };
      const hosted = renderSim?.(card, api);
      return (
        <View style={styles.stack} testID="card-sim">
          {card.title ? <RichText text={card.title} variant="title" /> : null}
          {hosted ?? (
            <Card tone="sunken">
              <View style={styles.stack}>
                <Text variant="label">{t(sharedKey("lab_fallback_title"))}</Text>
                <Media mediaRef={card.fallback.media ?? null} />
                <RichText text={card.fallback.body} />
              </View>
            </Card>
          )}
          {card.tasks.map((task) => (
            <RichText key={task.id} text={task.prompt} tone="muted" />
          ))}
          {pendingTask && !readOnly ? <Button variant="ghost" label={t(sharedKey("skip_task"))} onPress={() => act({ type: "skip_task" })} testID="skip-task" /> : null}
        </View>
      );
    }
    case "model3d":
    case "pano360":
      return (
        <View style={styles.stack} testID={`card-${card.type}`}>
          <RichText text={card.prompt} variant="heading" />
          <Card tone="sunken">
            <View style={styles.stack}>
              <Text variant="label">{t(sharedKey(card.type === "model3d" ? "model_fallback_title" : "pano_fallback_title"))}</Text>
              <Media mediaRef={card.fallback.media ?? null} />
              <RichText text={card.fallback.body} />
            </View>
          </Card>
        </View>
      );
    case "video":
    case "roleplay":
      return (
        <View style={styles.stack} testID="card-online-only">
          {card.type === "video" && card.title ? <RichText text={card.title} variant="title" /> : null}
          <Banner tone="offline" icon="WifiSlash" text={t(sharedKey("online_only_body"))} />
          {!readOnly ? <Button variant="secondary" label={t("learn:LES-01.skip")} onPress={() => act({ type: "skip_online" })} testID="skip-online" /> : null}
        </View>
      );
    case "question":
      return null;
  }
}

function Section({ title, items, numbered }: { title: string; items: string[]; numbered?: boolean }) {
  return (
    <View style={styles.stackTight}>
      <Text variant="label">{title}</Text>
      {items.map((s, i) => (
        <RichText key={i} text={`${numbered ? `${i + 1}.` : "•"} ${s}`} />
      ))}
    </View>
  );
}

function FormulaCard({ card }: { card: Extract<BundleCard, { type: "formula" }> }) {
  const { bundle, subject, t } = usePlayer();
  const m = bundle.math[`$$${card.latex}$$`];
  return (
    <View style={styles.stack} testID="card-formula">
      <RichText text={card.title} variant="title" />
      <FormulaBox latex={card.latex} svg={m?.svg} label={card.spoken ?? card.title} subject={subject} symbols={card.symbols.map((s) => ({ id: s.symbol, label: s.symbol }))} testID="formula-box" />
      <Text variant="label">{t(sharedKey("symbols"))}</Text>
      {card.symbols.map((s) => (
        <RichText key={s.symbol} text={`$${s.symbol}$ · ${s.meaning}${s.unit ? ` (${s.unit})` : ""}`} />
      ))}
      {card.conditions ? <RichText text={`${t(sharedKey("works_when"))}: ${card.conditions}`} tone="muted" /> : null}
    </View>
  );
}

function WorkedExample({ card }: { card: Extract<BundleCard, { type: "worked_example" }> }) {
  const { t } = usePlayer();
  const [shown, setShown] = useState(0);
  const steps = card.solution_steps;
  return (
    <View style={styles.stack} testID="card-worked_example">
      <Text variant="label" tone="muted">
        {t(sharedKey("problem"))}
      </Text>
      <RichText text={card.problem} variant="heading" />
      {steps.slice(0, shown).map((s, i) => (
        <RichText key={i} text={`${i + 1}. ${s}`} />
      ))}
      {shown < steps.length ? (
        <Button variant="secondary" label={t(sharedKey("show_solution"))} onPress={() => setShown(shown + 1)} testID="show-step" />
      ) : (
        <Card tone="tint">
          <View style={styles.stackTight}>
            <Text variant="label">{t(sharedKey("answer"))}</Text>
            <RichText text={card.answer} />
          </View>
        </Card>
      )}
      {shown >= steps.length && card.common_trap ? <RichText text={`${t("learn:LES-02.sections.4")}: ${card.common_trap}`} tone="muted" /> : null}
    </View>
  );
}

function MemoryHook({ mnemonicId }: { mnemonicId: string }) {
  const { bundle, t } = usePlayer();
  const m = bundle.mnemonics[mnemonicId] as { text?: unknown; hook?: unknown } | undefined;
  const text = typeof m?.text === "string" ? m.text : typeof m?.hook === "string" ? m.hook : null;
  return (
    <Card tone="tint" testID="card-memory_hook">
      <View style={styles.stackTight}>
        <Text variant="label">{t("learn:LRN-03.memory_trick.1" as MessageKey)}</Text>
        {text ? <RichText text={text} /> : <Text tone="muted">{t(sharedKey("media_missing"))}</Text>}
      </View>
    </Card>
  );
}

function CheatSheetRef({ sheetId }: { sheetId: string }) {
  const { bundle, t } = usePlayer();
  const sheet = bundle.sheets[sheetId] as { title?: unknown } | undefined;
  return (
    <Card tone="sunken" testID="card-cheat_sheet_ref">
      <View style={styles.stackTight}>
        <Text variant="label">{t(sharedKey("kind_cheat_sheet"))}</Text>
        {typeof sheet?.title === "string" ? <Text variant="heading">{sheet.title}</Text> : null}
      </View>
    </Card>
  );
}

/** Interactive widgets. Drag and drop is done by tapping (pick an item, then its box), which also works with a screen reader. */
function Interactive({ card, readOnly, pendingTask, act }: { card: InteractiveCardData; readOnly: boolean; pendingTask: boolean; act: (a: LessonAction) => void }) {
  const { t } = usePlayer();
  const [result, setResult] = useState<WidgetResult | null>(null);
  const send = (response: WidgetResponse) => {
    const r = checkInteractive(card, response);
    if (r.done) setResult(r);
    act({ type: "widget", response });
  };
  const locked = readOnly || !pendingTask;
  return (
    <View style={styles.stack} testID="card-interactive">
      <RichText text={card.prompt} variant="heading" />
      <Media mediaRef={card.media ?? null} />
      <Widget card={card} locked={locked} send={send} wrong={result?.wrong ?? []} />
      {result && result.correct !== null ? (
        <Banner
          tone="info"
          icon={result.correct ? "CheckCircle" : "Info"}
          text={result.correct ? (card.feedback?.correct ?? t(sharedKey("widget_right"))) : (card.feedback?.wrong ?? t(sharedKey("widget_wrong")))}
          testID="widget-feedback"
        />
      ) : null}
      {pendingTask && !readOnly ? <Button variant="ghost" label={t(sharedKey("skip_task"))} onPress={() => act({ type: "skip_task" })} testID="skip-task" /> : null}
    </View>
  );
}

function Widget({ card, locked, send, wrong }: { card: InteractiveCardData; locked: boolean; send: (r: WidgetResponse) => void; wrong: string[] }) {
  const { t } = usePlayer();
  const [picked, setPicked] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<string[]>([]);
  const [stepOrder, setStepOrder] = useState<string[] | null>(null);
  switch (card.widget) {
    case "drag_sort": {
      const cfg = card.config;
      const place = (bin: string) => {
        if (!picked || locked) return;
        const next = { ...placed, [picked]: bin };
        setPlaced(next);
        setPicked(null);
        if (Object.keys(next).length === cfg.items.length) {
          send({ widget: "drag_sort", placements: Object.entries(next).map(([item, b]) => ({ item, bin: b })) });
        }
      };
      return (
        <View style={styles.stack}>
          <Text variant="caption" tone="muted">
            {t(sharedKey("sort_hint"))}
          </Text>
          <View style={styles.wrap}>
            {cfg.items
              .filter((i) => !placed[i.id])
              .map((i) => (
                <Chip key={i.id} kind="filter" label={i.text} selected={picked === i.id} onPress={locked ? undefined : () => setPicked(i.id)} testID={`item-${i.id}`} />
              ))}
          </View>
          {cfg.bins.map((b) => (
            <Card key={b.id} tone="sunken" onPress={picked && !locked ? () => place(b.id) : undefined} accessibilityLabel={t(sharedKey("box_for_item"), { item: b.label })} testID={`bin-${b.id}`}>
              <View style={styles.stackTight}>
                <Text variant="label">{b.label}</Text>
                <View style={styles.wrap}>
                  {cfg.items
                    .filter((i) => placed[i.id] === b.id)
                    .map((i) => (
                      <Chip key={i.id} label={i.text} tone={wrong.includes(i.id) ? "error" : "neutral"} onPress={locked ? undefined : () => setPlaced(omit(placed, i.id))} />
                    ))}
                </View>
              </View>
            </Card>
          ))}
        </View>
      );
    }
    case "label_diagram": {
      const cfg = card.config;
      const label = (spot: string) => {
        if (!picked || locked) return;
        const next = { ...placed, [spot]: picked };
        setPlaced(next);
        setPicked(null);
        if (Object.keys(next).length === cfg.spots.length) send({ widget: "label_diagram", placements: Object.entries(next).map(([s, l]) => ({ spot: s, label: l })) });
      };
      const used = new Set(Object.values(placed));
      return (
        <View style={styles.stack}>
          <Media mediaRef={cfg.media} />
          <View style={styles.wrap}>
            {cfg.labels
              .filter((l) => !used.has(l.id))
              .map((l) => (
                <Chip key={l.id} kind="filter" label={l.text} selected={picked === l.id} onPress={locked ? undefined : () => setPicked(l.id)} />
              ))}
          </View>
          {cfg.spots.map((s, i) => (
            <OptionCard
              key={s.id}
              kind="choice"
              keyLabel={String(i + 1)}
              label={cfg.labels.find((l) => l.id === placed[s.id])?.text ?? t(sharedKey("label_for_spot"), { n: i + 1 })}
              state={wrong.includes(s.id) ? "wrong" : placed[s.id] ? "selected" : "idle"}
              disabled={locked}
              onPress={() => label(s.id)}
            />
          ))}
        </View>
      );
    }
    case "order_steps": {
      const steps = card.config.steps;
      const order = stepOrder ?? shuffleStable(steps.map((s) => s.id), card.id);
      const setOrder = setStepOrder;
      const move = (i: number, d: -1 | 1) => {
        const next = [...order];
        const j = i + d;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j]!, next[i]!];
        setOrder(next);
      };
      return (
        <View style={styles.stack}>
          {order.map((id, i) => (
            <View key={id} style={styles.row}>
              <View style={styles.grow}>
                <OptionCard kind="choice" keyLabel={String(i + 1)} label={steps.find((s) => s.id === id)?.text ?? id} state={wrong.includes(id) ? "wrong" : "idle"} disabled={locked} />
              </View>
              <Chip label="↑" accessibilityLabel={t(sharedKey("move_up_a11y"), { step: i + 1 })} onPress={locked ? undefined : () => move(i, -1)} />
              <Chip label="↓" accessibilityLabel={t(sharedKey("move_down_a11y"), { step: i + 1 })} onPress={locked ? undefined : () => move(i, 1)} />
            </View>
          ))}
          <Button variant="secondary" label={t("learn:LES-01.check")} disabled={locked} onPress={() => send({ widget: "order_steps", order })} />
        </View>
      );
    }
    case "tap_reveal": {
      const tiles = card.config.tiles;
      return (
        <View style={styles.stack}>
          <Text variant="caption" tone="muted">
            {t(sharedKey("tap_reveal_hint"))}
          </Text>
          {tiles.map((tile) => {
            const open = revealed.includes(tile.id);
            return (
              <Card
                key={tile.id}
                tone={open ? "tint" : "sunken"}
                onPress={() => {
                  if (open) return;
                  const next = [...revealed, tile.id];
                  setRevealed(next);
                  send({ widget: "tap_reveal", revealed: next });
                }}
                accessibilityLabel={tile.label}
              >
                <View style={styles.stackTight}>
                  <Text variant="label">{tile.label}</Text>
                  {open ? <RichText text={tile.text} /> : null}
                </View>
              </Card>
            );
          })}
        </View>
      );
    }
    case "slider":
    case "graph":
      // A native slider and graph handle need a gesture component; until then the task can be skipped (never a miss).
      return (
        <Text variant="caption" tone="muted">
          {t(sharedKey("lab_fallback_title"))}
        </Text>
      );
  }
}

function omit(o: Record<string, string>, k: string): Record<string, string> {
  const { [k]: _drop, ...rest } = o;
  return rest;
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  stackTight: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bullet: { flexDirection: "row", gap: 8 },
});
