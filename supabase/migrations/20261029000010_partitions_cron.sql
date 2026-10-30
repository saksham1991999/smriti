-- 0010: initial partitions and pg_cron jobs (DB_SCHEMA §13).
set search_path = public, extensions;

-- learn.srs_cards: hash by user_id, 16 partitions.
do $$
begin
  for i in 0..15 loop
    execute format(
      'create table if not exists learn.srs_cards_p%s partition of learn.srs_cards for values with (modulus 16, remainder %s)',
      lpad(i::text, 2, '0'), i);
  end loop;
end
$$;
create trigger srs_cards_touch before update on learn.srs_cards
  for each row execute function app.touch_updated_at();

-- Monthly range partitions. Creates `months` partitions starting at the month of `start_day`.
-- Idempotent; the cron job (or the worker, where pg_cron is missing) calls it a week ahead.
create or replace function ops.create_monthly_partitions(parent text, start_day date, months integer)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  first_day date := date_trunc('month', start_day)::date;
  created integer := 0;
  lo date;
  hi date;
  part text;
  schema_name text := split_part(parent, '.', 1);
  table_name text := split_part(parent, '.', 2);
begin
  for i in 0..(months - 1) loop
    lo := (first_day + make_interval(months => i))::date;
    hi := (first_day + make_interval(months => i + 1))::date;
    part := format('%s_%s', table_name, to_char(lo, 'YYYYMM'));
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = schema_name and c.relname = part
    ) then
      execute format('create table %I.%I partition of %I.%I for values from (%L) to (%L)',
                     schema_name, part, schema_name, table_name, lo, hi);
      created := created + 1;
    end if;
  end loop;
  return created;
end
$$;

-- Every partitioned-by-month table gets a default partition as a safety net (rows outside the
-- created months, for example a phone with a wrong clock), plus partitions from 12 months back
-- to 3 months ahead. Offline events can arrive late, so the past months exist too.
do $$
declare
  t text;
begin
  foreach t in array array['learn.srs_reviews','learn.question_attempts','game.xp_ledger','ai.tutor_messages','notify.log'] loop
    perform ops.create_monthly_partitions(t, (now() - interval '12 months')::date, 16);
    execute format('create table if not exists %s_default partition of %s default', t, t);
  end loop;
end
$$;

create or replace function ops.ensure_partitions_ahead() returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  t text;
begin
  foreach t in array array['learn.srs_reviews','learn.question_attempts','game.xp_ledger','ai.tutor_messages','notify.log'] loop
    perform ops.create_monthly_partitions(t, now()::date, 3);
  end loop;
end
$$;

-- Guests with no server activity for 90 days are removed (TRD §6); their rows cascade.
create or replace function ops.cleanup_idle_guests(idle interval default interval '90 days') returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  n integer;
begin
  with idle_guests as (
    select u.id
      from auth.users u
     where u.is_anonymous
       and u.created_at < now() - idle
       and not exists (
         select 1 from learn.activity_days d
          where d.user_id = u.id and d.last_event_at > now() - idle
       )
  )
  delete from auth.users u using idle_guests g where u.id = g.id;
  get diagnostics n = row_count;
  return n;
end
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('smriti-partitions-ahead', '0 3 * * *', 'select ops.ensure_partitions_ahead()');
    perform cron.schedule('smriti-idle-guests', '30 3 * * *', 'select ops.cleanup_idle_guests()');
  else
    raise notice 'pg_cron missing: partition upkeep and guest cleanup run from the worker cron instead';
  end if;
end
$$;
