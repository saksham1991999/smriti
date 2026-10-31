/**
 * Answer inputs for every question type (content-format §8). Each hands back a lesson-core
 * `Answer`; checking is lesson-core's job. Typed text never leaves the device: lesson-core turns it
 * into ids, numbers or matched keys before any event is written.
 */
import { useId, useMemo, type ReactNode } from "react";
import { blankIds, BLANK_TOKEN, type BundleChildQuestion, type BundleQuestion } from "@smriti/content-schema";
import type { Answer, AnyQuestion } from "@smriti/lesson-core";
import { Icon, OptionCard, Text, cx, focusRing } from "@smriti/ui-web";
import { usePlayer } from "./context";
import { Media } from "./Media";
import { RichText } from "./RichText";

type ChildOrQuestion = Exclude<BundleQuestion, { type: "paragraph" }> | BundleChildQuestion;
const KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export interface QuestionViewProps {
  q: AnyQuestion;
  passage: string | null;
  draft: Answer | null;
  onDraft: (a: Answer | null) => void;
  /** Locked after the answer is checked (feedback, explain) and in read-only review. */
  locked: boolean;
  /** Reveal right and wrong after the answer is final. */
  reveal: "none" | "right" | "final";
  struck: string[];
}

/** Can [Check] be pressed with this draft? */
export function canSubmit(q: AnyQuestion, a: Answer | null): boolean {
  if (!a) return false;
  switch (a.kind) {
    case "options":
      return a.optionIds.length > 0;
    case "number":
      return String(a.value).trim() !== "";
    case "order":
      return a.order.length > 1;
    case "pairs":
      return q.type === "match_list" && a.pairs.length === q.list_i.length && a.pairs.every((p) => p.right);
    case "matrix":
      return q.type === "matrix_match" && q.rows.every((r) => (a.rows.find((x) => x.row === r.id)?.columns.length ?? 0) > 0);
    case "blanks":
      return q.type === "fill_blank" && q.blanks.every((b) => a.blanks.some((x) => x.blank === b.id && (x.choiceId || (x.text ?? "").trim())));
  }
}

/** A stable, non-trivial starting order for order_steps (never the answer order). */
export function initialOrder(ids: string[], answer: string[], seed: string): string[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j] as string, out[i] as string];
  }
  if (out.join("|") === answer.join("|") && out.length > 1) out.push(out.shift() as string);
  return out;
}

/**
 * A question served without its answer key (a mock while it runs) gets an empty key, so the views
 * can render with nothing revealed: it marks nothing right and starts order questions shuffled.
 */
export function withAnswerKey<Q extends AnyQuestion | ChildOrQuestion>(q: Q): Q {
  const o = q as unknown as Record<string, unknown>;
  if (o.answer) return q;
  const steps = (o.steps as { id: string }[] | undefined)?.map((x) => x.id) ?? [];
  return { ...o, answer: { ...(o.options ? { option_ids: [] } : {}), value: null, unit: null, order: steps, pairs: [], blanks: [] } } as unknown as Q;
}

/** The draft a question starts with: order questions start shuffled, so [Check] works at once. */
export function initialDraft(question: AnyQuestion | null): Answer | null {
  const q = question && withAnswerKey(question);
  if (q?.type === "order_steps") return { kind: "order", order: initialOrder(q.steps.map((s) => s.id), q.answer.order, q.id) };
  return null;
}

export function QuestionView(props: QuestionViewProps) {
  const { t } = usePlayer();
  const q = withAnswerKey(props.q as ChildOrQuestion);
  return (
    <div className="flex flex-col gap-4">
      {props.passage && (
        <section aria-label={t("learn:WEB-02.passage")} className="rounded-md bg-surface-sunken p-4">
          <Text variant="label" tone="muted">
            {t("learn:WEB-02.passage")}
          </Text>
          <RichText text={props.passage} className="mt-1" />
        </section>
      )}
      {q.media && <Media refId={q.media} />}
      <Stem q={q} />
      <Input {...props} q={q} />
    </div>
  );
}

function Stem({ q }: { q: ChildOrQuestion }) {
  const { t } = usePlayer();
  if (q.type === "fill_blank") return null; // the stem carries the blanks (see Blanks)
  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 text-heading font-bold text-ink">
        <RichText as="span" text={q.stem} className="text-heading font-bold" />
      </h2>
      {q.type === "assertion_reason" && (
        <dl className="m-0 flex flex-col gap-2">
          <div className="rounded-md bg-surface-sunken p-3">
            <dt className="text-label font-bold text-ink-muted">{t("learn:WEB-02.assertion")}</dt>
            <dd className="m-0">
              <RichText text={q.assertion} />
            </dd>
          </div>
          <div className="rounded-md bg-surface-sunken p-3">
            <dt className="text-label font-bold text-ink-muted">{t("learn:WEB-02.reason")}</dt>
            <dd className="m-0">
              <RichText text={q.reason} />
            </dd>
          </div>
        </dl>
      )}
      {q.type === "statement_based" && (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {q.statements.map((s, i) => (
            <li key={i} className="rounded-md bg-surface-sunken p-3">
              <span className="text-label font-bold text-ink-muted">{t("learn:WEB-02.statement_n", { n: i + 1 })}</span>
              <RichText text={s} />
            </li>
          ))}
        </ol>
      )}
      {q.type === "match_list" && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { head: t("learn:WEB-02.list_one"), items: q.list_i },
            { head: t("learn:WEB-02.list_two"), items: q.list_ii },
          ].map((col) => (
            <div key={col.head} className="rounded-md bg-surface-sunken p-3">
              <Text variant="label" tone="muted">
                {col.head}
              </Text>
              <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                {col.items.map((it) => (
                  <li key={it.id} className="flex gap-2">
                    <span className="font-bold text-ink-muted">{it.id.toUpperCase()}.</span>
                    <RichText as="span" text={it.text} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Input(props: QuestionViewProps & { q: ChildOrQuestion }) {
  const { q } = props;
  switch (q.type) {
    case "mcq_single":
    case "mcq_multi":
    case "assertion_reason":
    case "statement_based":
      return <Options {...props} options={q.options} multiple={q.type === "mcq_multi"} correct={q.answer.option_ids} />;
    case "match_list":
      if ("option_ids" in q.answer && q.options) return <Options {...props} options={q.options} multiple={false} correct={q.answer.option_ids} />;
      return <Pairs {...props} q={q} />;
    case "numerical":
    case "integer":
      return <NumberInput {...props} unit={q.answer.unit ?? null} integer={q.type === "integer"} />;
    case "order_steps":
      return <Order {...props} q={q} />;
    case "matrix_match":
      return <Matrix {...props} q={q} />;
    case "fill_blank":
      return <Blanks {...props} q={q} />;
  }
}

function Options({
  options,
  multiple,
  correct,
  draft,
  onDraft,
  locked,
  reveal,
  struck,
}: QuestionViewProps & { options: { id: string; text: string }[]; multiple: boolean; correct: string[] }) {
  const { t } = usePlayer();
  const chosen = draft?.kind === "options" ? draft.optionIds : [];
  const toggle = (id: string) => {
    if (locked || struck.includes(id)) return;
    const next = multiple ? (chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]) : [id];
    onDraft({ kind: "options", optionIds: next });
  };
  return (
    <div role={multiple ? "group" : "radiogroup"} aria-label={t("learn:WEB-02.your_answer")} className="flex flex-col gap-3">
      {options.map((o, i) => {
        const isChosen = chosen.includes(o.id);
        let state: "idle" | "selected" | "correct" | "wrong" = isChosen ? "selected" : "idle";
        if (struck.includes(o.id)) state = "wrong";
        if (reveal === "right" && isChosen) state = "correct";
        if (reveal === "final") state = correct.includes(o.id) ? "correct" : isChosen ? "wrong" : "idle";
        return (
          <OptionCard
            key={o.id}
            label={o.text}
            keyLabel={KEYS[i]}
            multiple={multiple}
            state={state}
            disabled={locked || struck.includes(o.id)}
            onPress={() => toggle(o.id)}
            testID={`option-${o.id}`}
          />
        );
      })}
    </div>
  );
}

const fieldCls = cx(
  "h-14 w-full rounded-md bg-surface-sunken px-4 text-heading text-ink outline-none ring-[1.5px] ring-inset ring-line focus-visible:ring-primary disabled:opacity-70",
);

function NumberInput({ draft, onDraft, locked, reveal, unit, integer, q }: QuestionViewProps & { unit: string | null; integer: boolean }) {
  const { t } = usePlayer();
  const id = useId();
  const value = draft?.kind === "number" ? String(draft.value) : "";
  const answer = (q as { answer: { value: number } }).answer.value;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-label font-bold text-ink-muted">
        {t("learn:WEB-02.your_answer")}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          inputMode={integer ? "numeric" : "decimal"}
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={locked}
          placeholder={t("learn:WEB-02.type_a_number")}
          onChange={(e) => onDraft(e.target.value === "" ? null : { kind: "number", value: e.target.value, unit })}
          className={cx(fieldCls, reveal === "right" && "ring-success", reveal === "final" && "ring-line")}
          data-testid="numeric-input"
        />
        {unit && (
          <Text tone="muted" className="shrink-0">
            {t("learn:LES-03.unit", { unit })}
          </Text>
        )}
      </div>
      {reveal === "final" && (
        <Text variant="label" tone="success" testID="correct-answer">
          {t("learn:WEB-02.correct_answer")}: {answer}
          {unit ? ` ${unit}` : ""}
        </Text>
      )}
    </div>
  );
}

function Order({ q, draft, onDraft, locked, reveal }: QuestionViewProps & { q: Extract<ChildOrQuestion, { type: "order_steps" }> }) {
  const { t } = usePlayer();
  const start = useMemo(() => initialOrder(q.steps.map((s) => s.id), q.answer.order, q.id), [q]);
  const order = draft?.kind === "order" ? draft.order : start;
  const text = new Map(q.steps.map((s) => [s.id, s.text]));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    onDraft({ kind: "order", order: next });
  };
  return (
    <div className="flex flex-col gap-2">
      <Text variant="label" tone="muted">
        {t("learn:WEB-02.order_hint")}
      </Text>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {order.map((id, i) => {
          const right = reveal === "final" ? q.answer.order[i] === id : null;
          return (
            <li key={id} className={cx("flex items-center gap-2 rounded-md bg-surface-sunken p-2 ps-3", right === true && "bg-success-tint", right === false && "bg-error-tint")}>
              <span aria-hidden className="w-5 text-label font-bold text-ink-muted">
                {i + 1}
              </span>
              <RichText as="span" text={text.get(id) ?? id} className="flex-1" />
              {!locked && (
                <span className="flex gap-1">
                  <MoveButton label={t("learn:WEB-02.move_up_a11y", { step: i + 1 })} up disabled={i === 0} onPress={() => move(i, -1)} />
                  <MoveButton label={t("learn:WEB-02.move_down_a11y", { step: i + 1 })} disabled={i === order.length - 1} onPress={() => move(i, 1)} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {reveal === "final" && <CorrectList label={t("learn:WEB-02.correct_answer")} items={q.answer.order.map((id) => text.get(id) ?? id)} />}
    </div>
  );
}

export function MoveButton({ label, up, disabled, onPress }: { label: string; up?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onPress}
      className={cx("grid size-11 place-items-center rounded-full bg-surface text-ink shadow-card disabled:opacity-40", focusRing)}
    >
      <Icon name="CaretDown" size={20} className={up ? "rotate-180" : undefined} />
    </button>
  );
}

function CorrectList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="rounded-md bg-success-tint p-3" data-testid="correct-answer">
      <Text variant="label" tone="success">
        {label}
      </Text>
      <ol className="m-0 mt-1 ps-5">
        {items.map((s, i) => (
          <li key={i}>
            <RichText as="span" text={s} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Select({ label, value, options, disabled, onChange, testID, invalid }: { label: string; value: string; options: { id: string; text: string }[]; disabled: boolean; onChange: (v: string) => void; testID?: string; invalid?: boolean }) {
  const { t } = usePlayer();
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      data-testid={testID}
      onChange={(e) => onChange(e.target.value)}
      className={cx("h-12 min-w-0 rounded-md bg-surface px-3 text-body text-ink ring-[1.5px] ring-inset ring-line", invalid && "ring-error", focusRing)}
    >
      <option value="">{t("learn:WEB-02.choose")}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.text}
        </option>
      ))}
    </select>
  );
}

function Pairs({ q, draft, onDraft, locked, reveal }: QuestionViewProps & { q: Extract<ChildOrQuestion, { type: "match_list" }> }) {
  const { t } = usePlayer();
  const pairs = draft?.kind === "pairs" ? draft.pairs : [];
  const key = "pairs" in q.answer ? new Map(q.answer.pairs.map((p) => [p.left, p.right])) : new Map<string, string>();
  const set = (left: string, right: string) => {
    const next = q.list_i.map((l) => ({ left: l.id, right: l.id === left ? right : (pairs.find((p) => p.left === l.id)?.right ?? "") }));
    onDraft({ kind: "pairs", pairs: next.filter((p) => p.right) });
  };
  return (
    <div className="flex flex-col gap-2">
      {q.list_i.map((l) => {
        const v = pairs.find((p) => p.left === l.id)?.right ?? "";
        const wrong = reveal === "final" && key.get(l.id) !== v;
        return (
          <div key={l.id} className="grid grid-cols-[1fr_minmax(0,1fr)] items-center gap-2">
            <RichText as="span" text={l.text} />
            <Select
              label={t("learn:WEB-02.pick_match", { item: l.text })}
              value={v}
              options={q.list_ii.map((r) => ({ id: r.id, text: r.text }))}
              disabled={locked}
              invalid={wrong}
              onChange={(r) => set(l.id, r)}
              testID={`pair-${l.id}`}
            />
          </div>
        );
      })}
      {reveal === "final" && (
        <CorrectList
          label={t("learn:WEB-02.correct_answer")}
          items={q.list_i.map((l) => `${l.text} → ${q.list_ii.find((r) => r.id === key.get(l.id))?.text ?? ""}`)}
        />
      )}
    </div>
  );
}

function Matrix({ q, draft, onDraft, locked, reveal }: QuestionViewProps & { q: Extract<ChildOrQuestion, { type: "matrix_match" }> }) {
  const { t } = usePlayer();
  const rows = draft?.kind === "matrix" ? draft.rows : [];
  const key = new Map(q.answer.pairs.map((p) => [p.row, new Set(p.columns)]));
  const has = (r: string, c: string) => rows.find((x) => x.row === r)?.columns.includes(c) ?? false;
  const toggle = (r: string, c: string) => {
    const next = q.rows.map((row) => {
      const cols = rows.find((x) => x.row === row.id)?.columns ?? [];
      return { row: row.id, columns: row.id === r ? (cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c]) : cols };
    });
    onDraft({ kind: "matrix", rows: next });
  };
  return (
    <div className="flex flex-col gap-2">
      <Text variant="label" tone="muted">
        {t("learn:WEB-02.matrix_hint")}
      </Text>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-body text-ink">
          <thead>
            <tr>
              <th />
              {q.columns.map((c) => (
                <th key={c.id} scope="col" className="p-1 text-label font-bold text-ink-muted">
                  <RichText as="span" text={c.text} className="text-label" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="p-1 text-start font-semibold">
                  <RichText as="span" text={r.text} />
                </th>
                {q.columns.map((c) => {
                  const on = has(r.id, c.id);
                  const right = key.get(r.id)?.has(c.id) ?? false;
                  return (
                    <td key={c.id} className={cx("rounded-xs p-1 text-center", reveal === "final" && right && "bg-success-tint", reveal === "final" && on && !right && "bg-error-tint")}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={locked}
                        aria-label={`${r.text} – ${c.text}`}
                        onChange={() => toggle(r.id, c.id)}
                        className="size-6 accent-[var(--color-primary)]"
                        data-testid={`cell-${r.id}-${c.id}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Blanks({ q, draft, onDraft, locked, reveal }: QuestionViewProps & { q: Extract<ChildOrQuestion, { type: "fill_blank" }> }) {
  const { t } = usePlayer();
  const values = draft?.kind === "blanks" ? draft.blanks : [];
  const order = blankIds(q.stem);
  const set = (blank: string, v: { choiceId?: string; text?: string }) => {
    const next = q.blanks.map((b) => (b.id === blank ? { blank, ...v } : (values.find((x) => x.blank === b.id) ?? { blank: b.id })));
    onDraft({ kind: "blanks", blanks: next });
  };
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of q.stem.matchAll(new RegExp(BLANK_TOKEN.source, "g"))) {
    const at = m.index ?? 0;
    if (at > last) parts.push(<RichText key={`t${at}`} as="span" text={q.stem.slice(last, at)} className="text-heading font-bold" />);
    const id = m[1] as string;
    const def = q.blanks.find((b) => b.id === id);
    const n = order.indexOf(id) + 1;
    const cur = values.find((x) => x.blank === id);
    const keyEntry = q.answer.blanks.find((b) => b.blank === id);
    if (def?.choices) {
      parts.push(
        <span key={`b${id}`} className="mx-1 inline-block align-middle">
          <Select
            label={t("learn:WEB-02.blank_n", { n })}
            value={cur?.choiceId ?? ""}
            options={def.choices}
            disabled={locked}
            invalid={reveal === "final" && keyEntry !== undefined && "choice_id" in keyEntry && keyEntry.choice_id !== cur?.choiceId}
            onChange={(v) => set(id, { choiceId: v })}
            testID={`blank-${id}`}
          />
        </span>,
      );
    } else {
      parts.push(
        <input
          key={`b${id}`}
          aria-label={t("learn:WEB-02.blank_n", { n })}
          value={cur?.text ?? ""}
          disabled={locked}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => set(id, { text: e.target.value })}
          className={cx("mx-1 inline-block h-11 w-36 rounded-md bg-surface-sunken px-3 align-middle text-body text-ink ring-[1.5px] ring-inset ring-line", focusRing)}
          data-testid={`blank-${id}`}
        />,
      );
    }
    last = at + m[0].length;
  }
  if (last < q.stem.length) parts.push(<RichText key="tail" as="span" text={q.stem.slice(last)} className="text-heading font-bold" />);
  const correctText = (id: string) => {
    const k = q.answer.blanks.find((b) => b.blank === id);
    if (!k) return "";
    if ("choice_id" in k) return q.blanks.find((b) => b.id === id)?.choices?.find((c) => c.id === k.choice_id)?.text ?? "";
    return k.accepted[0]?.text[0] ?? "";
  };
  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 text-heading font-bold leading-[2.6] text-ink">{parts}</h2>
      {reveal === "final" && <CorrectList label={t("learn:WEB-02.correct_answer")} items={order.map((id) => correctText(id))} />}
    </div>
  );
}
