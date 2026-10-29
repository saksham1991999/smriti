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
  "source": { "url": "…", "title": "…", "published": "YYYY-MM-DD", "retrieved": "YYYY-MM-DD", "pages": "…" },
  "mode": "cbt | pen_paper",
  "duration_min": 0,
  "languages": ["en", "hi"],
  "interface": "nta | upsc_omr | ssc_tcs | generic",
  "calculator": "none | basic | scientific",
  "section_navigation": "free | locked_in_order | free_within_timer",
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
  "notes": "Anything the notification leaves ambiguous, and how it was resolved"
}
```

Partial marking (JEE Advanced style) uses a `partial` rule inside `marking`, for example per correct option chosen with no wrong option. Optional sections, attempt-any rules, sectional cut-offs and qualifying papers (UPSC CSAT) all have their own fields. Add fields to the schema rather than squeezing rules into `notes`.

## Steps

1. Find the notification on the exam body's own website. Save the URL, title, publish date and the page numbers you used.
2. Read the scheme of examination section completely, including footnotes and annexures.
3. Fill every field from the document. Anything not stated is `null`, with an entry in `notes`. Do not fill gaps from memory or coaching sites.
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
- [ ] Every question type used has a marking rule, including unattempted.
- [ ] Timer and navigation rules match the notification exactly.
- [ ] Both languages present. A person has reviewed it against the notification.
