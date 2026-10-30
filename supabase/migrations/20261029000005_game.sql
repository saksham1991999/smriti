-- 0005: gamification (DB_SCHEMA §6): stats, plant, pet, ledgers, quests, badges, shop, leagues.
-- game.squad_quests and game.squad_quest_progress are created in 0006 (they reference social.squads).
set search_path = public, extensions;

create table game.user_stats (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  xp_total            bigint not null default 0,
  xp_week             integer not null default 0,
  week_start          date,
  level               smallint not null default 1,
  gems                integer not null default 0 check (gems >= 0),
  current_streak      integer not null default 0,
  longest_streak      integer not null default 0,
  streak_last_day     date,
  freezes_available   smallint not null default 1,
  updated_at          timestamptz not null default now()
);
create trigger user_stats_touch before update on game.user_stats
  for each row execute function app.touch_updated_at();

create table game.plants (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  species           text not null default 'tulsi',
  skin              text,
  growth_points     integer not null default 0,
  stage             text not null default 'seed' check (stage in ('seed','sprout','sapling','flowering','tree')),
  health            text not null default 'thriving' check (health in ('thriving','droopy','dry','wilted','dormant')),
  last_watered_day  date,
  revival_progress  smallint not null default 0,
  updated_at        timestamptz not null default now()
);
create trigger plants_touch before update on game.plants
  for each row execute function app.touch_updated_at();

create table game.plant_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  species       text not null,
  skin          text,
  stage         text not null,
  growth_points integer not null,
  planted_on    date not null,
  retired_on    date not null
);
create index on game.plant_history (user_id, retired_on desc);

create table game.pets (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  species        text not null check (species in ('cat','dog')),
  name           text not null,
  mood           smallint not null default 80 check (mood between 0 and 100),
  energy         smallint not null default 80 check (energy between 0 and 100),
  state          text not null default 'happy',
  outfit_ids     text[] not null default '{}',
  room_theme     text,
  last_cared_at  timestamptz,
  last_decay_day date,
  updated_at     timestamptz not null default now()
);
create trigger pets_touch before update on game.pets
  for each row execute function app.touch_updated_at();

create table game.xp_ledger (
  event_id     uuid not null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  amount       integer not null,
  source       text not null check (source in ('lesson','review','practice','mock','quest','duel','challenge','lab','experiment','bonus','admin')),
  ref          text,
  occurred_at  timestamptz not null,
  primary key (event_id, occurred_at)
) partition by range (occurred_at);
create index on game.xp_ledger (user_id, occurred_at desc);

create table game.gem_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  delta       integer not null,
  reason      text not null,
  ref         text,
  created_at  timestamptz not null default now()
);
create index on game.gem_ledger (user_id, created_at desc);

create table game.streak_freezes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source      text not null check (source in ('monthly','pro_monthly','shop','reward')),
  granted_at  timestamptz not null default now(),
  used_on     date
);
create index on game.streak_freezes (user_id) where used_on is null;

create table game.quests (
  id           text primary key,
  period       text not null check (period in ('daily','weekly','event')),
  spec         jsonb not null,
  reward       jsonb not null,
  active_from  date not null,
  active_to    date
);

create table game.user_quests (
  user_id       uuid not null references auth.users(id) on delete cascade,
  quest_id      text not null references game.quests(id),
  period_start  date not null,
  progress      integer not null default 0,
  target        integer not null,
  completed_at  timestamptz,
  claimed_at    timestamptz,
  primary key (user_id, quest_id, period_start)
);

create table game.badges (
  id text primary key,
  name i18n_text not null,
  description i18n_text not null,
  asset_id uuid,
  rule jsonb not null,
  tier smallint not null default 1
);
create table game.user_badges (
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null references game.badges(id),
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create table game.collections (
  id text primary key,
  name i18n_text not null,
  item_ids text[] not null
);
create table game.user_collection_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id text not null references game.collections(id),
  item_id text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, collection_id, item_id)
);

create table game.shop_items (
  id text primary key,
  kind text not null check (kind in ('freeze','pet_outfit','plant_skin','theme','palace_room','treat','room_theme')),
  price_gems integer not null,
  pro_only boolean not null default false,
  asset_id uuid,
  active boolean not null default true
);
create table game.inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references game.shop_items(id),
  qty smallint not null default 1,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table game.league_cohorts (
  id           uuid primary key default gen_random_uuid(),
  week_start   date not null,
  tier         smallint not null check (tier between 1 and 10),
  exam_group   text not null,
  status       text not null check (status in ('open','closed'))
);
create index on game.league_cohorts (week_start, tier, exam_group);

create table game.league_members (
  cohort_id  uuid not null references game.league_cohorts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  xp         integer not null default 0,
  final_rank smallint,
  result     text check (result in ('promoted','stayed','demoted')),
  primary key (cohort_id, user_id)
);
create index on game.league_members (user_id);

create table game.daily_challenges (
  id               uuid primary key default gen_random_uuid(),
  exam_profile_id  text not null,
  day              date not null,
  question_id      text not null,
  unique (exam_profile_id, day)
);
create table game.daily_challenge_results (
  challenge_id uuid not null references game.daily_challenges(id),
  user_id      uuid not null references auth.users(id) on delete cascade,
  correct      boolean not null,
  time_ms      integer not null,
  submitted_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index on game.daily_challenge_results (user_id);
