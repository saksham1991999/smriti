/**
 * LES-01 to LES-03, LES-07 and LES-10 on the web. The lesson rules live in @smriti/lesson-core:
 * this component owns one `LessonSession`, dispatches the student's actions and renders from
 * `state.phase` and the current card. Every event the session produces goes to `onEvent` as a
 * sync envelope, in order, for the host to put in the outbox.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TypedBundle } from "@smriti/content-schema";
import {
  autoNarrate,
  cardNarration,
  checkSimTask,
  currentCard,
  isReadOnly,
  LessonSession,
  lessonPetEvent,
  petReaction,
  playerRules,
  readyMediaUrl,
  shownAnswer,
  shownOptionIds,
  workedSolution,
  type Answer,
  type AudioPort,
  type Confidence,
  type EventEnvelope,
  type LessonAction,
  type LessonConfig,
  type LessonPlan,
  type LessonState,
  type Rating,
} from "@smriti/lesson-core";
import {
  Button,
  ConfidenceRow,
  Icon,
  IconButton,
  PetLine,
  PetView,
  RatingButtons,
  SegmentedProgress,
  Text,
  cx,
  useUI,
  focusRing,
  type Confidence as UiConfidence,
} from "@smriti/ui-web";
import { CardView, Title, type SimCardData, type SimHostApi } from "./cards";
import { contentUrl, PlayerProvider, type PlayerContextValue, type Translate } from "./context";
import { useNarration } from "./narration";
import { canSubmit, initialDraft, QuestionView } from "./questions";
import { RichText } from "./RichText";

export interface LessonPlayerProps {
  plan: LessonPlan;
  bundle: TypedBundle;
  config: LessonConfig;
  /** IANA zone of the device, sent with every event. */
  tz: string;
  t: Translate;
  contentBaseUrl: string;
  /** Subject colour family for the subject tint (`data-subject`). */
  subject?: string;
  resumeIndex?: number;
  online?: boolean;
  pet?: { species: "cat" | "dog"; name: string };
  /** Next-interval labels for Quick Revision self-rating (from app-core FSRS previews). */
  ratingIntervals?: Record<"again" | "hard" | "good" | "easy", string>;
  renderSim?: (card: SimCardData, api: SimHostApi) => ReactNode | null;
  onEvent: (e: EventEnvelope) => void;
  /** After each card change: what to save for resume (learn §7.3 rule 1). */
  onProgress?: (p: { lastCardIndex: number; biteId: string | null; bundleVersion: string | null }) => void;
  onComplete: (s: LessonState) => void;
  onPreviewEnd: (s: LessonState) => void;
  /** The close button: the host shows LES-05 with the cards left, then calls `exit` if they leave. */
  onRequestExit: (cardsLeft: number) => void;
  clock?: () => number;
  newId?: (now: number) => string;
  /** Lets the host dispatch actions (exit after LES-05) and read state. */
  sessionRef?: { current: LessonSession | null };
  /**
   * Plays card narration. Without one (or without ready audio) [Listen] is hidden and the lesson
   * works the same, silently.
   */
  audio?: AudioPort;
  /** The app's sound setting: when muted, narration never starts by itself and stops if playing. */
  muted?: boolean;
  /** Each time narration starts, for `narration_played` (`auto`: it started by itself). */
  onNarrationPlayed?: (p: { cardId: string | null; auto: boolean }) => void;
}

const fromUi = (c: UiConfidence | null): Confidence | null => (c === "half" ? "fifty_fifty" : c);
const toUi = (c: Confidence | null): UiConfidence | null => (c === "fifty_fifty" ? "half" : c);
const RATING: Record<"again" | "hard" | "good" | "easy", Rating> = { again: 1, hard: 2, good: 3, easy: 4 };
/** LES-07's five-point scale onto lesson-core's three confidence values. */
const SCALE: (Confidence | null)[] = ["guess", "guess", "fifty_fifty", "sure", "sure"];

export function LessonPlayer(props: LessonPlayerProps) {
  const { plan, bundle, config, tz, t, onEvent } = props;
  const [session] = useState(() => {
    const s = new LessonSession({ config, tz, clock: props.clock, newId: props.newId });
    s.dispatch({ type: "start", plan, resumeIndex: props.resumeIndex });
    return s;
  });
  if (props.sessionRef) props.sessionRef.current = session;
  const [state, setState] = useState<LessonState>(session.state);
  const [draft, setDraft] = useState<Answer | null>(() => initialDraft(currentCard(session.state)?.question ?? null));
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [xpGain, setXpGain] = useState(0);
  const [rated, setRated] = useState<Record<string, Rating>>({});
  const sent = useRef(0);
  const ended = useRef(false);
  const headingRef = useRef<HTMLDivElement>(null);
  const card = currentCard(state);
  const readOnly = isReadOnly(state);
  const rules = playerRules(plan.mode);
  const gentle = rules.tone === "gentle";
  const { reducedMotion } = useUI();
  const narrationUrl = readyMediaUrl(bundle.media, cardNarration(card));
  const narration = useNarration({
    audio: props.audio,
    src: narrationUrl ? contentUrl(props.contentBaseUrl, narrationUrl) : null,
    cardKey: `${state.viewIndex}`,
    auto: autoNarrate(rules, { muted: props.muted ?? false, readOnly }),
    muted: props.muted ?? false,
    onPlayed: (auto) => props.onNarrationPlayed?.({ cardId: card?.cardId ?? null, auto }),
  });

  const act = (a: LessonAction) => {
    const before = session.state;
    const next = session.dispatch(a);
    setXpGain(next.xp - before.xp);
    if (next.viewIndex !== before.viewIndex || (next.phase === "question" && before.phase !== "question" && before.phase !== "hint")) {
      setDraft(initialDraft(currentCard(next)?.question ?? null));
      setConfidence(null);
    }
    if (a.type === "try_again") setDraft(initialDraft(currentCard(next)?.question ?? null));
    if (next.phase === "guided" && before.phase !== "guided") {
      // Option questions start empty (the child taps the shown answer); the rest show the key.
      const nq = currentCard(next)?.question ?? null;
      setDraft(nq && !shownOptionIds(nq) ? shownAnswer(nq) : initialDraft(nq));
    }
    setState(next);
  };

  // Drain new events in order (StrictMode-safe: the cursor survives double effects).
  useEffect(() => {
    const all = session.emitted;
    for (; sent.current < all.length; sent.current++) onEvent(all[sent.current] as EventEnvelope);
    props.onProgress?.(session.progress());
    if (!ended.current && state.phase === "complete") {
      ended.current = true;
      props.onComplete(state);
    } else if (!ended.current && state.phase === "preview_end") {
      ended.current = true;
      props.onPreviewEnd(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Focus the card for screen readers when it changes.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, [state.viewIndex, state.phase === "confidence"]);

  const ctx = useMemo<PlayerContextValue>(
    () => ({ t, bundle, contentBaseUrl: props.contentBaseUrl, online: props.online ?? true }),
    [t, bundle, props.contentBaseUrl, props.online],
  );

  const simApi: SimHostApi = {
    reportTask: (taskId, measurement) => {
      if (card?.card?.type !== "sim") return;
      const res = checkSimTask(card.card, taskId, measurement);
      if (res.known) act({ type: "sim_task", taskId, correct: res.correct });
    },
  };

  if (state.phase === "complete" || state.phase === "preview_end" || state.phase === "exited" || !card) return null;

  const total = plan.previewLimit !== null ? Math.min(plan.previewLimit, plan.cards.length) : plan.cards.length;
  const q = card.question;
  const phase = state.phase;
  const kind = q ? "question" : (card.card?.type ?? "question");
  const browsing = phase === "card" || phase === "question";
  const outcome = state.outcomes[card.key];
  const pet = props.pet;
  const cornerPet = rules.cornerPet && pet ? { species: pet.species, ...petReaction(readOnly ? null : lessonPetEvent(phase), reducedMotion) } : null;
  const correctLines = [t("learn:LES-02.correct_pet_lines_rotate.1"), t("learn:LES-02.correct_pet_lines_rotate.2"), t("learn:LES-02.correct_pet_lines_rotate.3")];

  if (phase === "confidence") {
    return (
      <PlayerProvider value={ctx}>
        <Shell {...props} total={total} state={state} counter={rules.counter} onBack={null}>
          <div ref={headingRef} tabIndex={-1} className="flex flex-1 flex-col justify-center gap-6 outline-none" data-testid="lesson-confidence">
            <Text variant="title" heading align="center">
              {t("learn:LES-07.question", { topic_title: bundle.topic.name })}
            </Text>
            <div role="group" aria-label={t("learn:LES-07.question", { topic_title: bundle.topic.name })} className="grid grid-cols-5 gap-2">
              {SCALE.map((value, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => act({ type: "confidence", value })}
                  className={cx("flex min-h-16 flex-col items-center justify-center rounded-md bg-surface p-2 text-center text-label font-bold text-ink shadow-card", focusRing)}
                  data-testid={`confidence-${i + 1}`}
                >
                  <span aria-hidden className="text-title tabular-nums text-primary-text">
                    {i + 1}
                  </span>
                  {t(`learn:LES-07.scale.${i + 1}` as Parameters<Translate>[0])}
                </button>
              ))}
            </div>
            <Button label={t("learn:LES-07.skip")} variant="ghost" onPress={() => act({ type: "confidence", value: null })} testID="confidence-skip" />
          </div>
        </Shell>
      </PlayerProvider>
    );
  }

  const guided = phase === "guided" && !readOnly;
  // The guided finish marks the key on option questions (the child taps it) and shows the worked
  // answer on the rest, where [Continue] submits it (lesson-core shownAnswer).
  const shown = guided && q ? shownOptionIds(q) : null;
  const reveal: "none" | "right" | "final" =
    phase === "feedback" ? "right" : phase === "explain" || (guided && !shown) || (readOnly && outcome?.correct === false) ? "final" : readOnly && outcome?.correct ? "right" : "none";
  const solution = q ? workedSolution(q) : null;
  const rapidSummary = plan.rapid && card.card?.type === "summary" && phase === "card" && !readOnly;
  const isSim = card.card?.type === "sim";
  const online = props.online ?? true;
  const onlineOnlyBlocked = card.onlineOnly && (!online || card.card?.type === "roleplay");

  let footer: ReactNode;
  if (readOnly && browsing) {
    footer = (
      <>
        <Text variant="caption" tone="muted" align="center">
          {t("learn:WEB-02.read_only_note")}
        </Text>
        <Button label={t("learn:WEB-02.next_card")} onPress={() => act({ type: "forward" })} testID="lesson-forward" />
      </>
    );
  } else if (phase === "question" && q) {
    footer = (
      <>
        <Button label={t("learn:LES-01.check")} disabled={!canSubmit(q, draft)} onPress={() => draft && act({ type: "submit", answer: draft, confidence })} testID="lesson-check" />
        <Button label={t("learn:LES-01.don_t_know")} variant="ghost" size="sm" fullWidth onPress={() => act({ type: "dont_know" })} testID="lesson-dont-know" />
      </>
    );
  } else if (guided && q) {
    const key = shownAnswer(q);
    footer = shown ? null : <Button label={t("learn:LES-01.continue")} disabled={!key} onPress={() => key && act({ type: "submit", answer: key })} testID="lesson-guided-continue" />;
  } else if (phase === "hint") {
    footer = <Button label={t("learn:LES-02.try_again")} onPress={() => act({ type: "try_again" })} testID="lesson-try-again" />;
  } else if (phase === "feedback" || phase === "explain") {
    footer = <Button label={phase === "explain" ? t("learn:LES-02.got_it") : t("learn:LES-01.continue")} onPress={() => act({ type: "continue" })} testID="lesson-continue" />;
  } else if (onlineOnlyBlocked) {
    footer = <Button label={t("learn:LES-01.skip")} onPress={() => act({ type: "skip_online" })} testID="lesson-skip-online" />;
  } else {
    footer = (
      <>
        {state.pendingTask && (
          <Text variant="caption" tone="muted" align="center" testID="task-first">
            {t("learn:WEB-02.task_first")}
          </Text>
        )}
        <Button label={t("learn:LES-01.continue")} disabled={state.pendingTask} onPress={() => act({ type: "next" })} testID="lesson-continue" />
        {state.pendingTask && isSim && <Button label={t("learn:WEB-02.skip_task")} variant="ghost" size="sm" fullWidth onPress={() => act({ type: "skip_task" })} testID="lesson-skip-task" />}
      </>
    );
  }

  return (
    <PlayerProvider value={ctx}>
      <Shell {...props} total={total} state={state} counter={rules.counter} onBack={browsing && state.viewIndex > 0 ? () => act({ type: "back" }) : null}>
        <section className="flex flex-1 flex-col gap-4 rounded-card-large bg-surface p-[18px] shadow-card" aria-labelledby="lesson-card-kind">
          <div ref={headingRef} tabIndex={-1} className="flex items-center gap-2 outline-none">
            <span id="lesson-card-kind" className="rounded-full bg-subject-tint px-3 py-1 text-label font-bold text-subject-text" data-testid="lesson-card-kind">
              {t(`learn:WEB-02.kind_${kind}` as Parameters<Translate>[0])}
            </span>
            {readOnly && <Icon name="Check" size={20} color="success" label={t("learn:WEB-02.read_only_note")} />}
            {(narration.toggle || cornerPet) && (
              <span className="ms-auto flex items-center gap-2">
                {narration.toggle && (
                  <IconButton
                    icon={narration.status === "playing" ? "PauseCircle" : "SpeakerHigh"}
                    label={narration.status === "playing" ? t("learn:LES-01.listen_pause") : t("learn:LES-01.listen")}
                    onPress={narration.toggle}
                    testID="lesson-listen"
                  />
                )}
                {cornerPet && (
                  // LES-01 little learner: the pet stays at the top-right of every card and reacts (hop on
                  // correct, think on wrong). Decorative: the feedback itself is announced.
                  <span
                    key={`${state.viewIndex}:${phase}`}
                    aria-hidden
                    data-testid="lesson-pet"
                    data-mood={cornerPet.mood}
                    data-hop={cornerPet.hop || undefined}
                    className={cx(
                      "inline-grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-primary-tint",
                      cornerPet.hop && "motion-safe:animate-[sm-hop_var(--sm-duration-slow)_ease-out_1]",
                    )}
                  >
                    <PetView species={cornerPet.species} mood={cornerPet.mood} under10 decorative size={56} className="mt-[12%]" />
                  </span>
                )}
              </span>
            )}
          </div>
          {q ? (
            <QuestionView
              q={q}
              passage={card.passage}
              draft={readOnly ? null : draft}
              onDraft={shown ? (a) => a && act({ type: "submit", answer: a }) : setDraft}
              locked={readOnly || (phase !== "question" && !shown)}
              reveal={reveal}
              struck={readOnly ? [] : state.struckOptionIds}
              shown={shown ?? undefined}
            />
          ) : card.card ? (
            <CardView
              card={card.card}
              locked={readOnly}
              onWidget={(response) => act({ type: "widget", response })}
              renderSim={props.renderSim}
              simApi={simApi}
              taskDone={!!outcome && (outcome.correct !== null || outcome.skipped)}
            />
          ) : null}
          {q && phase === "question" && !readOnly && rules.confidenceRow && <ConfidenceRow value={toUi(confidence)} onChange={(v) => setConfidence(fromUi(v))} testID="confidence-row" />}
        </section>

        {phase === "feedback" && (
          <Panel tone="success" testID="feedback-correct">
            <div className="flex items-center gap-2">
              <Icon name="CheckCircle" weight="fill" color="success" />
              <Text variant="heading" tone="success" className="flex-1">
                {gentle ? t("learn:LES-02.little_learner_correct") : state.attempt === 2 ? t("learn:LES-02.second_try") : t("learn:LES-02.correct")}
              </Text>
              {rules.xpChip && xpGain > 0 && (
                <span className="rounded-full bg-surface px-3 py-1 text-caption font-bold text-primary-text" data-testid="xp-chip">
                  {t("learn:LES-02.xp", { xp: xpGain })}
                </span>
              )}
            </div>
            {state.comboNow && (
              <Text variant="label" tone="streak">
                {t("learn:LES-02.combo", { n: config.comboStreakLen })}
              </Text>
            )}
            {pet && <PetLine pet={{ species: pet.species, mood: "excited" }} petName={pet.name} text={correctLines[state.index % 3] ?? ""} />}
            {solution?.feynman && !state.guided && (
              <details className="group">
                <summary className={cx("cursor-pointer text-label font-bold text-ink", focusRing)}>{t("learn:LES-02.why")}</summary>
                <RichText text={solution.feynman} className="mt-2" />
              </details>
            )}
          </Panel>
        )}

        {phase === "hint" && state.hint && (
          <Panel tone={gentle ? "neutral" : "error"} testID="feedback-retry">
            {gentle ? (
              // LES-02 little learner: a sunken band with ArrowCounterClockwise, never "Not quite".
              <div className="flex items-center gap-2">
                <Icon name="ArrowCounterClockwise" weight="bold" color="primaryText" />
                <Text variant="heading">{t("learn:LES-02.little_learner_wrong")}</Text>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Icon name="XCircle" weight="fill" color="error" />
                <Text variant="heading" tone="error">
                  {t("learn:LES-02.not_quite")}
                </Text>
              </div>
            )}
            <Text variant="label">{t("learn:LES-02.hint")}</Text>
            {state.hint.source === "generic" ? (
              <Text>{t("learn:LES-02.generic_hint", { concept_name: conceptName(bundle, state.hint.conceptId) })}</Text>
            ) : (
              <RichText text={state.hint.text} />
            )}
            {pet && <PetLine pet={{ species: pet.species, mood: gentle ? petReaction("wrong", reducedMotion).mood : "thinking" }} petName={pet.name} text={t("learn:LES-02.wrong_pet_line")} />}
          </Panel>
        )}

        {guided && (
          <Panel tone="neutral" testID="feedback-guided">
            <div className="flex items-center gap-2">
              <Icon name="Lightbulb" weight="fill" color="primaryText" />
              <Text variant="heading">{t("learn:LES-02.little_learner_shown_answer")}</Text>
            </div>
            {solution?.feynman && <RichText text={solution.feynman} />}
            {pet && <PetLine pet={{ species: pet.species, mood: petReaction("shown", reducedMotion).mood }} petName={pet.name} text={t("learn:LRN-18.little_learner_show_me")} />}
          </Panel>
        )}

        {phase === "explain" && solution && (
          <Panel tone="neutral" testID={outcome?.correct ? "feedback-explain" : "feedback-revealed"}>
            <div className="flex items-center gap-2">
              <Icon name="Lightbulb" weight="fill" color="primary" />
              <Title>{outcome?.dontKnow ? t("learn:LES-02.don_t_know_head") : t("learn:LES-02.explain_head")}</Title>
            </div>
            {solution.feynman && (
              <Block title={t("learn:LES-02.sections.1")}>
                <RichText text={solution.feynman} />
              </Block>
            )}
            {solution.steps.length > 0 && (
              <Block title={t("learn:LES-02.sections.2")}>
                <ol className="m-0 flex flex-col gap-1 ps-5">
                  {solution.steps.map((s, i) => (
                    <li key={i}>
                      <RichText as="span" text={s} />
                    </li>
                  ))}
                </ol>
              </Block>
            )}
            {solution.shortcut && (
              <Block title={t("learn:LES-02.sections.3")}>
                <RichText text={solution.shortcut} />
              </Block>
            )}
            {solution.traps[0] && (
              <Block title={t("learn:LES-02.sections.4")}>
                <RichText text={solution.traps[0].why} />
              </Block>
            )}
            {plan.mode !== "quick_check" && outcome?.correct === false && (
              <Text variant="caption" tone="muted">
                {t("learn:LES-02.review_note")}
              </Text>
            )}
          </Panel>
        )}

        {rapidSummary && card.card && (
          <div className="flex flex-col gap-2" data-testid="rapid-rating">
            <Text variant="label" tone="muted">
              {t("learn:LES-10.recall_prompt.1")}
            </Text>
            <RatingButtons
              intervals={props.ratingIntervals ?? { again: "", hard: "", good: "", easy: "" }}
              onRate={(r) => {
                act({ type: "rate", rating: RATING[r] });
                setRated({ ...rated, [card.key]: RATING[r] });
              }}
            />
          </div>
        )}

        <div className="sticky bottom-0 flex flex-col gap-2 bg-bg pt-2 pb-[max(16px,env(safe-area-inset-bottom))]">{footer}</div>
      </Shell>
    </PlayerProvider>
  );
}

function conceptName(bundle: TypedBundle, id: string | null): string {
  return bundle.concepts.find((c) => c.id === id)?.name ?? bundle.topic.name;
}

function Panel({ tone, testID, children }: { tone: "success" | "error" | "neutral"; testID: string; children: ReactNode }) {
  return (
    <section
      role="status"
      aria-live="polite"
      data-testid={testID}
      className={cx("flex flex-col gap-3 rounded-card p-4", tone === "success" ? "bg-success-tint" : tone === "error" ? "bg-error-tint" : "bg-surface-sunken")}
    >
      {children}
    </section>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Text variant="label" tone="muted">
        {title}
      </Text>
      {children}
    </div>
  );
}

function Shell({
  t,
  subject,
  total,
  state,
  onRequestExit,
  counter,
  onBack,
  children,
}: Pick<LessonPlayerProps, "t" | "subject" | "onRequestExit"> & { total: number; state: LessonState; counter: boolean; onBack: (() => void) | null; children: ReactNode }) {
  const done = Math.min(state.index, total);
  return (
    <div className="flex min-h-dvh flex-col bg-bg" data-subject={subject} data-testid="lesson-player" data-phase={state.phase}>
      <header className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-4 pt-3 pb-2">
        <IconButton icon="X" label={t("learn:LES-01.close_a11y")} onPress={() => onRequestExit(Math.max(0, total - state.index))} testID="lesson-close" />
        {onBack ? <IconButton icon="CaretLeft" label={t("learn:WEB-02.previous_card_a11y")} onPress={onBack} testID="lesson-back" /> : null}
        <div className="min-w-0 flex-1">
          <SegmentedProgress total={total} done={done} current={Math.min(state.viewIndex, total - 1)} tone="primary" label={t("learn:LES-01.counter", { n: state.viewIndex + 1, total })} />
        </div>
        {/* Little learners get the dots alone (LES-01); the bar keeps its label for screen readers. */}
        {counter && (
          <Text variant="caption" tone="muted" numeric testID="lesson-counter">
            {t("learn:LES-01.counter", { n: Math.min(state.viewIndex + 1, total), total })}
          </Text>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-4 px-4 pb-2">{children}</main>
    </div>
  );
}
