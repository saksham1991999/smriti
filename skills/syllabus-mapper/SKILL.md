---
name: syllabus-mapper
description: Turn an official exam syllabus or school curriculum into Smriti's concept graph, exam map and coverage inventory. Use before any lesson or question work for a new exam, subject, chapter or syllabus revision.
---

# syllabus-mapper

Builds the skeleton every other content skill fills: the concept graph (`content/graph/`), the exam map (`content/exam-maps/`) and the coverage inventory (`content/coverage/`). Read `skills/_shared/content-format.md` §2, §5, §6 and `skills/_shared/quality-bar.md` §1 first.

## Inputs

- The exam profile ID (for example `jee-main-2027`, `cbse-11-2027`), and the subject.
- The **official** syllabus document: the exam body's notification or information bulletin, or the board's curriculum. Get the URL from the exam body's own site. Do not use a coaching site's copy.
- The reference books for the inventory: NCERT for classes 1–12, NEET and JEE Main; the official syllabus plus standard references for UPSC and SSC.
- The existing graph, if the subject already exists for another exam.

## Steps

1. **Fetch and record the source.** Save the syllabus URL and retrieval date in `sources[]`. Note the cycle it applies to.
2. **Split the syllabus into lines.** Give each line a stable reference: `{exam_profile}:{subject}:{unit}:{item}`.
3. **Reuse before creating.** For each line, search the existing graph for matching concepts (by name, aliases and summaries). The same concept must not exist twice. Add the new exam to the existing concept instead.
4. **Create the missing structure.** Unit → chapter → topic → subtopic → concept, following NCERT chapter boundaries where they exist. A concept is the smallest idea that can be taught and tested on its own.
5. **Write each concept:** `name`, `kind`, `intrinsic_depth`, a 1–3 sentence `summary` in both languages, `key_points` (specific and checkable), `prerequisites`, `syllabus_refs`.
6. **Build the inventory.** Walk the reference book section by section and list every definition, law, formula, constant, named reaction, date, list, diagram, solved example and exercise type. Map each one to a concept. Anything that maps to nothing either becomes a new concept or is marked `out_of_syllabus` with the reason.
7. **Write the exam map.** For each concept used by the exam: `depth` (the deepest level the exam asks), `priority` (`core` by default, `optional` only when the syllabus marks it so). Leave `weightage` and `pyq_count` as `null`. `pyq-ingest` fills them.
8. **Write the coverage file** with every syllabus line, its concepts, and every inventory item with its concept or its exclusion reason.
9. **Self-check** with the checklist below, then open a pull request titled `graph: {exam_profile} {subject}`.

## Depth levels

| Level | Meaning | Typical exams |
|---|---|---|
| L1 | Basic school level | Class 1–8, SSC GK basics |
| L2 | Board-exam level | Class 9–12 boards |
| L3 | Competitive basics | NEET, JEE Main (easy and medium), SSC, UPSC Prelims |
| L4 | Advanced | JEE Main (hard), NEET toppers, UPSC deeper |
| L5 | Elite | JEE Advanced, Olympiad |

Set `intrinsic_depth` to the lowest level at which the concept can be taught, and the exam map `depth` to the highest level the exam needs.

## Rules

- Never invent syllabus items or weightages.
- One concept, one ID, forever. To split a concept, create the new IDs and keep the old one as an alias.
- School classes are exam profiles too, so class 11 and JEE share concepts.
- Both languages for every name, summary and key point.

## Checklist

- [ ] Every syllabus line has at least one concept.
- [ ] Every inventory item maps to a concept or has an exclusion reason.
- [ ] No duplicate concepts (search by name and summary across subjects).
- [ ] Every concept has `key_points`, `kind`, `intrinsic_depth`, prerequisites that exist, and both languages.
- [ ] `weightage` and `pyq_count` are `null` unless computed by `pyq-ingest`.
- [ ] `pnpm content:check` passes.
