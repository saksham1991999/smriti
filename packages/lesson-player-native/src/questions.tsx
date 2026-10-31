/**
 * Question renderers for every question type (content-format §8). They only collect an `Answer`;
 * lesson-core's `checkAnswer` decides what is right.
 */
import { BLANK_TOKEN } from "@smriti/content-schema/runtime";
import type { Answer, AnyQuestion, CheckResult } from "@smriti/lesson-core";
import { Chip, NumericKeypad, OptionCard, Text, useTheme } from "@smriti/ui-native";
import type { OptionState } from "@smriti/tokens/ui";
import { StyleSheet, TextInput, View } from "react-native";

import { sharedKey, usePlayer } from "./context";
import { RichText } from "./RichText";

const KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** An empty answer of the right kind for a question. */
export function initialDraft(q: AnyQuestion | null): Answer | null {
  if (!q) return null;
  switch (q.type) {
    case "numerical":
    case "integer":
      return { kind: "number", value: "" };
    case "order_steps":
      return { kind: "order", order: shuffleStable(q.steps.map((s) => s.id), q.id) };
    case "matrix_match":
      return { kind: "matrix", rows: q.rows.map((r) => ({ row: r.id, columns: [] })) };
    case "fill_blank":
      return { kind: "blanks", blanks: q.blanks.map((b) => ({ blank: b.id })) };
    case "match_list":
      return q.options ? { kind: "options", optionIds: [] } : { kind: "pairs", pairs: [] };
    default:
      return { kind: "options", optionIds: [] };
  }
}

/** Whether the Check button is enabled for a draft. */
export function canSubmit(q: AnyQuestion | null, a: Answer | null): boolean {
  if (!q || !a) return false;
  switch (a.kind) {
    case "options":
      return a.optionIds.length > 0;
    case "number":
      return String(a.value).trim() !== "" && String(a.value) !== "-";
    case "order":
      return a.order.length > 0;
    case "matrix":
      return a.rows.some((r) => r.columns.length > 0);
    case "blanks":
      return a.blanks.every((b) => Boolean(b.choiceId) || Boolean(b.text?.trim()));
    case "pairs":
      return q.type === "match_list" && a.pairs.length === q.list_i.length;
  }
}

/**
 * The content contract says the player shuffles step order. A seeded shuffle keeps the order the
 * same across re-renders and resumes, and never starts in the right order.
 */
export function shuffleStable(ids: string[], seed: string): string[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  if (out.length > 1 && out.every((id, i) => id === ids[i])) out.push(out.shift()!);
  return out;
}

export interface QuestionViewProps {
  question: AnyQuestion;
  passage: string | null;
  draft: Answer | null;
  onChange: (a: Answer) => void;
  /** After a check: marks options right and wrong. */
  result: CheckResult | null;
  /** Options struck out after a first wrong try (single-answer types). */
  struck: string[];
  disabled: boolean;
}

export function QuestionView({ question: q, passage, draft, onChange, result, struck, disabled }: QuestionViewProps) {
  const { t } = usePlayer();
  return (
    <View style={styles.stack} testID="question">
      {passage ? (
        <View style={styles.stack}>
          <Text variant="label" tone="muted">
            {t(sharedKey("passage"))}
          </Text>
          <RichText text={passage} />
        </View>
      ) : null}
      {q.type !== "fill_blank" ? <RichText text={q.stem} variant="heading" testID="question-stem" /> : null}
      <QuestionBody q={q} draft={draft} onChange={onChange} result={result} struck={struck} disabled={disabled} />
    </View>
  );
}

function QuestionBody({ q, draft, onChange, result, struck, disabled }: { q: AnyQuestion; draft: Answer | null; onChange: (a: Answer) => void; result: CheckResult | null; struck: string[]; disabled: boolean }) {
  const { t } = usePlayer();
  switch (q.type) {
    case "numerical":
    case "integer": {
      const value = draft?.kind === "number" ? String(draft.value) : "";
      const unit = q.type === "numerical" ? q.answer.unit : (q.answer.unit ?? null);
      return (
        <View style={styles.stack}>
          <NumericKeypad
            value={value}
            onChange={(v) => onChange({ kind: "number", value: v, unit: unit ?? null })}
            allowDecimal={q.type === "numerical"}
            allowNegative
            disabled={disabled}
            label={t(sharedKey("your_answer"))}
            testID="keypad"
          />
          {unit ? (
            <Text variant="caption" tone="muted">
              {t("learn:LES-03.unit", { unit })}
            </Text>
          ) : null}
        </View>
      );
    }
    case "order_steps": {
      const order = draft?.kind === "order" ? draft.order : q.steps.map((s) => s.id);
      const byId = new Map(q.steps.map((s) => [s.id, s.text]));
      const move = (i: number, d: -1 | 1) => {
        const next = [...order];
        const j = i + d;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j]!, next[i]!];
        onChange({ kind: "order", order: next });
      };
      return (
        <View style={styles.stack}>
          <Text variant="caption" tone="muted">
            {t(sharedKey("order_hint"))}
          </Text>
          {order.map((id, i) => (
            <View key={id} style={styles.row}>
              <View style={styles.grow}>
                <OptionCard label={byId.get(id) ?? id} keyLabel={String(i + 1)} kind="choice" disabled={disabled} testID={`order-${id}`} />
              </View>
              <Chip label="↑" accessibilityLabel={t(sharedKey("move_up_a11y"), { step: byId.get(id) ?? id })} onPress={disabled ? undefined : () => move(i, -1)} />
              <Chip label="↓" accessibilityLabel={t(sharedKey("move_down_a11y"), { step: byId.get(id) ?? id })} onPress={disabled ? undefined : () => move(i, 1)} />
            </View>
          ))}
        </View>
      );
    }
    case "matrix_match": {
      const rows = draft?.kind === "matrix" ? draft.rows : [];
      const toggle = (row: string, col: string) => {
        const next = q.rows.map((r) => {
          const cur = rows.find((x) => x.row === r.id)?.columns ?? [];
          if (r.id !== row) return { row: r.id, columns: cur };
          return { row: r.id, columns: cur.includes(col) ? cur.filter((c) => c !== col) : [...cur, col] };
        });
        onChange({ kind: "matrix", rows: next });
      };
      return (
        <View style={styles.stack}>
          <Text variant="caption" tone="muted">
            {t(sharedKey("matrix_hint"))}
          </Text>
          {q.rows.map((r) => (
            <View key={r.id} style={styles.stackTight}>
              <RichText text={r.text} variant="label" />
              <View style={styles.wrap}>
                {q.columns.map((c) => (
                  <Chip
                    key={c.id}
                    kind="filter"
                    label={c.text}
                    selected={rows.find((x) => x.row === r.id)?.columns.includes(c.id) ?? false}
                    onPress={disabled ? undefined : () => toggle(r.id, c.id)}
                    testID={`matrix-${r.id}-${c.id}`}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case "fill_blank":
      return <FillBlank q={q} draft={draft} onChange={onChange} disabled={disabled} />;
    case "match_list":
      if (!q.options) return <MatchPairs q={q} draft={draft} onChange={onChange} disabled={disabled} />;
      return (
        <View style={styles.stack}>
          <MatchLists q={q} />
          <Options q={q} options={q.options} draft={draft} onChange={onChange} result={result} struck={struck} disabled={disabled} />
        </View>
      );
    case "assertion_reason":
      return (
        <View style={styles.stack}>
          <Labelled label={t(sharedKey("assertion"))} text={q.assertion} />
          <Labelled label={t(sharedKey("reason"))} text={q.reason} />
          <Options q={q} options={q.options} draft={draft} onChange={onChange} result={result} struck={struck} disabled={disabled} />
        </View>
      );
    case "statement_based":
      return (
        <View style={styles.stack}>
          {q.statements.map((s, i) => (
            <Labelled key={i} label={t(sharedKey("statement_n"), { n: i + 1 })} text={s} />
          ))}
          <Options q={q} options={q.options} draft={draft} onChange={onChange} result={result} struck={struck} disabled={disabled} />
        </View>
      );
    case "mcq_single":
    case "mcq_multi":
      return <Options q={q} options={q.options} draft={draft} onChange={onChange} result={result} struck={struck} disabled={disabled} />;
    case "paragraph":
      return null;
  }
}

function Labelled({ label, text }: { label: string; text: string }) {
  return (
    <View style={styles.stackTight}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <RichText text={text} />
    </View>
  );
}

function Options({ q, options, draft, onChange, result, struck, disabled }: { q: AnyQuestion; options: { id: string; text: string }[]; draft: Answer | null; onChange: (a: Answer) => void; result: CheckResult | null; struck: string[]; disabled: boolean }) {
  const multi = q.type === "mcq_multi";
  const chosen = draft?.kind === "options" ? draft.optionIds : [];
  const detail = result?.detail.kind === "options" ? result.detail : null;
  const pick = (id: string) => {
    if (multi) onChange({ kind: "options", optionIds: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] });
    else onChange({ kind: "options", optionIds: [id] });
  };
  return (
    <View style={styles.stack} accessibilityRole={multi ? undefined : "radiogroup"}>
      {options.map((o, i) => {
        const isStruck = struck.includes(o.id);
        let state: OptionState = chosen.includes(o.id) ? "selected" : "idle";
        if (detail && result?.correct && detail.correctIds.includes(o.id)) state = "correct";
        else if (detail && detail.chosenWrong.includes(o.id)) state = "wrong";
        if (isStruck) state = "wrong";
        return (
          <OptionCard
            key={o.id}
            label={o.text}
            keyLabel={KEYS[i]}
            state={state}
            multiple={multi}
            disabled={disabled || isStruck}
            onPress={() => pick(o.id)}
            testID={`option-${o.id}`}
          />
        );
      })}
    </View>
  );
}

function MatchLists({ q }: { q: Extract<AnyQuestion, { type: "match_list" }> }) {
  const { t } = usePlayer();
  return (
    <View style={styles.row}>
      <View style={[styles.grow, styles.stackTight]}>
        <Text variant="label" tone="muted">
          {t(sharedKey("list_one"))}
        </Text>
        {q.list_i.map((x) => (
          <Text key={x.id} variant="body">{`${x.id.toUpperCase()}. ${x.text}`}</Text>
        ))}
      </View>
      <View style={[styles.grow, styles.stackTight]}>
        <Text variant="label" tone="muted">
          {t(sharedKey("list_two"))}
        </Text>
        {q.list_ii.map((x) => (
          <Text key={x.id} variant="body">{`${x.id}. ${x.text}`}</Text>
        ))}
      </View>
    </View>
  );
}

function MatchPairs({ q, draft, onChange, disabled }: { q: Extract<AnyQuestion, { type: "match_list" }>; draft: Answer | null; onChange: (a: Answer) => void; disabled: boolean }) {
  const { t } = usePlayer();
  const pairs = draft?.kind === "pairs" ? draft.pairs : [];
  const set = (left: string, right: string) => onChange({ kind: "pairs", pairs: [...pairs.filter((p) => p.left !== left), { left, right }] });
  return (
    <View style={styles.stack}>
      {q.list_i.map((l) => (
        <View key={l.id} style={styles.stackTight}>
          <Text variant="label">{t(sharedKey("pick_match"), { item: l.text })}</Text>
          <View style={styles.wrap}>
            {q.list_ii.map((r) => (
              <Chip key={r.id} kind="filter" label={r.text} selected={pairs.some((p) => p.left === l.id && p.right === r.id)} onPress={disabled ? undefined : () => set(l.id, r.id)} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function FillBlank({ q, draft, onChange, disabled }: { q: Extract<AnyQuestion, { type: "fill_blank" }>; draft: Answer | null; onChange: (a: Answer) => void; disabled: boolean }) {
  const { t } = usePlayer();
  const theme = useTheme();
  const blanks = draft?.kind === "blanks" ? draft.blanks : [];
  const set = (blank: string, patch: { choiceId?: string; text?: string }) =>
    onChange({ kind: "blanks", blanks: q.blanks.map((b) => (b.id === blank ? { blank, ...patch } : (blanks.find((x) => x.blank === b.id) ?? { blank: b.id }))) });
  const stem = q.stem.replace(BLANK_TOKEN, (_m, id: string) => `____ (${q.blanks.findIndex((b) => b.id === id) + 1})`);
  return (
    <View style={styles.stack}>
      <RichText text={stem} variant="heading" testID="question-stem" />
      {q.blanks.map((b, i) => (
        <View key={b.id} style={styles.stackTight}>
          <Text variant="label" tone="muted">
            {t(sharedKey("blank_n"), { n: i + 1 })}
          </Text>
          {b.choices ? (
            <View style={styles.wrap}>
              {b.choices.map((c) => (
                <Chip key={c.id} kind="filter" label={c.text} selected={blanks.find((x) => x.blank === b.id)?.choiceId === c.id} onPress={disabled ? undefined : () => set(b.id, { choiceId: c.id })} />
              ))}
            </View>
          ) : (
            <TextInput
              editable={!disabled}
              value={blanks.find((x) => x.blank === b.id)?.text ?? ""}
              onChangeText={(text) => set(b.id, { text })}
              accessibilityLabel={t(sharedKey("blank_n"), { n: i + 1 })}
              autoCorrect={false}
              autoCapitalize="none"
              style={[styles.input, { borderColor: theme.colors.line, color: theme.colors.ink, backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm }]}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  stackTight: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { borderWidth: 1, minHeight: 48, paddingHorizontal: 12, fontSize: 17 },
});
