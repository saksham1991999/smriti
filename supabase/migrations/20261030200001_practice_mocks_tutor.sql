-- 20261030200001: practice, mocks and the AI tutor (wave 2, agent B).
-- docs/flows/practice.md §7.2 and §12.3, docs/flows/tutor-social.md §A14, TRD §9.2.
-- Additive only: new tables, new nullable or defaulted columns, indexes and policies.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------
-- content: question bodies for the server (mock papers, the daily challenge, tutor context).
-- Written by tools/content-publish like question_keys, and service only for the same reason:
-- questions whose use is `mock` or `daily` never ship to devices (content-format §8).
create table content.question_bodies (
  question_id  text primary key references content.questions(id) on delete cascade,
  uses         text[] not null,
  body         jsonb not null
);
create index on content.question_bodies using gin (uses);
alter table content.question_bodies enable row level security;
revoke all on content.question_bodies from anon, authenticated;
grant all on content.question_bodies to service_role;

-- Full-text fallback for tutor retrieval while pgvector is not installed (TRD §9.5). The
-- `simple` config keeps Hindi tokens intact; ranking stays in the query.
create index concepts_fts on content.concepts using gin (
  to_tsvector('simple'::regconfig,
    coalesce(name ->> 'en', '') || ' ' || coalesce(name ->> 'hi', '') || ' ' ||
    coalesce(summary ->> 'en', '') || ' ' || coalesce(summary ->> 'hi', '') || ' ' ||
    coalesce(key_points::text, ''))
);
create index topics_fts on content.topics using gin (
  to_tsvector('simple'::regconfig,
    coalesce(name ->> 'en', '') || ' ' || coalesce(name ->> 'hi', '') || ' ' ||
    coalesce(summary ->> 'en', '') || ' ' || coalesce(summary ->> 'hi', ''))
);
create index on content.mock_items (question_id);

-- ---------------------------------------------------------------------------------------------
-- learn: practice sessions (practice §5.3, §12.3)
alter table learn.practice_sessions
  add column exam_profile_id text,
  add column source          text,
  add column question_ids    text[] not null default '{}',
  add column size            smallint;
create index on learn.question_attempts (user_id, session_id) where session_id is not null;

-- Mock attempts (practice §6.2 to §6.10). `paper` pins the sections, items and marking at the
-- start, so a content patch mid-mock applies only to the next attempt (practice §6.6).
alter table learn.mock_attempts
  add column kind            text check (kind in ('full','sectional','chapter','pyq_paper','live','custom')),
  add column exam_profile_id text,
  add column attempt_no      smallint not null default 1,
  add column paper           jsonb,
  add column paused_at       timestamptz,
  add column last_saved_at   timestamptz,
  add column scored_at       timestamptz;
-- One mock in progress per student (MOCK-04 "a clean resume slot").
create unique index mock_attempts_one_in_progress on learn.mock_attempts (user_id) where status = 'in_progress';
create index on learn.mock_attempts (mock_id, attempt_no) where status in ('submitted','auto_submitted');
create index on learn.mock_attempts (server_deadline_at) where status = 'in_progress';

-- ---------------------------------------------------------------------------------------------
-- game: the daily challenge (practice §5.5). The start row holds the server start time; the
-- result row the scored answer. One attempt per student per challenge.
create table game.daily_challenge_starts (
  challenge_id uuid not null references game.daily_challenges(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  started_at   timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index on game.daily_challenge_starts (user_id);

alter table game.daily_challenge_results
  add column answer          jsonb,
  add column confidence      text check (confidence in ('sure','fifty','guess')),
  add column client_time_ms  integer,
  add column local_day       date;
create index on game.daily_challenge_results (challenge_id, correct desc, time_ms, submitted_at);

-- ---------------------------------------------------------------------------------------------
-- ai: tutor messages carry whether they used the daily quota, their outcome and the published
-- content they cite (tutor-social §A5, §A6). Messages are kept for `ai.tutor_retention_days`.
alter table ai.tutor_sessions
  add column last_message_at timestamptz;
alter table ai.tutor_messages
  add column counted   boolean not null default false,
  add column status    text not null default 'ok' check (status in ('ok','stopped','refused','crisis','error')),
  add column citations jsonb not null default '[]';
create index on ai.tutor_messages (user_id, created_at) where counted;

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS for the new table (the 0009 helpers were dropped after use).
grant select, insert, update, delete on game.daily_challenge_starts to authenticated;
grant all on game.daily_challenge_starts to service_role;
alter table game.daily_challenge_starts enable row level security;
create policy owner_read on game.daily_challenge_starts for select to authenticated
  using (user_id = (select auth.uid()));
