-- 0009: row-level security for every table (DB_SCHEMA §12), in one reviewable file.
--
-- The API runs user queries inside a transaction that starts with
--   set local role authenticated;  select set_config('request.jwt.claims', <claims>, true);
-- so auth.uid() works in these policies. The worker and the API's server-side recompute use
-- service_role, which bypasses RLS. Every policy uses (select auth.uid()) so Postgres evaluates
-- it once per query.
--
-- Patterns (helpers below, dropped at the end of this file):
--   owner_all      user reads and writes rows where <col> = auth.uid()
--   owner_read     user reads own rows; only the service role writes
--   owner_insert   user inserts own rows and reads them back; staff read through the service role
--   public_read    anon and authenticated read rows matching a filter
--   service_only   RLS on, no policies
set search_path = public, extensions;

-- Privileges. RLS decides which rows; these grants decide which commands are possible at all.
grant usage on schema app, content, learn, game, social, billing, ai, notify, ops to authenticated, service_role;
grant usage on schema content, game, app, billing to anon;
grant select on all tables in schema content to anon, authenticated;
grant select, insert, update, delete on all tables in schema app, learn, game, social, billing, ai, notify to authenticated;
grant select, insert on ops.support_tickets to authenticated;
grant select on game.badges, game.quests, game.shop_items, game.collections, game.squad_quests, app.institutions, billing.products to anon;
grant all on all tables in schema app, content, learn, game, social, billing, ai, notify, ops to service_role;
grant usage, select on all sequences in schema app, content, learn, game, social, billing, ai, notify, ops to service_role;
grant execute on function app.consent_request_by_code(text) to authenticated;

create function ops._rls_on(tbl text) returns void language plpgsql as $$
begin
  execute format('alter table %s enable row level security', tbl);
end $$;

create function ops._owner_all(tbl text, col text default 'user_id') returns void language plpgsql as $$
begin
  perform ops._rls_on(tbl);
  execute format(
    'create policy owner_all on %s for all to authenticated using (%I = (select auth.uid())) with check (%I = (select auth.uid()))',
    tbl, col, col);
end $$;

create function ops._owner_read(tbl text, col text default 'user_id') returns void language plpgsql as $$
begin
  perform ops._rls_on(tbl);
  execute format('create policy owner_read on %s for select to authenticated using (%I = (select auth.uid()))', tbl, col);
end $$;

create function ops._owner_insert(tbl text, col text default 'user_id') returns void language plpgsql as $$
begin
  perform ops._rls_on(tbl);
  execute format('create policy owner_insert on %s for insert to authenticated with check (%I = (select auth.uid()))', tbl, col);
  execute format('create policy owner_read on %s for select to authenticated using (%I = (select auth.uid()))', tbl, col);
end $$;

create function ops._public_read(tbl text, filter text default 'true') returns void language plpgsql as $$
begin
  perform ops._rls_on(tbl);
  execute format('create policy public_read on %s for select to anon, authenticated using (%s)', tbl, filter);
end $$;

-- ---------------------------------------------------------------------------------------------
-- app
select ops._owner_all('app.profiles');
select ops._owner_all('app.user_exams');
select ops._owner_all('app.devices');
select ops._owner_all('app.exports');
select ops._owner_read('app.data_requests');
select ops._public_read('app.institutions', 'active');
select ops._rls_on('app.account_merges');            -- service only; the owner reads its merge through the API

-- Learner or guardian read, server write (auth flow §6.10, §6.11)
select ops._rls_on('app.guardian_consents');
create policy learner_or_guardian_read on app.guardian_consents for select to authenticated
  using (user_id = (select auth.uid()) or guardian_user_id = (select auth.uid()));

select ops._rls_on('app.guardian_links');
create policy learner_or_guardian_read on app.guardian_links for select to authenticated
  using (learner_user_id = (select auth.uid()) or guardian_user_id = (select auth.uid()));

select ops._rls_on('app.parental_controls');
create policy learner_or_guardian_read on app.parental_controls for select to authenticated
  using (
    learner_user_id = (select auth.uid())
    or exists (
      select 1 from app.guardian_links gl
       where gl.learner_user_id = parental_controls.learner_user_id
         and gl.guardian_user_id = (select auth.uid())
         and gl.revoked_at is null
    )
  );

select ops._rls_on('app.time_requests');
create policy learner_or_guardian_read on app.time_requests for select to authenticated
  using (
    learner_user_id = (select auth.uid())
    or exists (
      select 1 from app.guardian_links gl
       where gl.learner_user_id = time_requests.learner_user_id
         and gl.guardian_user_id = (select auth.uid())
         and gl.revoked_at is null
    )
  );

-- Learner read, server write. Guardians read a request only through app.consent_request_by_code().
select ops._owner_read('app.guardian_consent_requests', 'learner_user_id');

-- ---------------------------------------------------------------------------------------------
-- content: public read of published rows; only the service role writes.
select ops._public_read('content.exams', 'is_active');
select ops._public_read('content.exam_profiles', 'is_active');
select ops._public_read('content.exam_blueprints', $f$status in ('active','retired')$f$);
select ops._public_read('content.subjects');
select ops._public_read('content.units');
select ops._public_read('content.chapters');
select ops._public_read('content.topics');
select ops._public_read('content.subtopics');
select ops._public_read('content.concepts');
select ops._public_read('content.concept_edges');
select ops._public_read('content.exam_concepts');
select ops._public_read('content.content_items', $f$status = 'published'$f$);
select ops._public_read('content.content_item_concepts');
select ops._public_read('content.content_versions');
select ops._public_read('content.bundles');
select ops._public_read('content.bundle_history');
select ops._public_read('content.bundle_patches');
select ops._public_read('content.manifests');
select ops._public_read('content.seed_packs');
select ops._public_read('content.questions', $f$status = 'published'$f$);
select ops._rls_on('content.question_keys');          -- service only: answer keys never leave the server
select ops._public_read('content.question_concepts');
select ops._public_read('content.pyq_papers');
select ops._public_read('content.pyq_questions');
select ops._public_read('content.mocks', $f$status in ('scheduled','open','closed')$f$);
select ops._public_read('content.mock_items');
select ops._public_read('content.media_assets', $f$status = 'approved' and visibility = 'public'$f$);
create policy owner_private_read on content.media_assets for select to authenticated
  using (visibility = 'private' and owner_user_id = (select auth.uid()));
select ops._public_read('content.sims', $f$status = 'published'$f$);
select ops._public_read('content.videos');
select ops._public_read('content.search_docs');
select ops._public_read('content.mnemonics', $f$status = 'published'$f$);
-- submitted_by is never selected by a client: column privilege removed below.
select ops._owner_all('content.mnemonic_votes');

revoke select on content.mnemonics from anon, authenticated;
grant select (id, concept_id, technique, locale, body, audio_asset_id, image_asset_id, exam_style,
              origin, votes, status) on content.mnemonics to anon, authenticated;
revoke select on content.question_keys from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- learn
select ops._owner_all('learn.lesson_progress');
select ops._owner_all('learn.concept_mastery');
select ops._owner_all('learn.daily_plans');
select ops._owner_all('learn.topic_status');
select ops._owner_all('learn.activity_days');
select ops._owner_all('learn.cards', 'owner_user_id');
select ops._owner_all('learn.deck_helpful_votes');
select ops._owner_all('learn.srs_cards');
select ops._owner_all('learn.srs_reviews');
select ops._owner_all('learn.fsrs_params');
select ops._owner_all('learn.question_attempts');
select ops._owner_all('learn.mock_attempts');
select ops._owner_all('learn.mock_registrations');
select ops._owner_all('learn.practice_sessions');
select ops._owner_all('learn.palaces');
select ops._owner_all('learn.notes');
select ops._owner_all('learn.mind_maps');
select ops._owner_all('learn.user_mnemonics');
select ops._owner_all('learn.emotion_tags');
select ops._owner_all('learn.bookmarks');
select ops._owner_all('learn.lab_progress');
select ops._owner_insert('learn.content_reports');

-- Decks: owner reads and writes; system decks (no owner) are readable by everyone signed in.
select ops._owner_all('learn.decks', 'owner_user_id');
create policy system_read on learn.decks for select to authenticated using (owner_user_id is null);

-- Owner via parent
select ops._rls_on('learn.palace_rooms');
create policy owner_via_parent on learn.palace_rooms for all to authenticated
  using (exists (select 1 from learn.palaces p where p.id = palace_rooms.palace_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from learn.palaces p where p.id = palace_rooms.palace_id and p.user_id = (select auth.uid())));

select ops._rls_on('learn.palace_loci');
create policy owner_via_parent on learn.palace_loci for all to authenticated
  using (exists (select 1 from learn.palace_rooms r join learn.palaces p on p.id = r.palace_id
                  where r.id = palace_loci.room_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from learn.palace_rooms r join learn.palaces p on p.id = r.palace_id
                       where r.id = palace_loci.room_id and p.user_id = (select auth.uid())));

select ops._rls_on('learn.mock_answers');
create policy owner_via_parent on learn.mock_answers for all to authenticated
  using (exists (select 1 from learn.mock_attempts a where a.id = mock_answers.attempt_id and a.user_id = (select auth.uid())))
  with check (exists (select 1 from learn.mock_attempts a where a.id = mock_answers.attempt_id and a.user_id = (select auth.uid())));

-- Owner read, server write (via parent)
select ops._rls_on('learn.mock_reports');
create policy owner_read_via_parent on learn.mock_reports for select to authenticated
  using (exists (select 1 from learn.mock_attempts a where a.id = mock_reports.attempt_id and a.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------------------------
-- game
select ops._owner_all('game.user_stats');
select ops._owner_all('game.plants');
select ops._owner_all('game.plant_history');
select ops._owner_all('game.pets');
select ops._owner_read('game.xp_ledger');
select ops._owner_read('game.gem_ledger');
select ops._owner_read('game.streak_freezes');
select ops._owner_read('game.user_quests');
select ops._owner_read('game.user_badges');
select ops._owner_read('game.user_collection_items');
select ops._owner_read('game.inventory');
select ops._owner_read('game.daily_challenge_results');
select ops._owner_read('game.league_members');
select ops._public_read('game.quests');
select ops._public_read('game.badges');
select ops._public_read('game.collections');
select ops._public_read('game.shop_items', 'active');
select ops._public_read('game.squad_quests');
select ops._public_read('game.daily_challenges');
select ops._rls_on('game.league_cohorts');            -- read through the API (members only)
create policy member_read on game.league_cohorts for select to authenticated
  using (exists (select 1 from game.league_members m where m.cohort_id = league_cohorts.id and m.user_id = (select auth.uid())));

select ops._rls_on('game.squad_quest_progress');
create policy member_read on game.squad_quest_progress for select to authenticated
  using (exists (select 1 from social.squad_members m where m.squad_id = squad_quest_progress.squad_id and m.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------------------------
-- social: visible to participants; writes go through the API after its consent checks.
select ops._rls_on('social.friendships');
create policy participant_read on social.friendships for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

select ops._rls_on('social.duos');
create policy participant_read on social.duos for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

select ops._rls_on('social.duels');
create policy participant_read on social.duels for select to authenticated
  using ((select auth.uid()) = challenger_id or (select auth.uid()) = opponent_id);

select ops._rls_on('social.duel_answers');
create policy participant_read on social.duel_answers for select to authenticated
  using (exists (select 1 from social.duels d where d.id = duel_answers.duel_id
                  and (select auth.uid()) in (d.challenger_id, d.opponent_id)));

select ops._rls_on('social.nudges');
create policy sender_or_recipient_read on social.nudges for select to authenticated
  using ((select auth.uid()) in (from_user, to_user));

-- Activity and reactions: the owner and the owner's accepted (never blocked) friends.
create function social.is_friend(a uuid, b uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from social.friendships f
     where f.user_a = least(a, b) and f.user_b = greatest(a, b) and f.status = 'accepted'
  )
$$;
grant execute on function social.is_friend(uuid, uuid) to authenticated;

select ops._rls_on('social.activity_items');
create policy owner_or_friend_read on social.activity_items for select to authenticated
  using (user_id = (select auth.uid()) or social.is_friend(user_id, (select auth.uid())));

select ops._rls_on('social.reactions');
create policy owner_or_friend_read on social.reactions for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from social.activity_items i
                where i.id = reactions.item_id
                  and (i.user_id = (select auth.uid()) or social.is_friend(i.user_id, (select auth.uid()))))
  );

select ops._owner_insert('social.user_reports', 'reporter_id');

create function social.is_squad_member(sq uuid, u uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from social.squad_members m where m.squad_id = sq and m.user_id = u)
$$;
grant execute on function social.is_squad_member(uuid, uuid) to authenticated;

select ops._rls_on('social.squads');
create policy member_read on social.squads for select to authenticated
  using (social.is_squad_member(id, (select auth.uid())));

select ops._rls_on('social.squad_members');
create policy member_read on social.squad_members for select to authenticated
  using (social.is_squad_member(squad_id, (select auth.uid())));

-- ---------------------------------------------------------------------------------------------
-- billing
select ops._public_read('billing.products', 'active');
select ops._owner_read('billing.subscriptions');
select ops._owner_read('billing.entitlements');
select ops._owner_read('billing.promo_grants');
select ops._rls_on('billing.payments');
create policy owner_read_via_parent on billing.payments for select to authenticated
  using (exists (select 1 from billing.subscriptions s where s.id = payments.subscription_id and s.user_id = (select auth.uid())));
select ops._rls_on('billing.payment_events');         -- service only
select ops._rls_on('billing.intro_claims');           -- service only
select ops._rls_on('billing.payment_links');          -- service only

-- ---------------------------------------------------------------------------------------------
-- ai
select ops._owner_all('ai.tutor_sessions');
select ops._owner_all('ai.tutor_messages');
select ops._owner_all('ai.message_feedback');
select ops._owner_all('ai.generated_stories');
select ops._owner_all('ai.feynman_scores');
select ops._owner_all('ai.voice_sessions');
select ops._owner_read('ai.generations');
select ops._owner_read('ai.usage_daily');
select ops._rls_on('ai.moderation_flags');            -- service only

-- ---------------------------------------------------------------------------------------------
-- notify
select ops._owner_all('notify.prefs');
select ops._owner_read('notify.log');
select ops._rls_on('notify.templates');               -- service only

-- ---------------------------------------------------------------------------------------------
-- ops: service only, except the reporter's own support tickets.
select ops._rls_on('ops.app_variants');
select ops._rls_on('ops.flags');
select ops._rls_on('ops.staff');
select ops._rls_on('ops.audit_log');
select ops._owner_insert('ops.support_tickets');

drop function ops._owner_all(text, text);
drop function ops._owner_read(text, text);
drop function ops._owner_insert(text, text);
drop function ops._public_read(text, text);
-- ops._rls_on stays: later migrations (0011) use it for new tables.

-- Guard: fail the migration if any table in our schemas has RLS off.
do $$
declare
  missing text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ')
    into missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('app','content','learn','game','social','billing','ai','notify','ops')
     and c.relkind in ('r','p')
     and not c.relispartition
     and not c.relrowsecurity;
  if missing is not null then
    raise exception 'RLS is off on: %', missing;
  end if;
end
$$;
