# Analytics ingest contract

Status: v1.0, 31 Oct 2026. Shared by `packages/analytics` (the `httpTransport` sender) and `apps/api`. The Pydantic models in `apps/api/smriti_api/schemas/analytics_ingest.py` are the OpenAPI source; `packages/api-client` is generated from them. Storage: `docs/DB_SCHEMA.md` §14 (`events`). Rules: AGENTS.md rules 6 and 8.

## `POST /v1/analytics/events`

Signed-in or guest session (`Authorization: Bearer`). `X-Device-Id` fills `device_id`.

```json
{
  "events": [
    {
      "event_id": "01930c3e-7a8f-7c1e-9d2a-5b8f0e6c1a42",
      "name": "analytics_card_opened",
      "occurred_at": "2026-10-31T09:00:00.000Z",
      "props": { "card": "speed" },
      "context": { "platform": "android", "app_variant": "jee", "app_version": "1.0.0", "locale": "en", "exam_profile": "jee-main-2027", "tier": "free" }
    }
  ]
}
```

The client's other fields (`stream`, `audience`, `context.is_guest`) are ignored. The server works out the stream from the catalogue, and the audience and guest status from the session and the profile.

### Limits

| Limit | Value | Answer |
|---|---|---|
| Events per batch | 1 to 100 | 422 |
| Body size | 256 KB, and `Content-Length` must be sent | 413 `batch_too_large`, 411 `length_required` |
| Requests per user per minute | `RATE_ANALYTICS_PER_MIN` (default 60) | 429 `rate_limited` |
| Props per event | 64 | 422 |
| `occurred_at` | from 400 days ago to 10 minutes ahead (the same window as sync) | dropped (`too_old`, `in_the_future`) |

No Idempotency-Key is needed. Every event carries its own `event_id`, and the `events` table is a ReplacingMergeTree on `event_id`, so a retried batch collapses to one row each. The same id twice in one batch is dropped as `duplicate_in_batch`.

### What the server checks

The catalogue is `packages/analytics/catalogue.json`, written by `pnpm --filter @smriti/analytics generate` from the same source as the TypeScript catalogue. `generate:check` fails CI when the file is stale. `ANALYTICS_CATALOGUE_PATH` points the API at another copy.

1. **Event.** The event must be in the catalogue (`unknown_event`). The server stream is written only by the API and worker (`server_only`).
2. **Audience.** The audience comes from `app.profiles.age_band`, never from the client:
   - `u10`: learning events, plus product events on the little-learner allow-list (`little_learner_not_allowed`).
   - `10_12`, `13_17` and an unknown band: learning and essential events only (`minor_not_allowed`).
   - `18p`: everything, unless `settings.analytics_opt_out` is true, which drops non-essential product events (`opted_out`).
   - With the flag `minor.defer_sync_until_consent` on, a minor without guardian consent (the `account` scope) keeps nothing (`awaiting_consent`).
3. **Props.** Each prop is checked against the event's catalogue entry, using the same rules as `src/guard.ts`:
   - A prop whose name carries personal data or an ad id, or starts with `utm_`, is removed (`blocked_name`).
   - A prop not in the entry is removed (`unknown_prop`).
   - A value that is not a short token, an id, a number or a boolean is removed (`free_text`, `bad_type`). So is a list longer than 50 items (`too_many_items`).
   - An enum value the catalogue doesn't list is kept and reported (`unknown_enum_value`).
   - For minors, the behavioural-tracking props in `policy.minor_stripped_props` are removed (`stripped_for_minor`).

### Answer, 200

```json
{
  "accepted": ["01930c3e-7a8f-7c1e-9d2a-5b8f0e6c1a42"],
  "dropped": [ { "event_id": "…", "reason": "minor_not_allowed" } ],
  "issues": [ { "event_id": "…", "prop": "colour", "code": "unknown_prop" } ]
}
```

`issues` names the prop and the reason. It never carries the value. A dropped event is not an error: the client must not retry it. A 400 or 422 means the batch itself is bad, and `httpTransport` drops it. Any other failure, 503 `analytics_unavailable` included, keeps the batch for a retry.

### Storage

Accepted events are written in one call to the event store (`EventStore` in `apps/api/smriti_api/integrations/event_store.py`):

| Setting | Store |
|---|---|
| `CLICKHOUSE_URL` set | ClickHouse `events` (JSONEachRow; times in UTC as `YYYY-MM-DD HH:MM:SS.mmm`) |
| local or test, no ClickHouse | JSON lines at `ANALYTICS_EVENTS_FILE` (default `.dev/analytics/events.jsonl`) |
| otherwise | none: 503 `analytics_unavailable` |

The row columns are the §14 `events` columns:
- `props` holds the kept props as a JSON string.
- `session_id` is the nil UUID until the apps send a session id.
- `device_id` comes from `X-Device-Id`, or the nil UUID.

Logs carry counts and a hashed user id only.
