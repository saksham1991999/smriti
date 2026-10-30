/**
 * TEST FIXTURE. Placeholder text only, labelled as such: this is not study content and must never
 * ship as a lesson (AGENTS.md rule 1). Real lessons come from content/ through lesson-core.
 */
import type { Lesson, PlayerStrings } from "../src";

export const fixtureLesson: Lesson = {
  topicId: "fixture.topic-1",
  title: "Fixture topic 1",
  subject: "phy",
  bundleVersion: "fixture-1",
  minutes: 2,
  fixture: true,
  cards: [
    { type: "concept", id: "c1", title: "Fixture concept card", body: "Placeholder body text for a concept card." },
    { type: "worked_example", id: "c2", title: "Fixture worked example", steps: ["Placeholder step one.", "Placeholder step two."] },
    {
      type: "mcq",
      id: "c3",
      prompt: "Fixture question: which option is marked correct?",
      options: [
        { id: "a", label: "Fixture option A" },
        { id: "b", label: "Fixture option B (correct)" },
        { id: "c", label: "Fixture option C" },
      ],
      correctId: "b",
      hint: "Placeholder hint.",
      explanation: "Placeholder explanation.",
    },
    { type: "numeric", id: "c4", prompt: "Fixture numeric: type 4.", answer: 4, tolerance: 0.01, unit: "m", hint: "Placeholder hint.", explanation: "Placeholder explanation." },
    { type: "recap", id: "c5", title: "Fixture recap", points: ["Placeholder point one.", "Placeholder point two."] },
  ],
};

export const strings: PlayerStrings = {
  close: "Close lesson",
  counter: (n, total) => `${n} of ${total}`,
  progressLabel: "Lesson progress",
  continue: "Continue",
  check: "Check",
  dontKnow: "I don't know yet",
  correct: "Correct!",
  secondTry: "Correct on the second try!",
  xp: (xp) => `+${xp} XP`,
  why: "Why?",
  notQuite: "Not quite",
  hint: "Hint",
  tryAgain: "Try again",
  explainHead: "Here's how it works",
  reviewNote: "We'll bring this back in your review.",
  gotIt: "Got it",
  dontKnowHead: "No worries. Here's the idea.",
  correctPetLines: ["Nailed it!"],
  wrongPetLine: "Close! Look again.",
  numericLabel: "Your answer",
  unit: (u) => `Unit: ${u}`,
  cardKind: { concept: "Explainer", worked_example: "Worked example", mcq: "Question", numeric: "Question", sim: "Try it", recap: "Recap" },
};
