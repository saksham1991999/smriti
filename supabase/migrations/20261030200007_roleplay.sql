-- 20261030200007: role play (AI-21, tutor-social §A11).
-- The role-play card's script (character, persona prompt, goals, guardrails, opening line,
-- suggested replies) lives in the lesson bundle on the device. The server needs its own copy so
-- the persona prompt and guardrails it sends to the model come from published content, never
-- from the client. The content publish job fills `content.roleplay_scripts` in the same pass as
-- `content.card_index`. `ai.roleplay_chats` holds one chat's progress: turns and goals met.
set search_path = public, extensions;

create table content.roleplay_scripts (
  card_id      text primary key,
  item_id      text not null references content.content_items(id) on delete cascade,
  topic_id     text not null references content.topics(id),
  concept_ids  text[] not null default '{}',
  -- character, persona_prompt, goals, guardrails, opening_line, suggested_replies (content-format §7)
  script       jsonb not null,
  status       text not null default 'published' check (status in ('published','retired')),
  updated_at   timestamptz not null default now()
);
create index on content.roleplay_scripts (item_id);

comment on table content.roleplay_scripts is
  'Server copy of published role-play cards (AI-21). Service only: the persona prompt is server-side.';

alter table content.roleplay_scripts enable row level security;
grant all on content.roleplay_scripts to service_role;

create table ai.roleplay_chats (
  session_id   uuid primary key references ai.tutor_sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  card_id      text not null,
  turns        smallint not null default 0 check (turns >= 0),
  goals_total  smallint not null check (goals_total > 0),
  goals_met    smallint[] not null default '{}',
  status       text not null default 'open' check (status in ('open','ended')),
  end_reason   text check (end_reason in ('goals_met','turn_cap','wrap_up')),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index on ai.roleplay_chats (user_id, started_at desc);

comment on table ai.roleplay_chats is
  'One AI-21 role-play chat: student turns and the script goals met. Messages are in ai.tutor_messages.';

-- RLS (DB_SCHEMA §12): the student reads their own rows; no client writes.
grant select, insert, update, delete on ai.roleplay_chats to authenticated;
grant all on ai.roleplay_chats to service_role;
alter table ai.roleplay_chats enable row level security;
create policy owner_read on ai.roleplay_chats for select to authenticated
  using (user_id = (select auth.uid()));
