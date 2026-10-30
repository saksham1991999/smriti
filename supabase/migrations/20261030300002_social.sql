-- Phase 2 social backend (IMPLEMENTATION_PLAN G-4, docs/flows/tutor-social.md Part B).
-- Additive to 0006: how a friendship was made (R31: invite and QR friends see the pet name), per
-- student social state, handle reservations, Duo invites, squad name picks, server-run duels
-- (players, the random-match queue and the duel event log behind the realtime interface) and
-- league tiers. Writes go through the API after its consent checks (DB_SCHEMA §7, §12).
set search_path = public, extensions;

-- Friends -------------------------------------------------------------------------------------
alter table social.friendships
  add column method text check (method in ('invite','qr','search','league_row','duel','squad'));

create table social.members (                     -- one row per student who opened social
  user_id            uuid primary key references auth.users(id) on delete cascade,
  first_visit_at     timestamptz,                 -- SOC-03 shows once
  inbox_seen_at      timestamptz,                 -- SOC-06 unread count
  league_joined_at   timestamptz,                 -- teens tap Join (R30); adults are in after sign-in
  handle_changed_at  timestamptz,                 -- `social.handle_change_days`
  presence_visible   boolean not null default false,  -- "Studying now" (Q-B5): adults only, opt-in
  board_school       boolean not null default false,  -- school board opt-in (B7)
  board_city         boolean not null default false,  -- city board opt-in (B7)
  created_at         timestamptz not null default now()
);

create table social.handle_reservations (         -- old handles are kept for a while (B14)
  handle       citext primary key,
  user_id      uuid references auth.users(id) on delete cascade,
  released_at  timestamptz not null
);

create unique index activity_items_once on social.activity_items (user_id, kind, ref);

-- Duos ----------------------------------------------------------------------------------------
alter table social.duos
  add column invited_by       uuid references auth.users(id) on delete set null,
  add column invited_at       timestamptz not null default now(),
  add column ended_by         uuid references auth.users(id) on delete set null,
  add column evaluated_through date;               -- the last calendar day the streak was settled for

-- Squads --------------------------------------------------------------------------------------
alter table social.squads
  add column crest_id       text,
  add column name_word_ids  text[],                -- from the name picker (`social.squad_name_words`)
  add column name_number    smallint;
alter table social.squad_members
  add column via text not null default 'code' check (via in ('create','link','qr','code'));

-- Duels ---------------------------------------------------------------------------------------
alter table social.duels
  add column code                  text unique,     -- smriti.app/duel/{code}
  add column subject_id            text,
  add column relation              text not null default 'friend' check (relation in ('friend','random','solo')),
  add column settings              jsonb not null default '{}',  -- question_seconds, count, speed bonus at creation
  add column start_at              timestamptz,     -- the synced 3-2-1 ends here
  add column current_index         smallint not null default 0,  -- live: the shared question
  add column question_opened_at    timestamptz,
  add column expires_at            timestamptz,
  add column rematch_of            uuid references social.duels(id) on delete set null,
  add column rematch_requested_by  uuid references auth.users(id) on delete set null,
  add column rematch_requested_at  timestamptz;

create table social.duel_players (                -- per-player clock, presence and score
  duel_id             uuid not null references social.duels(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  role                text not null check (role in ('challenger','opponent')),
  joined_at           timestamptz,
  last_seen_at        timestamptz,
  current_index       smallint not null default 0,   -- async and solo: each player's own question
  question_opened_at  timestamptz,
  finished_at         timestamptz,
  score               integer not null default 0,
  correct             smallint not null default 0,
  flagged_fast        boolean not null default false,  -- an answer under `duel.min_answer_ms` (A36)
  primary key (duel_id, user_id)
);
create index on social.duel_players (user_id);

create table social.duel_queue (                  -- random matching (B10 §2): same exam, age group
  user_id          uuid primary key references auth.users(id) on delete cascade,
  exam_profile_id  text not null,
  subject_id       text,
  age_group        text not null check (age_group in ('adult','teen')),
  tier             smallint not null default 1,
  enqueued_at      timestamptz not null default now(),
  matched_duel_id  uuid references social.duels(id) on delete set null
);
create index on social.duel_queue (exam_profile_id, age_group, enqueued_at) where matched_duel_id is null;

create table social.duel_events (                 -- what the realtime channel carries; polled or streamed locally
  id          bigint generated always as identity primary key,
  duel_id     uuid not null references social.duels(id) on delete cascade,
  kind        text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index on social.duel_events (duel_id, id);

-- Leagues -------------------------------------------------------------------------------------
create table game.league_players (                -- tier and history between weeks (R30)
  user_id          uuid primary key references auth.users(id) on delete cascade,
  tier             smallint not null default 1 check (tier between 1 and 10),
  best_week_xp     integer,
  best_week_tier   smallint,
  best_week_start  date,
  last_week_start  date,
  last_tier        smallint,
  last_rank        smallint,
  last_xp          integer,
  last_result      text check (last_result in ('promoted','stayed','demoted')),
  result_seen_at   timestamptz,
  updated_at       timestamptz not null default now()
);
alter table game.league_members add column joined_at timestamptz not null default now();
create index on game.league_cohorts (week_start, exam_group, tier) where status = 'open';

-- Grants and RLS ------------------------------------------------------------------------------
grant select, insert, update, delete on social.members, social.handle_reservations, social.duel_players,
  social.duel_queue, social.duel_events, game.league_players to authenticated;
grant all on social.members, social.handle_reservations, social.duel_players, social.duel_queue,
  social.duel_events, game.league_players to service_role;
grant usage, select on all sequences in schema social to service_role;

alter table social.members enable row level security;
create policy owner_read on social.members for select to authenticated
  using (user_id = (select auth.uid()));

alter table social.handle_reservations enable row level security;  -- service only

alter table social.duel_queue enable row level security;
create policy owner_read on social.duel_queue for select to authenticated
  using (user_id = (select auth.uid()));

alter table game.league_players enable row level security;
create policy owner_read on game.league_players for select to authenticated
  using (user_id = (select auth.uid()));

-- Duel rows are visible to the two players only (the Realtime channel `duel:{id}` uses the same rule).
create function social.is_duel_player(d uuid, u uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from social.duels x where x.id = d and u in (x.challenger_id, x.opponent_id)
  )
$$;
grant execute on function social.is_duel_player(uuid, uuid) to authenticated;

alter table social.duel_players enable row level security;
create policy participant_read on social.duel_players for select to authenticated
  using (social.is_duel_player(duel_id, (select auth.uid())));

alter table social.duel_events enable row level security;
create policy participant_read on social.duel_events for select to authenticated
  using (social.is_duel_player(duel_id, (select auth.uid())));
