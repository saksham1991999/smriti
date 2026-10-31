---
name: content-qa
description: Check Smriti content before review - schema, coverage against the syllabus inventory, factual accuracy against sources, answer correctness, English-Hindi parity, depth tags, mnemonics, media and alt text, accessibility, safety and licences - and write the coverage report. Use on every content pull request and before any exam or subject is published.
---

# content-qa

The gate between agent-written content and students. It finds problems and reports them. It does **not** approve its own work: a person reviews every pull request after this skill passes. Read `skills/_shared/quality-bar.md` and `skills/_shared/content-format.md` first.

## Inputs

- The changed files in `content/` (or a whole subject or exam profile for a release check).
- The graph, exam maps, inventory, blueprints and sources they rely on.

## Checks

Run all of them. Each finding has a severity: **blocker** (must fix before merge), **major** (fix before publish), **minor** (fix when convenient).

| # | Check | Blocker when |
|---|---|---|
| 1 | **Schema:** `pnpm content:check` passes | Any failure |
| 2 | **Coverage:** every syllabus line → concept, every inventory item → concept, every exam-map concept has a teaching card, a revision card, practice questions at depth, a spaced-repetition card, worked examples for formulas, hooks for lists and dates. Little learner profiles need a teaching item (card, storybook or song) and a play activity instead | Any gap in a subject or chapter released in `content/releases.json` |
| 3 | **Facts:** every number, date, constant, unit, name and definition matches a cited source. Open the source, don't recall. | Any mismatch |
| 4 | **Answers:** re-solve every question independently. Check the options, the tolerance and the solution steps. | Any wrong or ambiguous answer |
| 5 | **Parity:** the English and Hindi versions say the same thing, with the same numbers, options and order. Hindi terms follow NCERT. | Different facts or numbers |
| 6 | **Depth:** card and question depth tags fit each exam that uses them | A card above an exam's depth is not tagged |
| 7 | **Mnemonics:** `decodes_to` matches the facts exactly and in order | Any mismatch |
| 8 | **Media:** every reference resolves to a request; every request is `approved` before publish; diagrams are correct; no text inside images | A wrong diagram |
| 9 | **Accessibility:** alt text in both languages (or marked decorative), transcripts for audio and animation, captions for video | Missing alt text on a teaching image |
| 10 | **Safety and tone:** age-appropriate, balanced history and polity, home-safe experiments, humour not at anyone's expense. Little learner songs and play use no negative feedback words (`little_negative_word`) and every play round can be won | Any unsafe experiment or offensive content |
| 11 | **Licences:** every third-party asset has a commercial-use licence and attribution | NC, ND or unknown licence |
| 12 | **No invented stats:** no "asked N times", "high-yield", ranks or percentages unless computed and recorded | Any invented statistic |
| 13 | **Blueprints:** question counts and marks add up; every type has a marking rule; the source is the official notification | Any mismatch |

## Outputs

- `content/coverage/{exam_profile_id}.json`: the coverage numbers per subject, chapter and concept (machine-readable, read by the coverage dashboard).
- A QA report in the pull request: a table of findings with file, card or question ID, check number, severity, the problem and the suggested fix.
- For a release check, a one-line verdict per subject: ready or not ready, with the blocker count.

## Rules

- Be specific: "q.….0007, option c: 9.8 should be 9.81 m/s² per source NCERT 11 Ch 9", not "check the numbers".
- When unsure whether something is right, it's a finding. Say what you checked.
- Never edit the content to make it pass. Report, and let the authoring skill fix it, so the fix is reviewed too.
