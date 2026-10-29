-- 0001: extensions, the i18n_text domain, schemas and the shared updated_at trigger (DB_SCHEMA §1, §16).

create schema if not exists extensions;
set search_path = public, extensions;

create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- pgvector is part of every Supabase project. A plain local Postgres may not have it, so
-- vector columns and HNSW indexes are added only when the extension exists (see 0002 and
-- the helper below). Nothing else depends on them.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'vector') then
    create extension if not exists vector with schema extensions;
  else
    raise notice 'pgvector is not available on this server: vector columns and HNSW indexes are skipped (local only)';
  end if;
end
$$;

-- pg_cron needs shared_preload_libraries, so it is guarded too (0010 schedules the jobs).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron is available but could not be created (%): cron jobs are skipped', sqlerrm;
    end;
  else
    raise notice 'pg_cron is not available on this server: cron jobs are skipped (local only); the worker runs them';
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'i18n_text') then
    create domain public.i18n_text as jsonb
      check (jsonb_typeof(value) = 'object' and value <> '{}'::jsonb);
  end if;
end
$$;

create schema if not exists app;
create schema if not exists content;
create schema if not exists learn;
create schema if not exists game;
create schema if not exists social;
create schema if not exists billing;
create schema if not exists ai;
create schema if not exists notify;
create schema if not exists ops;

create or replace function app.touch_updated_at() returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Runs `stmt` only when pgvector is installed; otherwise prints one NOTICE naming what was skipped.
create or replace function ops.if_vector(stmt text, what text) returns void
  language plpgsql
as $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute stmt;
  else
    raise notice 'pgvector missing: skipped %', what;
  end if;
end
$$;
