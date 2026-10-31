-- 200003: AUTH-27, a guardian links an existing teen (auth flow §6.11 "Linking an existing teen to
-- a parent", me-money SET-18 path 2).
--
-- The guardian starts a link request: for a teen's sign-in email (matched to an account; the
-- address itself is never stored, only an HMAC) or as a code the teen scans or types. The teen
-- sees it (list), and accepts or declines it. On accept the API records the teen's evidence and
-- opens the usual §6.10 consent request (initiated_by = 'guardian', same code), which the guardian
-- then agrees to on AUTH-20. Rows are written only by the API (service role).
set search_path = public, extensions;

create table app.guardian_link_requests (
  id                  uuid primary key default gen_random_uuid(),
  guardian_user_id    uuid not null references auth.users(id) on delete cascade,
  -- The teen: set at creation when the email matched an account, or when the teen claims the code.
  learner_user_id     uuid references auth.users(id) on delete cascade,
  code_hash           text not null unique,
  target_email_hash   text,
  -- 'account' is always asked for (the API adds it); the guardian ticks the rest.
  scopes              text[] not null default '{account}'
                        check (cardinality(scopes) between 1 and 5),
  status              text not null default 'pending'
                        check (status in ('pending','accepted','declined','expired','cancelled')),
  consent_request_id  uuid references app.guardian_consent_requests(id) on delete set null,
  -- The teen's acceptance: time, app version, platform, the scopes shown. Never free text.
  evidence            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  resolved_at         timestamptz,
  check (guardian_user_id is distinct from learner_user_id)
);
create index on app.guardian_link_requests (guardian_user_id, created_at desc);
create index on app.guardian_link_requests (learner_user_id) where status = 'pending';
-- One open request per guardian and teen.
create unique index guardian_link_requests_one_open
  on app.guardian_link_requests (guardian_user_id, learner_user_id)
  where status = 'pending' and learner_user_id is not null;

comment on table app.guardian_link_requests is
  'AUTH-27: a guardian asks to link an existing teen; the teen accepts or declines (auth §6.11).';

-- RLS (DB_SCHEMA §12): the guardian and the teen read their own requests; no client writes.
grant select, insert, update, delete on app.guardian_link_requests to authenticated;
grant all on app.guardian_link_requests to service_role;
alter table app.guardian_link_requests enable row level security;
create policy guardian_or_learner_read on app.guardian_link_requests for select to authenticated
  using (
    guardian_user_id = (select auth.uid()) or learner_user_id = (select auth.uid())
  );
