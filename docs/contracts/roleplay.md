# Role play contract (AI-21)

Status: v1.0, 31 Oct 2026. Shared by the apps and `apps/api`. The Pydantic models in `apps/api/smriti_api/schemas/roleplay.py` are the OpenAPI source; `packages/api-client` is generated from them. Flow: `docs/flows/tutor-social.md` §A11. Screen: `docs/ux/tutor-social.md` AI-21, hosted in LES-01.16.

## Where the script comes from

The card (`type: "roleplay"`: `character`, `persona_prompt`, `goals[]`, `guardrails[]`, `opening_line`, `suggested_replies[]`) is in the lesson bundle, so the opening line and the replies show at once, even offline.

The server keeps its own copy in `content.roleplay_scripts`. The content publish job fills it in the same pass as `content.card_index`, and it is service only. The app sends only `card_id`, so the persona prompt and the guardrails the model sees are always published content.

## Who can use it

| Check | Answer when it fails |
|---|---|
| Little learner (`u10`) | 403 `roleplay_not_for_age` |
| Parent mode's tutor switch | the tutor's own error |
| A strict or live mock running (R24) | 409 `exam_in_progress` |
| Free: `free.roleplay_chats_per_day` chats started today (local day) | 429 `roleplay_daily_cap` with `limit`, `under_13` (the app picks the copy) and `resets_at` |
| Pro: the shared fair-use cap `pro.tutor_messages_per_day` | 429 `quota_exhausted` with `quota` |

Role play never uses free tutor messages. A Pro turn counts as one tutor message. Flags that are null mean no cap.

## `POST /v1/roleplay/chats`

Body: `{ "card_id": "<role-play card id>" }`. `Idempotency-Key` is optional.

The answer is the open chat for that card if there is one (so a reload resumes it). Otherwise it starts a chat, with the opening line as the character's first message. 404 `unknown_card` when the card isn't published.

```json
{
  "session_id": "uuid",
  "card_id": "phy.mech.newton:dd:10",
  "status": "open",
  "end_reason": null,
  "turns": 0,
  "max_turns": null,
  "goals_total": 2,
  "goals_met": [],
  "messages": [ { "id": "uuid", "role": "character", "text": "…", "created_at": "…" } ],
  "summary": null
}
```

`GET /v1/roleplay/chats/{session_id}` returns the same shape. It answers 404 for anyone else's chat.

## `POST /v1/roleplay/chats/{session_id}/turns`

Body: `{ "client_message_id": "uuid", "reply_index": 0 }` (a tapped suggestion) or `{ "client_message_id": "uuid", "text": "…" }`.
- Under-13s send `reply_index` only. Text gets 422 `replies_only`.
- A `reply_index` the card doesn't have gets 422 `unknown_reply`.
- Text over `tutor.max_input_chars` gets 422 `too_long`.

A retry with the same `client_message_id` returns the chat as it stands, without a second reply. No Idempotency-Key is needed.

The answer is the chat, plus these fields:

| Field | Meaning |
|---|---|
| `step_out` | The student asked for something unsafe or off the lesson, or the reply failed the screen. The app shows the pet line "Stepping out of the story for a moment." and [Back to the story]. The turn isn't counted, and the line stays out of the chat. |
| `safety: "crisis"`, `helplines` | The crisis card (AI-08). The turn isn't counted and the model is never called. |
| `quota` | Pro only: the shared fair-use quota after this turn. |

The model marks which goals the student has found out. The server keeps the union and checks every index against the script.
- The chat ends when every goal is met (`end_reason: "goals_met"`) or after `roleplay.max_turns` student turns (`"turn_cap"`).
- A chat that has started always finishes, even past the daily cap.
- After the end, a turn gets 409 `roleplay_ended`.
- 503 `roleplay_unavailable` means the reply failed ("Couldn't reply." with [Try again]). Nothing is counted.

## `POST /v1/roleplay/chats/{session_id}/wrap-up`

[Wrap up] ends the chat now (`end_reason: "wrap_up"`). It is a no-op on an ended chat.

## The summary

When `status` is `ended`, `summary` holds the end card:

```json
{
  "found_out": [ { "en": "…", "hi": "…" } ],
  "concepts": [ { "id": "…", "name": { "en": "…", "hi": "…" } } ]
}
```

- `found_out`: the goals met, in the script's words.
- `concepts`: the card's concepts, shown as chips.

Nothing in the summary is written by the model.

## Privacy

- Logs carry the card id and counts only, never the chat.
- Messages follow the tutor's retention (`ai.tutor_retention_days`).
- Role-play chats appear in tutor history as sessions with `mode: "roleplay"`.
- `POST /v1/tutor/sessions/{id}/messages` refuses a role-play session (409 `use_roleplay`).

## Not on the server

The offline state and the "to revisit" mark on the card (`lesson_progress`) are on the device. So are the analytics events `roleplay_started`, `roleplay_turn`, `roleplay_completed` and `roleplay_skipped`, which go through `packages/analytics`.
