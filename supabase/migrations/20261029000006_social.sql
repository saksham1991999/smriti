-- 0006: social (DB_SCHEMA §7), the Duo cap trigger, and game.squad_quests / squad_quest_progress.
set search_path = public, extensions;

create table social.friendships (
  user_a        uuid not null references auth.users(id) on delete cascade,
  user_b        uuid not null references auth.users(id) on delete cascade,
  status        text not null check (status in ('pending','accepted','blocked')),
  requested_by  uuid not null,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index on social.friendships (user_b);

create table social.duos (
  id                  uuid primary key default gen_random_uuid(),
  user_a              uuid not null references auth.users(id) on delete cascade,
  user_b              uuid not null references auth.users(id) on delete cascade,
  status              text not null check (status in ('invited','active','ended')),
  shared_streak       integer not null default 0,
  best_streak         integer not null default 0,
  last_both_active    date,
  started_at          timestamptz,
  ended_at            timestamptz
);
create unique index on social.duos (least(user_a,user_b), greatest(user_a,user_b)) where status <> 'ended';
create index on social.duos (user_a);
create index on social.duos (user_b);

-- Per-student cap (R32): reject an insert or an 'active' update when either student already
-- has `social.duo_max_partners` (flag, default 5) Duos that aren't ended. The API checks first.
create or replace function social.enforce_duo_cap() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  cap integer;
  n_a integer;
  n_b integer;
begin
  if new.status = 'ended' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'ended' and new.status = old.status then
    return new;
  end if;
  select coalesce((select (value #>> '{}')::integer from ops.flags where key = 'social.duo_max_partners'), 5)
    into cap;
  select count(*) into n_a from social.duos d
   where d.status <> 'ended' and d.id <> new.id and new.user_a in (d.user_a, d.user_b);
  select count(*) into n_b from social.duos d
   where d.status <> 'ended' and d.id <> new.id and new.user_b in (d.user_a, d.user_b);
  if n_a >= cap or n_b >= cap then
    raise exception 'duo_cap_reached' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger duos_cap before insert or update of status on social.duos
  for each row execute function social.enforce_duo_cap();

create table social.squads (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  owner_id         uuid not null references auth.users(id) on delete cascade,
  exam_profile_id  text,
  invite_code      text not null unique,
  max_members      smallint not null default 20,
  created_at       timestamptz not null default now()
);
create table social.squad_members (
  squad_id  uuid not null references social.squads(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (squad_id, user_id)
);
create index on social.squad_members (user_id);

create table social.duels (
  id               uuid primary key default gen_random_uuid(),
  challenger_id    uuid not null references auth.users(id) on delete cascade,
  opponent_id      uuid references auth.users(id) on delete cascade,
  exam_profile_id  text not null,
  question_ids     text[] not null,
  mode             text not null default 'live' check (mode in ('live','async','solo')),
  status           text not null check (status in ('pending','live','finished','expired','declined','abandoned')),
  scores           jsonb not null default '{}',
  winner_id        uuid,
  abandoned_by     uuid references auth.users(id) on delete set null,
  flagged_fast     boolean not null default false,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
create index on social.duels (challenger_id, created_at desc);
create index on social.duels (opponent_id, created_at desc);

create table social.duel_answers (
  duel_id      uuid not null references social.duels(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  question_id  text not null,
  answer       jsonb not null,
  is_correct   boolean not null,
  time_ms      integer not null,
  answered_at  timestamptz not null,
  primary key (duel_id, user_id, question_id)
);

create table social.nudges (
  id          uuid primary key default gen_random_uuid(),
  from_user   uuid not null references auth.users(id) on delete cascade,
  to_user     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('nudge','cheer','challenge')),
  preset_id   text not null,
  created_at  timestamptz not null default now()
);
create index on social.nudges (to_user, created_at desc);
create index on social.nudges (from_user, created_at desc);

create table social.activity_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('streak_milestone','league_promoted','badge_earned','duo_milestone')),
  ref         text,
  created_at  timestamptz not null default now()
);
create index on social.activity_items (user_id, created_at desc);

create table social.reactions (
  item_id     uuid not null references social.activity_items(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  reaction    text not null check (reaction in ('clap','star','strong','smile')),
  created_at  timestamptz not null default now(),
  primary key (item_id, user_id)
);

create table social.user_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null default 'person' check (target_kind in ('person','deck')),
  target_id   uuid references auth.users(id) on delete cascade,
  deck_id     uuid references learn.decks(id) on delete cascade,
  reason      text not null check (reason in
                ('inappropriate_username','cheating','bullying','impersonation',
                 'wrong_facts','copied','inappropriate_words','spam',
                 'other')),
  note        text,
  status      text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at  timestamptz not null default now(),
  check ((target_kind = 'person' and target_id is not null) or (target_kind = 'deck' and deck_id is not null))
);
create index on social.user_reports (reporter_id);

create table game.squad_quests (
  id           text primary key,
  spec         jsonb not null,
  reward       jsonb not null,
  active_from  date not null,
  active_to    date
);
create table game.squad_quest_progress (
  squad_id      uuid not null references social.squads(id) on delete cascade,
  quest_id      text not null references game.squad_quests(id),
  week_start    date not null,
  progress      integer not null default 0,
  target        integer not null,
  completed_at  timestamptz,
  contributors  uuid[] not null default '{}',
  primary key (squad_id, quest_id, week_start)
);
