-- Phase 2 AI (IMPLEMENTATION_PLAN G-2, G-3; TRD §9.4; tutor-social §A8, §A9).
--
-- Voice tutor: the API mints a short-lived Gemini Live token per session, relays the model's
-- tool calls, and stores the transcript privately in object storage (``transcript_key``) under
-- the tutor's retention. Feynman: each graded explanation is a row in ai.feynman_scores; the
-- explanation text itself is a tutor message (ai.tutor_messages), so it shares that retention.
-- Read-aloud audio is cached by sha256(text, voice, locale) so a repeated answer costs nothing.
set search_path = public, extensions;

-- Voice sessions --------------------------------------------------------------------------------
alter table ai.voice_sessions
  add column client_session_id uuid,
  add column context_ref       text,
  add column locale            text,
  add column status            text not null default 'minted'
                                 check (status in ('minted','ended','expired')),
  add column max_seconds       integer check (max_seconds > 0),
  add column tokens_minted     smallint not null default 1,
  add column tool_calls        smallint not null default 0,
  add column flashcards_made   smallint not null default 0,
  add column transcript_turns  smallint,
  add column flagged           boolean not null default false,
  add column end_reason        text check (end_reason in
                                 ('user','session_cap','daily_cap','network','background','phone_call','expired'));
create unique index voice_sessions_client_idx on ai.voice_sessions (user_id, client_session_id)
  where client_session_id is not null;
create index on ai.voice_sessions (user_id, started_at desc);
create index on ai.voice_sessions (started_at) where transcript_key is not null;
-- The server mints, ends and stores sessions; students read their own (AI-09 history).
drop policy if exists owner_all on ai.voice_sessions;
create policy owner_read on ai.voice_sessions for select to authenticated
  using (user_id = (select auth.uid()));

-- Feynman scores --------------------------------------------------------------------------------
alter table ai.feynman_scores
  -- The tutor message that holds the explanation (ai.tutor_messages.id); its text never leaves
  -- that table.
  add column message_id     uuid,
  add column attempt_no     smallint not null default 1,
  add column input_mode     text not null default 'text' check (input_mode in ('text','voice')),
  add column word_count     smallint not null default 0,
  add column key_point_count smallint not null default 0,
  -- Indexes into content.concepts.key_points (0-based). Misconceptions sit in ``gaps``.
  add column covered        smallint[] not null default '{}',
  add column missing        smallint[] not null default '{}',
  add column follow_up_of   uuid references ai.feynman_scores(id) on delete cascade,
  add column mastery_delta  real not null default 0;
create index on ai.feynman_scores (user_id, concept_id, created_at desc);
-- Scores come from the grader only.
drop policy if exists owner_all on ai.feynman_scores;
create policy owner_read on ai.feynman_scores for select to authenticated
  using (user_id = (select auth.uid()));

-- Read-aloud cache (service only) ---------------------------------------------------------------
create table ai.tts_cache (
  key_hash      text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  storage_key   text not null,
  mime          text not null,
  bytes         integer not null,
  locale        text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);
create index on ai.tts_cache (last_used_at);
alter table ai.tts_cache enable row level security;
revoke all on ai.tts_cache from authenticated, anon;
grant all on ai.tts_cache to service_role;

-- Feynman as a weak mastery signal (G-3) ----------------------------------------------------------
-- Mastery comes from answer counts, (correct + 1) / (attempts + 3), rewritten on every answer. The
-- latest Feynman score for the concept is kept beside the counts and blended in with its weight
-- (flag feynman.mastery_weight at grading time), so every writer of mastery keeps the signal.
alter table learn.concept_mastery
  add column feynman_score  real check (feynman_score between 0 and 1),
  add column feynman_weight real not null default 0 check (feynman_weight between 0 and 1),
  add column feynman_at     timestamptz;

create function learn.blend_feynman_mastery() returns trigger language plpgsql as $$
begin
  if new.feynman_score is not null and new.feynman_weight > 0 then
    new.mastery := (1 - new.feynman_weight) * ((new.correct + 1)::real / (new.attempts + 3))
                   + new.feynman_weight * new.feynman_score;
  end if;
  return new;
end $$;

create trigger concept_mastery_feynman before insert or update on learn.concept_mastery
  for each row execute function learn.blend_feynman_mastery();
