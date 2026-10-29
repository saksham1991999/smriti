# Quality bar for all content

Every content skill follows these rules. `content-qa` checks them, and a person reviews before anything is published.

## 1. Completeness: nothing is missed

The owner's requirement is that no fact, formula, shortcut or example in the syllabus is left out. That is enforced with data, not good intentions:

1. `syllabus-mapper` splits every official syllabus line into concepts and records the line in each concept's `syllabus_refs`. No syllabus line may be left without a concept.
2. It also lists, per chapter, every item from the reference sources (NCERT for school and NEET, the official syllabus and standard references for the others): each definition, law, formula, constant, named reaction, date, list, diagram, solved example and exercise type. That list is the chapter's **inventory**, stored in `coverage/`.
3. Every inventory item must map to at least one concept, and every concept in an exam map must have:
   - at least one teaching card in a Deep Dive,
   - at least one card in Quick Revision,
   - at least one practice question at the exam's depth,
   - at least one spaced-repetition card (summary points and key points become cards),
   - for formulas: the formula card, its symbols and units, and at least one worked example,
   - for lists and dates: a memory hook.
4. `content-qa` produces `coverage/{exam_profile_id}.json`. A subject ships only at 100%.

## 2. Accuracy

- Every fact traces to a source in `sources[]` that a reviewer can open. Prefer NCERT, official notifications, OpenStax and standard references.
- Numbers, constants, dates and units are checked against the source, not recalled.
- Exam patterns come only from the latest official notification (`exam-blueprint`).
- When sources disagree (for example, different textbooks giving different dates), say so on the card and follow the source the exam body uses.
- Never write "asked in N years", "high-yield", ranks, percentiles or any statistic unless it was computed from real data by a skill that records how.

## 3. Teaching

- Follow the subject's teaching style (PRD §5.3) and the Deep Dive arc: hook → intuition → visual → interaction → derivation or worked example → check → memory hook → summary.
- Ask before telling when a retrieval question helps.
- One idea per card. Body text is at most 3 short paragraphs.
- Pair words with a visual on every explainer (dual coding). Request visuals; never describe one without requesting it.
- Every solution starts with a plain-language (Feynman-style) explanation.
- Include the shortcut where a real, reliable one exists, and say when it fails.
- Tag every card with a `depth`, so one lesson serves several exams.

## 4. Language

- Write in plain English and standard Hindi. Short sentences, "you" form.
- Hindi follows NCERT Hindi-medium terminology. On first use, give the English term in brackets.
- Both locales are written for the reader, not translated word by word. The facts and the card order must match.
- No text inside images. Labels go in `label_anchors`.

## 5. Safety and respect

- Age-appropriate for the age band of the exam (class 1–5 content is gentle and simple).
- History and polity are balanced and factual. Role-play characters stay in their documented views and never endorse hatred. Sensitive topics (partition, communal violence, caste) follow the NCERT framing.
- Experiments are home-safe and marked with adult supervision where needed. No flames, strong acids or electricity from the mains in home experiments.
- No brand names, no real people's photos, no copyrighted text beyond short quotes with citations.
- Humour and parody punch at ideas, never at groups of people.

## 6. Licences

- Only use third-party material whose licence allows commercial use. Record `licence` and `attribution`.
- PYQ papers: record the official source URL. Rewrite solutions in our own words.
- Never copy text from coaching material or paid books.
