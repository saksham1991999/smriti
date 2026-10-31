/**
 * LES-01 to LES-03, LES-07 and LES-10 on iOS and Android. The lesson rules live in
 * @smriti/lesson-core: this component owns one `LessonSession`, dispatches the student's actions
 * and renders from `state.phase` and the current card. Every event the session produces goes to
 * `onEvent` as a sync envelope, in order, for the host to put in the outbox. Props and names follow
 * @smriti/lesson-player-web so both apps wire it the same way.
 */
import type { TypedBundle } from "@smriti/content-schema";
import type { MessageKey } from "@smriti/i18n";
import {
  currentCard,
  isReadOnly,
  LessonSession,
  playerRules,
  shownAnswer,
  shownOptionIds,
  workedSolution,
  type Answer,
  type AnyQuestion,
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
  Card,
  Chip,
  ConfidenceRow,
  Icon,
  IconButton,
  RatingButtons,
  SegmentedProgress,
  Text,
  useTheme,
} from "@smriti/ui-native";
import type { Confidence as UiConfidence, IconName } from "@smriti/tokens/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View, type ImageSourcePropType } from "react-native";

import { CardView, type SimCardData, type SimHostApi } from "./cards";
import { PlayerProvider, sharedKey, usePlayer as usePlayerT, type PlayerContextValue, type Translate } from "./context";
import { canSubmit, initialDraft, QuestionView } from "./questions";
import { RichText } from "./RichText";

export interface PlayerHaptics {
  success(): void;
  error(): void;
  tap(): void;
}

export interface LessonPlayerProps {
  plan: LessonPlan;
  bundle: TypedBundle;
  config: LessonConfig;
  /** IANA zone of the device, sent with every event. */
  tz: string;
  t: Translate;
  /** Bundle-relative media url to an image source (seed pack, download or CDN). */
  resolveMedia: (url: string) => ImageSourcePropType | undefined;
  /** Subject colour family for the subject tint. */
  subject?: string;
  resumeIndex?: number;
  online?: boolean;
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
  haptics?: PlayerHaptics;
  clock?: () => number;
  newId?: (now: number) => string;
  /** Lets the host dispatch actions (exit after LES-05) and read state. */
  sessionRef?: { current: LessonSession | null };
  testID?: string;
}

const fromUi = (c: UiConfidence | null): Confidence | null => (c === "half" ? "fifty_fifty" : c);
const toUi = (c: Confidence | null): UiConfidence | null => (c === "fifty_fifty" ? "half" : c);
const RATING: Record<"again" | "hard" | "good" | "easy", Rating> = { again: 1, hard: 2, good: 3, easy: 4 };
/** LES-07's five-point scale onto lesson-core's three confidence values. */
const SCALE: Confidence[] = ["guess", "guess", "fifty_fifty", "sure", "sure"];

const KIND_ICON: Partial<Record<string, IconName>> = {
  story: "BookBookmark",
  explainer: "BookBookmark",
  formula: "FileText",
  worked_example: "Lightbulb",
  derivation: "FileText",
  interactive: "Sparkle",
  sim: "Flask",
  summary: "CheckCircle",
  memory_hook: "Brain",
  question: "Question",
};

export function LessonPlayer(props: LessonPlayerProps) {
  const { plan, bundle, config, tz, t, onEvent } = props;
  const theme = useTheme();
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
  const scroll = useRef<ScrollView>(null);
  const viewCard = state.plan?.cards[state.viewIndex] ?? null;
  const card = currentCard(state);
  const readOnly = isReadOnly(state);
  const rules = playerRules(plan.mode);
  const gentle = rules.tone === "gentle";

  const act = (a: LessonAction) => {
    const before = session.state;
    const next = session.dispatch(a);
    setXpGain(next.xp - before.xp);
    if (next.viewIndex !== before.viewIndex || (next.phase === "question" && before.phase !== "question" && before.phase !== "hint")) {
      setDraft(initialDraft(currentCard(next)?.question ?? null));
      setConfidence(null);
      scroll.current?.scrollTo({ y: 0, animated: false });
    }
    if (a.type === "try_again") setDraft(initialDraft(currentCard(next)?.question ?? null));
    if (next.phase === "guided" && before.phase !== "guided") {
      // Option questions start empty (the child taps the shown answer); the rest show the key.
      const nq = currentCard(next)?.question ?? null;
      setDraft(nq && !shownOptionIds(nq) ? shownAnswer(nq) : initialDraft(nq));
    }
    if ((before.phase === "question" || before.phase === "guided") && next.phase === "feedback") props.haptics?.success();
    if (before.phase === "question" && (next.phase === "hint" || next.phase === "explain") && a.type === "submit") props.haptics?.error();
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

  const ctx: PlayerContextValue = { t, bundle, resolveMedia: props.resolveMedia, online: props.online ?? true, subject: props.subject };
  const total = plan.cards.length;
  const cardsLeft = Math.max(0, total - state.index);
  const shownCard = viewCard ?? card;
  const kind = shownCard?.question ? "question" : (shownCard?.card?.type ?? "explainer");
  const guided = state.phase === "guided" && !readOnly;
  // The guided finish marks the key on option questions (the child taps it); on the rest the
  // inputs show the key and [Continue] submits it (lesson-core shownAnswer).
  const shown = guided && card?.question ? shownOptionIds(card.question) : null;
  const guidedKey = guided && card?.question && !shown ? shownAnswer(card.question) : null;
  const solution = guided && card?.question ? workedSolution(card.question) : null;

  return (
    <PlayerProvider value={ctx}>
      <View style={[styles.root, { backgroundColor: theme.colors.bg }]} testID={props.testID ?? "lesson-player"}>
        <View style={styles.header}>
          <IconButton icon="X" label={t("learn:LES-01.close_a11y")} onPress={() => props.onRequestExit(cardsLeft)} testID="lesson-close" />
          <View style={styles.grow}>
            <SegmentedProgress total={total} done={state.index} current={state.viewIndex} label={t("learn:LES-01.counter", { n: state.viewIndex + 1, total })} />
          </View>
          {/* Little learners get the dots alone (LES-01); the bar keeps its label for screen readers. */}
          {rules.counter ? (
            <Text variant="label" tone="muted" numeric testID="lesson-counter">
              {t("learn:LES-01.counter", { n: Math.min(state.viewIndex + 1, total), total })}
            </Text>
          ) : null}
        </View>

        <ScrollView ref={scroll} style={styles.grow} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {state.phase === "confidence" ? (
            <ConfidenceStep topicTitle={bundle.topic.name} onPick={(v) => act({ type: "confidence", value: v })} />
          ) : shownCard ? (
            <Card size="lg" testID={`card-${state.viewIndex}`}>
              <View style={styles.stack}>
                <View style={styles.kindRow}>
                  <Icon name={KIND_ICON[kind] ?? "BookBookmark"} size={16} color="subjectText" />
                  <Text variant="label" tone="subject" subject={props.subject}>
                    {t(sharedKey(`kind_${kind === "cheat_sheet_ref" ? "cheat_sheet" : kind}`))}
                  </Text>
                </View>
                {shownCard.question ? (
                  <QuestionView
                    question={shownCard.question}
                    passage={shownCard.passage}
                    draft={readOnly ? null : draft}
                    onChange={(a) => {
                      props.haptics?.tap();
                      if (shown) act({ type: "submit", answer: a });
                      else setDraft(a);
                    }}
                    result={readOnly || guided ? null : state.lastResult}
                    struck={readOnly ? [] : state.struckOptionIds}
                    disabled={readOnly || (state.phase !== "question" && !shown)}
                    shown={shown ?? undefined}
                  />
                ) : shownCard.card ? (
                  <CardView card={shownCard.card} readOnly={readOnly} pendingTask={state.pendingTask} act={act} renderSim={props.renderSim} />
                ) : null}
                {readOnly ? (
                  <Text variant="caption" tone="muted">
                    {t(sharedKey("read_only_note"))}
                  </Text>
                ) : null}
                {state.phase === "question" && !readOnly && rules.confidenceRow ? (
                  <ConfidenceRow value={toUi(confidence)} onChange={(v) => setConfidence(fromUi(v))} testID="confidence-row" />
                ) : null}
              </View>
            </Card>
          ) : null}

          {state.phase === "feedback" && state.lastResult ? (
            <Card tone="tint" testID="feedback-correct">
              <View style={styles.stackTight}>
                <View style={styles.kindRow}>
                  <Icon name="CheckCircle" size={24} color="success" />
                  <Text variant="heading" tone="success">
                    {gentle ? t("learn:LES-02.little_learner_correct") : state.attempt === 2 ? t("learn:LES-02.second_try") : t("learn:LES-02.correct")}
                  </Text>
                  {rules.xpChip && xpGain > 0 ? <Chip label={t("learn:LES-02.xp", { xp: xpGain })} tone="success" /> : null}
                </View>
                {state.comboNow ? <Text variant="label" tone="streak">{t("learn:LES-02.combo", { n: config.comboStreakLen })}</Text> : null}
              </View>
            </Card>
          ) : null}

          {state.phase === "hint" ? (
            <Card tone="sunken" testID="feedback-hint">
              <View style={styles.stackTight}>
                {gentle ? (
                  // LES-02 little learner: ArrowCounterClockwise on the sunken band, never "Not quite".
                  <View style={styles.kindRow}>
                    <Icon name="ArrowCounterClockwise" size={24} color="primary" />
                    <Text variant="heading">{t("learn:LES-02.little_learner_wrong")}</Text>
                  </View>
                ) : (
                  <View style={styles.kindRow}>
                    <Icon name="Lightbulb" size={24} color="warning" />
                    <Text variant="heading">{t("learn:LES-02.not_quite")}</Text>
                  </View>
                )}
                <Text variant="label" tone="muted">
                  {t("learn:LES-02.hint")}
                </Text>
                {state.hint && state.hint.source !== "generic" ? (
                  <RichText text={state.hint.text} />
                ) : (
                  <Text>{t("learn:LES-02.wrong_pet_line")}</Text>
                )}
              </View>
            </Card>
          ) : null}

          {guided ? (
            <Card tone="sunken" testID="feedback-guided">
              <View style={styles.stackTight} accessibilityLiveRegion="polite">
                <View style={styles.kindRow}>
                  <Icon name="Lightbulb" size={24} color="primary" />
                  <Text variant="heading">{t("learn:LES-02.little_learner_shown_answer")}</Text>
                </View>
                {solution?.feynman ? <RichText text={solution.feynman} /> : null}
              </View>
            </Card>
          ) : null}

          {state.phase === "explain" && card?.question ? <Explain dontKnow={state.outcomes[card.key]?.dontKnow ?? false} question={card.question} /> : null}
        </ScrollView>

        <Footer
          state={state}
          readOnly={readOnly}
          canCheck={canSubmit(shownCard?.question ?? null, draft)}
          rapidSummary={Boolean(plan.rapid && shownCard?.card?.type === "summary" && state.phase === "card" && !readOnly)}
          ratingIntervals={props.ratingIntervals}
          rated={shownCard ? rated[shownCard.key] : undefined}
          onRate={(r) => {
            if (!shownCard) return;
            setRated({ ...rated, [shownCard.key]: RATING[r] });
            act({ type: "rate", rating: RATING[r] });
          }}
          onAction={act}
          guidedKey={guidedKey}
          answer={draft}
          confidence={confidence}
          t={t}
        />
      </View>
    </PlayerProvider>
  );
}

function Footer({
  state,
  readOnly,
  canCheck,
  rapidSummary,
  ratingIntervals,
  rated,
  onRate,
  onAction,
  guidedKey,
  answer,
  confidence,
  t,
}: {
  state: LessonState;
  readOnly: boolean;
  canCheck: boolean;
  rapidSummary: boolean;
  ratingIntervals?: Record<"again" | "hard" | "good" | "easy", string>;
  rated: Rating | undefined;
  onRate: (r: "again" | "hard" | "good" | "easy") => void;
  onAction: (a: LessonAction) => void;
  /** Guided finish on a question without options: [Continue] submits the shown key. */
  guidedKey: Answer | null;
  answer: Answer | null;
  confidence: Confidence | null;
  t: Translate;
}) {
  if (readOnly) {
    return (
      <View style={styles.footerRow}>
        <View style={styles.grow}>
          <Button variant="secondary" label={t(sharedKey("previous_card_a11y"))} icon="CaretLeft" onPress={() => onAction({ type: "back" })} fullWidth />
        </View>
        <View style={styles.grow}>
          <Button label={t(sharedKey("next_card"))} icon="CaretRight" iconPosition="end" onPress={() => onAction({ type: "forward" })} fullWidth testID="lesson-forward" />
        </View>
      </View>
    );
  }
  switch (state.phase) {
    case "card":
      return (
        <View style={styles.footer}>
          {rapidSummary && ratingIntervals ? <RatingButtons intervals={ratingIntervals} onRate={onRate} /> : null}
          {state.pendingTask ? (
            <Text variant="caption" tone="muted" align="center">
              {t(sharedKey("task_first"))}
            </Text>
          ) : null}
          <Button label={t("learn:LES-01.continue")} disabled={state.pendingTask || (rapidSummary && !!ratingIntervals && rated === undefined)} onPress={() => onAction({ type: "next" })} fullWidth testID="lesson-continue" />
        </View>
      );
    case "question":
      return (
        <View style={styles.footer}>
          <Button variant="ghost" label={t("learn:LES-01.don_t_know")} onPress={() => onAction({ type: "dont_know" })} fullWidth testID="lesson-dont-know" />
          <Button
            label={t("learn:LES-01.check")}
            disabled={!canCheck}
            onPress={() => answer && onAction({ type: "submit", answer, confidence })}
            fullWidth
            testID="lesson-check"
          />
        </View>
      );
    case "feedback":
      return (
        <View style={styles.footer}>
          <Button label={t("learn:LES-01.continue")} onPress={() => onAction({ type: "continue" })} fullWidth testID="lesson-continue" />
        </View>
      );
    case "hint":
      return (
        <View style={styles.footer}>
          <Button label={t("learn:LES-02.try_again")} onPress={() => onAction({ type: "try_again" })} fullWidth testID="lesson-try-again" />
        </View>
      );
    case "guided":
      return guidedKey ? (
        <View style={styles.footer}>
          <Button label={t("learn:LES-01.continue")} onPress={() => onAction({ type: "submit", answer: guidedKey })} fullWidth testID="lesson-guided-continue" />
        </View>
      ) : null;
    case "explain":
      return (
        <View style={styles.footer}>
          <Button label={t("learn:LES-02.got_it")} onPress={() => onAction({ type: "continue" })} fullWidth testID="lesson-got-it" />
        </View>
      );
    default:
      return null;
  }
}

function Explain({ question, dontKnow }: { question: AnyQuestion; dontKnow: boolean }) {
  const { t } = usePlayerT();
  const sol = workedSolution(question);
  const section = (n: 1 | 2 | 3 | 4) => t(`learn:LES-02.sections.${n}` as MessageKey);
  return (
    <Card tone="sunken" testID="feedback-explain">
      <View style={styles.stack}>
        <Text variant="heading">{dontKnow ? t("learn:LES-02.don_t_know_head") : t("learn:LES-02.explain_head")}</Text>
        {sol.feynman ? (
          <View style={styles.stackTight}>
            <Text variant="label" tone="muted">
              {section(1)}
            </Text>
            <RichText text={sol.feynman} />
          </View>
        ) : null}
        {sol.steps.length ? (
          <View style={styles.stackTight}>
            <Text variant="label" tone="muted">
              {section(2)}
            </Text>
            {sol.steps.map((s, i) => (
              <RichText key={i} text={`${i + 1}. ${s}`} />
            ))}
          </View>
        ) : null}
        {sol.shortcut ? (
          <View style={styles.stackTight}>
            <Text variant="label" tone="muted">
              {section(3)}
            </Text>
            <RichText text={sol.shortcut} />
          </View>
        ) : null}
        {sol.traps.length ? (
          <View style={styles.stackTight}>
            <Text variant="label" tone="muted">
              {section(4)}
            </Text>
            {sol.traps.map((tr, i) => (
              <RichText key={i} text={tr.why} />
            ))}
          </View>
        ) : null}
        <Text variant="caption" tone="muted">
          {t("learn:LES-02.review_note")}
        </Text>
      </View>
    </Card>
  );
}

/** LES-07: "How sure does {topic} feel?" on a five-point scale, or Skip. */
function ConfidenceStep({ topicTitle, onPick }: { topicTitle: string; onPick: (v: Confidence | null) => void }) {
  const { t } = usePlayerT();
  return (
    <Card size="lg" testID="lesson-confidence">
      <View style={styles.stack}>
        <Text variant="title">{t("learn:LES-07.question", { topic_title: topicTitle })}</Text>
        {SCALE.map((v, i) => (
          <Button key={i} variant="secondary" label={t(`learn:LES-07.scale.${i + 1}` as MessageKey)} onPress={() => onPick(v)} fullWidth testID={`confidence-${i + 1}`} />
        ))}
        <Button variant="ghost" label={t("learn:LES-07.skip")} onPress={() => onPick(null)} fullWidth testID="confidence-skip" />
      </View>
    </Card>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  grow: { flex: 1 },
  scroll: { padding: 16, gap: 16, paddingBottom: 32 },
  stack: { gap: 12 },
  stackTight: { gap: 6 },
  kindRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  footer: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8, gap: 8 },
  footerRow: { flexDirection: "row", paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8, gap: 8 },
});
