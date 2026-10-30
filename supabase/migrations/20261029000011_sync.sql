-- 0011: sync bookkeeping for docs/contracts/sync.md. ADDITION by backend-core, not yet in
-- DB_SCHEMA v0.2 (listed in the build report for the DB_SCHEMA owner):
--   learn.sync_events      every accepted event, keyed by the client's event_id (idempotency,
--                          server recompute, and the union step of a guest merge)
--   app.sync_state         per-user state_version and the version each state section last changed
--   learn.srs_tombstones   deleted cards, so GET /v1/sync/state?since= can report them
--   sync_version columns   on learn.srs_cards and learn.topic_status, for incremental state
--   game.streak_freezes.equipped_at   which held freezes sit in the (up to 2) freeze slots (R28)
set search_path = public, extensions;

create table app.sync_state (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  version           bigint not null default 0,
  section_versions  jsonb not null default '{}',   -- {"profile": 3, "streak": 7, ...}
  updated_at        timestamptz not null default now()
);
create trigger sync_state_touch before update on app.sync_state
  for each row execute function app.touch_updated_at();

create table learn.sync_events (
  event_id      uuid primary key,                  -- the client's UUIDv7
  user_id       uuid not null references auth.users(id) on delete cascade,
  device_id     uuid,
  type          text not null,
  occurred_at   timestamptz not null,
  tz            text,
  local_day     date not null,                     -- occurred_at in the profile timezone at apply time
  payload       jsonb not null,                    -- own data only; never forwarded to analytics as-is
  status        text not null check (status in ('applied','rejected')),
  reject_code   text,
  state_version bigint,
  received_at   timestamptz not null default now()
);
create index on learn.sync_events (user_id, local_day);
create index on learn.sync_events (user_id, type, occurred_at);

create table learn.srs_tombstones (
  user_id       uuid not null references auth.users(id) on delete cascade,
  card_ref      text not null,
  sync_version  bigint not null,
  deleted_at    timestamptz not null default now(),
  primary key (user_id, card_ref)
);

alter table learn.srs_cards add column sync_version bigint not null default 0;
alter table learn.topic_status add column sync_version bigint not null default 0;
alter table game.streak_freezes add column equipped_at timestamptz;

-- The new-user trigger also creates the sync bookkeeping row.
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
  insert into app.sync_state (user_id) values (new.id) on conflict do nothing;
  return new;
end
$$;

grant select, insert, update, delete on app.sync_state, learn.sync_events, learn.srs_tombstones to authenticated;
grant all on app.sync_state, learn.sync_events, learn.srs_tombstones to service_role;

select ops._rls_on('app.sync_state');
create policy owner_read on app.sync_state for select to authenticated using (user_id = (select auth.uid()));
select ops._rls_on('learn.sync_events');
create policy owner_read on learn.sync_events for select to authenticated using (user_id = (select auth.uid()));
select ops._rls_on('learn.srs_tombstones');
create policy owner_read on learn.srs_tombstones for select to authenticated using (user_id = (select auth.uid()));
