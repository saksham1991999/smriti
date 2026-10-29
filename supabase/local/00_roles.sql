-- LOCAL ONLY. Never copy into supabase/migrations.
--
-- Supabase creates these roles in every project. The local cluster has no
-- Supabase stack (docs/TRD.md §17, BUILD_BRIEF "Local services"), so this file
-- recreates them with the same names and attributes the migrations rely on.
-- Roles are cluster-wide, so this runs once per cluster and is idempotent.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    -- Local only: the password is a fixed dev value; the cluster listens on localhost.
    create role authenticator login noinherit password 'authenticator';
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
-- The API connects as postgres locally and switches with `set local role`.
grant anon, authenticated, service_role to postgres;
