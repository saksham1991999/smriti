-- Learning-science jobs (IMPLEMENTATION_PLAN G-8, TRD §9.6).
--
-- learn.weak_area_alerts records each predictive weak-area alert the nightly job queued: the
-- topic whose cards are predicted (FSRS retrievability) to drop below the student's target
-- retention within the horizon, how many cards, and the lowest predicted recall. Students read
-- their own rows; only the job writes them. The bedtime and usual-study-hour estimates already
-- have columns in notify.prefs (DB_SCHEMA §10).
set search_path = public, extensions;

create table learn.weak_area_alerts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  local_day          date not null,
  topic_id           text not null,
  cards              integer not null check (cards > 0),
  min_retrievability real not null check (min_retrievability between 0 and 1),
  target_retention   real not null check (target_retention between 0 and 1),
  horizon_days       smallint not null,
  notified           boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (user_id, local_day)
);
create index on learn.weak_area_alerts (user_id, created_at desc);

alter table learn.weak_area_alerts enable row level security;
grant select on learn.weak_area_alerts to authenticated;
grant all on learn.weak_area_alerts to service_role;
create policy owner_read on learn.weak_area_alerts for select to authenticated
  using (user_id = (select auth.uid()));
