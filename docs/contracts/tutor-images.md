# Tutor images contract ("Draw it" and the AI-14 board)

Status: v1.0, 31 Oct 2026. Shared by the apps and `apps/api`. The Pydantic models in `apps/api/smriti_api/schemas/tutor_images.py` are the OpenAPI source, and `packages/api-client` is generated from them. Flow: `docs/flows/tutor-social.md` §A5 step 6, §A9 step 4, §A14. Rules: TRD §9.3, R35, Q-A2.

## Who gets which picture

The model writes a short brief of what to draw, based on the course content. The server removes personal data from the brief and the alt text, runs the text tutor's safety screen on both (keyword lists, plus the cheap-tier check when `ai.llm_moderation` is on), and builds the visual-director preset prompt (`sunny-diagram` or `sunny-scene`, Agnes `2K`, `3:2`). It then looks for a picture in this order:

| Step | Who gets it |
|---|---|
| 1. An approved index image (`content.media_assets`) with the same prompt hash | Everyone |
| 2. An exact cache hit (`ai.image_cache`). Prompts never contain student text, so a hit is shared across students at once (Q-A2) | Everyone except under-13s, who only see reviewed images |
| 3. A new Agnes image from the AI gateway's image tier (`AI_TIER_IMAGE_MODEL`), made on the worker's `media` queue | Pro only (R35), never under-13s, within `pro.tutor_images_per_hour` and `pro.tutor_images_per_day` (owner flags; no cap applies until they are set) |

When there is no picture, the reason is one of these:

- `pro_required`: the app shows the "Draw it · Pro" chip.
- `not_for_age`: no price is shown (R15).
- `limit_reached`
- `policy`: the brief was blocked. A blocked brief also gets an `ai.moderation_flags` row with `source_kind = 'tutor_image'`.

## Chat: `POST /v1/tutor/sessions/{id}/messages` with `input: "chip"` and `chip_id: "draw_it"`

The answer streams as usual. Once it finishes, the cheap tier writes the brief from the answer and the course material. The student's message is not sent to it. One of these events follows, before `citations`:

- `image_ready {generation_id, url, url_expires_at, alt}`: an index or cache hit.
- `image_pending {generation_id, alt}`: show "Drawing…", then poll.
- `image_failed {generation_id | null, reason, retry}`

The same three events apply on the ask, card, question and photo-solve streams. `MessageOut.images` lists `{generation_id, status, alt}` for each answer, so a picture that lands after the sheet closed still shows in history.

## Voice board: the `generate_image` tool

The tool is declared on `POST /v1/voice/sessions` and called with args `{brief, alt, style?: "diagram" | "scene", concept_id?}`. The result is either:

- `{board: {kind: "image", generation_id, status: "ready" | "pending", alt, url?}}`, or
- `{error: reason}`, which the voice model explains to the student.

The device polls the generation in the same way as chat.

## `GET /v1/ai/generations/{id}`

Returns `GenerationOut`:

- `id`, `kind: "image"`, `source` (`tutor_chat` or `voice_board`), `status` (`pending`, `ready`, `failed` or `blocked`)
- `reason`, `origin` (`index`, `cache` or `generated`), `alt`, `locale`
- `url` and `url_expires_at`, set only when the status is `ready`
- `message_id`, `tutor_session_id`, `can_retry`, `created_at`, `finished_at`

The `url` is a signed link to a private file that expires after 15 minutes. Ask again after `url_expires_at`. Another student's id answers 404. The prompt is never returned.

## `POST /v1/ai/generations/{id}/retry`

This is [Try again]. It is allowed once, after a failed new picture, and never counts as a message. While the picture is pending, it returns the same state. Otherwise it answers 409 `cannot_retry`.

## Storage, retention, logs

- New files live in the private `uploads` bucket under `tutor-images/`.
- Rows (`ai.tutor_images`, owner read only) are deleted after `ai.tutor_retention_days`. A cached file goes once no row points at it and it has been unused for that long. Deleting a chat or a voice session removes its pictures.
- Logs carry ids, statuses and byte counts only. They never include the brief, the prompt or the alt text (AGENTS rule 6).

## Not yet

- **Search by meaning in the index:** this needs the embedding provider (TRD §9.5, D2). Until then the index matches on the exact prompt hash only.
- **Model-initiated pictures in text chat without the chip:** these wait for Agnes streaming tool calls, which still need to be confirmed (TRD §9.3).
