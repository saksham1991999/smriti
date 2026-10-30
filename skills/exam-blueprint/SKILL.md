---
name: exam-blueprint
description: Encode an exam's official pattern (papers, sections, timers, question types, marking, languages, interface rules) as a versioned blueprint JSON that drives Smriti's mock engine. Use for a new exam, a new exam cycle, or whenever an official notification changes the pattern.
---

# exam-blueprint

The mock engine has no exam-specific code. Everything that makes a JEE mock feel like JEE, or an SSC mock like SSC, comes from the blueprint this skill writes (TRD §7.4, DB_SCHEMA `content.exam_blueprints`).

## Inputs

- The exam profile (for example `neet-ug-2027`).
- The **latest official notification or information bulletin** from the exam body (NTA, UPSC, SSC, the state commission). Nothing else counts as a source for the pattern.
- The previous blueprint version, if any.

## Output

`content/blueprints/{exam_profile_id}/{paper_code}.v{n}.json`. Never edit a published version: a change is a new version with a new `effective_from`.

```json
{
  "schema": "blueprint@1",
  "exam_profile": "…",
  "paper_code": "…",
  "version": 1,
  "effective_from": "YYYY-MM-DD",
  "source": { "url": "…", "title": "…", "published": "YYYY-MM-DD", "retrieved": "YYYY-MM-DD", "pages": "…", "linked_from": "…" },
  "mode": "cbt | pen_paper | mixed",
  "duration_min": 0,
  "languages": ["en", "hi"],
  "interface": "nta | nta_omr | upsc_omr | ssc_tcs | generic",
  "calculator": "none | basic | scientific | null",
  "section_navigation": "free | locked_in_order | free_within_timer | null",
  "numeric_input": "virtual_keypad | keyboard | null",
  "question_count": 0,
  "sections": [
    {
      "code": "…",
      "title": { "en": "…", "hi": "…" },
      "subject": "phy",
      "timer_min": null,
      "question_count": 0,
      "attempt_rule": { "attempt_any": null },
      "question_types": ["mcq_single"],
      "marking": {
        "mcq_single": { "correct": 0, "wrong": 0, "unattempted": 0 },
        "numerical": { "correct": 0, "wrong": 0, "unattempted": 0, "tolerance": "as_notified" }
      }
    }
  ],
  "qualifying": { "rule": null },
  "instructions": { "en": "…", "hi": "…" },
  "hi_source": "official | translation",
  "open_questions": [
    { "field": "calculator", "question": "The notice does not say whether a calculator is allowed.", "checked": "YYYY-MM-DD" }
  ],
  "notes": "How ambiguous wording was read, with page references"
}
```

`packages/content-schema/schemas/blueprint.schema.json` is the full contract; this is an outline. Values to know:

| Field | Value | Use it when |
|---|---|---|
| `mode` | `mixed` | Parts of the paper are taken in different modes. Each section then sets its own `mode` (`cbt` or `pen_paper`). |
| `interface` | `nta_omr` | An NTA paper taken on an OMR sheet (NEET UG). `nta` is NTA's computer-based screen. `upsc_omr` is UPSC's OMR paper. |
| question type | `drawing` | Answers graded by examiners (JEE Main Paper 2A drawing test). The mock engine shows the task and never scores it. It still has a marking rule; if the notice gives only the section total, `correct` is null (with its open question) and the total goes in the section's `max_marks`. |
| question type | `skill_test` | A qualifying skill test with no questions or marks (SSC typing or data entry). A section of `skill_test` only has `question_count: null` and needs no `marking`; its standard goes in `cutoff`, e.g. `max_error_percent` by category. |
| `qualifying.rule`, section `cutoff` | `percent_of_max`, `marks`, `percentile`, `max_error_percent`, each with one `value` or a `by_category` list; or `set_by_conducting_body` with a `basis` | Only as notified. Category labels are written as the notice prints them. |
| `hi_source` | `official` or `translation` | `official` when the Hindi comes from the conducting body's Hindi notice; `translation` when it is ours. |

Partial marking (JEE Advanced style) uses a `partial` rule inside `marking`, for example per correct option chosen with no wrong option. Optional sections, attempt-any rules, sectional cut-offs and qualifying papers (UPSC CSAT) all have their own fields. Add fields to the schema rather than squeezing rules into `notes`.

### The "not stated" rule

An exam fact the notification does not state is `null`, never a guess, a typical value or last year's value. Every such null has an `open_questions` entry whose `field` is the dotted path of that fact from the file root, with sections addressed by code:

- `calculator`, `section_navigation`, `numeric_input`, `question_count`
- `sections.{code}.question_count` (not for a `skill_test` section, where null is the normal value)
- `sections.{code}.marking.{type}.correct`
- `interface_profile.save_requires_explicit_action`, `interface_profile.clear_keeps_mark`, `interface_profile.marked_answer_evaluated`, `interface_profile.keyboard_disabled_on_exam_day`

Write the question as what is missing and where you looked, add `checked` (the date you last looked) and, if you know it, `source_url` (where the answer should appear, such as the admit card page). Use `"field": null` for questions about the file as a whole, such as "the new cycle's notice is not published yet". `pnpm content:check` fails with `open_question_missing` when a null fact has no entry. When the notice prints a section total but not the marks per question, keep `correct: null` (with its open question) and record the printed total in the section's `max_marks`.

## Steps

1. Find the notification on the exam body's own website. Save the URL, title, publish date and the page numbers you used.
2. Read the scheme of examination section completely, including footnotes and annexures.
3. Fill every field from the document. Anything not stated is `null`, with an `open_questions` entry naming its field (see "The not stated rule"). Do not fill gaps from memory or coaching sites.
4. Write the official instructions screen text in both languages, as close to the official wording as the licence allows (summarise if unsure).
5. Compare with the previous version and list every change in the pull request.
6. Ask a person to check the blueprint against the notification side by side. Record their name in `reviewed_by`.

## Rules

- The pattern table in PRD §4.3 is a starting point only. The notification always wins.
- Re-run this skill at the start of every exam cycle, even if nothing seems to have changed, and update `verified_at`.
- JEE Advanced changes question types every year. Never reuse last year's blueprint without checking.

## Checklist

- [ ] Source URL is the exam body's own site, with publish date and pages.
- [ ] Question counts per section add up to the paper total, and marks add up to the maximum.
- [ ] Every question type used has a marking rule, including unattempted. The only exception is a section of `skill_test` questions only.
- [ ] Every null exam fact has an `open_questions` entry with its dotted `field`; `pnpm content:check` passes.
- [ ] `hi_source` says whether the Hindi is the official notice's or our translation.
- [ ] Timer and navigation rules match the notification exactly.
- [ ] Both languages present. A person has reviewed it against the notification.
