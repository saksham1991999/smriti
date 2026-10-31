# Analytics summary contract (PRC-14)

Status: v1.0, 31 Oct 2026. Shared by the apps and `apps/api`. The Pydantic models in `apps/api/smriti_api/schemas/analytics_summary.py` are the OpenAPI source; `packages/api-client` is generated from them. Flow: `docs/flows/practice.md` §5.6; screen: `docs/ux/practice.md` PRC-14.

## `GET /v1/analytics/summary?exam=<exam_profile_id>&period=7d|30d|all`

`exam` defaults to the learner's primary exam (409 `no_exam` without one, 404 `unknown_exam` for an id that doesn't exist). `period` defaults to `30d`. Free for every tier (R25), guests included.

Every number comes from the caller's own rows. Nothing is estimated, smoothed or filled in.

```json
{
  "exam_profile_id": "jee-main-2027",
  "period": "30d",
  "computed_at": "2026-10-31T09:00:00Z",
  "readiness":  { "shown": true, "reason": null, "have": 42, "needed": 20, "percent": 37, "practised": 42, "total": 310, "weighted": false },
  "speed":      { "shown": true, "reason": null, "have": 180, "needed": 50, "avg_ms": 74000, "target_ms": 90000, "right_but_slow": 12, "fast_and_wrong": 9 },
  "confidence": { "shown": false, "reason": "not_enough_data", "have": 11, "needed": 30, "levels": null, "lucky_guesses": null },
  "mistakes":   { "shown": true, "reason": null, "have": 7, "needed": 1, "counts": [ { "type": "conceptual", "count": 3 }, { "type": "calculation", "count": 2 }, { "type": "misread", "count": 0 }, { "type": "silly", "count": 2 }, { "type": "time", "count": 0 } ] }
}
```

(The numbers above show the shape only.)

## Every card

| Field | Meaning |
|---|---|
| `shown` | `false` when the card has too little data or its threshold isn't set |
| `reason` | `not_enough_data` (below the threshold) or `threshold_unset` (the owner hasn't set the flag yet); null when shown |
| `have`, `needed` | the count so far and the threshold, for "Answer {needed − have} more questions to see this" (`needed` is null when unset) |

When `shown` is false, the card's own numbers are null. The app shows the empty line, never a chart with placeholder data.

## The cards

| Card | Counts | Threshold flag | Values |
|---|---|---|---|
| `readiness` | concepts of the exam with at least one answer (`learn.concept_mastery.attempts > 0`) | `analytics.min_concepts_for_readiness` | `percent`: mastery over all of the exam's concepts (unpractised ones count as 0), weighted by `content.exam_concepts.weightage` when every concept has one (`weighted: true`), else equal weights. It ignores `period`. It is not a predicted score or rank (PRD §6.3). `practised` and `total` are always filled. |
| `speed` | first answers in the period to questions with an `ideal_time_s` | `analytics.min_answers_total` | `avg_ms` against `target_ms` (the average ideal time of the same questions), `right_but_slow` (right, over the ideal time), `fast_and_wrong` (wrong, under it) |
| `confidence` | first answers in the period tagged Sure, 50:50 or Guess | `analytics.min_tagged_answers` | `levels` (answers, correct and accuracy per tag, accuracy null for a tag with no answers) and `lucky_guesses` (right when tagged Guess) |
| `mistakes` | the student's own mistake tags in the period | any tag (`needed: 1`) | `counts` per type, zeros included |

## Which answers count

- Practice, drill, daily, lesson, duel, PYQ and chapter-test first attempts from `learn.question_attempts`.
- Mock answers from `learn.mock_answers` of submitted attempts, where review tags live. The copies the server makes of them in `question_attempts` (context `mock`, sync v1.3) are left out, so each answer counts once.
- Only questions linked to one of the exam's concepts.
- Answers still in the device's outbox are not included. The app shows "{n} answers will count when you're online".

## Not yet

Subject mastery, accuracy vs speed per chapter, the trend and syllabus-covered cards, and `GET /v1/analytics/subjects/{id}` (PRC-15) are not built.
