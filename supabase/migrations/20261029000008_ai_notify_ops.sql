-- 0008: AI (DB_SCHEMA §9), notifications (§10) and operations/config (§11), plus the
-- age-based notification defaults (§3 "Notification defaults by age").
set search_path = public, extensions;

-- 9. AI
create table ai.tutor_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  mode             text not null check (mode in ('chat','feynman','doubt_photo','voice','roleplay')),
  context_ref      text,
  exam_profile_id  text,
  locale           text not null,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  message_count    smallint not null default 0
);
create index on ai.tutor_sessions (user_id, started_at desc);

create table ai.tutor_messages (
  id          uuid not null default gen_random_uuid(),
  session_id  uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('user','assistant','tool')),
  content     text not null,
  attachments jsonb not null default '[]',
  tool_calls  jsonb,
  tokens_in   integer, tokens_out integer,
  flagged     boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
create index on ai.tutor_messages (session_id, created_at);
create index on ai.tutor_messages (user_id, created_at desc);

create table ai.message_feedback (
  message_id  uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rating      text not null check (rating in ('up','down')),
  reasons     text[] not null default '{}',
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index on ai.message_feedback (user_id);

create table ai.generated_stories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  concept_id  text,
  locale      text not null,
  pages       jsonb not null,
  saved       boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on ai.generated_stories (user_id, created_at desc);

create table ai.feynman_scores (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references ai.tutor_sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  concept_id   text not null,
  clarity      smallint not null check (clarity between 0 and 100),
  completeness smallint not null check (completeness between 0 and 100),
  accuracy     smallint not null check (accuracy between 0 and 100),
  gaps         jsonb not null default '[]',
  created_at   timestamptz not null default now()
);
create index on ai.feynman_scores (user_id);

create table ai.voice_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  tutor_session_id uuid references ai.tutor_sessions(id),
  provider        text not null default 'gemini_live',
  token_expires_at timestamptz not null,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  seconds         integer,
  transcript_key  text
);
create index on ai.voice_sessions (user_id);

create table ai.generations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  kind         text not null check (kind in
                 ('image','tts','stt','story','mnemonic','cornell_fill','mind_map','cards_from_transcript',
                  'doubt_photo','embedding')),
  provider     text not null,
  model        text not null,
  input_hash   text not null,
  asset_id     uuid,
  cache_hit    boolean not null default false,
  cost_micros  bigint,
  latency_ms   integer,
  status       text not null check (status in ('ok','error','blocked')),
  trace_id     text,
  created_at   timestamptz not null default now()
);
create index on ai.generations (user_id, created_at desc);

create table ai.usage_daily (
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null,
  tier          text not null,
  requests      integer not null default 0,
  tokens_in     bigint not null default 0,
  tokens_out    bigint not null default 0,
  units         integer not null default 0,
  cost_micros   bigint not null default 0,
  primary key (user_id, day, tier)
);

create table ai.moderation_flags (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  source_kind  text not null,
  source_id    text not null,
  category     text not null,
  score        real,
  action       text not null check (action in ('allowed','blocked','queued')),
  reviewed_by  uuid,
  created_at   timestamptz not null default now()
);

-- 10. Notifications
create table notify.prefs (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  reminder_enabled     boolean not null default true,
  daily_reminder_at    time,
  smart_timing         boolean not null default false,
  streak_saver         boolean not null default false,
  pet_plant_nudges     boolean not null default false,
  review_due           boolean not null default true,
  weak_area_alerts     boolean not null default true,
  daily_challenge      boolean not null default true,
  sleep_review         boolean not null default false,
  bedtime_review_time  time,
  focus_timer          boolean not null default true,
  friends              boolean not null default true,
  exam_alerts          boolean not null default true,
  news                 boolean not null default false,
  email_reminders      boolean not null default false,
  quiet_start          time not null default '22:00',
  quiet_end            time not null default '07:00',
  school_hours         boolean not null default false,
  focus_until          timestamptz,
  ignored_count        smallint not null default 0,
  paused_at            timestamptz,
  estimated_bedtime    time,
  usual_study_hour     time,
  bedtime_confidence   real,
  updated_at           timestamptz not null default now()
);
create trigger prefs_touch before update on notify.prefs
  for each row execute function app.touch_updated_at();

create table notify.templates (
  id         text not null,
  locale     text not null,
  pet        text not null default 'any' check (pet in ('cat','dog','any')),
  kind       text not null,
  title      text not null,
  body       text not null,
  active     boolean not null default true,
  primary key (id, locale, pet)
);

create table notify.log (
  id           uuid not null default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_id    uuid,
  template_id  text not null,
  channel      text not null check (channel in ('push','email','in_app')),
  status       text not null check (status in ('queued','sent','failed','suppressed')),
  suppressed_reason text,
  sent_at      timestamptz not null default now(),
  opened_at    timestamptz,
  primary key (id, sent_at)
) partition by range (sent_at);
create index on notify.log (user_id, sent_at desc);

-- 11. Operations and config
create table ops.app_variants (
  id               text primary key,
  exam_profile_ids text[] not null,
  min_version      text not null,
  latest_version   text not null,
  config           jsonb not null,
  active           boolean not null default true
);

create table ops.flags (
  key          text primary key,
  value        jsonb not null,
  rules        jsonb not null default '[]',
  description  text,
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);
create trigger flags_touch before update on ops.flags
  for each row execute function app.touch_updated_at();

create table ops.staff (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  role     text not null check (role in ('admin','content','support','finance'))
);

create table ops.support_tickets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  category      text not null,
  message       text check (message is null or char_length(message) <= 1000),
  app_info      jsonb,
  reply_email   text,
  status        text not null default 'open' check (status in ('open','waiting','closed')),
  created_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index on ops.support_tickets (user_id);

create table ops.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  target      text not null,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);

-- Notification defaults by age (DB_SCHEMA §3, me-money flow §4.3). Minors get only the reminder
-- at their picked time, focus alarms and exam alerts; adults get the full set. Runs on sign-up
-- (after the prefs row exists) and on every age_band change.
create or replace function notify.apply_age_defaults(uid uuid, band text) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if band is null then
    return;
  end if;
  if band = '18p' then
    update notify.prefs set
      smart_timing = true, streak_saver = true, pet_plant_nudges = true,
      school_hours = false, quiet_start = '22:00', quiet_end = '07:00'
     where user_id = uid;
  else
    update notify.prefs set
      smart_timing = false, streak_saver = false, pet_plant_nudges = false,
      sleep_review = false, news = false, email_reminders = false,
      school_hours = true,
      quiet_start = case when band = '13_17' then time '21:00' else time '20:00' end,
      quiet_end   = case when band = '13_17' then time '07:00' else time '08:00' end
     where user_id = uid;
  end if;
end
$$;

create or replace function app.on_age_band_change() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.age_band is distinct from old.age_band then
    perform notify.apply_age_defaults(new.user_id, new.age_band);
  end if;
  return new;
end
$$;

create trigger profiles_age_band_defaults
  after insert or update of age_band on app.profiles
  for each row execute function app.on_age_band_change();
