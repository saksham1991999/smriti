-- Tutor images (tutor-social §A5 step 6, §A9 step 4 "Board", §A14; TRD §9.3).
--
-- A picture the tutor asks for in a chat answer ("Draw it") or on the voice board. The model
-- writes a short brief from the course content; the server screens it like any tutor text,
-- builds the style-preset prompt and looks for an approved index image or an exact cache hit
-- before anything is generated. New Agnes images are Pro only (R35), never for under-13s, and
-- capped per hour and per day (pro.tutor_images_per_hour, pro.tutor_images_per_day). Files are
-- private (the `uploads` bucket) and reach the app only as short-lived signed URLs through
-- GET /v1/ai/generations/{id}. Rows follow the tutor's retention (ai.tutor_retention_days).

-- One row per picture the student was shown or is waiting for. Owner read; the API writes.
create table ai.tutor_images (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  source            text not null check (source in ('tutor_chat','voice_board')),
  tutor_session_id  uuid references ai.tutor_sessions(id) on delete cascade,
  message_id        uuid,                         -- the assistant answer it belongs to (chat)
  voice_session_id  uuid references ai.voice_sessions(id) on delete cascade,
  concept_id        text,
  style_preset      text not null,                -- skills/visual-director/presets
  size              text not null,
  ratio             text not null,
  -- The composed, screened prompt (model-written from content, personal data removed). Kept for
  -- the one retry; never returned by the API and never logged.
  prompt            text not null,
  prompt_hash       text not null,                -- ai.image_cache key
  alt               text not null,
  locale            text not null,
  status            text not null check (status in ('pending','ready','failed','blocked')),
  reason            text check (reason in
                      ('policy','busy','ai_unavailable','failed','pro_required','not_for_age','limit_reached')),
  origin            text check (origin in ('index','cache','generated')),
  asset_id          uuid references content.media_assets(id) on delete set null,   -- index hits
  storage_bucket    text check (storage_bucket in ('uploads','assets')),
  storage_key       text,
  retries           smallint not null default 0,
  created_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index on ai.tutor_images (user_id, created_at desc);
create index on ai.tutor_images (message_id) where message_id is not null;
create index on ai.tutor_images (prompt_hash);

-- RLS (DB_SCHEMA §12): the student reads their own rows; no client writes.
grant select, insert, update, delete on ai.tutor_images to authenticated;
grant all on ai.tutor_images to service_role;
alter table ai.tutor_images enable row level security;
create policy owner_read on ai.tutor_images for select to authenticated
  using (user_id = (select auth.uid()));

-- Generated tutor pictures by prompt hash (service only). Prompts never contain the student's
-- text, so an exact hit is reused across students at once (Q-A2, R35); semantic reuse is only
-- of approved index images.
create table ai.image_cache (
  prompt_hash   text primary key check (prompt_hash ~ '^[0-9a-f]{64}$'),
  storage_key   text not null,
  mime          text not null,
  bytes         integer not null,
  model         text not null,
  style_preset  text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);
create index on ai.image_cache (last_used_at);
alter table ai.image_cache enable row level security;
revoke all on ai.image_cache from authenticated, anon;
grant all on ai.image_cache to service_role;
