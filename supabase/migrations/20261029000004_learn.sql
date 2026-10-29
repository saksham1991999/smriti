-- 0004: learning state (DB_SCHEMA §5). Partitions for the partitioned tables are created in 0010.
set search_path = public, extensions;

-- 5.1 Lessons, mastery and the daily plan
create table learn.lesson_progress (
  user_id          uuid not null references auth.users(id) on delete cascade,
  topic_id         text not null,
  mode             text not null check (mode in ('deep_dive','quick_revision')),
  bundle_hash      text not null,
  last_card_index  smallint not null default 0,
  cards_seen       smallint not null default 0,
  bites_completed  text[] not null default '{}',
  best_score       smallint,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (user_id, topic_id, mode)
);
create trigger lesson_progress_touch before update on learn.lesson_progress
  for each row execute function app.touch_updated_at();

create table learn.concept_mastery (
  user_id            uuid not null references auth.users(id) on delete cascade,
  concept_id         text not null,
  mastery            real not null default 0,
  attempts           integer not null default 0,
  correct            integer not null default 0,
  avg_time_ms        integer,
  sure_total smallint not null default 0, sure_correct smallint not null default 0,
  fifty_total smallint not null default 0, fifty_correct smallint not null default 0,
  guess_total smallint not null default 0, guess_correct smallint not null default 0,
  calibration        real,
  self_confidence    smallint,
  last_practiced_at  timestamptz,
  updated_at         timestamptz not null default now(),
  primary key (user_id, concept_id)
);
create trigger concept_mastery_touch before update on learn.concept_mastery
  for each row execute function app.touch_updated_at();

create table learn.daily_plans (
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null,
  items         jsonb not null,
  done_items    jsonb not null default '[]',
  generated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

create table learn.topic_status (
  user_id      uuid not null references auth.users(id) on delete cascade,
  topic_id     text not null,
  status       text not null check (status in ('not_started','in_progress','learned')),
  learned_via  text check (learned_via in ('lesson','test_out','placement','chapter_test')),
  updated_at   timestamptz not null default now(),
  primary key (user_id, topic_id)
);
create trigger topic_status_touch before update on learn.topic_status
  for each row execute function app.touch_updated_at();

create table learn.activity_days (
  user_id            uuid not null references auth.users(id) on delete cascade,
  day                date not null,
  xp                 integer not null default 0,
  minutes            smallint not null default 0,
  focus_sessions     smallint not null default 0,
  cards_reviewed     smallint not null default 0,
  lessons_completed  smallint not null default 0,
  mock_sections      smallint not null default 0,
  daily_challenge    boolean not null default false,
  qualified          boolean not null default false,
  goal_met           boolean not null default false,
  rescue_done        boolean not null default false,
  rest_day           boolean not null default false,
  freeze_used        boolean not null default false,
  first_event_at     timestamptz,
  last_event_at      timestamptz,
  primary key (user_id, day)
);

-- 5.2 Spaced repetition (FSRS)
create table learn.decks (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid references auth.users(id) on delete cascade,
  source         text not null check (source in ('system','user','note','transcript','tutor','shared_copy')),
  title          text not null,
  topic_id       text,
  share_code     text unique,
  is_public      boolean not null default false,
  share_status   text check (share_status in ('checking','shared','blocked','stopped')),
  listed_for_exam text,
  helpful_count  integer not null default 0,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index on learn.decks (owner_user_id);

create table learn.cards (
  id              uuid primary key,
  deck_id         uuid not null references learn.decks(id) on delete cascade,
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  kind            text not null default 'basic' check (kind in ('basic','basic_reverse','cloze')),
  front           jsonb not null,
  back            jsonb not null,
  image_asset_id  uuid,
  concept_id      text,
  source_ref      text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index on learn.cards (owner_user_id);
create index on learn.cards (deck_id);

create table learn.deck_helpful_votes (
  deck_id     uuid not null references learn.decks(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (deck_id, user_id)
);
create index on learn.deck_helpful_votes (user_id);

create table learn.srs_cards (
  user_id         uuid not null references auth.users(id) on delete cascade,
  card_ref        text not null,
  deck_id         uuid,
  state           smallint not null,
  due_at          timestamptz not null,
  stability       real not null,
  difficulty      real not null,
  reps            smallint not null default 0,
  lapses          smallint not null default 0,
  last_review_at  timestamptz,
  suspended       boolean not null default false,
  flags           smallint not null default 0,
  buried_until    date,
  updated_at      timestamptz not null default now(),
  primary key (user_id, card_ref)
) partition by hash (user_id);
create index on learn.srs_cards (user_id, due_at) where not suspended;

create table learn.srs_reviews (
  id              uuid not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  card_ref        text not null,
  rating          smallint not null check (rating between 1 and 4),
  confidence      text check (confidence in ('sure','fifty','guess')),
  state_before    smallint not null,
  elapsed_days    real not null,
  scheduled_days  real not null,
  stability_after real not null,
  difficulty_after real not null,
  duration_ms     integer,
  context         text check (context in ('review','lesson','sleep_review','palace_walk','duel')),
  reviewed_at     timestamptz not null,
  primary key (id, reviewed_at)
) partition by range (reviewed_at);
create index on learn.srs_reviews (user_id, reviewed_at desc);
create index on learn.srs_reviews (user_id, card_ref, reviewed_at);

create table learn.fsrs_params (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  weights            real[] not null,
  desired_retention  real not null default 0.9,
  review_count       integer not null,
  optimised_at       timestamptz not null
);

-- 5.3 Practice and mocks
create table learn.question_attempts (
  id            uuid not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  question_id   text not null,
  context       text not null check (context in ('practice','drill','daily','lesson','duel','pyq','chapter_test')),
  session_id    uuid,
  attempt_no    smallint not null default 1,
  difficulty_shown text,
  answer        jsonb not null,
  is_correct    boolean not null,
  time_ms       integer not null,
  confidence    text check (confidence in ('sure','fifty','guess')),
  mistake_type  text check (mistake_type in ('conceptual','calculation','misread','silly','time')),
  hints_used    smallint not null default 0,
  answered_at   timestamptz not null,
  primary key (id, answered_at)
) partition by range (answered_at);
create index on learn.question_attempts (user_id, answered_at desc);

create table learn.mock_attempts (
  id                 uuid primary key,
  user_id            uuid not null references auth.users(id) on delete cascade,
  mock_id            text,
  generated_spec     jsonb,
  blueprint_id       uuid not null,
  language           text not null,
  time_policy        text not null default 'practice' check (time_policy in ('practice','strict','live')),
  paused_ms          integer not null default 0,
  pause_count        smallint not null default 0,
  active_device_id   uuid,
  accommodation      jsonb,
  status             text not null check (status in ('in_progress','submitted','auto_submitted','abandoned')),
  section_state      jsonb not null default '{}',
  started_at         timestamptz not null,
  submitted_at       timestamptz,
  server_deadline_at timestamptz not null,
  score              numeric(6,2),
  max_score          numeric(6,2),
  rank               integer,
  percentile         numeric(5,2),
  created_at         timestamptz not null default now()
);
create index on learn.mock_attempts (user_id, started_at desc);
create index on learn.mock_attempts (mock_id, score desc) where status in ('submitted','auto_submitted');

create table learn.mock_answers (
  attempt_id          uuid not null references learn.mock_attempts(id) on delete cascade,
  question_id         text not null,
  section_code        text not null,
  palette_status      text not null check (palette_status in
                        ('not_visited','not_answered','answered','marked','answered_marked')),
  answer              jsonb,
  time_spent_ms       integer not null default 0,
  visits              smallint not null default 0,
  first_seen_seq      smallint,
  answered_seq        smallint,
  answer_changes      smallint not null default 0,
  confidence          text check (confidence in ('sure','fifty','guess')),
  is_correct          boolean,
  marks_awarded       numeric(5,2),
  mistake_type        text check (mistake_type in ('conceptual','calculation','misread','silly','time')),
  client_updated_at   timestamptz not null,
  primary key (attempt_id, question_id)
);

create table learn.mock_reports (
  attempt_id    uuid primary key references learn.mock_attempts(id) on delete cascade,
  report        jsonb not null,
  report_version smallint not null,
  generated_at  timestamptz not null default now()
);

create table learn.mock_registrations (
  mock_id        text not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  registered_at  timestamptz not null default now(),
  reminded_at    timestamptz,
  primary key (mock_id, user_id)
);
create index on learn.mock_registrations (user_id);

create table learn.practice_sessions (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('drill','weak_spots','pyq','chapter_test','custom')),
  spec        jsonb not null,
  started_at  timestamptz not null,
  ended_at    timestamptz,
  answered    smallint not null default 0,
  correct     smallint not null default 0
);
create index on learn.practice_sessions (user_id, started_at desc);

-- 5.4 Memory tools
create table learn.palaces (
  id           uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  template     text not null check (template in ('home','school','monument','pano360','custom')),
  pano_asset_id uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index on learn.palaces (user_id);
create trigger palaces_touch before update on learn.palaces
  for each row execute function app.touch_updated_at();

create table learn.palace_rooms (
  id                  uuid primary key,
  palace_id           uuid not null references learn.palaces(id) on delete cascade,
  name                text not null,
  sort                smallint not null,
  background_asset_id uuid
);
create index on learn.palace_rooms (palace_id);

create table learn.palace_loci (
  id             uuid primary key,
  room_id        uuid not null references learn.palace_rooms(id) on delete cascade,
  sort           smallint not null,
  pos            jsonb not null,
  item_ref       text not null,
  note           text,
  image_asset_id uuid
);
create index on learn.palace_loci (room_id);

create table learn.notes (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  topic_id      text,
  concept_ids   text[] not null default '{}',
  title         text not null,
  cues          jsonb not null default '[]',
  body          jsonb not null,
  summary       text,
  ai_filled_at  timestamptz,
  deck_id       uuid references learn.decks(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index on learn.notes (user_id, updated_at desc);
create trigger notes_touch before update on learn.notes
  for each row execute function app.touch_updated_at();

create table learn.mind_maps (
  id             uuid primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  root_topic_id  text,
  graph          jsonb not null,
  origin         text not null check (origin in ('ai','user')),
  updated_at     timestamptz not null default now()
);
create index on learn.mind_maps (user_id);
create trigger mind_maps_touch before update on learn.mind_maps
  for each row execute function app.touch_updated_at();

create table learn.user_mnemonics (
  id             uuid primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  concept_id     text,
  card_ref       text,
  technique      text not null,
  body           text not null,
  image_asset_id uuid,
  audio_asset_id uuid,
  origin         text not null check (origin in ('ai','user')),
  shared_for_review boolean not null default false,
  created_at     timestamptz not null default now()
);
create index on learn.user_mnemonics (user_id);

create table learn.emotion_tags (
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_ref    text not null,
  emoji       text,
  feeling     text,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (user_id, item_ref)
);

create table learn.bookmarks (
  id         uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_ref   text not null,
  kind       text not null check (kind in ('bookmark','highlight','formula_vault','shortcut_vault')),
  range      jsonb,
  note       text,
  created_at timestamptz not null default now()
);
create index on learn.bookmarks (user_id, kind, created_at desc);

create table learn.content_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  kind        text not null check (kind in
                ('lesson_card','question','review_card','solution','tutor_message','generated_image',
                 'story_page','roleplay_turn','community_mnemonic','lab','album_card')),
  item_ref    text not null,
  bundle_hash text,
  locale      text,
  reason      text not null check (reason in ('wrong','unclear','typo','translation','offensive','spam','other')),
  note        text check (note is null or char_length(note) <= 280),
  status      text not null default 'open' check (status in ('open','accepted','fixed','rejected')),
  created_at  timestamptz not null default now()
);
create index on learn.content_reports (kind, status, created_at);
create index on learn.content_reports (user_id);

create table learn.lab_progress (
  user_id         uuid not null references auth.users(id) on delete cascade,
  item_id         text not null,
  last_opened_at  timestamptz not null,
  tasks           jsonb not null default '{}',
  readings        jsonb not null default '{}',
  completed_at    timestamptz,
  primary key (user_id, item_id)
);
