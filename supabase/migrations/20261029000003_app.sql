-- 0003: accounts and profiles (DB_SCHEMA §3), the new-user trigger and app.consent_request_by_code().
set search_path = public, extensions;

create table app.institutions (
  id          text primary key,
  kind        text not null check (kind in ('school','coaching')),
  name        i18n_text not null,
  city        text not null,
  state       text not null,
  source      text not null,
  active      boolean not null default true
);

create table app.profiles (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  handle                  citext unique,
  nickname_word_ids       text[],
  nickname_number         smallint,
  display_name            text,
  avatar_asset_id         uuid,
  locale                  text not null default 'en' check (locale in ('en','hi')),
  timezone                text not null default 'Asia/Kolkata',
  age_band                text check (age_band in ('u10','10_12','13_17','18p')),
  is_minor                boolean generated always as (age_band in ('u10','10_12','13_17')) stored,
  birth_ym                date,
  age_source              text check (age_source in ('class','birth_year','declined','guardian','self_declared')),
  account_kind            text not null default 'learner'
                            check (account_kind in ('learner','managed','guardian')),
  guardian_consent_state  text not null default 'not_required'
                            check (guardian_consent_state in ('not_required','required','pending','granted','declined','revoked')),
  signed_up_at            timestamptz,
  deletion_scheduled_for  timestamptz,
  primary_exam_profile_id text,
  daily_goal_xp           smallint not null default 30,
  daily_goal_minutes      smallint not null default 10 check (daily_goal_minutes in (5,10,20,30)),
  settings                jsonb not null default '{}',
  discoverable            boolean not null default false,
  league_opt_out          boolean not null default false,
  institution_id          text references app.institutions(id),
  city                    text,
  first_variant           text,
  referral_code           text unique,
  referred_by             uuid references auth.users(id),
  onboarding_completed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index on app.profiles (timezone);
create index on app.profiles (deletion_scheduled_for) where deletion_scheduled_for is not null;
create trigger profiles_touch before update on app.profiles
  for each row execute function app.touch_updated_at();

create table app.user_exams (
  user_id          uuid not null references auth.users(id) on delete cascade,
  exam_profile_id  text not null,
  target_date      date,
  is_primary       boolean not null default false,
  self_level       text check (self_level in ('starting','basics','revising')),
  question_language text check (question_language in ('en','hi')),
  created_at       timestamptz not null default now(),
  primary key (user_id, exam_profile_id)
);
create unique index on app.user_exams (user_id) where is_primary;

create table app.guardian_consent_requests (
  id                uuid primary key default gen_random_uuid(),
  learner_user_id   uuid references auth.users(id) on delete cascade,
  claim_secret_hash text unique,
  claimed_at        timestamptz,
  initiated_by      text not null default 'learner' check (initiated_by in ('learner','guardian','device')),
  channel           text not null check (channel in ('handoff','link')),
  code_hash         text not null unique,
  scopes            text[] not null,
  status            text not null default 'pending'
                      check (status in ('pending','granted','declined','expired','cancelled')),
  guardian_user_id  uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  resolved_at       timestamptz,
  check (learner_user_id is not null or claim_secret_hash is not null)
);
create index on app.guardian_consent_requests (learner_user_id, created_at desc);

create table app.guardian_consents (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  guardian_user_id    uuid references auth.users(id) on delete set null,
  guardian_sub_hash   text not null,
  request_id          uuid references app.guardian_consent_requests(id) on delete set null,
  method              text not null check (method in ('google_same_device','google_own_device','parent_created')),
  age_assurance       text not null check (age_assurance in ('self_declared','digilocker_token','known_adult')),
  scope               jsonb not null,
  notice_version      text not null,
  consented_at        timestamptz not null,
  revoked_at          timestamptz,
  superseded_by       uuid references app.guardian_consents(id),
  evidence            jsonb not null default '{}'
);
create unique index on app.guardian_consents (user_id) where revoked_at is null and superseded_by is null;
create index on app.guardian_consents (guardian_user_id);

create table app.guardian_links (
  guardian_user_id  uuid not null references auth.users(id) on delete cascade,
  learner_user_id   uuid not null references auth.users(id) on delete cascade,
  kind              text not null check (kind in ('managed','consent')),
  relation          text not null default 'parent' check (relation in ('parent','guardian')),
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  primary key (guardian_user_id, learner_user_id)
);
create unique index on app.guardian_links (learner_user_id) where kind = 'managed' and revoked_at is null;
create index on app.guardian_links (learner_user_id);

create table app.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  platform      text not null check (platform in ('ios','android','web')),
  app_variant   text not null,
  app_version   text not null,
  push_token    text unique,
  web_push_subscription jsonb,
  push_enabled  boolean not null default true,
  notif_permission text not null default 'not_asked'
                  check (notif_permission in ('not_asked','granted','denied','provisional','not_required')),
  notif_asked_count smallint not null default 0,
  timezone      text,
  locale        text,
  last_seen_at  timestamptz not null default now(),
  invalid_at    timestamptz
);
create index on app.devices (user_id);

create table app.account_merges (
  id              uuid primary key default gen_random_uuid(),
  source_user_id  uuid not null,
  target_user_id  uuid not null references auth.users(id) on delete cascade,
  status          text not null check (status in ('queued','running','done','failed')),
  include_progress boolean not null default true,
  attempts        smallint not null default 0,
  failure_code    text,
  stats           jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index on app.account_merges (target_user_id, created_at desc);

create table app.exports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('pdf_book','data_export')),
  spec          jsonb not null,
  status        text not null check (status in ('queued','rendering','ready','failed','expired')),
  r2_key        text,
  pages         integer,
  bytes         bigint,
  requested_at  timestamptz not null default now(),
  completed_at  timestamptz,
  expires_at    timestamptz
);
create index on app.exports (user_id, requested_at desc);

create table app.parental_controls (
  learner_user_id     uuid primary key references auth.users(id) on delete cascade,
  set_by              uuid references auth.users(id) on delete set null,
  daily_limit_min     smallint check (daily_limit_min in (15,30,45,60,90,120)),
  allowed_from        time,
  allowed_to          time,
  break_reminders     boolean not null default false,
  ask_before_switching boolean not null default false,
  tutor_button        boolean not null default false,
  picture_rhymes      boolean not null default false,
  updated_at          timestamptz not null default now()
);
create trigger parental_controls_touch before update on app.parental_controls
  for each row execute function app.touch_updated_at();

create table app.time_requests (
  id                uuid primary key default gen_random_uuid(),
  learner_user_id   uuid not null references auth.users(id) on delete cascade,
  guardian_user_id  uuid references auth.users(id) on delete set null,
  minutes           smallint not null,
  status            text not null default 'pending' check (status in ('pending','allowed','declined','expired')),
  created_at        timestamptz not null default now(),
  decided_at        timestamptz
);
create index on app.time_requests (learner_user_id, created_at desc);

create table app.data_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  kind          text not null check (kind in ('access','correction','erasure','withdraw_consent')),
  status        text not null check (status in ('open','in_progress','done','rejected')),
  created_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index on app.data_requests (user_id, created_at desc);

-- On sign-up (DB_SCHEMA §3): every new auth.users row gets a profile, stats, a seed plant and
-- notification prefs. It must stay cheap and idempotent. 0008 adds the age-based notification
-- defaults, and 0011 adds the sync bookkeeping rows.
create or replace function app.handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into app.profiles (user_id) values (new.id) on conflict do nothing;
  insert into game.user_stats (user_id) values (new.id) on conflict do nothing;
  insert into game.plants (user_id) values (new.id) on conflict do nothing;
  insert into notify.prefs (user_id) values (new.id) on conflict do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- A guardian reads a consent request only through this function (DB_SCHEMA §12): it checks the
-- code hash, status and expiry and returns only what the consent screen needs.
create or replace function app.consent_request_by_code(code text)
  returns table (
    request_id uuid,
    learner_first_name text,
    pet_name text,
    pet_species text,
    app_variant text,
    scopes text[],
    expires_at timestamptz
  )
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  return query
  select r.id,
         split_part(coalesce(p.display_name, ''), ' ', 1),
         pet.name,
         pet.species,
         p.first_variant,
         r.scopes,
         r.expires_at
    from app.guardian_consent_requests r
    left join app.profiles p on p.user_id = r.learner_user_id
    left join game.pets pet on pet.user_id = r.learner_user_id
   where r.code_hash = encode(extensions.digest(upper(code), 'sha256'), 'hex')
     and r.status = 'pending'
     and r.expires_at > now();
end
$$;
