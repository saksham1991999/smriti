-- LOCAL ONLY. Never copy into supabase/migrations.
--
-- A minimal stand-in for Supabase's `auth` schema so the migrations, the RLS
-- policies and the API's dev auth endpoints run against plain Postgres 16.
-- Column names and function bodies follow Supabase's own definitions, so code
-- that works here works against a real Supabase project unchanged.

create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  aud                 text default 'authenticated',
  role                text default 'authenticated',
  email               text,
  is_anonymous        boolean not null default false,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  raw_app_meta_data   jsonb not null default '{}'::jsonb,
  banned_until        timestamptz,
  last_sign_in_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create unique index if not exists users_email_partial_key
  on auth.users (email) where email is not null and is_anonymous = false;

create table if not exists auth.identities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  provider        text not null,
  provider_id     text not null,              -- the provider's `sub`
  identity_data   jsonb not null default '{}'::jsonb,
  email           text generated always as (lower(identity_data ->> 'email')) stored,
  last_sign_in_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (provider_id, provider)
);
create index if not exists identities_user_id_idx on auth.identities (user_id);

-- Same bodies as Supabase (auth.uid, auth.role, auth.jwt).
create or replace function auth.uid() returns uuid
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;
grant all on auth.users, auth.identities to service_role;
grant usage on schema extensions to anon, authenticated, service_role;
