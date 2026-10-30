import { describe, expect, it } from "vitest";

import {
  type Answer,
  currentCard,
  evaluatePlacement,
  evaluateTestOut,
  type LessonAction,
  type LessonPlan,
  LessonSession,
  type LessonState,
  isReadOnly,
  planCheck,
  planFix,
  planLesson,
  resumePoint,
  selectPlacement,
  selectTestOut,
  simCardFor,
  toughOne,
  uuidv7,
  workedSolution,
} from "../src/index.js";
import { config, EXAM_DEPTH, fixtureBundle, T0, XP } from "./fixture.js";

const A = "fx.chapter-a.topic-a";
const TZ = "Asia/Kolkata";

/** A session on a fake clock that moves 1 s per action. */
function session(cfg = config()) {
  let now = T0;
  let n = 0;
  const s = new LessonSession({
    config: cfg,
    tz: TZ,
    clock: () => (now += 1000),
    newId: () => `id-${++n}`,
  });
  const run = (...actions: LessonAction[]): LessonState => {
    let st = s.state;
    for (const a of actions) st = s.dispatch(a);
    return st;
  };
  return { s, run, types: () => s.emitted.map((e) => e.type) };
}

function deepDive(topic: "a" | "b" | "c" | "d", extra: Partial<Parameters<typeof planLesson>[1]> = {}): LessonPlan {
  const { bundle, hash } = fixtureBundle(topic, "deep_dive");
  return planLesson(bundle, { mode: "deep_dive", bundleVersion: hash, examDepth: EXAM_DEPTH, config: config(), ...extra });
}

const opts = (...ids: string[]): Answer => ({ kind: "options", optionIds: ids });
const SORTED = { type: "widget" as const, response: { widget: "drag_sort" as const, placements: [
  { item: "i1", bin: "b1" },
  { item: "i2", bin: "b2" },
  { item: "i3", bin: "b1" },
] } };

describe("Deep Dive bite", () => {
  it("plays through with events, a hint, the confidence check and XP", () => {
    const plan = deepDive("a");
    const { s, run, types } = session();
    expect(run({ type: "start", plan })).toMatchObject({ phase: "card", index: 0 });
    expect(s.emitted[0]).toMatchObject({
      type: "lesson_started",
      tz: TZ,
      occurred_at: "2026-10-30T10:00:01.000Z",
      payload: { topic_id: A, mode: "deep_dive", bundle_version: plan.bundleVersion, locale: "en" },
    });

    run({ type: "next" }, { type: "next" });
    expect(currentCard(s.state)?.card?.type).toBe("interactive");
    // The drag-sort must be done before moving on.
    expect(run({ type: "next" })).toMatchObject({ blocked: "task", index: 2 });
    expect(run({ type: "widget", response: { widget: "drag_sort", placements: [{ item: "i1", bin: "b1" }] } }).pendingTask).toBe(true);
    expect(run(SORTED).pendingTask).toBe(false);
    expect(run({ type: "next" })).toMatchObject({ phase: "question", index: 3 });
    expect(run({ type: "next" }).blocked).toBe("question");

    // First wrong answer: the trap for the option picked, and the option struck out.
    const hinted = run({ type: "submit", answer: opts("b"), confidence: "sure" });
    expect(hinted).toMatchObject({ phase: "hint", hint: { source: "trap", text: "Fixture trap A1.b" }, struckOptionIds: ["b"], xp: 0 });
    expect(s.emitted.at(-1)).toMatchObject({
      type: "answer_submitted",
      payload: { card_id: `${A}:dd:04`, context: "lesson", response: { option_ids: ["b"] }, correct: false, attempt: 1, confidence: "sure", ms_to_answer: 2000 },
    });
    expect("question_id" in s.emitted.at(-1)!.payload).toBe(false);

    run({ type: "try_again" });
    expect(run({ type: "submit", answer: opts("c") })).toMatchObject({ phase: "feedback", xp: XP.secondTry, attempt: 2 });
    expect(run({ type: "continue" })).toMatchObject({ phase: "card", index: 4 });
    expect(run({ type: "next" }).phase).toBe("confidence");
    const done = run({ type: "confidence", value: "fifty_fifty" });

    expect(done.phase).toBe("complete");
    expect(done.topicConfidence).toBe("fifty_fifty");
    expect(done.summary).toMatchObject({ xp: XP.secondTry + XP.complete, correct: 1, total: 1, accuracy: 1, cardsSeen: 5, comboReached: false });
    expect(done.summary!.missed.map((m) => m.questionId)).toEqual(["q.fx.chapter-a.topic-a.0001"]);
    expect(done.reviewQueue).toEqual([]);
    expect(types()).toEqual([
      "lesson_started",
      "lesson_card_viewed",
      "lesson_card_viewed",
      "lesson_card_viewed",
      "answer_submitted",
      "answer_submitted",
      "lesson_card_viewed",
      "lesson_card_viewed",
      "lesson_completed",
    ]);
    expect(s.emitted.at(-1)!.payload).toMatchObject({ topic_id: A, mode: "deep_dive", cards_seen: 5, correct: 1, total: 1, xp: 25 });
    expect(new Set(s.emitted.map((e) => e.event_id)).size).toBe(s.emitted.length);
    // Nothing happens after the end.
    expect(run({ type: "next" })).toBe(s.state);
  });

  it("shows the worked solution and queues a review after the second wrong answer", () => {
    const { run } = session();
    run({ type: "start", plan: deepDive("a"), resumeIndex: 3 });
    const first = run({ type: "submit", answer: opts("a") });
    expect(first.hint).toEqual({ source: "hint", text: "Fixture hint A1" });
    run({ type: "try_again" });
    const st = run({ type: "submit", answer: opts("d") });
    expect(st).toMatchObject({ phase: "explain", xp: XP.attempt, streak: 0, struckOptionIds: ["a"] });
    expect(st.reviewQueue).toEqual([{ cardRef: `c:${A}:dd:04`, questionId: "q.fx.chapter-a.topic-a.0001", concepts: [`${A}.sub-1.concept-1`], reason: "wrong_twice" }]);
    expect(st.outcomes[`${A}:dd:04`]).toMatchObject({ correct: false, attempts: 2, firstTry: false });
    expect(workedSolution(currentCard(st)!.question!)).toMatchObject({ feynman: "Fixture explanation A1", steps: ["Fixture step A1.1"] });
    expect(run({ type: "continue" })).toMatchObject({ phase: "card", index: 4 });
  });

  it("treats I don't know yet as a miss with no response", () => {
    const { s, run } = session();
    run({ type: "start", plan: deepDive("a"), resumeIndex: 3 });
    const st = run({ type: "dont_know" });
    expect(st.phase).toBe("explain");
    expect(st.reviewQueue[0]!.reason).toBe("dont_know");
    expect(s.emitted.at(-1)!.payload).toMatchObject({ response: null, correct: false, attempt: 1, confidence: null });
  });

  it("fires the combo once after five first-try answers in a row", () => {
    const { run } = session();
    run({ type: "start", plan: deepDive("d") }, { type: "next" }, { type: "next" });
    const answers: Answer[] = [
      opts("b"),
      { kind: "number", value: "1500" },
      { kind: "matrix", rows: [{ row: "p", columns: ["one", "three"] }, { row: "q", columns: ["two"] }] },
      { kind: "blanks", blanks: [{ blank: "b1", choiceId: "c2" }, { blank: "b2", text: "fixtures" }] },
      { kind: "number", value: "-3" },
      { kind: "pairs", pairs: [{ left: "p", right: "two" }, { left: "q", right: "one" }] },
    ];
    const combos: boolean[] = [];
    let st: LessonState = run();
    for (const answer of answers) {
      st = run({ type: "submit", answer });
      expect(st.phase, `${currentCard(st)?.key}`).toBe("feedback");
      combos.push(st.comboNow);
      st = run({ type: "continue" });
    }
    expect(combos).toEqual([false, false, false, false, true, false]);
    expect(st.xp).toBe(6 * XP.firstTry + XP.combo);
    expect(st.streak).toBe(6);
    const done = run({ type: "next" }, { type: "next" }, { type: "confidence", value: "sure" });
    expect(done.summary).toMatchObject({ correct: 6, total: 6, comboReached: true });
  });

  it("identifies paragraph children by question id in events", () => {
    const { s, run } = session();
    run({ type: "start", plan: deepDive("d"), resumeIndex: 2 }, { type: "submit", answer: opts("b") });
    const payload = s.emitted.at(-1)!.payload;
    expect(payload).toMatchObject({ question_id: "q.fx.chapter-a.topic-d.0002", topic_id: "fx.chapter-a.topic-d" });
    expect("card_id" in payload).toBe(false);
  });
});

describe("cards with tasks and online-only cards", () => {
  it("lets a sim task, or skipping it, unblock the card; tap reveal never blocks", () => {
    const plan = deepDive("b", { biteId: "bite-2" });
    const { run } = session();
    run({ type: "start", plan }, { type: "next" });
    expect(currentCard(run())?.card?.type).toBe("sim");
    expect(run({ type: "next" }).blocked).toBe("task");
    expect(run({ type: "sim_task", taskId: "task-1", correct: true }).pendingTask).toBe(false);
    const tap = run({ type: "next" });
    expect(tap).toMatchObject({ pendingTask: false, index: 2 });

    const other = session();
    other.run({ type: "start", plan, resumeIndex: 1 });
    const skipped = other.run({ type: "skip_task" });
    expect(skipped.pendingTask).toBe(false);
    expect(skipped.outcomes[plan.cards[1]!.key]).toMatchObject({ skipped: true, correct: null });

    const q = plan.cards.find((c) => c.question && c.concepts.includes("fx.chapter-a.topic-b.sub-1.concept-1"))!;
    expect(simCardFor(plan.cards, q)?.card?.type).toBe("sim");
  });

  it("skips a video offline without counting a miss", () => {
    const plan = deepDive("c", { biteId: "bite-2" });
    const { s, run } = session();
    run({ type: "start", plan }, { type: "next" });
    expect(currentCard(s.state)?.card?.type).toBe("video");
    expect(run({ type: "skip_online" })).toMatchObject({ phase: "question", index: 2 });
    expect(s.state.outcomes[plan.cards[1]!.key]).toMatchObject({ skipped: true });
    // Not a video: nothing to skip.
    expect(run({ type: "skip_online" }).index).toBe(2);
  });
});

describe("navigation", () => {
  it("resumes at the saved card, and earlier cards are read-only", () => {
    const { run } = session();
    run({ type: "start", plan: deepDive("a"), resumeIndex: 3 });
    const back = run({ type: "back" });
    expect(back).toMatchObject({ index: 3, viewIndex: 2 });
    expect(isReadOnly(back)).toBe(true);
    expect(run({ type: "submit", answer: opts("c") }).outcomes).toEqual({});
    expect(run({ type: "widget", response: SORTED.response }).outcomes).toEqual({});
    expect(run({ type: "next" })).toMatchObject({ index: 3, viewIndex: 3, phase: "question" });
    expect(run({ type: "back" }, { type: "back" }, { type: "forward" })).toMatchObject({ viewIndex: 2 });
  });

  it("stops a Pro-locked Deep Dive at the preview end", () => {
    const plan = deepDive("a", { previewLimited: true });
    const { run } = session();
    run({ type: "start", plan }, { type: "next" }, { type: "next" }, SORTED, { type: "next" }, { type: "submit", answer: opts("c") });
    expect(run({ type: "continue" })).toMatchObject({ phase: "preview_end", index: 3 });

    const locked = session();
    expect(locked.run({ type: "start", plan: deepDive("a", { previewLimited: true, biteId: "bite-2" }) }).phase).toBe("preview_end");
    // A saved position past the preview is pulled back inside it.
    expect(session().run({ type: "start", plan, resumeIndex: 4 }).index).toBe(3);
  });

  it("opens and closes the tutor and Make it stick, but no tutor in onboarding", () => {
    const { run } = session();
    run({ type: "start", plan: deepDive("a"), resumeIndex: 3 });
    expect(run({ type: "open_overlay", overlay: "tutor" }).phase).toBe("tutor");
    expect(run({ type: "next" }).phase).toBe("tutor");
    expect(run({ type: "close_overlay" }).phase).toBe("question");

    const { bundle, hash } = fixtureBundle("a", "deep_dive");
    const onboarding = session();
    onboarding.run({ type: "start", plan: planLesson(bundle, { mode: "onboarding", bundleVersion: hash, examDepth: EXAM_DEPTH, config: config() }) });
    expect(onboarding.run({ type: "open_overlay", overlay: "tutor" }).phase).toBe("card");
    expect(onboarding.run({ type: "open_overlay", overlay: "make_it_stick" }).phase).toBe("make_it_stick");
  });

  it("waits for the network when the bundle is not on the device, and saves on exit", () => {
    const { s, run } = session();
    expect(run({ type: "offline" }).phase).toBe("needs_net");
    const again = session();
    again.run({ type: "start", plan: deepDive("a") }, { type: "next" });
    expect(again.run({ type: "exit" }).phase).toBe("exited");
    expect(again.s.progress()).toEqual({ lastCardIndex: 1, biteId: "bite-1", bundleVersion: again.s.state.plan!.bundleVersion });
    expect(s.emitted).toEqual([]);
  });

  it("onboarding ends without the confidence check", () => {
    const { bundle, hash } = fixtureBundle("d", "deep_dive");
    const plan = planLesson(bundle, { mode: "onboarding", bundleVersion: hash, examDepth: EXAM_DEPTH, config: config() });
    const { run, s } = session();
    run({ type: "start", plan }, { type: "next" }, { type: "next" });
    while (s.state.phase === "question") run({ type: "dont_know" }, { type: "continue" });
    run({ type: "next" });
    expect(run({ type: "next" }).phase).toBe("complete");
    expect(s.emitted.at(-1)!.payload).toMatchObject({ mode: "onboarding" });
  });
});

describe("Quick Revision", () => {
  it("rates questions by result and lets the student rate summaries", () => {
    const { bundle, hash } = fixtureBundle("a", "quick_revision");
    const plan = planLesson(bundle, { mode: "quick_revision", bundleVersion: hash, examDepth: EXAM_DEPTH, config: config() });
    const { run } = session();
    run({ type: "start", plan });
    // Rating only applies to summary cards.
    expect(run({ type: "rate", rating: 4 }).ratings).toEqual([]);
    run({ type: "next" }, { type: "submit", answer: opts("a") }, { type: "continue" });
    expect(currentCard(run())?.card?.type).toBe("summary");
    expect(run({ type: "rate", rating: 1 }).reviewQueue).toHaveLength(1);
    const st = run({ type: "rate", rating: 3 });
    expect(st.ratings).toEqual([
      { cardRef: `c:${A}:qr:02`, rating: 3 },
      { cardRef: `c:${A}:qr:03`, rating: 3 },
    ]);
    expect(st.reviewQueue).toEqual([{ cardRef: `c:${A}:qr:03`, questionId: null, concepts: plan.cards[2]!.concepts, reason: "rated_again" }]);
    expect(run({ type: "next" }, { type: "next" }).phase).toBe("confidence");
  });
});

describe("checks", () => {
  const practiceA = fixtureBundle("a", "practice");

  it("Test out: one try, the explanation after every answer, nothing queued", () => {
    const qs = selectTestOut([practiceA.bundle], 3);
    const plan = planCheck(qs, { scopeId: A, bundleVersion: practiceA.hash, locale: "en" });
    const { s, run } = session();
    run({ type: "start", plan });
    expect(run({ type: "submit", answer: opts("c"), confidence: "sure" }).phase).toBe("explain");
    run({ type: "continue" });
    const wrong = run({ type: "submit", answer: { kind: "number", value: "9" }, confidence: "sure" });
    expect(wrong).toMatchObject({ phase: "explain", hint: null, reviewQueue: [] });
    run({ type: "continue" });
    expect(evaluateTestOut(s.state)).toMatchObject({ unfinished: true, passed: [] });
    const done = run({ type: "submit", answer: opts("a"), confidence: "sure" }, { type: "continue" });
    expect(done.phase).toBe("complete");
    expect(evaluateTestOut(done)).toEqual({ kind: "test_out", passed: [], worthALesson: [A], unfinished: false });
    expect(s.emitted[0]!.payload).toMatchObject({ mode: "quick_check", topic_id: A });
    expect(s.emitted.filter((e) => e.type === "answer_submitted").every((e) => "question_id" in e.payload)).toBe(true);
  });

  it("Test out passes a topic only when every answer is right first time and not a guess", () => {
    const plan = planCheck(selectTestOut([practiceA.bundle], 1), { scopeId: A, bundleVersion: "v", locale: "en" });
    const sure = session();
    sure.run({ type: "start", plan }, { type: "submit", answer: opts("c"), confidence: "sure" }, { type: "continue" });
    expect(evaluateTestOut(sure.s.state).passed).toEqual([A]);
    const guess = session();
    guess.run({ type: "start", plan }, { type: "submit", answer: opts("c"), confidence: "guess" }, { type: "continue" });
    expect(evaluateTestOut(guess.s.state).worthALesson).toEqual([A]);
  });

  it("Find my level pre-marks chapters answered right and sure, and suggests where to start", () => {
    const qs = selectPlacement([practiceA.bundle], 5);
    const plan = planCheck(qs, { scopeId: "fx", bundleVersion: "v", locale: "en" });
    const first = (ch: string) => (ch === "fx.chapter-a" ? A : null);
    const right = session();
    right.run({ type: "start", plan }, { type: "submit", answer: { kind: "number", value: "7" }, confidence: "sure" }, { type: "continue" });
    expect(evaluatePlacement(right.s.state, first)).toEqual({ kind: "placement", premarkTopics: [A], suggestedChapter: null, unfinished: false });
    const unsure = session();
    unsure.run({ type: "start", plan }, { type: "submit", answer: { kind: "number", value: "7" }, confidence: "fifty_fifty" }, { type: "continue" });
    expect(evaluatePlacement(unsure.s.state, first)).toMatchObject({ premarkTopics: [], suggestedChapter: "fx.chapter-a" });
  });

  it("Fix mistakes sends answers but no lesson events", () => {
    const pool = practiceA.bundle.questions;
    const plan = planFix(
      [{ questionId: "q.fx.chapter-a.topic-a.0001", concepts: [`${A}.sub-1.concept-1`], topicId: A, chapterId: "fx.chapter-a" }],
      pool,
      [],
      { topicId: A, bundleVersion: practiceA.hash, locale: "en", config: config() },
    );
    const { run, types } = session();
    run({ type: "start", plan }, { type: "submit", answer: opts("a") }, { type: "continue" });
    expect(run().phase).toBe("complete");
    expect(types()).toEqual(["answer_submitted"]);
  });
});

describe("Hindi", () => {
  it("plays the Hindi bundle with the same cards, keys and Hindi help text", () => {
    const hi = fixtureBundle("a", "deep_dive", "hi");
    const plan = planLesson(hi.bundle, { mode: "deep_dive", bundleVersion: hi.hash, examDepth: EXAM_DEPTH, config: config() });
    expect(plan.locale).toBe("hi");
    expect(plan.cards.map((c) => c.key)).toEqual(deepDive("a").cards.map((c) => c.key));
    const { s, run } = session();
    run({ type: "start", plan, resumeIndex: 3 });
    expect(run({ type: "submit", answer: opts("b") }).hint).toEqual({ source: "trap", text: "फ़िक्स्चर आम गलती A1.b" });
    expect(s.emitted[0]!.payload).toMatchObject({ locale: "hi", bundle_version: hi.hash });
    run({ type: "try_again" });
    expect(run({ type: "submit", answer: opts("c") }).phase).toBe("feedback");
  });
});

describe("help, resume and ids", () => {
  it("marks PYQs and hard questions as a tough one", () => {
    const { bundle } = fixtureBundle("a", "practice");
    const pyq = bundle.questions["q.fx.chapter-a.topic-a.0005"]!;
    const chip = toughOne(pyq, bundle);
    expect(chip?.kind === "pyq" || chip?.kind === "hard").toBe(true);
    expect(toughOne(bundle.questions["q.fx.chapter-a.topic-a.0003"]!, bundle)).toBeNull();
  });

  it("offers the resume sheet when the bundle changed or the save is old", () => {
    const cfg = config({ resumeRestartDays: 14 });
    const day = 86_400_000;
    expect(resumePoint(null, { bundleVersion: "h1", cardCount: 5, now: T0 }, cfg)).toEqual({ index: 0, showSheet: false, bundleChanged: false });
    expect(resumePoint({ lastCardIndex: 3, bundleVersion: "h1", savedAt: T0 }, { bundleVersion: "h1", cardCount: 5, now: T0 + day }, cfg)).toEqual({
      index: 3,
      showSheet: false,
      bundleChanged: false,
    });
    expect(resumePoint({ lastCardIndex: 9, bundleVersion: "h1", savedAt: T0 }, { bundleVersion: "h2", cardCount: 5, now: T0 }, cfg)).toEqual({
      index: 4,
      showSheet: true,
      bundleChanged: true,
    });
    expect(resumePoint({ lastCardIndex: 1, bundleVersion: "h1", savedAt: T0 }, { bundleVersion: "h1", cardCount: 5, now: T0 + 15 * day }, cfg).showSheet).toBe(true);
    expect(resumePoint({ lastCardIndex: 1, bundleVersion: "h1", savedAt: T0 }, { bundleVersion: "h1", cardCount: 5, now: T0 + 99 * day }, config()).showSheet).toBe(false);
  });

  it("makes time-ordered UUIDv7 event ids", () => {
    const zero = (n: number) => new Uint8Array(n);
    const id = uuidv7(T0, zero);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.replace(/-/g, "").slice(0, 12)).toBe(T0.toString(16).padStart(12, "0"));
    expect(uuidv7(T0 + 1, zero) > id).toBe(true);
    expect(uuidv7(T0)).not.toBe(uuidv7(T0));
  });
});
