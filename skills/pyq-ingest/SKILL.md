---
name: pyq-ingest
description: Structure previous-year exam papers (PYQs) into Smriti's question format, link every question to concepts, record official answers and sources, and compute real weightage and PYQ counts for exam maps. Use when adding a past paper or refreshing exam weightages.
---

# pyq-ingest

Writes `content/pyq/{exam_id}/{paper_id}.json`, the questions themselves into `content/questions/`, and updates `weightage` and `pyq_count` in `content/exam-maps/`. Read `skills/_shared/content-format.md` §8–9.

## Inputs

- The paper from the **official source** (NTA, UPSC and SSC publish papers and answer keys), with its URL.
- The official final answer key (after challenges), where one is published.
- The concept graph for the exam's subjects.

## Steps

1. **Record the paper:** exam, year, session, date, source URL, retrieval date, and a `rights_note` describing what the source allows.
2. **Transcribe each question** exactly: the stem, the options, any figure (as a media request to recreate it, never a scan), in the languages the paper was set in. Use LaTeX for maths and chemistry.
3. **Answer:** take the official final key. If a question was dropped or had its answer changed, record that (`answer_challenged`, `dropped`).
4. **Solve it yourself** and write our own Feynman-style solution, steps, shortcut and traps, following `question-author`. If your answer disagrees with the official key, flag it for a person. Never silently change the official answer.
5. **Link concepts** with weights. Use the most specific concepts. If none fits, report a gap to `syllabus-mapper` rather than forcing a match.
6. **Compute exam-map stats** across all ingested papers for the exam: `pyq_count` per concept, and `weightage` as the share of marks over the last N papers (store N and the papers used in the exam map's metadata).

## Rules

- Only official sources. Never ingest from coaching PDFs or memory-based "recollections".
- Keep the original question wording. Our solutions are our own words.
- Weightage is always computed, never estimated. Record exactly which papers it's based on.

## Checklist

- [ ] Every question in the paper is present, numbered as in the original.
- [ ] Official answers recorded, including dropped and changed ones.
- [ ] Every question links to at least one concept.
- [ ] Our solutions agree with the official key, or the disagreement is flagged.
- [ ] Exam-map stats recomputed and the basis recorded.
