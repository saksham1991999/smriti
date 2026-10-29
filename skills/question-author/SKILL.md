---
name: question-author
description: Write Smriti practice and mock questions with answers, Feynman-style solutions, shortcuts and common traps, in English and Hindi, tagged to concepts, depth and exam style. Use for every topic after its concepts exist, and to fill coverage gaps found by content-qa.
---

# question-author

Writes `content/questions/{subject}/{chapter}/{topic}.json`. Read `skills/_shared/content-format.md` §8 and `skills/_shared/quality-bar.md` first.

## Inputs

- The topic ID and its concepts with key points and depths.
- The exam maps that use them, and those exams' blueprints (question types and marking).
- Existing questions for the topic, to avoid duplicates.
- PYQs linked to these concepts by `pyq-ingest`, to match the real style. Never copy a PYQ as an "original".

## How many

For each concept, at each depth the exam maps need:
- at least **3 practice questions** (easy, medium, hard by your estimate),
- at least **1 lesson check question** (used inside the Deep Dive),
- for exam profiles with mocks, enough additional `mock`-use questions to fill sectional and full mocks without repeating practice items. The mock planner in `content-qa` reports the shortfall.

## Writing a question

1. Pick the type the exam actually uses (from its blueprint): JEE `mcq_single` and `numerical`, NEET `mcq_single`, UPSC `statement_based` and `assertion_reason`, SSC `mcq_single`, JEE Advanced also `mcq_multi`, `match_list` and `paragraph`.
2. Test one concept clearly. A multi-concept question lists every concept with a weight.
3. Make distractors from **real mistakes**: sign errors, unit slips, a common misconception, a confusable term. Record each one in `common_traps` with why it's tempting.
4. Write the solution:
   - `feynman`: the idea in plain words, as if explaining to a friend.
   - `steps`: the formal working with LaTeX.
   - `shortcut`: only if it's reliable, with when it fails.
5. Set `ideal_time_s` from the exam's pace (paper duration divided by questions, adjusted for difficulty).
6. Write both languages. Numbers, units and options are identical in both.

## Rules

- Each question has exactly one defensible answer (or the exact set for multi-correct), checked by working it out fully.
- For numerical answers, give the value and the tolerance the exam uses.
- No trick wording, no "all of the above" unless the exam uses it.
- UPSC statement-based questions follow the official style ("Which of the statements given above is/are correct?").
- Images in questions are media requests with label anchors. Never put the answer in alt text.

## Checklist

- [ ] Every concept at every needed depth has its minimum count.
- [ ] Every answer was re-derived independently before saving.
- [ ] Every distractor has a `common_traps` entry.
- [ ] No duplicates of existing questions or PYQs.
- [ ] Types and marking match the exam's blueprint.
- [ ] Both languages present. `pnpm content:check` passes.
