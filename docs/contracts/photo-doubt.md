# Photo doubt contract (AI-16 to AI-19)

Status: v1.1, 31 Oct 2026 (v1.1 adds §3 and §4). Shared by the apps and `apps/api`. The Pydantic models in `apps/api/smriti_api/schemas/tutor.py` are the OpenAPI source; `packages/api-client` is generated from them. Flow: `docs/flows/tutor-social.md` §A10.

## Who can use it

| Check | Answer when it fails |
|---|---|
| Pro (R35) | 403 `pro_required`, `paywall_trigger: tutor_tool`, `paywall_source: photo_doubt` |
| Not under 13 (Phase 1) | 403 `photo_doubt_not_for_age` (no price shown, R15) |
| Under 18: the guardian's `uploads` scope | 403 `guardian_consent_required`, `scope: uploads` |
| Parent mode's tutor switch | the tutor's own error |
| The tutor's daily fair-use cap (`pro.tutor_messages_per_day`) | 429 `quota_exhausted` on upload; the solve stream sends `quota_exhausted` |

## 1. Upload and read: `POST /v1/ai/doubt-photos?exam=<exam_profile_id>`

The body is the photo itself (`Content-Type: image/jpeg`, `image/png` or `image/webp`), at most 4 MiB. The app compresses to 2048 px on the long edge first. The server checks the file's first bytes, not the header (415 `unsupported_photo`, 413 `photo_too_large`, 422 `empty_photo`). The photo goes to the private `uploads` bucket, and the vision tier (`AI_TIER_VISION_MODEL`, through the AI gateway) reads it.

`201`:

```json
{ "id": "uuid", "status": "read", "reason": null, "question_text": "Find $x$ if $2x + 3 = 7$.", "subject": "maths", "session_id": null, "created_at": "..." }
```

| `status` | `reason` | The app shows |
|---|---|---|
| `read` | null | AI-18: the question rendered with KaTeX, [Solve this] and [Edit] |
| `unreadable` | `blurry`, `no_question`, `multiple` ("Crop to one question"), `unreadable`, `not_study`, `ai_unavailable` | the matching error with [Retake] |
| `rejected` | `personal` (a face or a personal document: "We only need the question."), `unsafe` | the error with [Retake]; the photo is already deleted |

`GET /v1/ai/doubt-photos/{id}` returns the same shape (404 for anyone else's photo).

## 2. Solve: `POST /v1/ai/doubt-photos/{id}/solve`

Body: the tutor's `MessageIn` (`client_message_id`, `text`, `input`, `chip_id`) plus:

- `question_text`: the student's edit from AI-18, saved before solving;
- `reveal`: `true` for "Show full solution" (hints first until then);
- `exam`: optional.

It answers 409 `photo_not_read` unless the photo was read. Otherwise it streams server-sent events exactly as `POST /v1/tutor/ask/question` does: `session` (`session_id`, `resumed`), then the tutor's `delta`, `replace`, `safety`, `citations`, `chips`, `quota`, `quota_exhausted`, `error` and `done`. The chat is a tutor session with `mode: doubt_photo` and context `{ "kind": "doubt", "ref": "doubt:{id}" }`, so follow-ups go to `POST /v1/tutor/sessions/{session_id}/messages`, and history, feedback and deletion work as for any chat. Before `reveal`, the chips start with `show_full_solution`.

## 3. Concepts and similar questions: `GET /v1/ai/doubt-photos/{id}/similar?count=10`

`count` is 1 to 30 (default 10, the practice default). The same gate as the photo applies. It answers 409 `photo_not_read` unless the photo was read, and 404 for anyone else's photo.

```json
{
  "photo_id": "uuid",
  "concepts": [ { "id": "phy.mech.newton.c2", "name": { "en": "...", "hi": "..." }, "topic_id": "phy.mech.newton" } ],
  "question_ids": ["q.phy.mech.newton.0012", "q.phy.mech.newton.0031"]
}
```

- `concepts`: up to 3 course concepts that match the confirmed question. They come from the course's own search over published concepts in the photo's exam, never from the model. AI-19 shows them as "Concepts used" chips that open LRN-03.
- `question_ids`: published practice questions on those concepts. Mock and daily-challenge questions are left out. The order is stable for each photo.
- PRC-03 takes the ids as a fixed set (`question_ids[]`, scope row "Similar questions ({n})").
- Both lists are empty when nothing in the course matches. The app then hides [Similar questions].

## 4. Voice: `make_flashcard`

From voice (AI-14), the tutor's `make_flashcard` tool returns `{ "flashcard": { "deck": "from_tutor", "front", "back", "concept_id", "source": "voice" } }`. The device saves it to "From the tutor" through its outbox, then shows the AI-04 toast with [Edit].
- Personal data is removed from the text, and blocked content returns `{ "error": "not_allowed" }`.
- An unknown `concept_id` becomes null.

## Privacy and retention

- Logs and analytics carry ids, the size and the outcome only: never the image, the recognised text or the prompt (AGENTS rules 6 and 8).
- The storage key holds no user id.
- Photos and their recognised text follow the tutor's retention (`ai.tutor_retention_days`, the `tutor_retention` job). A photo whose chat the student deleted goes at the next run. A rejected photo is deleted at once.

## Not yet

- Offline queueing is on the device (§A10 step 5). The server has nothing to add.
- Keeping only the text of a saved solution (§A10 step 8) is not built.
- The worker's image scan (TRD §5 Files) is not wired for doubt photos.
