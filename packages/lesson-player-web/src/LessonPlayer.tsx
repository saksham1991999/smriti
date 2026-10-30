import { useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import {
  Button,
  Card,
  ConfidenceRow,
  FormulaBox,
  Icon,
  IconButton,
  Illustration,
  OptionCard,
  PetLine,
  SegmentedProgress,
  Text,
  cx,
  type Confidence,
} from "@smriti/ui-web";
import { canCheck, createFlowReducer, initialFlow, isQuestion, parseNumeric, totalQuestions, type FlowState } from "./flow";
import type { AnswerRecord, LessonCard, Lesson, LessonResult, PlayerStrings, QuestionCard, SimCard } from "./types";

export interface LessonPlayerProps {
  lesson: Lesson;
  strings: PlayerStrings;
  /** Deep Dive preview: stop after this many cards (R16). */
  previewCards?: number;
  pet?: { species: "cat" | "dog"; name: string };
  /** XP for a right answer on the first and second try. */
  xpFor?: (attempt: 1 | 2) => number;
  /** Renders a sim card's interactive area (the app hosts the bundle through sim-bridge). */
  renderSim?: (card: SimCard) => ReactNode;
  onCardViewed?: (card: LessonCard, index: number, msOnCard: number) => void;
  onAnswer?: (a: AnswerRecord) => void;
  onComplete: (r: LessonResult) => void;
  onPreviewEnd?: (r: LessonResult) => void;
  /** The close button: the app shows LES-05 with the cards left. */
  onRequestExit: (cardsLeft: number) => void;
  now?: () => number;
}

const KEYS = ["A", "B", "C", "D", "E", "F"];
const toWire = (c: Confidence | null) => c;

/** LES-01 shell and every card renderer, with the LES-02 feedback panel. */
export function LessonPlayer({
  lesson,
  strings,
  previewCards,
  pet,
  xpFor = (a) => (a === 1 ? 10 : 5),
  renderSim,
  onCardViewed,
  onAnswer,
  onComplete,
  onPreviewEnd,
  onRequestExit,
  now = Date.now,
}: LessonPlayerProps) {
  const reducer = useMemo(() => createFlowReducer(lesson.cards, previewCards), [lesson.cards, previewCards]);
  const [s, dispatch] = useReducer(reducer, lesson.cards, initialFlow);
  const card = lesson.cards[s.index];
  const shownTotal = previewCards !== undefined ? Math.min(previewCards, lesson.cards.length) : lesson.cards.length;
  const startedAt = useRef(now());
  const cardStartedAt = useRef(now());
  const headingRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef(false);

  // Card viewed + focus the new card for screen readers.
  useEffect(() => {
    cardStartedAt.current = now();
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      if (card) onCardViewed?.(card, s.index, now() - cardStartedAt.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.index]);

  const result = (st: FlowState): LessonResult => ({
    cardsSeen: st.seen,
    correct: st.correct,
    total: totalQuestions(lesson.cards.slice(0, shownTotal)),
    firstTry: st.firstTry,
    msTotal: now() - startedAt.current,
    missed: st.missed,
  });

  useEffect(() => {
    if (sentRef.current) return;
    if (s.phase === "done") {
      sentRef.current = true;
      onComplete(result(s));
    } else if (s.phase === "preview_end") {
      sentRef.current = true;
      onPreviewEnd?.(result(s));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phase]);

  const record = (q: QuestionCard, correct: boolean, response: AnswerRecord["response"]) =>
    onAnswer?.({ card: q, index: s.index, response, correct, attempt: s.attempt, confidence: s.confidence, msToAnswer: now() - cardStartedAt.current });

  const check = () => {
    if (!isQuestion(card) || !canCheck(card, s)) return;
    const response = card.type === "mcq" ? [s.selected ?? ""] : (parseNumeric(s.numeric) ?? 0);
    const correct = card.type === "mcq" ? s.selected === card.correctId : Math.abs((parseNumeric(s.numeric) ?? NaN) - card.answer) <= card.tolerance + 1e-12;
    record(card, correct, response);
    dispatch({ type: "check" });
  };

  const dontKnow = () => {
    if (!isQuestion(card)) return;
    record(card, false, null);
    dispatch({ type: "dont_know" });
  };

  if (!card || s.phase === "done" || s.phase === "preview_end") return null;

  const answering = s.phase === "answering" || s.phase === "retry";
  const feedback = s.phase === "correct" || s.phase === "retry" || s.phase === "revealed";
  const petLine = strings.correctPetLines[s.index % Math.max(1, strings.correctPetLines.length)] ?? "";

  return (
    <div className="flex min-h-dvh flex-col bg-bg" data-subject={lesson.subject} data-testid="lesson-player">
      <header className="mx-auto flex w-full max-w-[720px] items-center gap-3 px-4 pt-3 pb-2">
        <IconButton icon="X" label={strings.close} onPress={() => onRequestExit(shownTotal - s.index)} testID="lesson-close" />
        <div className="min-w-0 flex-1">
          <SegmentedProgress total={shownTotal} done={s.index} current={s.index} tone="primary" label={strings.progressLabel} />
        </div>
        <Text variant="caption" tone="muted" numeric testID="lesson-counter">
          {strings.counter(s.index + 1, shownTotal)}
        </Text>
      </header>

      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-4 px-4 pb-4">
        <Card size="lg" className="flex flex-1 flex-col gap-4">
          <div ref={headingRef} tabIndex={-1} className="flex items-center gap-2 outline-none" aria-live="polite">
            <Text variant="label" tone="subject" subject={lesson.subject}>
              {strings.cardKind[card.type]}
            </Text>
          </div>
          <CardBody card={card} s={s} answering={answering} dispatch={dispatch} strings={strings} renderSim={renderSim} />
          {isQuestion(card) && answering && (
            <ConfidenceRow value={s.confidence} onChange={(v) => dispatch({ type: "confidence", value: toWire(v) })} />
          )}
        </Card>

        {feedback && isQuestion(card) && (
          <Feedback card={card} s={s} strings={strings} xp={s.phase === "correct" ? xpFor(s.attempt) : 0} pet={pet} petLine={petLine} />
        )}

        <div className="sticky bottom-0 flex flex-col gap-2 bg-bg pt-2 pb-[max(16px,env(safe-area-inset-bottom))]">
          {answering && isQuestion(card) ? (
            <>
              {s.phase === "retry" && s.selected === null && s.numeric === "" ? null : (
                <Button label={strings.check} disabled={!canCheck(card, s)} onPress={check} testID="lesson-check" />
              )}
              <Button label={strings.dontKnow} variant="ghost" size="sm" onPress={dontKnow} testID="lesson-dont-know" fullWidth />
            </>
          ) : (
            <Button label={s.phase === "revealed" ? strings.gotIt : strings.continue} onPress={() => dispatch({ type: "next" })} testID="lesson-continue" />
          )}
        </div>
      </main>
    </div>
  );
}

function CardBody({
  card,
  s,
  answering,
  dispatch,
  strings,
  renderSim,
}: {
  card: LessonCard;
  s: FlowState;
  answering: boolean;
  dispatch: (a: Parameters<ReturnType<typeof createFlowReducer>>[1]) => void;
  strings: PlayerStrings;
  renderSim?: (card: SimCard) => ReactNode;
}) {
  switch (card.type) {
    case "concept":
      return (
        <div className="flex flex-col gap-3">
          {card.illustration && (
            <div className="rounded-card bg-subject-tint p-3">
              <Illustration name={card.illustration} alt={card.illustrationAlt} className="mx-auto max-h-56" />
            </div>
          )}
          <Text variant="heading" heading>
            {card.title}
          </Text>
          <Text>{card.body}</Text>
          {card.formula && <FormulaBox latex={card.formula.latex} label={card.formula.label} />}
        </div>
      );
    case "worked_example":
      return (
        <div className="flex flex-col gap-3">
          <Text variant="heading" heading>
            {card.title}
          </Text>
          <ol className="flex flex-col gap-2">
            {card.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-subject-tint text-label text-subject-text">
                  {i + 1}
                </span>
                <Text>{step}</Text>
              </li>
            ))}
          </ol>
        </div>
      );
    case "mcq":
      return (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3">
            <Text variant="heading" heading>
              {card.prompt}
            </Text>
          </legend>
          <div role="radiogroup" aria-label={card.prompt} className="flex flex-col gap-3">
            {card.options.map((o, i) => {
              const selected = s.selected === o.id;
              let state: "idle" | "selected" | "correct" | "wrong" = selected ? "selected" : "idle";
              if (s.phase === "correct" && selected) state = "correct";
              if ((s.phase === "retry" || s.phase === "revealed") && selected) state = "wrong";
              if (s.phase === "revealed" && o.id === card.correctId) state = "correct";
              return (
                <OptionCard
                  key={o.id}
                  label={o.label}
                  keyLabel={KEYS[i]}
                  state={state}
                  disabled={!answering}
                  onPress={() => dispatch({ type: "select", optionId: o.id })}
                  testID={`option-${o.id}`}
                />
              );
            })}
          </div>
        </fieldset>
      );
    case "numeric":
      return (
        <div className="flex flex-col gap-3">
          <Text variant="heading" heading>
            {card.prompt}
          </Text>
          <label className="flex flex-col gap-1">
            <Text variant="label" tone="muted">
              {strings.numericLabel}
            </Text>
            <span className="flex items-center gap-2">
              <input
                inputMode="decimal"
                autoComplete="off"
                value={s.numeric}
                disabled={!answering}
                onChange={(e) => dispatch({ type: "numeric", value: e.target.value })}
                className={cx(
                  "h-14 w-full rounded-md bg-surface-sunken px-4 text-heading text-ink outline-none ring-[1.5px] ring-inset ring-line focus-visible:ring-primary",
                  s.phase === "retry" && "ring-error",
                )}
                data-testid="numeric-input"
              />
              {card.unit && (
                <Text tone="muted" className="shrink-0">
                  {strings.unit(card.unit)}
                </Text>
              )}
            </span>
          </label>
        </div>
      );
    case "sim":
      return (
        <div className="flex flex-col gap-3">
          <Text variant="heading" heading>
            {card.title}
          </Text>
          {renderSim?.(card)}
          <Text tone="muted">{card.caption}</Text>
        </div>
      );
    case "recap":
      return (
        <div className="flex flex-col gap-3">
          <Text variant="heading" heading>
            {card.title}
          </Text>
          <ul className="flex flex-col gap-2">
            {card.points.map((p, i) => (
              <li key={i} className="flex gap-3">
                <Icon name="CheckCircle" weight="fill" color="subjectStrong" size={24} />
                <Text>{p}</Text>
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

function Feedback({
  card,
  s,
  strings,
  xp,
  pet,
  petLine,
}: {
  card: QuestionCard;
  s: FlowState;
  strings: PlayerStrings;
  xp: number;
  pet?: { species: "cat" | "dog"; name: string };
  petLine: string;
}) {
  const correct = s.phase === "correct";
  const retry = s.phase === "retry";
  return (
    <section
      role="status"
      aria-live="assertive"
      data-testid={correct ? "feedback-correct" : retry ? "feedback-retry" : "feedback-revealed"}
      className={cx("flex flex-col gap-3 rounded-card p-4", correct ? "bg-success-tint" : retry ? "bg-error-tint" : "bg-surface-sunken")}
    >
      <div className="flex items-center gap-2">
        <Icon name={correct ? "CheckCircle" : retry ? "XCircle" : "Lightbulb"} weight="fill" color={correct ? "success" : retry ? "error" : "primary"} />
        <Text variant="heading" tone={correct ? "success" : retry ? "error" : "ink"} className="flex-1">
          {correct ? (s.attempt === 2 ? strings.secondTry : strings.correct) : retry ? strings.notQuite : strings.explainHead}
        </Text>
        {correct && xp > 0 && (
          <span className="rounded-full bg-surface px-3 py-1 text-caption font-bold text-primary-text">{strings.xp(xp)}</span>
        )}
      </div>
      {correct && pet && <PetLine pet={{ species: pet.species, mood: "excited" }} petName={pet.name} text={petLine} />}
      {retry && (
        <div className="flex flex-col gap-1">
          <Text variant="label">{strings.hint}</Text>
          <Text>{card.hint}</Text>
          {pet && <PetLine pet={{ species: pet.species, mood: "thinking" }} petName={pet.name} text={strings.wrongPetLine} />}
        </div>
      )}
      {(correct || s.phase === "revealed") && (
        <details open={s.phase === "revealed"} className="group">
          <summary className="cursor-pointer list-none text-label font-bold text-ink">{strings.why}</summary>
          <Text className="mt-2">{card.explanation}</Text>
        </details>
      )}
      {s.phase === "revealed" && (
        <Text variant="caption" tone="muted">
          {strings.reviewNote}
        </Text>
      )}
    </section>
  );
}
